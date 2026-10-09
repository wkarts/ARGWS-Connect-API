#!/usr/bin/env python3
"""Finish PR 226 source migration. Never operates on installed deployments."""
from pathlib import Path
import re, json, subprocess, hashlib
import yaml
R=Path.cwd(); N=R/'transcription-service'
# Historical reports describe their actual old deployment; do not rewrite history.
for name in ['docs/releases/1.3.0.md','docs/reviews/speech-correction-2026-10-07.md']:
 p=R/name
 p.write_bytes(subprocess.check_output(['git','show','HEAD:'+name]))
# Remove dead Transformers model-cache code and its no-op environment controls.
p=N/'src/storage.js';s=p.read_text();a=s.index('function modelCachePrefix(');b=s.index('function extensionFor(',a);s=s[:a]+s[b:]
for name in ['modelCachePrefix','restoreModelCache','persistModelCache']:s=s.replace('  '+name+',\n','')
p.write_text(s)
p=N/'src/config.js';s=p.read_text();s=s.replace("    syncModelCache: boolean('SPEECH_SYNC_MODEL_CACHE', false),\n",'');a=s.index('    modelStoragePrefix: ');b=s.index('    rabbitmq: ',a);s=s[:a]+s[b:];a=s.index('  if (!config.modelStoragePrefix');b=s.index('  if (!config.local.model',a);s=s[:a]+s[b:];p.write_text(s)
p=N/'src/inference-client.js';p.write_text(p.read_text().replace('config: { ...localConfig, syncModelCache: false }','config: localConfig'))
retired_cache=['SPEECH_SYNC_MODEL_CACHE','TRANSCRIPTION_MODEL_STORAGE_PREFIX','TRANSCRIPTION_MODEL_CACHE_DIR']
paths=[R/'docker-compose.yaml',R/'docker-compose.dev.yaml']+[p for p in (R/'deploy').rglob('*') if p.is_file()]+[R/'.env.example',R/'env.example']
for p in paths:
 try:s=p.read_text()
 except UnicodeError:continue
 if p.suffix in ['.yaml','.yml'] or p.name in ['env.example','.env.example'] or p.name.endswith('.env.example'):
  for k in retired_cache:s=re.sub(r'^[ \t]*'+k+r'[:=][^\n]*\n','',s,flags=re.M)
  s=s.replace('# Prefixo legado do cache de modelo em S3/MinIO; o download gerenciado usa SPEECH_MODELS_HOST_PATH.\n','')
  s=s.replace('# Diretório persistente de compatibilidade; normalmente use SPEECH_MODEL_PATH.\n','')
  s=s.replace('worker local','serviço opcional').replace('worker de transcrição','serviço de transcrição').replace('TRANSCRIPTION WORKER','TRANSCRIPTION SERVICE')
  p.write_text(s)
# The new repository cannot have the historical canonical 1.3.0 image tag. Core
# remains pinned; ASR defaults to the published stable channel with explicit override.
for name in ['deploy/canonical/compose.yaml','deploy/canonical/env.example']:
 p=R/name;p.write_text(p.read_text().replace('connect-transcription-service:1.3.0','connect-transcription-service:latest'))
# Tests retain stronger negative assertions instead of requiring an unused cache.
p=R/'.github/workflows/deployment-integrity.yml';s=p.read_text();s=s.replace("assert transcription_worker.get('environment', {}).get('TRANSCRIPTION_MODEL_STORAGE_PREFIX') == 'transcription-models'", "assert 'TRANSCRIPTION_MODEL_STORAGE_PREFIX' not in transcription_worker.get('environment', {})")
s=s.replace('prefixo de cache do modelo deve ficar no bucket','cache legado de modelo nao deve ser configurado');p.write_text(s)
p=R/'test/compose-env-only-deployments.test.py';s=p.read_text();s=re.sub(r"self\.assertEqual\(([^\n]+)\['TRANSCRIPTION_MODEL_STORAGE_PREFIX'\], 'transcription-models'\)",r"self.assertNotIn('TRANSCRIPTION_MODEL_STORAGE_PREFIX', \1)",s);p.write_text(s)
# Preserve detection/containment of old installations while recognizing the new
# service. Removed worker flags are diagnostic historical input, not requirements.
p=R/'scripts/connect-startup-diagnose.py';s=p.read_text();s=s.replace("r'^(?:(?:transcription|dictation|speech)-worker|speech-(?:dictation|transcription)-worker)","r'^(?:transcription-service|(?:transcription|dictation|speech)-worker|speech-(?:dictation|transcription)-worker)")
s=s.replace("(?:argws-connect-|connect-)?(?:(?:transcription|dictation|speech)-worker|speech-(?:dictation|transcription)-worker)","(?:argws-connect-|connect-)?(?:transcription-service|(?:transcription|dictation|speech)-worker|speech-(?:dictation|transcription)-worker)")
s=s.replace("if any(record['environment'].get('SPEECH_WORKER_MODE') != 'pool' for record in workers):", "if any('-worker' in record['service'] for record in workers):")
s=s.replace('Há worker sem SPEECH_WORKER_MODE=pool no ambiente observado. Pode haver Compose legado ou configuração diferente; conferir revisão/digest e arquivo efetivo.', 'Há executor de fala legado no projeto. Drene os jobs e retire somente esses containers antes de ativar o serviço nativo; conferir revisão/digest e arquivo efetivo.')
p.write_text(s)
# Update operator-facing runtime documentation; do not alter other service guidance.
p=R/'deploy/README.md';s=p.read_text();a=s.index('Todos os Compose de aplicação incluem');b=s.index('Kafka e ZooKeeper',a)
s=s[:a]+'''Todos os dez Compose de aplicação incluem somente o serviço opcional
`transcription-service` (com sufixo de instalação onde aplicável), inclusive
Fersoft develop e production. Não há worker separado de transcrição ou ditado.
Não é necessário aplicar um overlay: o serviço já está nos arquivos-base.
O perfil `transcription` fica fora de `COMPOSE_PROFILES` por padrão em todos os exemplos.
A API, áudio, vídeo, chamadas, Zapo, Baileys e Meta-compatible não dependem do ASR.

As variáveis novas são `TRANSCRIPTION_SERVICE_IMAGE`, `SPEECH_SERVICE_MEMORY`,
`SPEECH_SERVICE_CPUS` e `SPEECH_SERVICE_TMPFS_SIZE`. Seletores, concorrência e
réplicas dos executores antigos não integram mais os exemplos. A imagem nativa
é `ghcr.io/wkarts/connect-transcription-service`; release/develop a publicam
no mesmo fluxo dos demais componentes. A PR nunca publica imagens.
O core canonical conserva suas imagens fixadas; para seu novo ASR, fixe
explicitamente uma versão publicada usando `TRANSCRIPTION_SERVICE_IMAGE`.

Antes de atualizar uma instalação antiga, drene/cancele os jobs de fala e
pare/remova somente os antigos containers de transcrição/ditado do projeto.
Renomear no YAML não remove um container em execução. Preserve `.env`, segredos,
volumes, banco, filas e modelos. Não use `down -v` nem prune global.
Os comandos gerais de atualização acima não substituem essa drenagem prévia.

Para habilitar, acrescente `transcription` aos perfis existentes, ative somente
as flags de fala desejadas e provisione o modelo nativo verificado. Não copie
`env.example` sobre um ambiente instalado e não reutilize um seletor Transformers
como se fosse um modelo GGML. O reconhecimento é local, CPU-only, mas utiliza
um modelo ASR e recursos reais de CPU/RAM. Não há promessa de latência zero.

Consulte [o guia de migração e ativação](../docs/guides/optional-transcription-service.md)
para a lista de parâmetros, formatos, limites, provisão offline e retirada segura.
Os jobs, eventos, rotas e contratos existentes continuam os mesmos.

'''+s[b:];p.write_text(s)
p=R/'deploy/speech/README.md';s=p.read_text();s=s.replace('## Configuração de canário','## Configuração do serviço opcional')
s=s.replace('A configuração padrão do adaptador Transformers mantém\n4 GiB por pool e não deve receber o teto do canário sem medição.', 'Não existe mais executor Transformers nas novas imagens. O reconhecimento\nutiliza o modelo nativo e sua qualidade PT-BR precisa de avaliação própria.')
s=s.replace('Não aplique esse teto sem ajuste a dois\nworkers Transformers de 4 GiB.', 'Não aplique o teto a modelos maiores sem medir a demanda total.')
s=s.replace('API e ao worker','API e ao serviço').replace('não crie um segundo worker para ditado','não crie outro serviço para ditado')
s=s.replace('restaure as variáveis do adaptador anterior com o modelo\ncompatível.', 'restaure a revisão anterior no Git, sua imagem e o modelo\ncompatível. O novo Compose não contém um executor alternativo.')
p.write_text(s)
# Stable explanations for every exported example, including hidden aliases.
p=R/'scripts/sync-fersoft-deployments.py';s=p.read_text().replace("# A transcricao neste exemplo descreve a configuracao futura: release bloqueada ate validacao no develop principal.","# Transcricao e ditado sao opt-in no servico nativo unico; nenhum provider depende deles.")
p.write_text(s);subprocess.run(['python3','scripts/sync-fersoft-deployments.py'],check=True)
# Ensure native environment parsing and shutdown defaults match the service image.
p=N/'src/config.js';s=p.read_text().replace("chunkSeconds: integer('SPEECH_CHUNK_SECONDS', 30, 5, 30)","chunkSeconds: integer('SPEECH_CHUNK_SECONDS', 15, 5, 30)").replace("strideSeconds: integer('SPEECH_STRIDE_SECONDS', 5, 0, 15)","strideSeconds: integer('SPEECH_STRIDE_SECONDS', 1, 0, 15)");p.write_text(s)
# Append enforceable non-speech service preservation to the deployment regression.
p=R/'test/speech-service-deployment.test.py';s=p.read_text();pos=s.index(' def test_fersoft_generator_is_reproducible')
s=s[:pos]+''' def test_regular_services_networks_and_volumes_match_the_reviewed_baseline(self):
  import hashlib
  baseline=json.loads((ROOT/'test/fixtures/speech-protected-deployments.json').read_text())
  for name,expected in baseline.items():
   cfg=yaml.safe_load((ROOT/name).read_text()) or {}
   actual={k:v for k,v in cfg.items() if k!='services'}
   actual['services']={k:v for k,v in cfg.get('services',{}).items() if not k.startswith('transcription-service')}
   for service in actual['services'].values():
    if 'environment' in service:
     service['environment']={k:v for k,v in service['environment'].items() if not k.startswith(('SPEECH_','TRANSCRIPTION_','DICTATION_','MANAGER_FEATURE_TRANSCRIPTION'))}
   digest=hashlib.sha256(json.dumps(actual,sort_keys=True,ensure_ascii=True).encode()).hexdigest()
   self.assertEqual(digest,expected,name)
'''+s[pos:];p.write_text(s)
base={}
for name in ['docker-compose.yaml','docker-compose.dev.yaml']+[str(p.relative_to(R)) for p in (R/'deploy').rglob('*') if p.suffix in ['.yaml','.yml']]:
 try:cfg=yaml.safe_load(subprocess.check_output(['git','show','HEAD:'+name],stderr=subprocess.DEVNULL)) or {}
 except subprocess.CalledProcessError:continue
 if not any(k.startswith('transcription-worker') for k in cfg.get('services',{})):continue
 v={k:x for k,x in cfg.items() if k!='services'}
 v['services']={k:x for k,x in cfg.get('services',{}).items() if not k.startswith(('transcription-worker','speech-dictation-worker'))}
 for item in v['services'].values():
  if 'environment' in item:item['environment']={k:x for k,x in item['environment'].items() if not k.startswith(('SPEECH_','TRANSCRIPTION_','DICTATION_','MANAGER_FEATURE_TRANSCRIPTION'))}
 base[name]=hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=True).encode()).hexdigest()
(R/'test/fixtures/speech-protected-deployments.json').write_text(json.dumps(base,indent=2)+'\n')
# No credential-bearing inputs or authoring machinery belong in the release tree.
print('Finalized deployment migration; other services fingerprinted:',len(base))

p=R/'test/connect-startup-diagnose.test.py';s=p.read_text().replace("worker = 'worker' in service", "worker = 'worker' in service or service.startswith('transcription-service')");p.write_text(s)
# A replacement image has no old tag; explicitly pinned overrides remain allowed.
p=R/'tools/connect-deployer/test/index.test.cjs';p.write_text(p.read_text().replace('connect-transcription-service:1.3.0','connect-transcription-service:latest'))
p=R/'.github/workflows/image-promotion-integrity.yml';s=p.read_text().replace('[[ "$canonical_worker" =~ ^ghcr\\.io/wkarts/connect-transcription-service:[0-9]+\\.[0-9]+\\.[0-9]+$ ]]','[[ "$canonical_worker" == "ghcr.io/wkarts/connect-transcription-service:latest" ]]').replace('connect-transcription-service:1.3.0','connect-transcription-service:latest');p.write_text(s)
for name in ['tools/connect-deployer/index.cjs','tools/connect-deployer/native/src/lib.rs']:
 p=R/name;s=p.read_text().replace('"TRANSCRIPTION_WORKER_TMPFS_SIZE"]','"TRANSCRIPTION_WORKER_TMPFS_SIZE", "SPEECH_SYNC_MODEL_CACHE", "TRANSCRIPTION_MODEL_STORAGE_PREFIX", "TRANSCRIPTION_MODEL_CACHE_DIR"]');p.write_text(s)
# Remove authoring helpers from the proposed tree. Do not update any Git ref here.
for name in ['.github/workflows/speech-service-migration.yml','.github/migrations/speech-service-inputs.zip','.github/migrations/speech-finalize.py']:
 (R/name).unlink(missing_ok=True)
# Publish the new regression suite and its exact baseline despite the repository's
# default /test/* ignore rule; leave all other local test files ignored.
p=R/'.gitignore';s=p.read_text();s+='\n# Single-service deployment regression and protected non-ASR baseline.\n!/test/speech-service-deployment.test.py\n!/test/fixtures/\n/test/fixtures/*\n!/test/fixtures/speech-protected-deployments.json\n';p.write_text(s)
p=R/'test/speech-model-download.test.ts';s=p.read_text();block="// Historical ONNX manifest compatibility, not an installed inference engine.\nprocess.env.SPEECH_ENGINE = 'transformers';\n";s=s.replace(block+'\n'+block,block);p.write_text(s)

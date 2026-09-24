#!/usr/bin/env python3
"""Materialize two opt-in full-stack deployments, without modifying their parent deployments."""
import argparse
import copy
import importlib.util
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ops', ROOT/'scripts/prepare-operations-env.py')
ops = importlib.util.module_from_spec(spec); spec.loader.exec_module(ops)

def generate():
    result = {}
    for channel in ('develop', 'production'):
        folder = Path('deploy')/channel/'full-stack'; suffix = 'argws-connect-'+channel
        compose = yaml.safe_load((ROOT/f'deploy/{channel}/compose.yaml').read_text())
        services = compose['services']
        # Only the API is published; Manager and Scalar are served through its existing paths.
        services['docs-'+suffix].pop('ports', None)
        api = services['api-'+suffix]
        api['environment']['NATS_ENABLED'] = '${NATS_ENABLED:-true}'
        api['environment']['KAFKA_ENABLED'] = '${KAFKA_ENABLED:-true}'
        api['environment']['TRACCAR_ENABLED'] = '${TRACCAR_ENABLED:-true}'
        api['environment']['TRACCAR_MODE'] = '${TRACCAR_MODE:-internal}'
        services['kafka-'+suffix]['environment']['KAFKA_AUTO_CREATE_TOPICS_ENABLE'] = '${KAFKA_AUTO_CREATE_TOPICS:-true}'
        mysql = copy.deepcopy(yaml.safe_load((ROOT/'docker-compose.yaml').read_text())['services']['mysql'])
        mysql['container_name'] = 'mysql-'+suffix
        mysql['networks'] = {suffix+'-net': {'aliases': ['mysql-'+suffix]}}
        mysql['healthcheck']['test'] = ['CMD-SHELL', 'MYSQL_PWD="$${MYSQL_ROOT_PASSWORD}" mysqladmin ping -h 127.0.0.1 -u root --silent']
        services['mysql-'+suffix] = mysql
        text = yaml.safe_dump(compose, sort_keys=False, allow_unicode=True, width=120)
        text = text.replace(':-./volumes/', ':-../volumes/')
        result[folder/'compose.yaml'] = '# Alternative full-stack profile. Parent deployment is preserved.\n'+text
        env = (ROOT/f'deploy/{channel}/env.example').read_text()
        for key, value in {'COMPOSE_PROFILES':'operations,nats,kafka,mysql,traccar','OPERATIONS_ENABLED':'true',
          'NATS_ENABLED':'true','KAFKA_ENABLED':'true','KAFKA_AUTO_CREATE_TOPICS':'true','MYSQL_SERVICE_ENABLED':'true',
          'TRACCAR_ENABLED':'true','TRACCAR_MODE':'internal','TRACCAR_REPLICAS':'1',
          'FINDHUB_MIN_TRACKING_INTERVAL_SECONDS':'0','FINDHUB_STORE_POSITION_HISTORY':'true',
          'SERVER_DISABLE_DOCS':'false','SERVER_DISABLE_MANAGER':'false'}.items():
            env = ops.set_value(env, key, value)
        env = env.replace('=./volumes/', '=../volumes/')
        env = '# FULL STACK: API unica porta; services locais opcionais selecionados por padrao.\n'+env
        env = env.replace('# Duas portas locais publicadas: API e Connect|API DOCs. Manager permanece em /manager.', '# Uma porta local publicada: API. Manager e DOCs permanecem na API.')
        result[folder/'env.example'] = env
        for script in ('prepare-operations-env.py','prepare-findhub-env.py','prepare-traccar-env.py','traccar-bootstrap.cjs'):
            result[folder/script] = (ROOT/'scripts'/script).read_text()
        result[folder/'prepare-env.py'] = (ROOT/'scripts/prepare-full-stack-env.py').read_text()
        result[folder/'prepare-volumes.py'] = (ROOT/'scripts/prepare-full-stack-volumes.py').read_text()
        result[folder/'check-runtime.py'] = (ROOT/'scripts/check-full-stack-runtime.py').read_text()
        result[folder/'prepare-env.sh'] = '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\npython3 ./prepare-env.py "$@"\n'
        result[folder/'deploy.sh'] = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-env.py --check
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml pull
python3 ./prepare-volumes.py
docker compose --env-file .env -f compose.yaml up -d --pull never
python3 ./check-runtime.py
'''
        result[folder/'README.md'] = f'''# Full stack — {channel}

Alternativa ao deploy pai, nao um segundo stack simultaneo. Preserva nomes dos containers,
projeto e rede do perfil {channel}. Os dados padrao ficam em `../volumes`, no diretorio do deploy pai.
Nao execute as duas configuracoes ao mesmo tempo. Nao execute `down -v`.

## Atualizar uma instalacao existente

Faça backup privado do `.env`, dos dados e das chaves. Nesta pasta:

```bash
bash prepare-env.sh --from-env ../.env
bash deploy.sh
```

A importacao nao altera a origem. Preserva todos os parametros, senhas, chave da API e cofre Find Hub,
e resolve cada caminho relativo de volume contra o local ORIGINAL do `.env` importado.
Nao importe o `.env` de develop na producao. Se `.env` ja existe nesta pasta, o script recusa sobrescreve-lo.
Execute `bash prepare-env.sh --all-services` para habilitar novamente todos os opcionais.

## Instalacao nova

```bash
bash prepare-env.sh
bash deploy.sh
```

Segredos novos e independentes sao gerados localmente, uma unica vez. O arquivo recebe permissao 0600.
Instalacoes com dados anteriores devem importar o ambiente correspondente, nao criar senhas novas.

## Servicos

14 servicos: API/Manager, DOCs, PostgreSQL principal, Redis, RabbitMQ, MinIO, Operations,
NATS/JetStream, Kafka, ZooKeeper, MySQL auxiliar, Traccar, PostgreSQL Traccar e bootstrap Traccar.
O bootstrap e uma tarefa finita; terminar com codigo 0 e o resultado correto, nao um container quebrado.
O deploy prepara os binds vazios de MySQL/Kafka/ZooKeeper para o UID/GID real das imagens antes do start.
Nao usa chmod 777, chown recursivo, volumes nomeados novos ou banco em root. Diretorios com dados
ja gravados nunca tem dono alterado automaticamente; permissoes incompativeis interrompem o deploy.
Execute `python3 prepare-volumes.py` antes de um `docker compose up` manual.
`check-runtime.py` aguarda todos os servicos selecionados e testa API, MySQL, Kafka e NATS.
Se falhar, `full-stack-diagnostics.json` preserva o diagnostico sanitizado sem exportar o .env.
PostgreSQL permanece o banco principal; subir MySQL nao migra o banco da API.

`COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar`. Cada recurso pode ser desabilitado
pelas flags `OPERATIONS_ENABLED`, `NATS_ENABLED`, `KAFKA_ENABLED`, `MYSQL_SERVICE_ENABLED`
e `TRACCAR_ENABLED`. Execute o preparador depois de editar flags para sincronizar profiles.
Traccar aceita `internal`, `external` ou `disabled`; externo nao inicia os containers internos.
No modo interno a API usa `http://traccar:8082`; o bootstrap utiliza as credenciais administrativas locais.
Uma chave da Connect API nao e um token Traccar. Se o token importado for igual a chave da API,
apenas esse token Traccar indevido e esvaziado para usar autenticacao administrativa interna.
Credenciais ja usadas por bancos ou Traccar NAO sao rotacionadas em atualizacoes.

Servicos cloud nao sao containers locais: SQS/Pusher e APIs de IA exigem as credenciais do titular.
Os modulos continuam disponiveis como no pai, mas nenhum destino global sem credenciais e inventado.
As configuracoes globais de eventos existentes nao sao alteradas silenciosamente.
Telemetria permanece desabilitada. Nao foram acrescentados Nginx/Traefik.

Somente a porta da API e publicada no host; Manager `/manager`, DOCs `/manager/docs`.
Nao e preciso expor Traccar, bancos, brokers, MinIO ou Operations publicamente.

## Imagens e compatibilidade

Este perfil conserva `{'develop' if channel=='develop' else 'latest'}` para API/DOCs; bases seguem o catalogo GHCR existente.
Novos endpoints/avatar/timeout exigem uma imagem com esta implementacao. Criar este deploy nao promove
`latest`, nao publica imagens nem modifica a versao canonica 1.1.3.
O perfil production usa somente a imagem estavel aprovada pelo operador.

`docker compose --env-file .env -f compose.yaml config --services` lista servicos selecionados sem imprimir segredos.
`config` sem `--quiet` pode revelar segredos; nao publique sua saida.
'''
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    pending=[]
    for name,text in generate().items():
        path=ROOT/name
        if not path.exists() or path.read_text()!=text:
            if args.check:pending.append(str(name))
            else:
                path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
                if path.suffix in ('.sh','.py'):path.chmod(0o755)
    if pending:raise SystemExit('Full stacks desatualizadas: '+', '.join(pending))
    print('Full stacks develop/production sincronizadas.')
if __name__=='__main__':main()

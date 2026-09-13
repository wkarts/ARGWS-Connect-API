# Pull Request

## Branch

`fix/zapo-multidevice-calls`

## Título

`fix(voip): corrige atendimento e encerramento entre dispositivos Zapo`

## Descrição

### Contexto

Chamadas entre contas com Connect API vinculada podiam cair quando o celular atendia e deixar sessões antigas tocando/ativas. A análise do MHTML foi confrontada com o ZIP `ARGWS-Connect-API-develop (18).zip` e com o pacote npm exato utilizado. As falhas de signaling foram reproduzidas em testes com as classes reais da dependência.

### Objetivo

Preservar o aparelho que atende, sincronizar o encerramento da sessão companion e evitar acúmulo de chamadas, mantendo a biblioteca e os contratos existentes.

### Escopo

Incluído: patch local de `@innovatorssoft/voip@1.0.0` para CJS/ESM, integração de instalação/Docker, estados do adaptador/Manager, respostas de encerramento/recusa, testes e guia operacional.

Fora do escopo: alterações no HUB, troca de provider, fork, migrations, limpeza de banco, exclusão de instâncias, deploy em produção e homologação com contas WhatsApp reais.

### Decisões técnicas e arquitetura

- Manter `@innovatorssoft/voip@1.0.0` e `@innovatorssoft/zapo-js@1.6.3`.
- Aplicar substituições determinísticas em arquivos da dependência com SHA-256 antes/depois; builds diferentes falham explicitamente.
- Resolver PN/LID somente para comparação da identidade. Preservar os JIDs originais de signaling e mídia/SRTP.
- Tratar o primeiro atendimento como vencedor; eventos de outro dispositivo não assumem a chamada.
- Ao receber atendimento no próprio celular, encerrar apenas a sessão companion, sem hangup no interlocutor.
- Publicar sucesso local de encerramento apenas depois dos envios; falhas de envio deixam a chamada disponível para nova tentativa. Isso não equivale à confirmação remota de recepção.

### Alterações realizadas

1. Comparação por conta PN/LID e device, considerando `:0` equivalente ao aparelho principal.
2. Proteções de direção/estado/concorrência no atendimento e preservação da mídia após ACK atrasado.
3. Tratamento de término mesmo com JID não normalizável ou falha no ACK.
4. Retenção dos destinos reais da oferta para cancelamento antes do ACK e propagação aos devices envolvidos.
5. Recusa remota tratada, distinguindo device ocupado do conjunto de destinatários e revalidando o vencedor após operações assíncronas.
6. Mapeamento dos estados reais do pacote e `accepted_elsewhere` no webhook/Manager.
7. Respostas de `endCall`/`rejectCall` normalizadas após a operação nativa.

### Arquivos adicionados

- `patches/zapo-voip-1.0.0.json` — substituições e hashes dos seis arquivos CJS/ESM.
- `scripts/apply-zapo-voip-patch.cjs` — aplicação e verificação idempotentes.
- `.github/workflows/zapo-voip-regression.yml` — testes em Node 22.
- `test/zapo-voip-signaling.test.cjs` — 20 cenários com classes e criptografia reais.
- `test/zapo-voip-installer.test.cjs` — 14 cenários do instalador.
- `test/zapo-call-lifecycle.test.cjs` — 8 cenários de contrato/Manager/serviço.
- `docs/operations/zapo-multidevice-calls.md` — guia de operação e homologação.
- `CORRECAO-CHAMADAS-MULTIDEVICE.md` — esta descrição técnica.

### Arquivos modificados

- `.gitignore` — versionamento explícito das três novas suítes.
- `Dockerfile` — disponibilizar installer/manifesto antes da instalação e na imagem final.
- `package.json` — `postinstall`, `patch:zapo-voip` e `test:voip`.
- `package-lock.json` — registrar existência do script de instalação, sem atualizar dependências.
- `scripts/check-zapo-runtime.cjs` — validar hashes do patch.
- `src/api/integrations/channel/whatsapp/zapo.call-contract.helpers.ts` — estados reais e motivos terminais.
- `src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts` — snapshots após end/reject.
- `manager/src/services/normalizers.ts` — status canônico e indicador terminal.
- `manager/src/views/VoiceView.vue` — lista ativa e mídia local coerentes com término.

### Arquivos removidos

Não se aplica a esta alteração.

### Banco de dados

Não se aplica a esta alteração. Não há migration, seed, DROP ou alteração de dados. A geração do cliente Prisma usada no build não se conecta ao banco nem aplica migrations.

### APIs, contratos e integrações

Métodos, rotas, autenticação e payloads de entrada preservados. `POST /call/end/{instanceName}` e `POST /call/reject/{instanceName}` continuam usando `callId`; o snapshot de saída reflete o estado após a operação. `GET /call/list/{instanceName}` permanece consultando o plugin real. O evento `CALL` mantém seu formato e passa a reconhecer os estados da versão utilizada. Falha real de envio em `endCall` propaga erro, em vez de indicar sucesso somente local.

### Dependências e configurações

Nenhuma dependência adicionada, removida ou atualizada. Nenhuma variável ou segredo novo. `postinstall` aplica o patch tanto no npm local quanto no Docker. Se usar `--ignore-scripts`, executar `npm run patch:zapo-voip`. `runtime:deps:check` impede aprovar um build sem o patch.

### Segurança e privacidade

Cache de identidade por sessão; sem estado global entre instâncias. Equivalência PN/LID depende do resolver existente, sem igualar somente o número do device. Não há tokens no patch ou nos testes. O instalador valida versão, paths, links, hashes e todas as substituições antes das escritas.

### Desempenho e observabilidade

O resolver usa cache da biblioteca e cache por chamada, com timeout de 5 segundos. Cancelamentos anteriores ao atendimento geram envios adicionais limitados aos participantes da chamada. Falhas de identidade, participantes inválidos e quantidade de envios malsucedidos são registradas. Nenhuma varredura de histórico ou consulta adicional de banco foi introduzida.

### Testes implementados

42 casos: vencedor PN/LID, device zero, accepts duplicados/concorrentes, atendimento na própria conta, encerramento com ACK/JID problemático, três chamadas sem acúmulo, recusa/busy, oferta e encerramento concorrentes, retry de envio, SSRC, SRTP e proteção contra replay após ACK atrasado, contrato da UI/API e integridade do instalador.

### Testes executados

- `npm run test:voip`: **42 aprovados, 0 falhas**.
- Mesmos 20 testes de signaling contra pacote original: **4 aprovados, 16 falhas**; contra pacote corrigido: **20 aprovados, 0 falhas**.
- `npm run build`: build da API aprovado, incluindo TypeScript e runtime checker.
- `npm --prefix manager run build`: typecheck e build do Manager aprovados.
- `npx tsc --noEmit`: aprovado após as alterações finais no serviço.
- ESLint dos dois arquivos TypeScript modificados na API: aprovado.
- `npm run docs:check`: contratos OpenAPI/AsyncAPI sincronizados.
- Imports reais CJS e ESM de `@innovatorssoft/voip`: aprovados.
- `git diff --check`: aprovado.

Ambiente local Linux com Node 24.19.0. CI nova configurada para Node 22; não se confunde com execução local. O harness usa rede e hardware de áudio simulados, mas router, manager, sessão, builders, normalização e criptografia reais.

### Testes recomendados

Homologação de chamadas com duas contas, celulares e instâncias reais; áudio bidirecional; combinações API/HUB/mobile/desktop; build Docker no pipeline do projeto. Esses testes não foram executados neste ambiente.

### Validação manual

1. Instalar a imagem corrigida nas duas APIs de teste.
2. Ligar A → B e atender no celular B; A deve manter a chamada, API B limpar apenas a sessão companion.
3. Repetir atendendo no Manager/HUB da API B.
4. Encerrar antes e depois do atendimento; verificar ambas as APIs.
5. Repetir três chamadas e consultar a lista: nenhuma sessão antiga ativa.
6. Validar áudio nos dois sentidos e regressões Mobile/Desktop ↔ API.
7. Testar recusa e um device ocupado com outro disponível.

### Impactos e compatibilidade

Sem breaking change de endpoint ou schema. Correção sensível a detalhes do protocolo, limitada à versão exata do pacote. O build recusa dependência divergente. Falhas de identificação preservam o possível vencedor; a confirmação completa de compatibilidade com a rede WhatsApp depende de homologação real.

### Procedimento de deploy

1. Usar a branch corrigida e reconstruir a imagem pelo fluxo habitual. Um restart da imagem anterior não incorpora a correção.
2. Conferir `npm run test:voip` e `npm run runtime:deps:check` no build.
3. Reiniciar a API de forma controlada sem chamadas legítimas em andamento, preservando volumes/pareamento.
4. Conferir healthcheck e executar a matriz de homologação nas duas contas.

Nenhuma migration é necessária para este patch. Não excluir instâncias nem volumes.

### Procedimento de rollback

Se houver regressão comprovada, reimplantar somente a imagem anterior, preservando banco e volumes. Não executar reset amplo de branch, restauração de banco ou despareamento. Nenhum rollback foi executado nesta entrega.

### Build, release e distribuição

Projeto-fonte corrigido fornecido em ZIP. Dependência continua vindo do lockfile e recebe o patch no `postinstall`. Builds locais de API e Manager aprovados. Imagem Docker, release e deploy em produção não publicados por esta tarefa.

### Documentação

`docs/operations/zapo-multidevice-calls.md` documenta comportamento, instalação, limites de evidência, origem do pacote e matriz de homologação. Nenhuma rota/evento novo; contratos gerados continuam sincronizados.

### Checklist

- [x] Implementação e diff revisados.
- [x] Regressões reproduzidas no pacote original.
- [x] Arquivos e alterações documentados.
- [x] Contratos, dependências e configuração preservados.
- [x] Ausência de alteração de banco confirmada.
- [x] Testes automatizados executados.
- [x] Build local e documentação verificados.
- [x] Deploy e reversibilidade documentados.
- [ ] Homologação com aparelhos e contas WhatsApp reais.
- [ ] Build Docker e execução do CI remoto.

## Commit sugerido

`fix(voip): corrige atendimento e encerramento entre dispositivos Zapo`

## Merge sugerido

Squash da branch corrigida após os checks e a homologação de chamadas.

## Versão sugerida

Patch: `1.0.27` → `1.0.28`, pelo fluxo de release existente. A versão não foi incrementada manualmente nesta correção.

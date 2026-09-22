# Google Find Hub — implantação e API

O provider `GOOGLE-FIND-HUB` representa uma conta Google autorizada por instância. Os dispositivos pertencem àquela instância; o Manager e as integrações externas utilizam a mesma API. O canal é nativo TypeScript, sem GoogleFindMyTools, Python de localização, VNC, Selenium ou Chromium no servidor.

> **Autenticação assistida e limites:** o Manager oferece agora a opção de vinculação por uma extensão própria, com aprovação explícita da origem, do servidor e da conta. Ela obtém somente o artefato de login e a chave `finder_hw`, sem copiar tokens manualmente. A implementação **não implementa um login Google OAuth público** nem garante login puramente web em PC/mobile: exige Chrome/Edge desktop com a extensão e permanece sem homologação com conta Google real. O modo `CredentialProvider` por importação continua como alternativa avançada. Não informe senha/PIN à API; digite-os somente no Google.

## 1. Corrigir `FINDHUB_CREDENTIALS_KEY is required`

`FINDHUB_CREDENTIALS_KEY` é uma chave **local do servidor**, usada por AES-256-GCM para cifrar as credenciais no banco. Não é uma API key do Google Cloud, token do Traccar ou segredo que o usuário deva preencher no Manager.

Na pasta da stack que contém o `.env` efetivamente usado:

```bash
# Prepara somente as configurações Find Hub. Preserva o restante do .env.
python3 ./prepare-findhub-env.py --env-file .env

# Verifica sem mostrar o segredo.
python3 ./prepare-findhub-env.py --env-file .env --check --require-key
```

`prepare-env.sh` também chama esse preparador nos perfis com instalador. Uma chave existente válida nunca é rotacionada. Uma chave não vazia e inválida é rejeitada, não substituída. O arquivo é gravado com permissão 0600. **Se você já possuía contas cifradas e perdeu a chave, restaure a chave do backup: gerar outra não recupera os dados antigos.**

Para configuração manual, gere uma única vez com `openssl rand -hex 32`, guarde o resultado em `FINDHUB_CREDENTIALS_KEY` no `.env` e não exponha o valor no frontend. Aceita 64 caracteres hex ou base64 de 32 bytes.

Recrie o container da API: `restart` não reaplica mudanças de ambiente. Exemplo específico do perfil `deploy/develop`:

```bash
docker compose --env-file .env -f compose.yaml up -d --no-deps --force-recreate api-argws-connect-develop

docker compose --env-file .env -f compose.yaml exec -T api-argws-connect-develop \
  node -e 'const v=process.env.FINDHUB_CREDENTIALS_KEY||"";const b=/^[0-9a-f]{64}$/i.test(v)?Buffer.from(v,"hex"):Buffer.from(v,"base64");if(b.length!==32)process.exit(1);console.log("Chave Find Hub presente: 32 bytes; valor oculto")'
```

Nos perfis raiz, CloudPanel, Dockge e homologação, o serviço pode se chamar `api`; respeite o nome do seu Compose. No Portainer/Dockge, salve as variáveis no ambiente da stack e recrie o serviço. No Swarm, o CLI `docker stack deploy` não carrega `.env` como o Compose: forneça as variáveis no ambiente do comando ou renderize o arquivo com `docker compose --env-file ... config` para um arquivo protegido antes do deploy. Não publique o YAML renderizado com segredos.

## 2. Variáveis do canal

| Variável | Padrão no template | Uso |
| --- | --- | --- |
| `FINDHUB_CREDENTIALS_KEY` | vazio; preparador gera chave dedicada | Cifra credenciais. Obrigatória ao instanciar Find Hub; não é exigida pelos providers WhatsApp. |
| `FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS` | `60` | Intervalo inicial de novos dispositivos. |
| `FINDHUB_MIN_TRACKING_INTERVAL_SECONDS` | `30` | Mínimo aplicado ao iniciar tracking. |
| `FINDHUB_LOCATION_TIMEOUT_MS` | `30000` | Espera máxima da solicitação de posição. |
| `FINDHUB_STORE_POSITION_HISTORY` | `false` | Histórico opt-in no banco. Não impede a resposta de localização ou os eventos. |
| `FINDHUB_TRACCAR_TIMEOUT_MS` | `10000` | Timeout HTTP do adaptador Traccar. |

Todos os templates de API e o modelo Swarm repassam esses parâmetros explicitamente. A documentação possui configuração própria de Scalar, **sem chave Find Hub**. O inventário versionado está em `docs/operations/findhub-deployment-coverage.json`.

A alteração não troca tags de imagem dos perfis estáveis/canônicos. O canal exige uma imagem que já contenha sua implementação; após a PR 118, isso corresponde ao canal `develop`, não implica promoção automática para `latest`.

## 3. Banco, rede e conservação da chave

As migrations existentes criam `FindHubAccount`, `FindHubDevice`, `FindHubPosition` e `FindHubTraccarBinding` nos providers PostgreSQL/MySQL. Use o procedimento de migration da stack; não crie as tabelas manualmente nem apague dados para corrigir uma chave ausente.

O tráfego é de saída: HTTPS para autenticação/Nova/Spot/FCM do Google e TLS para `mtalk.google.com:5228`. Não é necessário publicar porta 5228 na VPS nem criar um serviço Find Hub separado. O Traccar deve ser acessível pelo container da API. A frequência de posição depende do Google, da rede e do aparelho.

Mantenha o `.env`/secret com backup protegido e acesso restrito. Reutilize a **mesma chave** após restart, atualização e restauração de banco. Não copie a chave para Scalar, Manager, URL, webhook ou analytics.

## 4. Autenticação da API e criação da instância

Os endpoints utilizam o header `apikey` da Connect|API: chave administrativa ou token autorizado da instância, conforme os guards existentes. Nunca confunda esse header com `FINDHUB_CREDENTIALS_KEY`.

```http
POST /instance/create
apikey: <CHAVE_ADMINISTRATIVA>
Content-Type: application/json

{"instanceName":"google-operador","integration":"GOOGLE-FIND-HUB","qrcode":false}
```

Depois, com a instância existente e a chave do servidor configurada:

```http
POST /findhub/auth/start/google-operador
apikey: <TOKEN_DA_INSTANCIA>
Content-Type: application/json

{"email":"operador@example.com"}
```

A resposta `201` contém `sessionId`, `bridgeToken`, `state=WAITING_AUTH`, `authMode=credential-provider` e `expiresAt`. A sessão dura dez minutos e reside em memória: uma reinicialização exige iniciar outra sessão. O `bridgeToken` não substitui o header `apikey`.

O provider autorizado conclui por `POST /findhub/auth/import/{instanceName}`, enviando `sessionId`, `bridgeToken`, `email`, `androidId`, `accountToken` (AAS), `sharedKey` e, opcionalmente, `fcm`. A API cifra o bundle e tenta conectar. **Não envie a chave de criptografia do servidor nesse payload.** Consulte `GET /findhub/auth/status/{instanceName}` para acompanhar o estado persistido.

## 5. Dispositivos, posição, tracking e histórico

| Método e rota | Comportamento |
| --- | --- |
| `GET /findhub/devices/{instanceName}` | Catálogo local; não força nova consulta Google. |
| `POST /findhub/devices/refresh/{instanceName}` | Consulta Google e atualiza o catálogo da conta. |
| `GET /findhub/device/{deviceId}/{instanceName}` | Detalha dispositivo; `deviceId` é o ID local retornado na lista. |
| `POST /findhub/locate/{deviceId}/{instanceName}` | Solicita posição. Pode retornar `null` quando não houver relatório utilizável. |
| `POST /findhub/tracking/start/{deviceId}/{instanceName}` | Agenda consultas; body opcional `{"intervalSeconds":60}`. |
| `POST /findhub/tracking/stop/{deviceId}/{instanceName}` | Interrompe consultas desse dispositivo. |
| `GET /findhub/positions/{deviceId}/{instanceName}?limit=100` | Histórico persistido, mais recente primeiro; limite 1–1000. |

O resultado de localização contém `latitude`, `longitude`, `timestamp`, `source`, `ownReport` e metadados disponíveis. **Use o timestamp do relatório**, não a hora da requisição, para avaliar quão recente é a posição. Histórico usa `recordedAt`; habilitá-lo não recupera posições antigas que nunca foram salvas. Tracking é consulta periódica, não stream GPS garantido a cada segundo.

## 6. Integração Traccar

```http
PUT /findhub/traccar/<ID_LOCAL>/google-operador
apikey: <TOKEN_DA_INSTANCIA>
Content-Type: application/json

{"enabled":true,"url":"http://traccar:5055","deviceId":"android-01"}
```

O `deviceId` do body é o identificador previamente cadastrado no Traccar; não é o ID local do parâmetro de rota. Configure o receptor HTTP/OsmAnd, não a API REST de administração do Traccar. Posições recebidas são encaminhadas quando o vínculo estiver habilitado. `DELETE` na mesma rota remove apenas o vínculo local e retorna `204` sem corpo.

## 7. Eventos

O EventManager existente transporta os eventos segundo a configuração por instância. Consulte o contrato **Eventos** no Scalar para o envelope específico do transporte e a descrição do campo `data`.

`findhub.devices.updated`, `findhub.location.updated`, `findhub.tracking.update` e `findhub.error` são emitidos pelos caminhos implementados. **`findhub.auth.update` está reservado no catálogo, mas o Auth Broker atual não o emite ao iniciar/importar; use o endpoint de status.** Nenhum evento deve conter bridgeToken, AAS ou sharedKey.

## 8. Scalar e validação

No seletor de documentos do Scalar, escolha **Connect|API Google Find Hub**. O contrato é servido em `openapi/findhub.openapi.json`, respeitando o mesmo `BASE_PATH` da documentação. As rotas também aparecem no REST geral sob a tag **Google Find Hub**. A imagem de docs precisa ser atualizada junto da API para receber o novo contrato.

```bash
python3 scripts/sync-findhub-deployments.py --check
npm run docs:generate
npm run docs:check
npm run test:findhub
```

`docs:check` valida também o documento dedicado. Os testes cobrem templates, preparação idempotente da chave, envelope cifrado existente e schemas; não fazem login nem rastreiam aparelhos reais.


## 9. Área dedicada e autenticação assistida

A rota `/manager/findhub` lista somente contas Google. Dentro da conta, as seções são **Conta e autenticação**, **Dispositivos**, **Histórico**, **Traccar** e **Eventos**. Os links antigos de detalhe, configurações e bots redirecionam para a seção correta **antes de carregar a tela WhatsApp**. Os seletores de mensagens, chamadas e bots não incluem Find Hub. O cartão Google não exibe número, contatos, conversas, mensagens ou teste de envio.

O canal compartilha infraestrutura administrativa da Connect|API (controle de acesso, registro de instâncias, banco e transportes). Isso não o torna um provider de mensagens. A barreira após o guard de autenticação recusa endpoints específicos de WhatsApp/bots quando a instância é Google; a resolução Meta Compatible existente continua restrita aos providers WhatsApp. Não se trata de isolamento em processos/containers diferentes.

### Extensão opcional no navegador do operador

Na seção Conta, obtenha o ZIP da sua própria instalação, extraia e carregue a pasta como extensão sem compactação no Chrome/Edge desktop (modo desenvolvedor). Recarregue o Manager e escolha **Conectar conta Google**. Confira os destinos na janela da extensão antes de autorizar. O usuário faz login no Google, desbloqueia as chaves na página Google e a interface aguarda a verificação do backend. Não há Session ID ou bridgeToken para copiar manualmente.

**Mudança em relação ao requisito puramente web:** esta alternativa requer uma extensão. Chrome Android, Safari iOS e Firefox não são suportados por esta implementação. Ela não instala um agente no smartphone a localizar, mas não satisfaz vinculação em qualquer navegador mobile. A extensão é experimental, não publicada na Chrome Web Store; não é uma integração oficial do Google. Mudanças ou desafios do protocolo Google podem impedir a vinculação.

Credenciais desse protocolo privado podem autorizar acesso Google mais amplo que localização. Vincule apenas contas próprias e instalações de confiança. A página solicitante autorizada recebe os artefatos temporários e os envia ao backend por HTTPS; uma vulnerabilidade nessa página comprometeria esse material. A permissão de host da extensão é opcional e limitada a `accounts.google.com`; ela não lê senha/PIN/formulários, não exporta cookies arbitrários, não utiliza storage permanente nem envia analytics. Fechar a origem ou a aba de autenticação encerra a tentativa. O processo usa o navegador do operador, não VNC ou Chromium da API.

### Mesmo fluxo para frontends externos

Todos os endpoints abaixo exigem `apikey` autorizado para a instância e continuam disponíveis fora do Manager:

| Etapa | Método e rota |
| --- | --- |
| Iniciar | `POST /findhub/auth/browser/start/{instanceName}` com `{email}` |
| Artefato do login | `POST /findhub/auth/browser/exchange/{instanceName}` com `{sessionId,bridgeToken,oauthToken}` |
| Desbloqueio Find Hub | `POST /findhub/auth/browser/complete/{instanceName}` com `{sessionId,bridgeToken,vaultKeys}` |
| Cancelar | `POST /findhub/auth/browser/cancel/{instanceName}` com `{sessionId,bridgeToken}` |
| Estado | `GET /findhub/auth/status/{instanceName}` |
| Helper self-hosted | `GET /findhub/auth/extension/{instanceName}` |
| Desvincular | `POST /findhub/disconnect/{instanceName}` |
| Consultar vínculo Traccar | `GET /findhub/traccar/{deviceId}/{instanceName}` |

O contrato da extensão está em `browser-extensions/findhub-auth/README.md` e o cliente de referência em `manager/src/components/FindHubBrowserAuth.vue`. Abra `chrome.runtime.connect` com o ID informado por `auth/status.helper.extensionId` e nome `connect-findhub-auth-v1`. `BEGIN` recebe `sessionId`, `email` e `apiOrigin`; nunca o apikey ou bridgeToken. A extensão pede consentimento, emite `OAUTH_TOKEN` e depois aguarda `UNLOCK` com o endereço retornado pelo backend. O callback emite `VAULT_KEYS`. Finalize com `DONE` ou `CANCEL`; envie `PING` a cada 15 segundos enquanto ativo. A extensão não transforma uma página não autorizada em cliente Google: cada tentativa exige consentimento na janela própria.

As provas permanecem em memória. Nunca coloque tokens no query string, localStorage, SessionStorage, webhook ou log. Uma chamada `complete` já aceita não é interrompida por `cancel`; aguarde a conclusão e desvincule explicitamente. Credenciais preexistentes não são sobrescritas só por abrir uma tentativa: o backend exige desvinculação anterior. O status `ready/connected` agora exige transporte MCS autenticado, não apenas um registro marcado READY no banco.

### Validação e build

```
node scripts/build-findhub-extension.cjs
npm run docs:generate
npm run docs:check
npm run test:findhub
npm test --prefix manager
```

O pacote da extensão é reproduzível e versionado em `public/findhub-auth.zip`, incluído na imagem normal da API. Não houve nova dependência de produção, novo container ou mudança nas chaves existentes. Os testes de autenticação isolam as respostas Google: aprovação desses testes não significa login real homologado.

### Falhas contidas no canal

Os preparadores/preflights gerais tratam a configuração Find Hub como módulo opcional: uma chave Google inválida produz aviso sem impedir implantação dos canais WhatsApp. O preparador dedicado e `--check --require-key` continuam retornando falha; o cofre continua recusando chaves inválidas e nenhuma é rotacionada automaticamente. Corrija a configuração antes de ativar uma conta Google. Não foi relaxada a validação de banco, Redis, credenciais administrativas ou imagens.

Na restauração de instâncias, uma exceção do Find Hub é capturada no seu próprio caminho, sem rejeitar tarefas de restauração dos demais canais. O runtime não trata TLS estabelecido como autenticação MCS: aguarda LoginResponse. Localizações têm limite de requisições pendentes e não sobrepõem consultas do mesmo dispositivo. Essas proteções reduzem impacto no processo compartilhado; não equivalem a isolamento de recursos em processos separados.

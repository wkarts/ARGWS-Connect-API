# Meta Compatible `/graph`

A camada Meta Compatible expõe um contrato HTTP/Webhook semelhante ao WhatsApp Cloud API sem criar um provider paralelo.

## Princípio

```text
API nativa ───────┐
                  ├── mesmo núcleo Connect|API ── mesmo provider ── mesma mensagem
/graph ───────────┘
```

Usar `/graph` e a API nativa em paralelo não duplica uma mensagem por si só. Duas requisições de envio distintas continuam sendo dois envios reais.

## Disponibilidade por instância

A compatibilidade `/graph` é uma capacidade nativa do Connect|API e não precisa ser habilitada por ENV, banco ou toggle no Manager.

Uma instância `WHATSAPP-BUSINESS`, `WHATSAPP-BAILEYS` ou `WHATSAPP-ZAPO` com identidade telefônica estável fica Graph-addressable automaticamente.

Consulte a identidade e configuração:

```bash
curl 'http://127.0.0.1:38080/compat/meta/minha-instancia' \
  -H 'apikey: <GLOBAL_API_KEY_OU_INSTANCE_TOKEN>'
```

O endpoint administrativo continua existindo para compatibilidade e para configurar apenas o webhook Meta opcional:

```bash
curl -X PUT 'http://127.0.0.1:38080/compat/meta/minha-instancia' \
  -H 'apikey: <GLOBAL_API_KEY_OU_INSTANCE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "webhookUrl": "https://example.com/webhooks/meta"
  }'
```

O campo `enabled` pode continuar aparecendo em respostas legadas, mas é sempre `true` e não controla mais o acesso ao `/graph`.

## Schemas de integração

O contrato OpenAPI Meta Compatible publica schemas explícitos para os formatos realmente aceitos pelo adapter: texto, imagem, vídeo, documento, áudio, localização, contatos, reação, interativos `button`/`list`, leitura, mídia, templates, webhooks e erros Graph.

A API nativa também publica `MetaCompatibilityConfig` e `MetaCompatibilityUpdateRequest`, que documentam a ponte entre uma instância Connect|API e sua identidade `/graph`.

## Autenticação Graph

```http
Authorization: Bearer <INSTANCE_TOKEN>
```

A autenticação `/graph` é independente da autenticação nativa `apikey`.

## Enviar texto

```bash
curl -X POST 'http://127.0.0.1:38080/graph/v20.0/<phoneNumberId>/messages' \
  -H 'Authorization: Bearer <INSTANCE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5575999999999",
    "type": "text",
    "text": {"body": "Olá pelo /graph"}
  }'
```

O `messages[0].id` retornado é o ID real do provider. Não existe prefixo `wamid` artificial.

## Formatos suportados

A fachada atual cobre:

```text
text
image
video
document
audio
location
contacts
reaction
interactive button
interactive list
template
mark-read
```

## Mídia

Upload:

```text
POST /graph/{version}/{phoneNumberId}/media
```

O upload reutiliza S3/MinIO existente e referência temporária. Não cria armazenamento binário permanente independente.

Mídia recebida:

```text
GET /graph/{version}/{mediaId}
```

O `mediaId` corresponde ao ID real da mensagem/provider usado na correlação. A resolução usa metadata existente e devolve URL segura/presigned quando disponível.

## Transcrição de áudio

A transcrição pelo contrato Meta Compatible é assíncrona e usa o worker local da
instalação. Não há dependência de OpenAI. O job fica escopado à instância do
`phoneNumberId` autenticado.

Para transcrever um áudio já persistido em uma mensagem:

```bash
curl -X POST 'http://127.0.0.1:38080/graph/v20.0/<phoneNumberId>/transcriptions' \
  -H 'Authorization: Bearer <INSTANCE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"messaging_product":"whatsapp","message_id":"REAL_AUDIO_MESSAGE_ID","language":"pt"}'
```

Para enviar um arquivo diretamente, use `multipart/form-data` com o campo
`audio` (o alias `file` também é aceito). Os formatos aceitos dependem da
instalação, normalmente OGG/Opus, MP3, M4A, WAV, WEBM e AMR.

```text
POST /graph/{version}/{phoneNumberId}/transcriptions
GET  /graph/{version}/{phoneNumberId}/transcriptions/{jobId}
POST /graph/{version}/{phoneNumberId}/transcriptions/{jobId}/retry
DELETE /graph/{version}/{phoneNumberId}/transcriptions/{jobId}
```

O POST retorna `202` e o estado inicial do job. Consulte o `id` retornado até
`status=completed` ou `status=failed`; a resposta nunca expõe credenciais nem
permite consultar job de outra instância.

Arquivos enviados diretamente para esse recurso são armazenados no bucket
privado da aplicação e têm retenção configurável por
`TRANSCRIPTION_SOURCE_RETENTION_SECONDS` (24 horas por padrão). Após o job
terminar, o ciclo de vida remove o objeto e o registro/resultado expirados; mídia
e jobs já pertencentes a uma mensagem da instância não são apagados. Quando a limpeza automática estiver
desligada (`0`), um administrador pode executar a limpeza manual pela API nativa
com `POST /v1/transcriptions/cleanup`, enviando `{"confirm":true}` e, se
necessário, `olderThanSeconds` e `limit`.

Para remover um job individual, use o `DELETE` acima. Jobs na fila ou em
processamento são cancelados pela remoção do registro; qualquer resultado
atrasado do worker é ignorado. O `DELETE` também é idempotentemente protegido
contra a mídia temporária já removida pelo ciclo de vida.
Em uploads diretos, o áudio temporário também é removido do MinIO; quando o job
foi criado a partir de uma mensagem, somente o resultado da transcrição é
removido e a mídia original permanece intacta. Para repetir uma transcrição
falha, use o endpoint `retry`. Um job `processing` pode ser reenfileirado após
perder atualizações por todo o limite de abandono configurado. Jobs `queued`
permanecem sob entrega durável do RabbitMQ; idade da fila, por si só, não os
reenfileira, pois uma mensagem pode já estar entregue sem confirmação.

## Publicar Status do WhatsApp

Status não é ativado implicitamente ao criar uma instância. A publicação é uma
ação explícita pelo Manager ou pela rota Meta Compatible, e somente providers
WhatsApp Web com suporte nativo (Baileys/ZAPO) aceitam essa operação. Business
retorna erro de capacidade, sem tentar um fallback.

Texto para todos os contatos:

```bash
curl -X POST 'http://127.0.0.1:38080/graph/v20.0/<phoneNumberId>/status' \
  -H 'Authorization: Bearer <INSTANCE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_product":"whatsapp",
    "type":"text",
    "text":{"body":"Aviso importante","background_color":"#1d4ed8","font":1},
    "all_contacts":true
  }'
```

Para uma lista controlada, troque `all_contacts` por
`status_jid_list:["5575999999999"]`. Imagem, vídeo e áudio podem ser enviados
como `multipart/form-data` no campo `file`, ou referenciados por `link`/`id`.
O retorno confirma apenas o aceite pelo provider e contém o identificador real
do envio em `messages[0].id`; não promete entrega ao aparelho.

Para consultar e excluir os Status publicados por uma instância:

```bash
curl 'http://127.0.0.1:38080/graph/v20.0/<phoneNumberId>/statuses?limit=50' \
  -H 'Authorization: Bearer <INSTANCE_TOKEN>'

curl -X DELETE 'http://127.0.0.1:38080/graph/v20.0/<phoneNumberId>/statuses/<STATUS_ID>' \
  -H 'Authorization: Bearer <INSTANCE_TOKEN>'
```

Essas rotas retornam somente Status enviados pela própria instância
(`status@broadcast`, `from_me=true`). A exclusão solicita o revoke ao provider
e remove o registro e a mídia local; se o provider já tiver removido o Status,
a limpeza local ainda pode ser concluída. Status recebidos não são expostos por
essas rotas de gerenciamento.

## Templates

```text
GET /graph/{version}/{businessAccountId}/message_templates
```

- `WHATSAPP-BUSINESS`: delega ao serviço real de templates;
- `WHATSAPP-BAILEYS` e `WHATSAPP-ZAPO`: catálogo persistido por instância, com `source=connectapi_local`, `execution=rendered_text`, `status=APPROVED`, `approved=true` e categoria `OPENING`;
- resultados locais paginados com `after`/`limit` (até 100) e `paging.next` relativo ao mesmo recurso;
- `type: template` é aceito em `/messages`: Business preserva o envio oficial; ZAPO/Baileys validam e executam exclusivamente o template persistido disponível. Template inexistente/desabilitado, versão divergente ou parâmetros inválidos impedem o envio.

Consulte [Templates por instância e integração com o HUB](local-templates.md).

## Webhooks

O webhook Meta Compatible é adicional ao webhook nativo. O mesmo evento interno pode ser entregue em ambos os formatos sem criar uma segunda mensagem interna.

Se um consumidor assinar os dois contratos ao mesmo tempo, deve correlacionar/deduplicar pelo ID real da mensagem quando aplicável.

## Status

Mapeamento atual:

```text
SERVER_ACK    → sent
DELIVERY_ACK  → delivered
READ          → read
PLAYED        → read
ERROR         → failed
DELETED       → deleted
PENDING       → não antecipar status sent
```

## Correção de direção e perfil — extensão genérica de webhook

A fachada `/graph` não é um novo provider. Nesta correção, os serviços, rotas e
credenciais da Meta oficial, `MetaCloudAuthService`, envio nativo e media adapter não
foram alterados. O dispatch já aguardava a serialização; `serializeIncoming()` passa
a ser assíncrono para aproveitar contatos persistidos localmente.

Para conversas individuais com PN conhecido:

| Evento | `contacts[].wa_id` | `messages[].from` |
|---|---|---|
| Entrada | PN do interlocutor | PN do interlocutor |
| Saída da conta conectada | PN do interlocutor | PN da instância |

`fromMe` considera a chave da mensagem, o registro e o envelope. `false` explícito
não é perdido por um `||`. Os candidatos são `remoteJidAlt`, `remoteJid`, `senderPn`,
`participantAlt`, `participant` e `sender`, preferindo PN válido `@s.whatsapp.net` ou
`@c.us`, removendo apenas o sufixo de dispositivo. O próprio remetente do envelope
não vira interlocutor remoto. Um participante alheio não fornece perfil para uma
conversa individual que já tenha destino explícito.

Há uma extensão opcional, **por mensagem**, em
`entry[].changes[].value.messages[].connect_api`:

```json
{
  "from_me": true,
  "remote_jid": "22654721644999@lid",
  "remote_jid_alt": "557596236940@s.whatsapp.net",
  "participant": null,
  "participant_alt": null,
  "phone_resolved": true,
  "source": "android"
}
```

Esses identificadores são fixtures de documentação/teste. `source` é propagado apenas
quando existe; não são inventados `api`, Android, iPhone ou bot. O valor que o provider
já gravou, inclusive `web` ou `unknown`, não é reinterpretado. A nova extensão não é
um campo oficial da Meta e qualquer consumidor pode ignorá-la quando não precisar de
metadados adicionais. `profile.picture` é uma extensão opcional de perfil.

O nome/foto do evento recebido têm precedência sobre o contato persistido. Na saída,
`pushName` e `profilePicUrl` podem pertencer à conta conectada e **não** identificam o
destinatário: usa-se o perfil persistido do interlocutor, depois seu PN para o nome.
Sem foto, `picture` é omitido. O serializer não escreve no cadastro, não altera nomes
locais de CRM e não faz chamadas ao WhatsApp durante o webhook.

O resolvedor consulta somente JIDs candidatos exatos/normalizados e o `instanceId`,
com quantidade limitada de candidatos. Prefere registros completos e depois mais
recentes. Não há busca por nome, sufixo de telefone, varredura de mensagens ou loop de
reconciliação. Falha na consulta opcional de perfil não elimina o evento válido.

### Identidades ainda não resolvidas

Não é possível transformar dígitos de um `@lid` em telefone por normalização. Quando
nenhum candidato fornece PN, o evento é preservado, `phone_resolved=false` e os JIDs
ficam na extensão. **`contacts[].wa_id` e `messages[].from` não são preenchidos com
número inventado ou string vazia**; são omitidos se aquele telefone for desconhecido.
Na saída, `from` continua contendo o número conhecido da própria instância. Consumidores
que aceitam eventos sem PN devem usar o identificador opaco com escopo da instância;
não devem reunir contatos diferentes numa chave vazia. Isso é uma extensão de
compatibilidade, não promessa de payload Cloud oficial quando o telefone está ausente.

Para `WHATSAPP-BUSINESS`, IDs Graph e `metadata` continuam intactos. Um `phone_number_id`
não é usado como telefone de um remetente de saída quando o número real é desconhecido.
Os testes preservam o payload convencional de entrada e o contrato de status.

Nos grupos, o JID `@g.us` continua em `remote_jid`, enquanto o participante identifica
o remetente de entrada. O grupo não vira um contato telefônico. Na saída de grupo sem
participante remoto há `contacts: []`. Status mantêm IDs, timestamps e mapeamentos
`sent/delivered/read/failed/deleted`; sem telefone de destino, mantêm `recipient_id`
vazio, sem inventar PN. Broadcast/canais não são convertidos em conversa individual.

O conjunto de eventos Meta-compatible cobre `messages.upsert`,
`messages.update` e agora também `messages.delete`, incluindo as variantes
maiúsculas. Um revoke recebido do smartphone da própria conta ou do interlocutor é
normalizado como um status da mensagem original:

```json
{
  "statuses": [
    {
      "id": "<ID_REAL_DA_MENSAGEM>",
      "status": "deleted",
      "timestamp": "<unix_timestamp>",
      "recipient_id": "<telefone_quando_resolvido>"
    }
  ]
}
```

O evento de exclusão usa o ID real da mensagem alvo, não o ID do
`protocolMessage` de controle. Baileys e ZAPO persistem o estado `DELETED` da
mensagem original antes de despachar o webhook, permitindo que consumidores façam
reconciliação posterior mesmo se estiverem temporariamente indisponíveis.

Esta entrega não assina `SEND_MESSAGE` adicionalmente, evitando duplicar o webhook
de um envio que já gera upsert/eco. Testes de API/bot verificam o upsert com
`fromMe=true` e origem existente. Não há uma nova API genérica de payload bruto
nesta alteração.

A autenticação Graph continua Bearer do token da instância. OAuth `190` por token
inadequado não é contornado. As rotas nativas de envio e seus guards permanecem iguais.

### Regressão

`npm run test:compat` inclui `test/meta-cloud/webhook-identity.test.ts`: direção,
camadas de `fromMe`, PN/LID, perfil persistido, foto ausente, isolamento, mídia, status,
grupos, payload convencional oficial, IDs Graph e rejeição de token inadequado.
Os testes usam registros e banco simulados; não são prova de homologação com uma
conta WhatsApp Business real.

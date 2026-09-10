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

## Templates

```text
GET /graph/{version}/{businessAccountId}/message_templates
```

- `WHATSAPP-BUSINESS`: delega ao serviço real de templates;
- `WHATSAPP-BAILEYS`: lista vazia (`data: []`);
- `WHATSAPP-ZAPO`: lista vazia (`data: []`) enquanto templates nativos não forem expostos pelo adapter.

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

## Direção, contato e origem nos webhooks

A serialização é genérica para qualquer consumidor. Não muda autenticação Graph,
endpoints nativos, persistência de conversas ou regras de apresentação de clientes.
O dispatcher continua aguardando a serialização antes de enfileirar o webhook.

Em mensagens individuais, `contacts[].wa_id` identifica o interlocutor. `messages[].from`
identifica o remetente: interlocutor na entrada, número da própria instância na saída.
`key.fromMe`, `record.fromMe` e `raw.fromMe` são considerados nessa ordem; um `false`
explícito não é substituído por um fallback `true`. Sem esse metadado, mantém-se a
interpretação legada de entrada. O serializer não deduz direção pelo nome do contato.

Para localizar o interlocutor, os candidatos são `remoteJidAlt`, `remoteJid`, `senderPn`,
`participantAlt`, `participant` e `sender`. JIDs telefônicos `@s.whatsapp.net` / `@c.us`
têm preferência sobre `@lid`; sufixos de dispositivo são removidos sem anexar seus
dígitos ao telefone. O remetente da instância não vira interlocutor apenas por aparecer
no envelope, e candidatos com outro PN não fornecem o perfil do contato selecionado.

### Extensão opcional `connect_api`

Localização: `entry[].changes[].value.messages[].connect_api`. É uma extensão do
Connect|API, não um campo anunciado como parte do contrato oficial da Meta. Pode ser
ignorada por consumidores que não precisam de metadados adicionais. `profile.picture`
é igualmente opcional e adicional ao perfil padrão.

Exemplo de mensagem enviada pela conta conectada; telefone da instância usado no exemplo:
`5575988449231`. Os identificadores abaixo são dados de teste.

```json
{
  "contacts": [{
    "wa_id": "557596236940",
    "profile": { "name": "Contato conhecido", "picture": "https://example.invalid/contact.jpg" }
  }],
  "messages": [{
    "from": "5575988449231",
    "id": "PHONE-OUT-1",
    "timestamp": "1789052400",
    "type": "text",
    "text": { "body": "Enviado pelo smartphone" },
    "connect_api": {
      "from_me": true,
      "remote_jid": "22654721644999@lid",
      "remote_jid_alt": "557596236940@s.whatsapp.net",
      "participant": null,
      "participant_alt": null,
      "phone_resolved": true,
      "source": "android"
    }
  }]
}
```

No evento de entrada equivalente, `from_me` é `false` e `messages[].from` é
`557596236940`; `contacts[].wa_id` continua `557596236940`.

`source` só é incluído quando já existe como string não vazia no registro/evento;
é propagado, não calculado. O serializer não transforma `web` em `api`, nem inventa
Android, iPhone, dispositivo ou bot quando não há evidência. Alguns registros ZAPO
atuais já chegam com `source: "web"`, inclusive envios locais. Esse valor é preservado;
a nova extensão não promete distinguir bot de dispositivo além dos dados da origem.

### Perfil conhecido e ausência de PN

O perfil é consultado somente nos contatos persistidos, com filtro obrigatório por
`instanceId` e pelos JIDs candidatos exatos/normalizados. A consulta tem limite de
candidatos e seleciona apenas JID, nome, foto e data de atualização. Entre aliases
conhecidos do mesmo interlocutor, prefere mais campos preenchidos e depois maior
atualização. Não há chamadas externas ao WhatsApp, varreduras de mensagens, escrita de
contatos ou reconciliador em segundo plano.

Na entrada, nome e foto presentes no evento têm precedência sobre o perfil persistido.
Sem nome, usa o telefone real; sem foto, omite `picture`. Na saída, `pushName` e foto
de remetente não identificam o destinatário: usa o perfil persistido do interlocutor,
evita atribuir o nome/foto da própria conta ao cliente e não altera nomes locais de
nenhum sistema consumidor.

Sem PN legítimo entre os candidatos, os dígitos de um LID não são convertidos em
telefone. O evento é preservado com `wa_id: ""`, `from: ""` na entrada e
`phone_resolved: false`; os JIDs opacos continuam na extensão. Na saída, `from` ainda é
o número conhecido da instância. A consulta de contatos não descobre um vínculo
PN/LID ausente: o provider precisa fornecer o PN ou alias nos metadados. Este caso é
uma extensão de compatibilidade e exige que o consumidor use a identidade opaca ou
aguarde uma associação legítima; não deve tratar string vazia como chave de contato.

Nos grupos, `remote_jid` preserva `@g.us` e identifica a conversa. O remetente de entrada
e o contato do evento são o participante identificado por `senderPn` / `participantAlt`
/ `participant` / `sender`, nunca os dígitos do grupo. Consumidores de eventos de grupo
precisam manter o JID do grupo como identidade da conversa, sem agrupá-la pelo autor.
Status de grupo não fabricam um destinatário telefônico. Broadcast e newsletter sem
identidade de pessoa suportada não são transformados em mensagens individuais.

Os status mantêm ID, timestamp e mapeamento anterior. `recipient_id` prefere PN legítimo
nos mesmos campos e fica vazio quando não há telefone conhecido. Fotos e perfis não
são consultados para status. A autenticação permanece `Bearer <INSTANCE_TOKEN>`;
credencial inadequada continua recebendo OAuth `190`, sem exceções por consumidor.

### Validação

`npm run test:compat` executa os testes de contrato existentes e as regressões de
`test/meta-cloud/webhook-identity.test.ts`. Inclui entrada, eco de smartphone, API/bot,
PN, LID+PN, aliases, perfil persistido, isolamento entre instâncias, ausência de dados,
mídia, status, grupos e autenticação Graph. Os testes usam registros e banco simulados;
a homologação deve conferir os webhooks reais da instância, sem modificar a produção.

# Modelos locais por instância — Connect|API

## Contrato e escopo

Esta implementação adiciona modelos de texto persistidos para `WHATSAPP-ZAPO` e
`WHATSAPP-BAILEYS`. Não simula aprovação Meta e não exige uma conta Business para
administrar o catálogo local. A integração `WHATSAPP-BUSINESS` continua usando seu
serviço oficial; o novo adaptador Graph encaminha `type: template` ao envio nativo
correspondente.

O primeiro formato local suporta BODY de texto, HEADER TEXT fixo opcional e FOOTER
fixo opcional. Botões, listas, anexos e mídia dentro do modelo local não são
suportados nesta entrega e são rejeitados, não ignorados. Outros tipos de mensagem
já existentes na API não são alterados.

**Execução explícita:** um modelo local é renderizado a partir da definição salva e
enviado como texto pelo método nativo da mesma instância. Não é um fallback quando
um template oficial falha. O consumidor envia nome, idioma, versão e parâmetros,
nunca uma definição arbitrária em substituição ao cadastro.

```json
{
  "source": "connectapi_local",
  "execution": "rendered_text",
  "meta_approved": false,
  "status": "LOCAL_READY"
}
```

`LOCAL_DISABLED` sinaliza um modelo desabilitado. `APPROVED` não é atribuído aos
modelos locais. A categoria `UTILITY` é uma classificação local de apresentação,
não uma classificação aprovada pela Meta.

## Persistência e implantação

O novo modelo Prisma `LocalTemplate` tem unicidade por
`instanceId + name + language`, controle de versão, habilitação e arquivamento
lógico. A tabela oficial `Template`, suas restrições, registros e métodos não são
alterados. PostgreSQL, MySQL e o schema PgBouncer são mantidos em paridade; PgBouncer
utiliza as migrations PostgreSQL existentes no fluxo do projeto.

As migrations `20260911200000_local_templates` criam a tabela e um registro real
`hello` / `pt_BR` por instância ZAPO/Baileys existente. O conteúdo inicial definido
nesta entrega é **“Olá! Como podemos ajudar?”**, editável na administração. Novas
instâncias locais recebem o mesmo modelo em uma criação aninhada, atômica com o
registro da instância, pelo fluxo `WAMonitoringService.saveInstance`.

Não existe seed em GET ou no HUB. Desabilitar/arquivar `hello` é respeitado. A
consulta não recria nem reativa o registro. A exclusão da instância remove seu
catálogo por chave estrangeira em cascata.

Faça backup e aplique as migrations antes de iniciar os binários atualizados. O
fluxo Docker existente executa `db:deploy` no startup. Em instalação manual:

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run build
npm --prefix manager install --no-audit --no-fund
npm --prefix manager run test
```

O script de banco usa `DATABASE_PROVIDER` e as credenciais já configuradas. Não
mude o provider ou a URI para aplicar esta entrega. Atualize também Manager e DOCs,
pois o frontend e os contratos novos são distribuídos pelas respectivas imagens.
Nenhuma variável de ambiente nova é exigida.

O rollback de aplicação não exige apagar a tabela. Preserve os dados locais; não
há migration destrutiva de rollback. A aplicação anterior não utilizará os novos
modelos e o HUB anterior não reconhecerá `LOCAL_READY`.

## Administração

No Manager com acesso direto à API: **Instâncias → abrir instância → Modelos de
mensagem**. A tela permite consultar, cadastrar, editar, habilitar/desabilitar e
arquivar. Exibe a origem local e a prévia de texto. Alterações usam a revisão lida;
conflito exige atualizar a lista.

O acesso operacional dessa tela consulta o token exato da instância pelo helper
existente e envia esse token no cabeçalho `apikey`, sem persistir a credencial no
armazenamento do navegador e sem usar a chave global como alternativa na operação.
A consulta administrativa de obtenção do token continua sob a sessão do Manager.
O modo opcional de serviço/contas, sem acesso direto à API, não é inventado ou
alterado por este recurso. A API nativa mantém a política de autenticação existente
para administradores; a chave global não foi revogada nesta entrega.

| Método e rota | Efeito |
| --- | --- |
| GET `/localTemplate/find/{instanceName}` | Lista, sem gravações; `limit` 1–100 e cursor `after`. |
| POST `/localTemplate/create/{instanceName}` | Cadastra nome/idioma/componentes/habilitação. |
| POST `/localTemplate/edit/{instanceName}` | Atualiza componentes e/ou habilitação com `version`. |
| DELETE `/localTemplate/delete/{instanceName}` | Arquiva com nome/idioma/versão. |

As rotas mantêm os guards nativos e utilizam somente o `instanceName` autorizado
da URL; dados do body/query não o substituem. Todos os acessos ao catálogo incluem
`instanceId`. Um token de outra instância é rejeitado pelo guard nativo.

### Criar um modelo

```http
POST /localTemplate/create/minha-instancia
apikey: <TOKEN_DA_INSTANCIA>
Content-Type: application/json
```

```json
{
  "name": "confirmacao_atendimento",
  "language": "pt_BR",
  "enabled": true,
  "components": [
    { "type": "HEADER", "format": "TEXT", "text": "Atendimento" },
    { "type": "BODY", "text": "Olá, {{1}}! Seu atendimento está confirmado para {{2}}." },
    { "type": "FOOTER", "text": "Nossa equipe agradece." }
  ]
}
```

Nomes começam com letra minúscula e usam até 64 letras minúsculas, números e
sublinhado. Idioma segue `pt`, `pt_BR` ou o mesmo padrão de 2–3 letras com país
opcional. Nome/idioma não são renomeados pela edição.

Somente o BODY tem variáveis, numeradas consecutivamente de `{{1}}` até `{{20}}`.
Repetições de uma posição reutilizam o mesmo valor. HEADER e FOOTER têm até 60
caracteres cada. O conjunto antes e depois da renderização tem até 4096 caracteres
(unidades UTF-16). Cada parâmetro é texto não vazio de até 1024 caracteres.
Substituição é literal em passagem única, sem execução de código, HTML ou
substituição recursiva de parâmetros.

Para desabilitar a versão 1:

```json
{ "name": "confirmacao_atendimento", "language": "pt_BR", "version": 1, "enabled": false }
```

Para arquivar, envie nome/idioma e a versão corrente à rota DELETE. O nome/idioma
permanecem reservados inclusive após arquivamento, evitando reutilização silenciosa
por mensagens antigas. A tela avisa essa regra antes da confirmação.

## Integração Graph e HUB

A listagem existente agora retorna o catálogo persistido da instância local:

```http
GET /graph/v20.0/{businessAccountId}/message_templates
Authorization: Bearer <TOKEN_DA_INSTANCIA>
```

`after` e `limit` se aplicam ao catálogo local. `paging.next` é uma referência
relativa à mesma rota, sem credencial na URL. A identidade deve ser obtida da
consulta nativa `/compat/meta/{instanceName}`. O roteamento por token de instâncias
que compartilham o número, corrigido na PR94, permanece preservado.

Cada item traz `id`, `name`, `language`, `components`, `version`, `enabled`,
`available`, `status`, `source`, `execution` e `meta_approved`. Um catálogo vazio
continua sendo uma resposta válida; não prova falha de credencial nem gera seed.

No HUB atualizado, **Reconciliar agora** importa os registros reais. Apenas o nome
exato `hello` é habilitado automaticamente na primeira descoberta. Os demais
modelos exigem habilitação na caixa; escolhas existentes sobrevivem a novas
versões, indisponibilidade temporária e reconciliações. A origem local aparece na
seleção e na prévia, sem apresentar aprovação Meta.

### Enviar um modelo

```http
POST /graph/v20.0/{phoneNumberId}/messages
Authorization: Bearer <TOKEN_DA_INSTANCIA>
Content-Type: application/json
```

```json
{
  "messaging_product": "whatsapp",
  "to": "5575999999999",
  "type": "template",
  "template": {
    "name": "confirmacao_atendimento",
    "language": { "code": "pt_BR" },
    "connect_api_version": 1,
    "components": [{
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Maria" },
        { "type": "text", "text": "segunda-feira às 14h" }
      ]
    }]
  }
}
```

Para `hello` sem variáveis, `components: []` ou BODY com `parameters: []` é válido.
O HUB envia a segunda forma e sempre inclui a versão local. A API permite a
omissão de versão para consumidores nativos/Graph que optem explicitamente pela
última definição, mas rejeita divergência quando ela é fornecida.

A operação nativa `/message/sendTemplate/{instanceName}` também suporta os modelos
locais. Usa `apikey: <TOKEN_DA_INSTANCIA>`, `language: "pt_BR"`, os mesmos parâmetros
em `components` e o campo opcional `version`. O formato Business nativo permanece
no serviço original.

O ID da resposta é o ID real retornado pela integração. A resposta Graph local
acrescenta `connect_api.template` com origem, nome, idioma, id do modelo e versão.
O HUB grava a referência do modelo e o ID externo, mantendo a prévia coerente com o
conteúdo enviado. Modelo inexistente, desabilitado, arquivado, revisão divergente,
variáveis inválidas ou instância desconectada impedem o envio, sem converter a
falha em uma mensagem livre.

Uma chamada já em andamento pode terminar após uma alteração administrativa. O
controle de versão verifica o cadastro no momento da renderização; não é uma
transação de banco mantida aberta durante uma chamada ao WhatsApp. Em timeout ou
resposta sem ID, a confirmação é incerta: confira a conversa antes de reenviar.
Este recurso não promete entrega exatamente uma vez nem deduplicação universal
de tentativas externas; não introduz retry/fallback de envio no HUB.

## Verificação

`npm run test:compat` inclui a regressão local por meio de `foundation.test.ts`.
O workflow Database Integrity contém testes adicionais com banco PostgreSQL/MySQL
isolado: seed de upgrade idempotente, criação aninhada, unicidade por instância e
idioma, edição concorrente, arquivamento e cascata. Esses testes exigem `CI=true`
e banco de nome `argws_connect_test` e não devem ser usados contra produção.

```bash
npm run test:compat
npm run docs:check
npm run lint:check
npm run build
npm --prefix manager run test
```

No HUB, executar os testes novos Ruby/Node e o spec Rails incluído. A aprovação de
checks automatizados não substitui um envio consentido de homologação com uma
instância conectada após implantação.

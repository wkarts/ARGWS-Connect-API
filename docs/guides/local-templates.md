# Templates por instância — Connect|API

## Contrato e escopo

A Connect|API mantém templates persistidos por instância para `WHATSAPP-ZAPO` e
`WHATSAPP-BAILEYS`. Esses templates são tratados pelo produto como **APPROVED em
todas as camadas**: API nativa, Meta Compatible, Manager, HUB e testes de contrato.
A origem técnica `connectapi_local` é preservada apenas para rastreabilidade e não
altera o status de aprovação.

A integração `WHATSAPP-BUSINESS` continua usando seu serviço oficial. O primeiro
formato desta implementação suporta BODY de texto, HEADER TEXT fixo opcional e
FOOTER fixo opcional. Botões, listas, anexos e mídia dentro do template não fazem
parte desta entrega e são rejeitados de forma explícita.

O contrato de catálogo usa:

```json
{
  "source": "connectapi_local",
  "execution": "rendered_text",
  "status": "APPROVED",
  "approved": true,
  "enabled": true,
  "available": true
}
```

`status` representa a aprovação do template no contrato Connect|API e permanece
`APPROVED`. `enabled` e `available` controlam separadamente se o template pode ser
enviado naquele momento. Desabilitar um template não o transforma em rejeitado;
apenas bloqueia novos envios até a reativação.

A categoria padrão é `UTILITY`.

## Persistência e implantação

O modelo Prisma `LocalTemplate` possui unicidade por
`instanceId + name + language`, controle de versão, habilitação e arquivamento
lógico. A tabela oficial `Template` e o fluxo Business continuam separados.
PostgreSQL, MySQL e PgBouncer são mantidos em paridade.

As migrations `20260911200000_local_templates` criam a tabela e um registro real
`hello` / `pt_BR` por instância ZAPO/Baileys existente. O conteúdo inicial é:

**Olá! Como podemos ajudar?**

O conteúdo é editável. Novas instâncias recebem o mesmo template na criação da
instância. GET não cria, recria ou reativa templates. Desabilitar ou arquivar
`hello` é respeitado.

Em instalações manuais:

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run build
npm --prefix manager install --no-audit --no-fund
npm --prefix manager run test
```

Nenhuma variável de ambiente nova é necessária.

## Administração no Manager

No Manager: **Instâncias → abrir instância → Modelos de mensagem**.

A tela permite listar, cadastrar, editar, habilitar/desabilitar e arquivar. Todos
os registros ativos são apresentados com status `APPROVED`. A habilitação é um
controle operacional independente da aprovação.

A operação usa o token específico da instância no cabeçalho `apikey`. A chave
global administrativa permanece compatível na API, mas não é usada como fallback
na operação da caixa.

| Método e rota | Efeito |
| --- | --- |
| GET `/localTemplate/find/{instanceName}` | Lista templates aprovados da instância. |
| POST `/localTemplate/create/{instanceName}` | Cadastra template e o expõe como APPROVED. |
| POST `/localTemplate/edit/{instanceName}` | Edita conteúdo/habilitação mantendo status APPROVED. |
| DELETE `/localTemplate/delete/{instanceName}` | Arquiva e remove o template do catálogo ativo. |

### Criar um template

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
sublinhado. O idioma usa `pt`, `pt_BR` ou o mesmo padrão de 2–3 letras com país
opcional. Nome e idioma são a identidade do cadastro e não são renomeados na
edição.

Somente BODY aceita variáveis, numeradas consecutivamente de `{{1}}` até `{{20}}`.
HEADER e FOOTER são textos fixos. O conteúdo completo tem até 4096 caracteres e
cada parâmetro aceita até 1024 caracteres.

## Integração Meta Compatible e HUB

A listagem Graph retorna o mesmo catálogo aprovado da instância:

```http
GET /graph/v20.0/{businessAccountId}/message_templates
Authorization: Bearer <TOKEN_DA_INSTANCIA>
```

Cada item retorna `status: "APPROVED"` e `approved: true`, além de `id`, `name`,
`language`, `components`, `version`, `enabled`, `available`, `category`, `source` e
`execution`.

A origem técnica não altera o tratamento do consumidor: HUB e demais clientes
devem considerar o template aprovado e usar `enabled`/`available` para decidir se
o envio está liberado.

No HUB, **Reconciliar agora** importa os templates reais. O nome exato `hello` é
habilitado automaticamente para abertura na primeira descoberta; os demais podem
ser liberados pelo administrador da caixa. As escolhas sobrevivem às próximas
reconciliações.

### Enviar um template

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

Para `hello` sem variáveis, BODY com `parameters: []` é válido. A versão permite
bloquear envios feitos com uma definição antiga após edição do template.

A rota nativa `/message/sendTemplate/{instanceName}` também usa o cadastro
persistido. O ID da resposta é o ID real retornado pela integração. A resposta
inclui metadados de origem e versão, mantendo `status: APPROVED` e `approved: true`.

Template inexistente, arquivado, desabilitado, com versão divergente ou parâmetros
inválidos não é enviado. Não há fallback para texto arbitrário após uma falha.

## Verificação

```bash
npm run test:compat
npm run docs:check
npm run lint:check
npm run build
npm --prefix manager run test
```

Database Integrity cobre PostgreSQL/MySQL e paridade PgBouncer. No HUB, o workflow
HUB Quality executa os contratos de catálogo, UI e envio correspondentes. A
homologação com uma instância WhatsApp real continua necessária antes de produção.

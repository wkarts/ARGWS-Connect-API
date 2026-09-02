# Connect|API — Documentation Contract

## Regra máxima

A documentação é parte da implementação. Uma mudança funcional só está concluída quando o comportamento público correspondente está documentado e os contratos gerados estão sincronizados.

## Fonte da verdade

```text
código implementado
      ↓
rotas / DTOs / eventos
      ↓
OpenAPI / AsyncAPI
      ↓
Scalar
      ↓
guias e exemplos
```

Nunca documentar comportamento ainda não implementado.

## Quando a documentação deve mudar

Atualização obrigatória sempre que houver alteração em:

- endpoints REST, método HTTP ou rota;
- parâmetros, query string, headers ou autenticação;
- DTOs, payloads, respostas e códigos de erro;
- eventos, Webhooks, WebSocket, RabbitMQ, NATS, SQS, Kafka ou Pusher;
- providers e capacidades por provider;
- Meta Compatible `/graph`;
- mídia, S3/MinIO e política de armazenamento;
- variáveis de ambiente e deploy;
- comportamento público do Manager quando necessário para integração;
- procedimentos operacionais ou troubleshooting.

## Contratos gerados

API nativa:

```text
docs/openapi/connect-api.openapi.json
```

Meta Compatible:

```text
docs/openapi/meta-compatible.openapi.json
```

Eventos:

```text
docs/asyncapi/connect-api-events.asyncapi.json
```

Inventário de cobertura:

```text
docs/openapi/coverage.json
```

Os contratos são materializados por:

```bash
npm run docs:generate
```

E validados por:

```bash
npm run docs:check
```

## Regra para qualquer IA ou desenvolvedor

Ao implementar uma mudança:

1. analisar o impacto documental antes de considerar a tarefa pronta;
2. implementar o código;
3. atualizar descrições, exemplos ou schemas específicos quando necessário;
4. executar `npm run docs:generate` quando rotas/eventos mudarem;
5. atualizar o guia temático correspondente;
6. executar `npm run docs:check`;
7. garantir que o service Scalar continua saudável;
8. informar na PR o impacto documental.

Se realmente não existir impacto documental, registrar na PR:

```text
DOCS IMPACT: NONE
Motivo: <justificativa objetiva>
```

## Regra de compatibilidade

A documentação deve diferenciar claramente as capacidades de:

- `WHATSAPP-BUSINESS`;
- `WHATSAPP-BAILEYS`;
- `CONNECT`.

Não declarar equivalência onde o provider não oferece a mesma capacidade.

## Meta Compatible

A documentação `/graph` deve preservar estas regras:

- `/graph` é fachada/protocolo, não provider;
- usa o mesmo núcleo e a mesma instância da API nativa;
- não cria mensagem duplicada por simplesmente usar outro contrato;
- IDs externos são IDs reais do provider;
- não criar `wamid` virtual;
- autenticação Graph usa Bearer token da instância;
- mídia recebida é resolvida pelo metadata já existente e S3/MinIO;
- templates dependem da capacidade real do provider.

## Definition of Done

Uma implementação documentável só está pronta quando:

- código concluído;
- testes e checks concluídos;
- OpenAPI sincronizado;
- AsyncAPI sincronizado quando aplicável;
- exemplos coerentes com o comportamento real;
- guia atualizado quando necessário;
- `Docs Integrity` aprovado;
- build/deploy do service `docs` válido.

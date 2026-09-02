# Autenticação

## API nativa

A API nativa utiliza o header:

```http
apikey: <API_KEY_OR_INSTANCE_TOKEN>
```

A chave pode ser a credencial global configurada ou, conforme o endpoint/guard, o token da instância.

Nunca publique chaves reais em exemplos, logs ou documentação.

## Meta Compatible `/graph`

A camada compatível usa autenticação independente da API nativa:

```http
Authorization: Bearer <INSTANCE_TOKEN>
```

O token é comparado à credencial da instância correspondente ao `phoneNumberId`, `businessAccountId` ou mídia resolvida.

Erros de autenticação Graph são retornados no formato Meta/Graph, com código OAuth compatível quando aplicável.

## Métricas

Quando `METRICS_AUTH_REQUIRED` estiver habilitado, `/metrics` usa Basic Authentication e pode ainda ser limitado por whitelist de IP.

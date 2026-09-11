# Autenticação

## API nativa

A API nativa utiliza o header:

```http
apikey: <API_KEY_OR_INSTANCE_TOKEN>
```

A chave pode ser a credencial global configurada ou, conforme o endpoint/guard, o token da instância.

A chave global é administrativa e não deve ser distribuída a tenants. Para endpoints vinculados a uma instância, prefira o token exclusivo daquela instância.

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

## Modelos locais por instância

As novas operações de modelos usam a credencial exclusiva da instância: `apikey`
na API nativa e `Authorization: Bearer` no Graph. O código de autenticação atual
também aceita a chave global administrativa, inclusive como Bearer Graph, por
compatibilidade. Isso não a torna a credencial recomendada para as caixas: o HUB
e a tela operacional de modelos não a usam como alternativa ao token individual.
A política global existente não é revogada por esta entrega.

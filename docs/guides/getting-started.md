# Getting Started

## Subir a stack

```bash
cp .env.example .env
docker compose up -d
```

Serviços principais:

```text
API      http://127.0.0.1:38080
Manager  http://127.0.0.1:38080/manager
DOCs     http://127.0.0.1:38082
```

## Criar uma instância

```bash
curl -X POST 'http://127.0.0.1:38080/instance/create' \
  -H 'apikey: <API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "instanceName": "minha-instancia",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

## Conectar por QR Code

```bash
curl 'http://127.0.0.1:38080/instance/connect/minha-instancia' \
  -H 'apikey: <API_KEY>'
```

## Conectar por código de pareamento

```bash
curl 'http://127.0.0.1:38080/instance/connect/minha-instancia?number=5575999999999' \
  -H 'apikey: <API_KEY>'
```

## Enviar texto

```bash
curl -X POST 'http://127.0.0.1:38080/message/sendText/minha-instancia' \
  -H 'apikey: <API_KEY_OR_INSTANCE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "number": "5575999999999",
    "text": "Olá pelo Connect|API"
  }'
```

## Abrir a referência interativa

Acesse o service `docs` e selecione:

- `Connect|API REST API`;
- `Connect|API Meta Compatible`;
- `Connect|API Events`.

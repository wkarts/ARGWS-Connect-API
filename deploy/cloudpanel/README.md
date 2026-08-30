# Deploy — CloudPanel

Este diretório contém o deployment oficial do ARGWS Connect API para CloudPanel. O servidor **não compila** a aplicação: ele consome exclusivamente imagens publicadas no GHCR.

## 1. Pré-requisitos

- Docker Engine + Docker Compose v2
- CloudPanel com dois sites/reverse proxies (recomendado)
- acesso ao GHCR se os packages estiverem privados

## 2. Preparar o ambiente

```bash
cp .env.example .env
chmod 600 .env
```

Troque obrigatoriamente `CHANGE_ME_*`, ajuste `SERVER_URL` e configure os domínios.

## 3. GHCR privado

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

O token precisa, no mínimo, de `read:packages`. Imagens públicas não exigem login.

## 4. Subir

Stack padrão (API + Manager + PostgreSQL + Redis):

```bash
./deploy.sh
```

Ou manualmente:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Com RabbitMQ:

```bash
docker compose --profile messaging up -d
```

Com MinIO:

```bash
docker compose --profile storage up -d
```

Stack completa:

```bash
docker compose --profile full up -d
```

## 5. CloudPanel

Crie dois sites **Reverse Proxy**:

- API: domínio desejado -> `http://127.0.0.1:8080`
- Manager: domínio desejado -> `http://127.0.0.1:3000`

Ative SSL/Let's Encrypt pelo próprio CloudPanel. Para WebSocket, mantenha os headers `Upgrade` e `Connection` do reverse proxy. Há snippets de referência na pasta `nginx/`.

## 6. Atualizar

```bash
./update.sh
docker image prune -f
```

## 7. Backup

Volumes persistentes principais:

- `argws_connect_instances`
- `argws_connect_postgres`
- `argws_connect_redis`
- `argws_connect_rabbitmq` (quando habilitado)
- `argws_connect_minio` (quando habilitado)

Faça backup do PostgreSQL e dos volumes antes de trocar versões.

# Backup e Restore

## Escopo do backup

Cada execução inclui:

- banco do Control Plane;
- metadados e manifest;
- banco PostgreSQL de cada tenant;
- estrutura de usuários/bancos necessária ao restore;
- objetos MinIO/S3;
- SHA-256 de todos os componentes;
- versão e commit da aplicação quando disponíveis.

## Backup manual

```bash
./scripts/backup.sh
```

Ou:

```bash
docker compose run --rm connect-api python -m app.cli backup
```

## Destinos

### Local

```text
BACKUP_DIR=/data/backups
```

### S3/MinIO

```text
BACKUP_UPLOAD_S3=true
BACKUP_S3_BUCKET=connect-api-backups
```

### Google Drive

Configure um remote `gdrive` no rclone e monte o arquivo no Compose:

```text
BACKUP_GOOGLE_DRIVE_ENABLED=true
BACKUP_GOOGLE_DRIVE_REMOTE=gdrive:connect-api-platform
RCLONE_CONFIG_PATH=/caminho/seguro/rclone.conf
```

### Dropbox

```text
BACKUP_DROPBOX_ENABLED=true
BACKUP_DROPBOX_REMOTE=dropbox:connect-api-platform
```

O exemplo sem credenciais está em `infrastructure/backup/rclone.conf.example`.

## Criptografia

É recomendável usar age:

```text
BACKUP_ENCRYPTION_RECIPIENT=age1...
BACKUP_ENCRYPTION_IDENTITY=/run/secrets/backup_age_identity
```

A chave privada nunca deve ser armazenada no mesmo servidor que os únicos backups.

## Retenção

```text
BACKUP_KEEP_DAILY=14
BACKUP_KEEP_WEEKLY=8
BACKUP_KEEP_MONTHLY=12
```

O serviço preserva o backup mais recente válido.

## Restore completo

```bash
./scripts/restore.sh /backup/arquivo.tar.zst
```

Para arquivo criptografado:

```bash
./scripts/restore.sh /backup/arquivo.tar.zst.age /caminho/identity.txt
```

Digite `RESTAURAR` quando solicitado.

O restore:

1. interrompe API, workers, beat, web e gateway;
2. ativa modo manutenção;
3. valida arquivo e checksums;
4. restaura Control Plane;
5. recria papéis e bancos dos tenants;
6. restaura os bancos;
7. restaura objetos;
8. remove modo manutenção somente após sucesso;
9. reinicia a aplicação.

## Teste de recuperação

Backup não testado não é garantia de recuperação. Execute periodicamente em servidor/staging separado:

```bash
cp backup.tar.zst /ambiente-isolado/
./scripts/restore.sh /ambiente-isolado/backup.tar.zst
docker compose ps
curl -fsS http://127.0.0.1:8800/health/ready
```

Valide amostras de tenants, documentos, cobranças, usuários e hashes.

# Backup e restauração

O Connect|API inclui backup nativo da stack para atualizações e recuperação.

O arquivo gerado usa a extensão `.connectbak` e é criptografado com AES-256-GCM. A chave é derivada da `AUTHENTICATION_API_KEY` da instalação. A API key não é armazenada dentro do backup.

## Criar

Na raiz da stack:

```bash
./backup.sh
```

Nas stacks de `deploy/production`, `deploy/develop`, `deploy/canonical`, `deploy/homologation`, `deploy/cloudpanel` e `deploy/dockge`, use o mesmo comando dentro do diretório da stack.

O backup inclui:

- dump do banco PostgreSQL ou MySQL;
- dados locais de sessão em `instances`;
- persistência do Redis;
- objetos do MinIO quando `BACKUP_INCLUDE_MINIO=true`;
- manifesto e checksums SHA-256.

## Verificar

```bash
./verify-backup.sh ./volumes/backups/<arquivo>.connectbak
```

A verificação autentica o envelope criptográfico e valida os checksums internos.

## Restaurar

```bash
./restore-backup.sh ./volumes/backups/<arquivo>.connectbak
```

A restauração exige a mesma `AUTHENTICATION_API_KEY` usada na criação do arquivo.

## Proteção de dados Google Find Hub

A desvinculação de uma conta Google Find Hub não é uma operação de purge: somente o material de autenticação é removido. Catálogo, histórico de posições, tracking, avatares, configurações e vínculos locais permanecem no banco para reconexão da mesma conta.

A exclusão da instância é a operação destrutiva e pode remover definitivamente esses registros por cascade. Antes de uma exclusão definitiva, mantenha um `.connectbak` validado.

Os scripts `update.sh` das stacks principais já executam `backup.sh` e `verify-backup.sh` antes de substituir a aplicação quando existe uma stack em execução. Os arquivos são mantidos em `ARGWS_CONNECT_BACKUPS_DATA_PATH` (por padrão `./volumes/backups`) conforme `BACKUP_RETENTION_COUNT`.

Para um incidente envolvendo apenas uma instância, não restaure um backup integral sobre o banco atual sem antes isolar o conteúdo do backup. O dump contém o estado completo da instalação; uma recuperação pontual deve extrair somente os registros da instância afetada ou ser feita primeiro em uma base temporária.

## Atualizações

Os scripts `update.sh` das stacks principais criam e verificam um backup antes de substituir a aplicação existente. A migration de compatibilidade da versão 1.0.21 preserva dados e não força conversão automática de provider ou novo pareamento do WhatsApp.

## Configuração

```env
ARGWS_CONNECT_BACKUPS_DATA_PATH=./volumes/backups
BACKUP_INCLUDE_MINIO=true
BACKUP_RETENTION_COUNT=10
```

`BACKUP_RETENTION_COUNT` controla apenas a retenção automática de arquivos `.connectbak` criados pelo script.

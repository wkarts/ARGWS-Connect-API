# Deployments oficiais

- `cloudpanel/`: Docker Compose + `.env` completo + snippets de reverse proxy para CloudPanel.
- `dockge/`: stack pronta para Dockge + `.env` completo.
- `ghcr/`: mapa das imagens e procedimento de bootstrap/publicação no GitHub Container Registry.

Todos os YAMLs de produção/homologação consomem imagens `ghcr.io/wkarts/argws-connect-*`. Não há build da aplicação no host de produção.

## Contrato de persistência

CloudPanel e Dockge seguem o mesmo padrão operacional: **bind mounts relativos à pasta da stack**.

```text
stack/
├── compose.yaml (ou docker-compose.yml)
├── .env
└── volumes/
    ├── instances/
    ├── postgres/
    ├── redis/
    ├── rabbitmq/
    ├── minio/
    ├── logs/
    └── backups/
```

Os serviços usam `./volumes/...` por padrão. Isso mantém configuração e dados físicos associados à mesma instalação e evita depender de named volumes internos do Docker.

Os caminhos podem ser sobrescritos pelo `.env` através de `ARGWS_CONNECT_*_DATA_PATH`, sem alterar os YAMLs.

# Deployments oficiais

- `cloudpanel/`: Docker Compose + `.env` completo + snippets para reverse proxy do CloudPanel.
- `dockge/`: stack pronta para importação no Dockge + `.env` completo.
- `ghcr/`: mapa das imagens e procedimento de bootstrap/publicação no GitHub Container Registry.

Todos os YAMLs de produção/homologação consomem imagens `ghcr.io/wkarts/argws-connect-*`. Não há build de código no host de produção.

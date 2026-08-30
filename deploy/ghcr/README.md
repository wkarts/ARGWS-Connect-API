# GHCR — ARGWS Connect API

O GHCR é o registry oficial do produto. Produção e homologação não dependem diretamente de Docker Hub, Quay ou outro registry.

## Bootstrap

Execute primeiro o workflow **GHCR - Sync Infrastructure Images**. Ele espelha as imagens-base e de infraestrutura para os packages `argws-connect-*` do GHCR.

Depois, o workflow **GHCR - Publish Application Images** publica API e Manager.

## Tags da aplicação

- `main` -> `latest`
- `develop` -> `homolog`
- tag semver -> versão semântica
- todo build -> tag `sha-<commit>`

Os assets de branding necessários em runtime são copiados para as imagens da API/Manager durante o build.

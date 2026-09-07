# Connect|API — GHCR hotfix

Correção incremental, sem refatoração do Engine ou da Manager.

## Causa

O artifact pattern `digest-develop-manager-*` também correspondia a `digest-develop-manager-api-*`.
O job de publicação do Manager baixava quatro digests em vez de dois e falhava em `test "${#sources[@]}" -eq 2`.
Como a matrix de publicação usava o `fail-fast` padrão, Manager API era cancelada e o tag `:develop` não era publicado.
Isso resultava em `manifest unknown` no `docker compose pull`.

## Correção

- separador de artifacts alterado para `component__arch`;
- patterns passam a ser exclusivos por componente;
- `fail-fast: false` na publicação;
- verificação final dos manifests `:develop`;
- mesma correção aplicada à automação de release para evitar o mesmo problema em `latest`/SemVer;
- contrato de deployment atualizado para reconhecer Manager e Manager API sem alterar os serviços existentes.

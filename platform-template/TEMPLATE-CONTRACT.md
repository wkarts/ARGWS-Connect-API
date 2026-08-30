# Template Contract v1

## Regra de sincronização

Toda implementação estrutural do `control-plane/` que seja independente do domínio Connect deve ser refletida neste template no mesmo ciclo de desenvolvimento.

## Tokens white-label

- `{{PLATFORM_NAME}}`
- `{{PLATFORM_SLUG}}`
- `{{PLATFORM_DOMAIN}}`
- `{{PLATFORM_API_IMAGE}}`
- `{{PLATFORM_WEB_IMAGE}}`

## Planos obrigatórios

```text
Control Plane
  -> Partners
  -> Tenants
  -> Installations
  -> Domains
  -> Nodes
  -> Provisioning
  -> Observability
```

## Persistência

O template usa bind mounts relativos ao diretório da stack em `./volumes/...`.

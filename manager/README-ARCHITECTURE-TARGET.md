# Connect|API Manager — arquitetura alvo

> Documento transitório para a evolução da Manager sem alterar o Engine nem os contratos públicos da API.

## Princípios

- Frontend administrativo: Vue 3 + TypeScript + Vite.
- BFF administrativo: FastAPI (Python), isolado do Engine.
- O Engine Connect|API permanece independente e não recebe responsabilidades de UI.
- Autenticação da Manager continua por sessão HttpOnly + CSRF + 2FA TOTP.
- Telemetria e licenciamento são funcionalidades administrativas **privadas e opt-in**: nenhuma informação, menu, status ou badge é exibido por padrão.
- Recursos privados só podem aparecer quando uma flag explícita de exposição estiver habilitada pelo operador da instalação.
- O domínio canônico da Manager é independente do domínio público da API.

## Política de exposição

Valores padrão obrigatórios:

```env
MANAGER_SHOW_LICENSE=false
MANAGER_SHOW_TELEMETRY=false
```

Mesmo que os serviços internos existam ou estejam configurados, a UI não deve inferir nem revelar sua presença sem opt-in explícito.

## Migração incremental

A implementação atual continua funcional durante a transição. O frontend legado não deve receber novas responsabilidades de produto além de correções, hardening e paridade necessária para permitir a troca segura pelo frontend Vue.

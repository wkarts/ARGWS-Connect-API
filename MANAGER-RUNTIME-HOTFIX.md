# Connect|API Manager — Runtime Hotfix

Correções aplicadas sem alterar o Engine Node.js/TypeScript nem os contratos de autenticação por API Key/token de instância.

- Manager API prepara o bind mount persistente e reduz privilégios antes de iniciar.
- `/manager/` e `/manager-api/` possuem roteamento explícito para o service Manager.
- Assets/PWA usam base `/manager/`, evitando que CSS/JS/ícones sejam encaminhados ao Engine.
- Primeiro acesso possui formulário protegido por `MANAGER_SETUP_TOKEN`.
- `MANAGER_SETUP_TOKEN` passa a ser gerado pelos scripts oficiais a partir do placeholder `CHANGE_ME_*`.
- Deployment Integrity valida o canal `develop` no `develop`; tags `latest`/SemVer continuam sob responsabilidade do workflow de release.
- Scripts de deploy preparam `volumes/manager` e exibem logs recentes automaticamente se a stack não subir.
- Global API Key e tokens individuais das instâncias permanecem inalterados e não dependem de 2FA.

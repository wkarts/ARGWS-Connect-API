# Deployments Fersoft

Quatro perfis sao mantidos sem remover os deploys oficiais existentes.

develop/: normal, derivado de deploy/develop.
develop/full-stack/: 14 servicos, derivado de deploy/develop/full-stack.
production/: normal, derivado de deploy/production.
production/full-stack/: 14 servicos, derivado de deploy/production/full-stack.

Cada perfil aponta para nomes de projeto, rede, servicos internos, banco, dominio e dados Fersoft.
As imagens e referencias GHCR sao exatamente as do template de origem e nao sao reescritas por este gerador.
Full stack e alternativa ao normal do mesmo canal e compartilha somente os dados daquele canal em ../volumes.

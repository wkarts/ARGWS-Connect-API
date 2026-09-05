# Segurança

O `connect-deploy` foi desenhado para não transportar segredos em argumentos da linha de comando.

- Chaves SSH conhecidas são validadas por padrão.
- `--accept-new-host-key` aceita apenas uma chave ainda desconhecida; uma alteração posterior continua sendo bloqueada.
- Senha SSH, token GitHub e token GHCR são solicitados com entrada oculta.
- `.env` e tokens temporários são enviados com permissão `0600` para um diretório remoto `0700` em `/tmp`.
- Temporários são removidos ao final da sessão SSH.
- `sudo` usa apenas `sudo -n`; o launcher não armazena nem injeta senha de sudo.
- O payload continua protegendo diretórios, volumes, identidade de dados, imagens e contexto Docker antes de aplicar a stack.

## Recomendações

1. Prefira autenticação SSH por chave Ed25519.
2. Use usuário de deploy dedicado.
3. Conceda somente as permissões efetivamente necessárias no VPS.
4. Não use `--accept-new-host-key` em automações permanentes; faça o primeiro trust de forma controlada.
5. Para GitHub privado, use token de leitura de repositório e `read:packages` separado para GHCR quando possível.
6. Assine os executáveis em produção quando houver certificado de code signing disponível.
7. Verifique o arquivo `.sha256` antes de distribuir o binário.

## Distribuição no repositório Connect|API

Builds de PR só recebem leitura do repositório, sem credenciais operacionais.
Apenas o job final da release canônica recebe `contents: write`, condicionado à
branch main e a uma release estável existente no mesmo commit validado.
Não há `pull_request_target`, `sudo` no build ou acesso a VPS em CI.
Os pacotes incluem avisos/licenças de terceiros e a revisão da fonte.
Não incluem assinatura de publicador: verifique a origem e o checksum confiável.
O checksum embutido do payload é uma verificação de integridade, não uma assinatura digital.

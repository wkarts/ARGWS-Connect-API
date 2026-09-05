# Distribuição do implantador no Connect|API

Este diretório contém o código do **ARGWS Connect Deployer 2.0.0**, integrado ao repositório principal. Não é necessário criar outro repositório ou uma tag independente.

## Receber os binários

No GitHub do Connect|API, abra **Actions → Connect Deployer - Build Binaries**, selecione uma execução concluída e baixe o artifact `connect-deploy-desktop-<plataforma>`.

Plataformas: `windows-x64`, `linux-x64`, `linux-arm64` e `macos-arm64`. Extraia o ZIP do artifact e depois o pacote da aplicação. Cada desktop contém os dois agentes Rust Linux. Os executáveis de agentes disponibilizados separadamente são para auditoria/build e não precisam ser instalados manualmente no VPS.

PRs/develop são builds de homologação. A publicação estável anexa os arquivos à mesma release existente do Connect|API, mediante a promoção autorizada da aplicação. Não execute `git tag v2.0.0` para publicar somente a ferramenta.

## Compilar

Use o workflow integrado ou os auxiliares locais descritos em `BUILD.md`. O workflow independente recebido no anexo está apenas em `reference/upstream-tauri-build.yml` como histórico.

## Operar

Abra a interface gráfica, confira o host/fingerprint SSH, configure o ambiente e revise o resultado de **Plan** antes de usar **Prepare** ou **Apply**. O Deployer não substitui backup de dados, não instala o sistema operacional/Docker/CloudPanel e não promove a aplicação para produção por conta própria.

Consulte `README.md`, `SECURITY.md` e `VALIDATION.md`. Os testes offline não comprovam uma implantação real no VPS. Não há assinatura de editor Authenticode/notarização Apple nesta integração.

# Connect|API — binários do implantador SSH

## Escopo

`tools/connect-deployer` integra o **ARGWS-Connect-Deployer.zip** fornecido por Wallace.
É uma ferramenta do repositório `wkarts/ARGWS-Connect-API`, não outra API, serviço
obrigatório ou ciclo independente de releases. O Engine, Platform, PgBouncer,
ACME/CloudPanel, Compose, migrations e o instalador raiz não são refatorados.

O launcher conserva os modos `local` e `ssh`, Paramiko, validação de chaves de host,
SFTP, PTY e o payload adaptado 1.0.1 com `GH_TOKEN_FILE` e
`ARGWS_CONNECT_GHCR_TOKEN_FILE`. A referência original permanece no pacote para
detectar divergências futuras em relação ao instalador raiz.

## Geração e associação ao projeto

Workflow: **Connect Deployer - Build Binaries**
(`.github/workflows/connect-deployer-binaries.yml`).

| Evento | Resultado |
|---|---|
| PR para develop/main com mudança no implantador | Testa e gera quatro pacotes em Actions; não publica release |
| Push pertinente em develop | Artefatos de desenvolvimento, identificados por SHA |
| Execução manual | Build da branch selecionada, sem publicar release |
| Release canônica da aplicação | Chamada reutilizável após a release existir; anexa os pacotes à mesma release |

A etapa aditiva `deployer-binaries` no workflow `auto-version-release.yml` chama
o workflow reutilizável com o commit e a tag resolvidos pela automação existente.
Não depende de evento de tag/release gerado pelo `GITHUB_TOKEN`, pois esse evento
não desencadeia automaticamente outro workflow. Não cria uma release concorrente,
não recalcula versões e não sobrescreve assets. Uma falha no implantador não
apaga nem substitui as imagens já publicadas da aplicação; aparece no workflow.

O arquivo de workflow precisa existir na branch padrão para o botão manual
ficar disponível. Antes da promoção, a PR já produz os artefatos automaticamente.

## Plataformas

| Pacote | Runner de compilação/teste |
|---|---|
| Windows x86_64 | Windows Server 2022 x64 |
| Linux x86_64 | Ubuntu 22.04 x64 |
| Linux ARM64 | Ubuntu 22.04 ARM64 |
| macOS ARM64 | macOS 14 Apple Silicon |

PyInstaller compila em cada sistema nativamente, sem QEMU/cross-compilation.
Linux usa glibc 2.35; não é um binário para Alpine/musl. Outros sistemas/versões
precisam de homologação. Não há assinatura Authenticode ou notarização Apple.

## Conteúdo e identidade

Cada artifact `connect-deploy-<sistema>-<arquitetura>` contém um ZIP e seu SHA-256.
Dentro do ZIP estão `connect-deploy` (ou `.exe`), `BUILD-INFO.json`, inventário de
hashes, dependências e licenças. A permissão executável é preservada no ZIP.
Um artifact adicional `connect-deployer-manifest` reúne os hashes dos quatro ZIPs.

A versão canônica da aplicação é lida de `VERSION`. A versão interna do wrapper
continua 1.0.0 e a do payload continua 1.0.1, conforme o anexo. Não representam
releases paralelas. Metadados incluem projeto, SHA, canal, plataforma e hash do payload.
A versão do binário não obriga a instalar a mesma versão no VPS: essa escolha
continua explicitamente no parâmetro `--version` após o separador `--`.

```powershell
.\connect-deploy.exe --version
.\connect-deploy.exe --build-info
.\connect-deploy.exe --self-check
```

## Usar do Windows para o VPS

Depois de extrair o ZIP Windows obtido em Actions, verifique o hash do ZIP com
`Get-FileHash` e o arquivo `.sha256` obtidos da mesma execução confiável.

Exemplo sem aplicar alterações, usando chave já conhecida:

```powershell
.\connect-deploy.exe ssh `
  --host SEU_VPS `
  --user deploy `
  --key-file "$HOME\.ssh\id_ed25519" `
  -- `
  --environment develop `
  --version develop `
  --deployment platform-develop `
  --directory /opt/stacks/argws-connect-platform-develop
```

Para interagir com os prompts, inclua `--interactive` antes do separador.
A aprovação para aplicar (`--apply`), aceitar o agente do host ou instalar Dockge
continua sendo uma escolha explícita. Não colocar senhas/tokens na linha de comando.
No primeiro acesso, valide a fingerprint por canal confiável antes de autorizar
`--accept-new-host-key`. Esse modo aceita somente uma chave ainda desconhecida;
uma mudança posterior deve ser investigada, não ignorada.

O computador local dispensa Python quando executa o binário. O VPS permanece
Linux com Python 3.10+, Docker/Compose e CloudPanel para a stack que o exige.
Não instala sistema operacional, Docker ou CloudPanel. O launcher não emite SSL,
executa SQL/migrations nem cria cron no host; entrega o instalador e usa os serviços
existentes. Não substitui o fluxo operacional do Dockge.

## Compilar localmente

No checkout Git completo, acesse `tools/connect-deployer` e use os scripts de build
para seu sistema. Eles criam um virtualenv, instalam dependências, geram metadados,
executam testes, compilam, fazem smoke test e empacotam. São ferramentas de build,
não scripts de manutenção dos bancos. Veja o README do implantador para comandos.

## Validação e limites

CI valida o executável congelado fora da árvore de fontes; verifica payload,
imports e operações criptográficas sem conexão SSH. Os quatro pacotes precisam
apontar para o mesmo SHA/versão/canal antes de serem aceitos.
Isso não comprova autenticação com as chaves privadas do operador, compatibilidade
com todo VPS ou implantação bem-sucedida na instalação real. Nenhuma credencial
operacional é necessária no GitHub Actions.

Fontes técnicas: documentação oficial do PyInstaller (compilação nativa e
bibliotecas de subprocessos) e GitHub Actions (runners, workflow_call e eventos
criados pelo GITHUB_TOKEN). O workflow original do anexo foi substituído apenas
para integração ao repositório e à release canônica.

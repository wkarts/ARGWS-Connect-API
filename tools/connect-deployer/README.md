# Connect|API Deployer (Rust nativo)

Executável Windows x64 nativo em Rust para preparar e validar uma stack do Connect|API. O `.exe` não contém Node.js, Python, WebView ou download de runtime. Ele usa o mesmo conjunto de ícones PNG do `Connect-FindHub-Auth-Assistant`.

O executável roda na máquina do operador e entrega somente:

- `compose.yaml`
- `.env` com permissao `0600`

O servidor de destino continua precisando apenas de Docker Compose, das imagens GHCR e dos volumes da stack. Nenhum `prepare-env.py`, `prepare-volumes.py`, shell script ou arquivo auxiliar e exigido pelo resultado.

## Uso rapido

Com o binário Windows baixado da pré-release `connect-api-develop` ou de uma release estável:

```powershell
.\argws-connect-deployer-win-x64.exe list
.\argws-connect-deployer-win-x64.exe plan `
  --flavor develop `
  --modules operations,traccar
.\argws-connect-deployer-win-x64.exe generate `
  --flavor develop `
  --modules operations,traccar `
  --output .\out\argws-connect-develop
.\argws-connect-deployer-win-x64.exe validate `
  --directory ./out/argws-connect-develop
```

Os mesmos comandos funcionam no `index.cjs` apenas para testes de compatibilidade no repositório; ele não é o binário distribuído.

`--modules` aceita `operations`, `nats`, `kafka`, `extended`, `mysql` e `traccar`. `extended` habilita NATS e Kafka; para uma stack somente com a infraestrutura base use `--modules none`.

Flavors disponíveis: `develop`, `homologation`, `production`, `canonical`, `dockge` e `cloudpanel`. Cada flavor usa o par oficial de template já versionado em `deploy/`.

## Traccar: regra que evita o incidente

O modo padrão é `--traccar-auth credentials`. Nesse modo o gerador:

- deixa `TRACCAR_TOKEN` vazio;
- gera `TRACCAR_ADMIN_PASSWORD` e `TRACCAR_DATABASE_PASSWORD` separadamente quando são placeholders;
- mantém a autenticação administrativa interna;
- recusa uma chave de API reutilizada como token Traccar.

Para importar deliberadamente um token existente, use explicitamente:

```powershell
.\argws-connect-deployer-win-x64.exe generate `
  --flavor develop `
  --modules operations,traccar `
  --traccar-auth token `
  --traccar-token TOKEN_QUE_FOI_EMITIDO_PELO_TRACCAR `
  --output .\out\argws-connect-develop
```

`AUTHENTICATION_API_KEY` e `TRACCAR_TOKEN` são credenciais diferentes. O gerador falha se forem iguais.

## Importar uma stack existente

Para preservar variáveis, comentários e credenciais existentes, passe o `.env` explicitamente. O arquivo importado não é reordenado:

```powershell
.\argws-connect-deployer-win-x64.exe generate `
  --flavor develop `
  --from-env C:\caminho\para\.env `
  --modules operations,traccar `
  --output .\out\argws-connect-develop
```

O gerador não rotaciona valores já preenchidos. Ele só cria valores onde encontra vazio ou `CHANGE_ME` e valida incompatibilidades antes de escrever.

## Build e validação do binário

O workflow `.github/workflows/connect-deployer.yml` executa os testes Node de compatibilidade e `cargo test` do núcleo Rust em cada PR. Nos builds de `develop` e nas tags, compila `tools/connect-deployer/native` em `windows-2022` com o SDK nativo e publica somente `argws-connect-deployer-win-x64.exe`. O `build.rs` incorpora os templates de `deploy/` e monta o ICO a partir dos mesmos `icon-16.png`, `icon-32.png`, `icon-48.png` e `icon-128.png` usados pelo Auth Assistant.

Cada build válido de `develop` atualiza a única pré-release móvel `connect-api-develop`, compartilhada com os binários Find Hub; os assets são substituídos com `--clobber`, sem criar uma tag por componente. Uma release `v*` é imutável e recebe o mesmo executável Windows, `SHA256SUMS.txt` e a proveniência junto dos demais assets da Connect|API.

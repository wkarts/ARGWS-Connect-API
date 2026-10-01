# Connect|API Deployer

Gerador portatil para preparar uma stack do Connect|API. Ele roda na maquina do operador e entrega somente:

- `compose.yaml`
- `.env` com permissao `0600`

O servidor de destino continua precisando apenas de Docker Compose, das imagens GHCR e dos volumes da stack. Nenhum `prepare-env.py`, `prepare-volumes.py`, shell script ou arquivo auxiliar e exigido pelo resultado.

## Uso rapido

Na raiz do repositorio:

```bash
node tools/connect-deployer/index.cjs list
node tools/connect-deployer/index.cjs plan \
  --flavor develop \
  --modules operations,traccar
node tools/connect-deployer/index.cjs generate \
  --flavor develop \
  --modules operations,traccar \
  --output ./out/argws-connect-develop
node tools/connect-deployer/index.cjs validate \
  --directory ./out/argws-connect-develop
```

`--modules` aceita `operations`, `nats`, `kafka`, `extended`, `mysql` e `traccar`. `extended` habilita NATS e Kafka; para uma stack somente com a infraestrutura base use `--modules none`.

Flavors disponíveis: `develop`, `homologation`, `production`, `canonical`, `dockge` e `cloudpanel`. Cada flavor usa o par oficial de template já versionado em `deploy/`.

## Traccar: regra que evita o incidente

O modo padrão é `--traccar-auth credentials`. Nesse modo o gerador:

- deixa `TRACCAR_TOKEN` vazio;
- gera `TRACCAR_ADMIN_PASSWORD` e `TRACCAR_DATABASE_PASSWORD` separadamente quando são placeholders;
- mantém a autenticação administrativa interna;
- recusa uma chave de API reutilizada como token Traccar.

Para importar deliberadamente um token existente, use explicitamente:

```bash
node tools/connect-deployer/index.cjs generate \
  --flavor develop \
  --modules operations,traccar \
  --traccar-auth token \
  --traccar-token 'TOKEN_QUE_FOI_EMITIDO_PELO_TRACCAR' \
  --output ./out/argws-connect-develop
```

`AUTHENTICATION_API_KEY` e `TRACCAR_TOKEN` são credenciais diferentes. O gerador falha se forem iguais.

## Importar uma stack existente

Para preservar variáveis, comentários e credenciais existentes, passe o `.env` explicitamente. O arquivo importado não é reordenado:

```bash
node tools/connect-deployer/index.cjs generate \
  --flavor develop \
  --from-env /caminho/para/.env \
  --modules operations,traccar \
  --output ./out/argws-connect-develop
```

O gerador não rotaciona valores já preenchidos. Ele só cria valores onde encontra vazio ou `CHANGE_ME` e valida incompatibilidades antes de escrever.

## Binários

O workflow `.github/workflows/connect-deployer.yml` testa o gerador em cada PR e empacota o binário Windows usando `pkg`. Cada build válido de `develop` atualiza a única pré-release móvel `connect-api-develop`, compartilhada com os binários Find Hub; os assets são substituídos com `--clobber`, sem criar uma tag por componente. Uma release `v*` é imutável e recebe o mesmo executável Windows, o `SHA256SUMS.txt` e a proveniência junto dos demais assets da Connect|API. A etapa de empacotamento cria um módulo temporário com os templates oficiais; o stack gerado continua independente desses arquivos.

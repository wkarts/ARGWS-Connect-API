# Find Hub Auth — Assistente Windows em Rust

Executável nativo Windows x64, sem Tauri/WebView ou dependências de execução. Não requer administrador, Rust, Node.js, Python ou conexão para preparar os arquivos. Não efetua login Google.

## Usar

Abra `Connect-FindHub-Auth-Assistant-0.1.3-windows-x64.exe`. Clique em **Instalar / atualizar arquivos**; os arquivos embutidos são conferidos e preparados em `%LOCALAPPDATA%\ARGWS\ConnectFindHubAuth\extension`. A atualização mantém a pasta e a identidade da extensão e conserva a versão anterior em `backups`.

Clique em Chrome ou Edge para abrir a página de extensões; o caminho da pasta é copiado. Na primeira utilização, habilite **Modo do desenvolvedor**, escolha **Carregar sem compactação** e cole o caminho. Na atualização, use **Recarregar** no card da extensão. O EXE não concede permissões nem ativa extensões silenciosamente. Se a extensão antiga foi carregada de outra pasta, remova somente aquele registro no navegador e carregue a pasta fixa acima; não deixe duas cópias ativas.

Brave e Vivaldi possuem atalhos quando detectados, mas precisam de homologação individual. Não há promessa de suporte universal em Chromium/mobile. A opção **Verificar instalação** confere os arquivos, não confirma que o navegador carregou a extensão.

O assistente não altera registro de políticas, arquivos de perfil, cookies ou sessões do navegador. Não transmite telemetria. O login continua sendo realizado diretamente nas páginas Google pela extensão autorizada. Uma resposta `exchange/http=400` exige análise do backend: o EXE não transforma uma rejeição Google em autenticação válida.

A distribuição inicial não possui assinatura Authenticode. Confira a origem e o SHA-256 publicado; não é necessário desativar antivírus ou proteções do navegador. Existe também o instalador NSIS tradicional no mesmo release. Ambos usam a mesma pasta e mutex; feche um antes de abrir o outro.

## Compilar

Na raiz do repositório, gere o pacote com `node scripts/build-findhub-distribution.cjs`. No Windows com Rust 1.90.0 e SDK Windows, configure `RC_EXE` para `rc.exe` x64, então:

```powershell
cargo +1.90.0 test --manifest-path browser-extensions/findhub-auth/windows-assistant/Cargo.toml --locked --offline
cargo +1.90.0 build --manifest-path browser-extensions/findhub-auth/windows-assistant/Cargo.toml --release --locked --offline
```

Não há crates externos. O resource compiler embute manifesto `asInvoker`, a versão e o ícone derivados dos ativos canônicos. O build reutilizável inclui testes reais de instalar/atualizar, detectar corrupção, abrir/fechar a janela, bloquear um segundo escritor e preservar políticas do navegador. Isso não homologa a autenticação Google real.

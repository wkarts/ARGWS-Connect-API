# Connect|API Deployer — interface gráfica nativa

O `argws-connect-deployer-gui-win-x64.exe` é a versão gráfica do Deployer.
Ele usa o mesmo núcleo Rust validado pela versão CLI e não contém Node.js,
WebView, Python ou runtime baixado.

A versão CLI (`argws-connect-deployer-win-x64.exe`) permanece disponível e não
é substituída. As duas versões geram exatamente os mesmos `compose.yaml` e
`.env`, com as mesmas regras de segurança e validação.

## Fluxo

1. escolha o flavor e os módulos da stack;
2. informe a pasta de saída;
3. opcionalmente importe um `.env` existente;
4. escolha credenciais internas do Traccar ou informe explicitamente um token;
5. clique em **Preparar stack**;
6. clique em **Validar pasta** antes de levar a stack ao servidor.

O modo seguro não sobrescreve `compose.yaml` ou `.env` existentes. A caixa de
substituição precisa ser marcada conscientemente.

O executável usa os mesmos PNGs de ícone do Auth Assistant:

- `browser-extensions/findhub-auth/icons/icon-16.png`
- `browser-extensions/findhub-auth/icons/icon-32.png`
- `browser-extensions/findhub-auth/icons/icon-48.png`
- `browser-extensions/findhub-auth/icons/icon-128.png`

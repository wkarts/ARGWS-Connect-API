# Validação do implantador integrado

A validação é feita no workflow raiz `Connect Deployer - Build Binaries`.

- Código anexado preservado como base e referência comparada ao instalador canônico.
- Testes unitários do launcher, comandos, payload, metadados e contratos de publicação.
- Compilação real PyInstaller em quatro runners nativos com Python 3.12.
- Smoke test do executável em diretório externo ao checkout: versão, metadados,
  integridade do payload, SSH/criptografia e ajuda. No Linux testa a delegação local `--help`.
- Hashes internos/externos e permissões dos quatro pacotes conferidos antes da publicação.
- CI não usa VPS, senha SSH, tokens Cloudflare ou credenciais privadas do operador.

Compilação bem-sucedida não é homologação de uma implantação real via SSH.
O status da PR/Actions é a evidência de execução, não este documento estático.

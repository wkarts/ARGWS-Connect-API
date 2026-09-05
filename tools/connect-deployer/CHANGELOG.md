# Changelog

## 1.0.0

- Criação do `connect-deploy` como launcher local/SSH.
- Empacotamento single-file via PyInstaller.
- Build local para Windows, Linux e macOS.
- Build e release automatizados por GitHub Actions.
- SSH por chave, agent ou senha solicitada localmente.
- Validação segura de `known_hosts` e opção explícita de trust-on-first-use.
- Upload SFTP temporário com permissões restritas.
- PTY remoto opcional para uso interativo.
- Transporte seguro de `.env`, token GitHub e token GHCR sem segredo na linha de comando.
- Execução opcional via `sudo -n`.
- Limpeza automática dos arquivos temporários remotos.
- Payload atualizado internamente de 1.0.0 para 1.0.1 apenas para suportar `GH_TOKEN_FILE` e `ARGWS_CONNECT_GHCR_TOKEN_FILE`.
- Cópia do payload original mantida em `reference/install-connect-original.py` para auditoria/diff.

## Integração com o repositório Connect|API

Workflow na raiz; quatro plataformas nativas; publicação na release já existente
da aplicação por chamada reutilizável; metadados, checksums, licenças e smoke tests
reais dos executáveis. O `install-connect.py` raiz e o runtime Connect|API permanecem
sem alterações. A delegação local restaura caminhos de bibliotecas do PyInstaller.

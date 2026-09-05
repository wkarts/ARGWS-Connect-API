# Validação da entrega

## Validações realizadas na geração do pacote

Foram revisados estruturalmente:

- organização do workspace Cargo;
- separação `protocol` / `agent` / `desktop`;
- contrato JSON compartilhado;
- UI Vue/TypeScript;
- fluxo Tauri `invoke`;
- SSH/SFTP e `known_hosts`;
- SHA-256 do agente por releitura SFTP;
- proteção de diretórios temporários;
- port das regras do `install-connect.py`;
- preservação do `.env`;
- proteção de volumes/portas/identidade de dados;
- GitHub release/commit/blob integrity;
- GHCR temporário;
- Docker Compose Plan/Prepare/Apply;
- readiness;
- agentes `amd64`/`arm64` embutidos;
- scripts locais;
- workflow de GitHub Actions;
- coleta dos artefatos a partir do `target/` correto do Cargo workspace.

Também foram adicionados testes Rust para:

- redaction de segredos em `Debug`;
- preservação de segredo existente no `.env`;
- troca controlada de tag de imagem;
- variáveis duplicadas no `.env`;
- derivação dos hosts da Platform;
- rejeição de `.`/`..` em diretório;
- rejeição de raízes perigosas;
- normalização/rejeição de repositórios GitHub.

## Limitação do ambiente desta entrega

O ambiente usado para montar este pacote **não possui `rustc`/`cargo` nem Docker utilizável para o build**, e o acesso aos registries de pacotes estava indisponível para instalar todas as dependências.

Mesmo assim, foi executado o validador estrutural `scripts/validate-project.py`, além da validação sintática do workflow YAML, dos scripts shell e do script Node de coleta de artefatos. A cópia de referência do instalador Python foi comparada byte a byte com o arquivo fornecido.

Por isso não foi possível executar localmente:

```text
cargo check
cargo test
cargo build
npm install
npm run build
npm run tauri:build
```

Essa limitação não é ocultada nem tratada como binário compilado/aprovado. O pacote entregue é o projeto-fonte completo; o build executável deve ser produzido localmente ou pelo workflow incluído.

## Validação automática prevista no repositório

O workflow `.github/workflows/build.yml` executa em infraestrutura GitHub:

### Agentes Linux

Para `amd64` e `arm64`, usando containers da própria arquitetura; o job `arm64` habilita QEMU no runner GitHub quando necessário:

```text
cargo test -p deployer-protocol
cargo test -p connect-deploy-agent
cargo check -p connect-deploy-agent
cargo build --release -p connect-deploy-agent
```

Os agentes são construídos para targets musl e recebem SHA-256.

### Desktop

Em Windows, Linux e macOS:

```text
npm install
npm run build
cargo check -p argws-connect-deployer-desktop
npm run tauri:build
```

Os dois agentes Linux do job anterior são incorporados antes do `cargo check`/build do desktop.

## Critério para considerar release utilizável

Antes de usar em produção, exija:

1. workflow verde para os dois agentes;
2. workflow verde para o desktop alvo;
3. SHA256SUMS gerado pela release;
4. primeiro deploy com `action=plan`;
5. teste em VPS de homologação equivalente à produção;
6. somente depois `action=apply` em produção.

## Testes operacionais recomendados

1. host SSH conhecido;
2. host SSH novo com aceite explícito;
3. host key alterada deve bloquear;
4. autenticação chave sem passphrase;
5. autenticação chave com passphrase;
6. autenticação SSH Agent;
7. senha SSH;
8. VPS amd64;
9. VPS arm64;
10. deploy develop;
11. produção latest estável;
12. tentativa `production + develop` deve bloquear;
13. repositório privado GitHub;
14. GHCR privado;
15. atualização com `.env` existente;
16. tentativa de substituir `.env` existente deve bloquear;
17. mudança de volume/porta deve bloquear;
18. Host Agent sem aceite deve bloquear;
19. Dockge sem aceite do socket deve bloquear;
20. readiness healthy e unhealthy.

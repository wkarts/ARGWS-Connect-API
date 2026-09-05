# Arquitetura — ARGWS Connect|API Deployer

## Componentes

### 1. Desktop UI

Tecnologias:

- Tauri 2;
- Vue 3;
- TypeScript;
- Vite.

Responsabilidades:

- UX do operador;
- coleta de parâmetros;
- seleção de arquivo local;
- apresentação de pré-flight, progresso e recibo.

A UI não executa shell remoto diretamente.

### 2. Desktop Rust Core

Local: `src-tauri/src/`.

Responsabilidades:

- TCP/SSH;
- autenticação por chave, senha ou SSH Agent;
- validação `known_hosts`;
- fingerprint SHA-256;
- SFTP;
- escolha de agente pela arquitetura;
- upload em diretório temporário privado;
- SHA-256 do agente relendo-o por SFTP;
- envio da solicitação por `stdin`;
- streaming dos eventos JSONL;
- limpeza do agente temporário.

### 3. Protocolo

Local: `crates/deployer-protocol`.

É compartilhado entre desktop e agente e define:

- `DeployRequest`;
- `DeployAction`;
- `Environment`;
- `AgentEvent`;
- `ServerPreflight`;
- `DeployReceipt`;
- `PROTOCOL_VERSION`.

Isso evita contratos duplicados entre desktop e agente.

### 4. Remote Agent

Local: `crates/deployer-agent`.

É um executável Linux Rust estático construído com musl.

Principais módulos:

```text
deploy.rs      orquestração da implantação
github.rs      resolução release/commit e integridade das fontes
envfile.rs     preservação/atualização segura do .env
docker.rs      Compose, imagens, GHCR, readiness e proteção de storage
storage.rs     lock, atomic writes, backup e recovery
events.rs      eventos estruturados JSONL
```

## Contrato Desktop → Agent

O desktop executa:

```text
connect-deploy-agent execute
```

A requisição JSON entra em **stdin**.

O agente responde em stdout exclusivamente com linhas JSON:

```json
{
  "protocol_version": 1,
  "kind": "info",
  "step": "github",
  "message": "Resolvendo release e commit imutável no GitHub...",
  "progress": 8
}
```

O último evento `result` contém o recibo.

Nenhum token é passado como argumento de processo.

## Embedding dos agentes

`src-tauri/build.rs` procura:

```text
src-tauri/embedded/agent-linux-amd64
src-tauri/embedded/agent-linux-arm64
```

Quando presentes, os bytes são incorporados no executável Tauri por `include_bytes!`.

Se uma arquitetura não estiver embutida, o desktop recusa um VPS dessa arquitetura, em vez de tentar baixar binário remoto não verificado.

## Modelo de atualização

O Deployer não clona o repositório no VPS.

O agente:

1. resolve `develop`, `latest` ou `vX.Y.Z` pela GitHub API;
2. resolve o commit SHA-1 de 40 caracteres;
3. obtém somente os arquivos de deployment necessários;
4. verifica o Git blob SHA-1 retornado pela API;
5. renderiza e valida o Compose;
6. valida imagens;
7. só depois altera a configuração/containers.

## Proteção de dados

Em atualização, a assinatura dos serviços existentes compara:

- volumes;
- portas;
- variáveis de identidade de dados, incluindo PostgreSQL/database URI/chaves de aplicação.

Se houver divergência, o deploy é bloqueado e exige revisão de migração explícita.

O agente não executa migração SQL automaticamente e não apaga volumes.

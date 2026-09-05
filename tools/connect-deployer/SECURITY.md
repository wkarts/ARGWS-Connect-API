# Segurança

## Threat model resumido

Este Deployer possui capacidade administrativa sobre VPS. Uma credencial SSH comprometida ou autorização indevida do Host Agent/Docker socket pode equivaler a controle do servidor.

Por isso o projeto adota comportamento **fail-closed** nas decisões de maior risco.

## SSH Host Key

- `known_hosts` é validado antes do deploy;
- `Mismatch` bloqueia imediatamente;
- host não conhecido bloqueia por padrão;
- TOFU só ocorre após opção explícita `accept_new_host_key`;
- fingerprint SHA-256 é apresentada ao operador.

## Credenciais

O projeto não grava senha SSH, passphrase, GitHub PAT, GHCR token ou Cloudflare token em logs.

As credenciais de deployment seguem pelo payload JSON em stdin no canal SSH. Portanto não ficam visíveis em `ps` como argumentos.

O `.env` selecionado no desktop não é enviado ao frontend como texto; ele é lido pelo comando Rust a partir do caminho escolhido.

## GHCR

O login usa `--password-stdin`.

O agente cria um `DOCKER_CONFIG` temporário:

- diretório `0700`;
- `config.json` `0600`;
- remove `credsStore` da cópia;
- remove apenas helper de `ghcr.io` da cópia;
- nunca envia o token temporário a um credential helper persistente;
- o diretório é destruído no drop do `TempDir`.

## Remote Agent

- caminho temporário contém UUID gerado localmente;
- diretório remoto `0700`;
- agente remoto `0700`;
- bytes do agente são relidos via SFTP;
- SHA-256 local deve coincidir antes da primeira execução;
- agente máximo: 64 MB na verificação;
- temporários são removidos por SFTP ao final.

## Sudo

O Deployer nunca solicita senha de sudo.

Se `sudo` estiver ativo:

```text
sudo -n true
```

precisa funcionar antes da implantação.

Evite `NOPASSWD: ALL` quando puder fornecer uma política mais restrita ao usuário de implantação.

## Docker socket

Docker socket é root-equivalent na prática. Por isso a instalação do Dockge exige autorização separada `accept_docker_socket`.

## CloudPanel Agent

Containers privilegiados são recusados, a menos que `accept_host_agent` tenha sido explicitamente marcado.

## Saída de processos

Falhas de Docker não imprimem stdout/stderr crus porque o Compose pode interpolar segredos em mensagens. O agente retorna erro sanitizado e código de saída.

## Timeouts

- comandos normais Docker: 60 s;
- inspeção de manifesto: 90 s;
- pull/up: 1800 s;
- readiness: configurável de 0 a 3600 s.

Ao atingir timeout de subprocesso, o agente encerra o filho e não expõe sua saída.

## Escopo deliberadamente não implementado

O Deployer não tenta:

- instalar Docker;
- instalar CloudPanel;
- alterar firewall/SSH do host;
- executar migrations SQL diretamente;
- remover volumes;
- realizar rollback destrutivo de banco;
- aceitar automaticamente uma chave SSH modificada.

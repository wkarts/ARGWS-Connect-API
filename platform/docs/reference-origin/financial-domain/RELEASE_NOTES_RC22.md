# Multitenant Application Platform 1.0.0-rc.22

## Objetivo

Esta release corrige falhas observadas em produção após a rc.21 nos fluxos de landing pública, observabilidade Docker, documentos, relatórios e WhatsApp.

## Correções

### Landing page pública

- o domínio público agora encaminha `/api/` para o backend antes do fallback estático;
- a configuração salva no Control Plane volta a ser carregada pela landing;
- habilitar/desabilitar a landing passa a refletir corretamente em `app.example.com`;
- a landing continua sem expor URLs administrativas, providers, repositórios ou detalhes internos.

### Central operacional e logs

- o `compose.yaml` canônico passa a incluir `platform-log-agent` e `financial-docker-proxy`;
- o agente não monta o Docker socket diretamente;
- o socket é acessado somente por proxy interno, em rede isolada, com operações de escrita bloqueadas;
- nenhum serviço de observabilidade publica porta no host;
- a API e o agente usam uma credencial interna dedicada;
- o gerador de segredos acrescenta automaticamente `INTERNAL_SERVICES_PASSWORD` também ao atualizar `.env` antigo;
- o bundle Dockge usa o mesmo desenho de observabilidade do compose canônico.

### Documentos e relatórios

- documentos não dependem mais de URL S3 pública para download;
- a API autenticada serve documentos diretamente do storage privado do tenant;
- PDFs da Central de Documentos podem ser visualizados, impressos e baixados;
- exportações concluídas passam a possuir rota autenticada própria de download;
- relatórios PDF, Excel e CSV são baixados mesmo quando `S3_PUBLIC_ENDPOINT_URL` está vazio;
- a mensagem incorreta “arquivo gerado, mas URL não retornada” deixa de ocorrer no fluxo normal.

### WhatsApp / Evolution

- o envio principal usa o payload atual `number` + `text`;
- existe fallback restrito para versões da Evolution que retornam erro 5xx explicitamente relacionado ao schema legado `textMessage`;
- respostas de erro do provider passam a ser registradas de forma estruturada na observabilidade, sem expor credenciais;
- o histórico do tenant exibe uma mensagem de falha útil em português em vez de ocultar a causa;
- o teste de envio preserva o resultado depois da atualização da grade;
- a normalização brasileira de DDI/DDD permanece aplicada.

### Português do Brasil

- filtros de comunicação deixam de exibir `PENDING`, `RETRY`, `SENT`, `DELIVERED`, `READ` e `FAILED` diretamente;
- `NEGOTIATED` e demais estados passam pelo tradutor comum de situações;
- termos visíveis de relatórios e documentos foram normalizados para PT-BR.

## Atualização de uma instalação existente

Antes do deploy, faça backup da stack e preserve o `.env` atual.

```bash
python3 scripts/generate_secrets.py --env .env

docker compose --env-file .env pull
docker compose --env-file .env up -d --remove-orphans
```

O primeiro comando preserva os segredos válidos existentes e cria apenas a nova credencial interna quando ela estiver ausente.

Após a subida, valide:

```bash
docker compose ps
```

Devem aparecer, além dos serviços já existentes:

```text
financial-docker-proxy
platform-log-agent
```

No Control Plane, **Logs e diagnóstico > Console da stack** deve listar os containers da própria stack.

## Segurança

- o Docker socket não é entregue à API nem ao frontend;
- o agente de logs permanece interno;
- o proxy Docker bloqueia operações POST;
- documentos permanecem privados no S3/MinIO e são entregues somente por endpoint autenticado;
- mensagens de erro do WhatsApp não persistem API key, Authorization ou outros segredos.

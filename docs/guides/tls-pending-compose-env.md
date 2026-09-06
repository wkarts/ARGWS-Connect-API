# DNS/SSL pendente usando somente compose.yaml e .env

O operador fornece apenas o `compose.yaml` da stack e o `.env`. Certificados, contas
ACME e recibos JSON são **dados internos gerados pelos serviços nos volumes**,
assim como os arquivos do PostgreSQL. Não são anexos que o operador deve preparar,
importar, editar ou incluir na pasta do deploy. Não criar uma prova fictícia para
marcar um domínio como ACTIVE.

## Caso reproduzido: diagnóstico de 06/09/2026 às 02:08 UTC

O bundle enviado mostra API e ambos os PgBouncer saudáveis, provisionamento em
WAITING_TLS (95%), ACME com ValueError e CloudPanel Agent com FileNotFoundError.
O código anterior ocultava o motivo específico do ACME ao retornar
WILDCARD_DNS_PROOF_PENDING e não exportava os recibos de diagnóstico. Esse bundle
não permite concluir se há token inválido, origem DNS inexistente ou outro erro
concreto. FileNotFoundError também não identifica o caminho ausente. Não utilizar
o log antigo de 05/09 como substituto desse diagnóstico.

## Correção de diagnóstico

O ACME valida os parâmetros antes de alterar DNS, grava e registra códigos seguros
de falha e a etapa: configuration, dns, account ou issuance. Não registra token,
chave privada, saída bruta de comandos ou qualquer mensagem arbitrária da exceção.

O agente continua pendente enquanto não puder confirmar o certificado servido.
Aguardar a primeira emissão não é motivo para importar PEM manualmente. As
verificações de cadeia, hostname, fingerprint, Host, upstream e journal de
rollback continuam obrigatórias. Esta correção não altera a lógica de instalação
de certificados no host.

A API preserva a causa segura do DNS/ACME, inclusive em recibos das imagens antigas:
quando dns.json tem apenas ValueError, tenta aproveitar o código específico em
acme.json. Um FileNotFoundError secundário do agente não deve ocultar um erro de
zona/token/origem no ACME. Estados ausentes ou expirados não viram provas válidas.

A exportação de diagnóstico do **Control Plane** agora contém um resumo sanitizado
em platform/tls-status.json: presença, status, etapa, atualização e código de erro.
Não exporta os recibos inteiros, variáveis de ambiente, tokens, registros DNS ou
arquivos de certificado. A exportação de um cliente não inclui esse resumo global.
Este JSON é criado automaticamente dentro do ZIP de diagnóstico; não é requisito
adicional de deploy.

## Parâmetros de desenvolvimento

Mantenha seus segredos, bancos, volumes e project existentes. Confira no `.env`:

```env
PLATFORM_TLS_AUTOMATION_ENABLED=true
ACME_STAGING=false
ACME_DOMAIN=d.connect.argws.com.br
TENANT_DOMAIN_ROOT=d.connect.argws.com.br
CLOUDPANEL_SITE_DOMAIN=d.connect.argws.com.br
CLOUDPANEL_WILDCARD_DOMAIN=*.d.connect.argws.com.br
CLOUDPANEL_REVERSE_PROXY_URL=http://127.0.0.1:38802
```

Também são obrigatórios ACME_EMAIL e CLOUDFLARE_API_TOKEN autorizados. O Compose
encaminha CLOUDFLARE_API_TOKEN ao CF_Token do serviço; preencher uma tela externa
não substitui essa configuração de ambiente. Não duplicar ou publicar o token.

CLOUDFLARE_TENANT_RECORD_TARGET é o destino **público** do DNS: IP público do VPS
ou hostname de origem válido, conforme o guia de provisionamento. Não usar
127.0.0.1, porta, esquema https:// ou IP privado nesse parâmetro. O loopback pertence
somente à URL interna do Reverse Proxy. Não trocar uma origem válida antes de
conferir o motivo informado pelo serviço.

CLOUDFLARE_ZONE_ID, quando informado, é o identificador da zona, não o texto
argws.com.br. Vazio permite descoberta com o token autorizado. Uma falha de
permissão não deve ser contornada dando acesso irrestrito à conta ou apagando DNS.

## Resolver pelo gerenciador

Atualize os serviços com as imagens homologadas do mesmo canal e recrie os
containers que receberam mudanças no `.env`. Não é preciso copiar o código-fonte,
executar shell no VPS nem rodar o implantador desktop para isso. A API, ACME e o
agente precisam compartilhar os mesmos volumes de recibos/certificados declarados
no Compose. Preserve os caminhos existentes; não apague volumes para recriá-los.

Consulte os logs do ACME no Dockge e o erro do domínio no painel. Exemplos:
CLOUDFLARE_HTTP_401/403 aponta para credencial/autorização; INVALID_DOMAIN aponta
para hostname inválido; PLATFORM_ORIGIN_DNS_MISSING aponta para ausência de origem;
PLATFORM_DNS_RECORD_CONFLICT exige revisão dos registros conflitantes. Nenhuma
dessas condições é corrigida criando dns.json manualmente.

Depois de corrigir a configuração específica, os próprios serviços repetem a
reconciliação. O job só conclui após DNS, certificado servido, banco e storage
passarem nas verificações existentes. Esta alteração não promete que todos os
valores do `.env` de uma instalação desconhecida estão corretos.

O mesmo código é usado pela Platform de produção; nesse ambiente, selecione as
imagens estáveis promovidas e os nomes connect.argws.com.br/porta 38800. Não use
uma tag develop isolada no conjunto de produção para contornar uma publicação.

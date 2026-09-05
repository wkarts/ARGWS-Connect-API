# Connect|API — SSL wildcard por serviços e criação confiável de instâncias

## Operação normal: um Reverse Proxy por stack

A aplicação usa o mesmo modelo do Scheduler Pro: **acme.sh + DNS-01 Cloudflare + agente CloudPanel com `clpctl`**, executados como serviços da stack. Não é necessário executar scripts no VPS, editar VHost ou instalar certificados manualmente.

No CloudPanel, crie ou mantenha apenas o Reverse Proxy base do ambiente que será utilizado:

| Stack | Domínio do Reverse Proxy | URL interna |
|---|---|---|
| Desenvolvimento | `d.connect.argws.com.br` | `http://127.0.0.1:38802` |
| Produção | `connect.argws.com.br` | `http://127.0.0.1:38800` |

Os valores personalizados do `.env` continuam prevalecendo. O gateway deve permanecer restrito ao loopback. Não misture `develop`, `latest` e versões canônicas no mesmo ambiente. Este lote é homologado e publicado primeiro no canal `develop`.

Antes de iniciar a stack no Dockge/Compose, mantenha no `.env` suas credenciais reais, `ACME_EMAIL` e `CLOUDFLARE_API_TOKEN` com permissão **Zone:Read + DNS:Edit** nas zonas utilizadas. Informe `CLOUDFLARE_TENANT_RECORD_TARGET` com o IP público do VPS, ou mantenha o registro base correto na Cloudflare para o serviço descobrir o destino pela API. Token, autorização da zona, conectividade pública e CloudPanel instalado são pré-requisitos, não recursos que a aplicação pode inventar.

`PLATFORM_TLS_AUTOMATION_ENABLED=true` é o padrão das stacks completas. Nas stacks standalone `platform-develop` e `platform-production`, ACME e agente não dependem mais de profile adicional. Na stack multiperfil, fazem parte do profile `platform` existente.

## O que os serviços fazem

O ACME reconcilia root, wildcard e aliases fixos configurados como DNS-only na Cloudflare. O provedor `dns_cf` do acme.sh cria e remove os TXT `_acme-challenge`; o reconciliador de registros de endereço não manipula esses TXT. A configuração persistente usa `/acme.sh` via `--config-home`; executável e providers permanecem na imagem.

O certificado contém root + wildcard, `TENANT_DOMAIN_ROOT` + wildcard, os hosts fixos da Platform e eventuais `ACME_ADDITIONAL_DOMAINS`. Isso é importante no desenvolvimento: **`*.d.connect.argws.com.br` não cobre `d.control.connect.argws.com.br`**; este último entra explicitamente como SAN, sem renomear o domínio existente.

O agente espera o Reverse Proxy base existir, identifica seu `server_name` exato, acrescenta os aliases e mantém `proxy_set_header Host $host`. Valida com `nginx -t`, recarrega e restaura a configuração anterior em caso de erro. Instala o certificado com `clpctl site:install:certificate`. Só publica estado `READY` depois de conferir cadeia confiável, validade, SAN e fingerprint do certificado **efetivamente servido** em `127.0.0.1:443`, usando SNI para cada alias e um hostname de prova do wildcard.

O ACME verifica periodicamente a validade; apenas certificados ausentes, alterados ou com até 30 dias restantes provocam emissão/renovação. Publica um bundle validado por troca atômica de symlink, preservando o anterior se a emissão falhar. Backoff limita novas tentativas. `ACME_STAGING=true` usa armazenamento separado: certificado de teste não é instalado no CloudPanel nem considerado pronto.

## Limite de privilégio e dados

O serviço `platform-cloudpanel-agent-<project>` tem `privileged: true`, `pid: host`, `network_mode: host` e `/:/host`. Não publica porta nem fornece endpoint. Esse privilégio equivale a acesso administrativo ao VPS e deve ficar restrito ao agente, que só gerencia os nomes explicitamente configurados. Os demais serviços não recebem esses novos privilégios. Permissões de integrações preexistentes, como o coletor de logs, não foram ampliadas.

Chaves privadas ficam apenas nos volumes ACME/certificados e no agente. API e worker montam somente `/tls-status:ro`, com recibos públicos de DNS e TLS. O agente não aceita destinos, comandos ou caminhos enviados pelo navegador. Recusa aliases pertencentes a outro VHost e conflitos DNS ambíguos, sem apagar sites ou registros de terceiros.

## Estados reais de provisionamento

Criar um arquivo PEM não comprova SSL ativo. Domínios da Platform só recebem ativação inicial depois dos recibos de DNS e do certificado servido. Sem prova, permanecem `WAITING_DNS`/`WAITING_SSL`.

Quando banco e storage estão prontos e só falta SSL, o job fica `WAITING_TLS` em 95%. O scheduler/worker revalida o certificado, o banco e o storage e conclui o provisionamento, sem recriar banco, alterar credenciais ou repetir bootstrap. Um site já verificado não é desligado por uma falha transitória de polling: fica com `RECHECK_PENDING` até revalidação, limitado à validade do último certificado comprovado.

`PLATFORM_TLS_AUTOMATION_ENABLED=false` desativa conscientemente os serviços; não simula certificado válido. Domínios externos arbitrários e hierarquias com mais níveis não são automaticamente cobertos pelo wildcard. Devem ter prova de propriedade, SAN/certificado e roteamento próprios; este lote não cria VHosts externos de clientes automaticamente. `ACME_ADDITIONAL_DOMAINS` é configuração explícita do operador, não entrada livre do cliente.

## Instâncias: criação e pareamento separados

`POST /api/v1/connect/instances` reserva o vínculo e a cota sob bloqueio transacional do cliente antes de chamar o Engine. A chamada de criação sempre usa `qrcode=false`; o campo público `qrcode` permanece compatível como intenção da interface, não como dependência para concluir a criação. O alias identifica uma reserva idempotente; repeti-lo com outra configuração retorna 409. Reservas pendentes também ocupam cota.

`POST /api/v1/connect/instances/{id}/reconcile` retoma uma criação incerta após timeout. Uma credencial individual criptografada prova a propriedade da instância anterior. Coincidência de nome não basta: objeto de outro cliente nunca é adotado automaticamente. Lease persistente evita duas chamadas concorrentes; não há transação SQL aberta durante a chamada HTTP externa.

`POST /api/v1/connect/instances/{id}/connect`, com corpo vazio ou `{"number":"5575999999999"}`, é a etapa própria de QR Code/código de pareamento. A resposta contém somente `base64`, `pairing_code`, `state` e `pending`. Falha de pareamento não apaga a instância. A interface permite verificar criação, pedir QR e pedir código separadamente; não anuncia conexão estabelecida quando o Engine ainda está aguardando.

Adoção existente exige nome exato e `instance_token` individual; a chave global não é aceita como prova fornecida pelo cliente. A descoberta não expõe inventário global de instâncias sem vínculo. Limites comerciais continuam permitindo várias instâncias por cliente, conforme o contrato.

## Demais correções

As rotas de perfis, chaves de API, webhooks de saída e empresas passam a existir no escopo Connect sem habilitar o domínio financeiro de referência. Concessão de permissões não pode ultrapassar as do operador. `/metrics` aceita o hostname interno canônico `connect-platform-api`.

Upstream 401/403 vira `ENGINE_CREDENTIAL_REJECTED` com HTTP 502, e não invalida a sessão do navegador. HTTP 409, 429, timeout e falha de pareamento têm códigos específicos. Repetição automática de HTTP é limitada a leituras seguras; criação, pareamento, envio e exclusão não são repetidos pelo cliente HTTP.

O diagnóstico de 05/09/2026 contém `08P01 / bouncer config error` intermitente durante login. Foi adicionada uma tentativa limitada de reconexão **antes de o driver retornar a conexão**, sem repetir SQL/transações, e o healthcheck PgBouncer agora consulta também o banco real. Logs de desconexão permitem investigar o motivo subjacente. Isso não prova, por si só, a eliminação de toda falha de infraestrutura na instalação real.

## Validação e limites

A suíte inclui transações PostgreSQL reais para concorrência, cota e reserva; o Engine externo é simulado nesses testes para controlar timeout e prova de propriedade. NGINX real valida wildcard, preservação de Host e rollback. Os serviços ACME e CloudPanel têm build próprio no CI. Testes isolados verificam certificados, cadeia/chave, staging, DNS e estados.

Cloudflare, emissão Let's Encrypt, `clpctl` real e pareamento WhatsApp real precisam de homologação no VPS autorizado. O CI não usa credenciais reais nem altera o ambiente do usuário. Atualizar GitHub/imagens não equivale a atualizar containers já executando.

## Correções da auditoria e instalador universal

`CLOUDFLARE_TENANT_RECORD_TARGET` como hostname agora exige cadeia CNAME conferida pela API, sem ciclos, sem proxy e terminando em IP público. O primeiro hostname é explicitamente gerenciado; os demais saltos são somente verificados. `CLOUDFLARE_ORIGIN_IPV4/IPv6` opcionais permitem provisionar esse primeiro hostname. Zonas sem autorização e cadeias ambíguas falham com código de diagnóstico, sem modificar terceiros. Confirmação por leitura após escrita precede o recibo DNS READY.

O scheduler revalida até 100 subdomínios persistidos por ciclo, priorizando os menos recentemente verificados. Somente registros específicos existentes nesses nomes são ajustados para a origem comprovada e DNS-only. Ausência de registro específico usa wildcard sem criar registro por cliente; um nó exato TXT/MX/NS sem endereço é um conflito que pode suprimir wildcard e não é considerado pronto. Campos `managed_dns` em metadata registram a comprovação individual. Chamadas repetidas usam prova recente, limitada a cinco minutos.

O agente corrige um único upstream literal HTTP loopback no VHost gerenciado para `CLOUDPANEL_REVERSE_PROXY_URL`. Upstreams remotos, dinâmicos ou múltiplos são recusados. `CLOUDPANEL_WILDCARD_DOMAIN` divergente dos SAN configurados deixa de ser ignorado. Journal persistente com checksum e permissões antecede a primeira mutação de arquivos; ao reiniciar, um journal pendente é recuperado antes da validação do NGINX. Esse rollback restaura arquivos NGINX/certificados, não transações internas do banco do CloudPanel.

`last_installed_at` registra instalação efetiva via clpctl; `last_verified_at` é a última conferência do certificado servido. `last-cloudpanel-installed-at.txt` é atualizado somente na instalação. Falha transitória mantém o último certificado; contradição DNS comprovada não é escondida como simples falha de polling.

A API não recebe novas permissões de host. O Docker Socket Proxy preexistente e o Dockge são fronteiras adicionais de confiança administrativa, mesmo sem `privileged`.

O [instalador universal](universal-installer.md) oferece seleção de ambiente, release, repositório público/privado e diretório. Todas as rotinas permanentes continuam nos serviços; aplicação desta branch não promove `main` automaticamente.

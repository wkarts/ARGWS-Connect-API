# Contrato de implantação do serviço operacional

Complemento de `history-and-zapo-commerce.md` para os Compose oficiais de desenvolvimento e produção.

## Nomes e endereço interno

| Ambiente | Serviço e container | Perfil Compose |
|---|---|---|
| Desenvolvimento | `operations-argws-connect-develop` | `operations` |
| Produção | `operations-argws-connect-production` | `operations` |

Ambos usam o alias DNS `operations` na rede da respectiva stack. O endereço interno da API continua `http://operations:8092`. O alias não publica uma porta no host nem exige um domínio novo.

O volume continua sendo `${ARGWS_CONNECT_OPERATIONS_DATA_PATH:-./volumes/operations}:/data`. A padronização de nomes não muda o caminho dos arquivos. Não execute `down -v` nem remova diretórios de dados.

## Habilitação explícita

O núcleo da stack permanece com seis serviços: API, DOCs, PostgreSQL, Redis, RabbitMQ e MinIO. O agente é opcional e não é dependência de inicialização da API.

Para habilitá-lo, siga as variáveis e os procedimentos de `history-and-zapo-commerce.md`: adicione `operations` a `COMPOSE_PROFILES`, defina `OPERATIONS_ENABLED=true` e configure o mesmo `OPERATIONS_INTERNAL_TOKEN` dedicado para API e agente. Não substitua outros perfis já configurados. O token não deve ser a API key global.

## Validação contínua

`Deployment Integrity` valida separadamente a configuração padrão, todos os perfis e somente o perfil `operations`. A lista de serviços permanece fechada; a nova entrada é permitida apenas em `develop` e `production`. A stack canônica anterior permanece inalterada.

Além das validações já existentes de nomes, portas, imagens e bind mounts, o contrato exige: mesma imagem da API, alias interno, entrada independente do agente, ausência de privilégios e de capabilities adicionais, `no-new-privileges`, limite de 0,5 CPU, 192 MiB de memória e 64 processos, um único bind mount em `/data`, ausência de socket Docker e ausência de dependência da API no agente.

A correção da PR #77 é materializada nos Compose e no verificador. Não depende de workflow temporário que reescreva arquivos após o push. Não altera providers, chamadas, schema, migrations, sessões WhatsApp ou o formato `.connectbak`.

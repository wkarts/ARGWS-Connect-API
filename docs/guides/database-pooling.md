# PgBouncer e proteção de capacidade

## Operação

O deployment continua usando somente o Compose existente e seu `.env`. Não há arquivo INI, userlist, SQL de instalação ou script adicional para o operador. A imagem `argws-connect-pgbouncer` contém PgBouncer 1.25.2 e o processo de configuração/healthcheck. O checksum do tarball está fixado no Dockerfile.

Stacks clássicas recebem `pgbouncer-argws-connect-<deployment>`. As três stacks Platform recebem também `platform-pgbouncer-argws-connect-<deployment>`. Não há porta publicada para nenhum pooler. As redes, bancos, volumes e portas públicas anteriores são preservados.

A conexão direta `DATABASE_CONNECTION_URI` continua sendo utilizada nas migrations Prisma; somente o PrismaRepository troca o endpoint em runtime. A Platform mantém `POSTGRES_HOST`/`POSTGRES_PORT` diretos e um endpoint separado para runtime. Migrations, bootstrap e provisionamento administrativo continuam diretos. O worker de backup usa o PostgreSQL direto para pg_dump; seu controle de tarefas usa a conexão runtime.

## Parâmetros iniciais no .env

| Variável | Padrão | Efeito |
| --- | --- | --- |
| DATABASE_POOL_ENABLED | true nas stacks | Engine usa PgBouncer em runtime |
| DATABASE_POOL_CONNECTION_LIMIT | 5 | Conexões Prisma por processo |
| DATABASE_POOL_TIMEOUT | 10 | Espera local por conexão, em segundos |
| PGBOUNCER_POOL_SIZE | 32 | Conexões de servidor do banco Engine |
| PGBOUNCER_MAX_CLIENTS | 256 | Clientes aceitos pelo pooler Engine |
| PGBOUNCER_QUERY_WAIT_TIMEOUT | 10 | Espera por backend, em segundos |
| PGBOUNCER_QUERY_TIMEOUT | 60 | Tempo máximo de consulta via pooler |
| PGBOUNCER_SERVER_IDLE_TIMEOUT | 15 | Recolhimento de backends ociosos |
| POSTGRES_PGBOUNCER_ENABLED | true nas stacks Platform | Runtime FastAPI/Celery usa pooler |
| PLATFORM_PGBOUNCER_CONTROL_POOL_SIZE | 20 | Limite para o banco de controle |
| PLATFORM_PGBOUNCER_TENANT_POOL_SIZE | 4 | Limite por banco/usuário de cliente |
| PLATFORM_PGBOUNCER_MAX_CLIENTS | 256 | Clientes no pooler Platform |
| PLATFORM_TENANT_ENGINE_CACHE_SIZE | 16 | Máximo de engines em cache por processo |
| PLATFORM_DATABASE_MAX_CONCURRENT_REQUESTS | 16 | Requisições /api simultâneas por processo |

Com PgBouncer habilitado, SQLAlchemy usa NullPool, nomes únicos para prepared statements e caches locais desativados. O pooler executa DISCARD ALL ao devolver conexões. No modo direto de retaguarda, os pools são menores e sem overflow para clientes.

## Isolamento e autenticação

Não existe `user=` forçado compartilhado entre clientes. Cada conexão usa a role do seu banco isolado. Um usuário técnico sem privilégios administrativos executa somente uma função SECURITY DEFINER de consulta de credenciais. A função reside no banco postgres, possui search_path fixo, valida rolcanlogin/rolvaliduntil e admite somente o administrador configurado ou o prefixo de roles do produto. Contas novas não exigem edição de arquivos ou restart do pooler.

O usuário de estatísticas não recebe privilégios de administração PgBouncer. Os arquivos gerados ficam em tmpfs, com permissão 0600, e o processo executa sem root e sem capabilities. Não há credenciais reais no código. A rede Docker precisa continuar privada: TLS do servidor é preferido, não exigido, pois os bancos locais atuais não têm certificado obrigatório.

## Capacidade e falhas

`max_db_connections` é por banco, não global. Não multiplicar 4 por centenas de bancos e chamar o resultado de um único pool de 4. Dimensionar o PostgreSQL considerando todos os bancos ativos, usuários, processos e réplicas. A coleta de backends ociosos reduz a pressão, mas não constitui um limite agregado rígido.

A Platform recusa excesso de concorrência com HTTP 503 e Retry-After, mantendo health/metrics acessíveis. Erros temporários de conexão/lotação também são convertidos em 503, sem consulta adicional para persistir esse erro no mesmo banco saturado. Erros de integridade e regras de negócio não são disfarçados como sobrecarga. O Engine trata os códigos Prisma de lotação/conexão como indisponibilidade temporária. Nenhuma gravação é automaticamente repetida.

Isso reduz risco e evita filas ilimitadas; não substitui índices, análise de queries, memória/CPU suficientes, monitoramento ou alta disponibilidade. Uma transação longa retém seu backend até terminar ou atingir timeout. O healthcheck do pooler verifica sua console; a prontidão de banco da aplicação continua sendo verificada pelo healthcheck da API.

## Atualização e homologação

Criar branch da develop, executar testes e CI, homologar e só então fazer merge. O fluxo de publicação existente constrói o novo componente para amd64/arm64 em :develop e o promove com os demais componentes na release da main. Não usar o Compose novo antes de a imagem correspondente estar publicada. Não houve incremento manual de versão nesta frente.

O teste de integração em CI cria bancos descartáveis e verifica autenticação dinâmica, isolamento, expiração/rotação, SQLAlchemy/asyncpg, limite por banco e recuperação após esgotamento da fila. Ele é ferramenta de desenvolvimento, não o procedimento de deploy.

## Referências técnicas

- PgBouncer: https://www.pgbouncer.org/config
- Release e segurança 1.25.2: https://www.pgbouncer.org/changelog.html
- SQLAlchemy asyncpg/PgBouncer: https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#prepared-statement-name-with-pgbouncer

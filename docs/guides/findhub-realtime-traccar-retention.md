# Rastreamento nativo, Traccar opcional e preservação GHCR

Esta evolução acrescenta rastreamento ao canal Google Find Hub existente. Não modifica login, extensão 0.1.6, desbloqueio Google, chave do cofre nem engines WhatsApp. As alterações são aditivas, com migrations PostgreSQL/MySQL e autorização por instância já existente.

## Fluxos de posição

O Find Hub continua consultando o protocolo Google e recebendo relatórios por FCM. A API guarda a posição mais recente, publica no barramento de eventos existente e entrega SSE autenticado ao Manager. Vários leitores da mesma conta **não criam consultas Google extras**. Cada dispositivo tem no máximo uma consulta em andamento. O intervalo é a espera **após** terminar a consulta; o timeout é o limite de espera de uma resposta útil. Falhas aumentam a espera, sem sobreposição.

`Localizar agora` aceita um timeout opcional somente para aquela chamada; não ativa rastreamento silenciosamente. Um retorno intermediário apenas com metadados não consome a espera antes de chegar o relatório criptografado. Isso é coberto por regressão controlada; não constitui evidência de que tal retorno tenha causado um problema específico em uma conta real.

O mapa fica na aplicação, com seleção de dispositivo, acompanhamento do ponto, precisão, horário do relatório, horário de recebimento e trilha dos pontos recebidos. Não extrapola movimento nem atualiza artificialmente o horário de uma posição antiga. `online`/`offline` exigem um estado explícito do provedor; posição recente é identificada como recente, e ausência de informação como desconhecida/sem posição. O estado online de um receptor OsmAnd usado como ponte não prova que o telefone Google esteja online.

### Parâmetros por conta e dispositivo

- `intervalSeconds`: padrão 60; respeita o mínimo da instalação (30 por padrão; mínimo absoluto 15); máximo 86400.
- `timeoutMs`: 5000 a 120000, padrão 30000, independente do intervalo.
- `staleAfterSeconds`: 30 a 604800; padrão 300.
- `historyEnabled`: controla novas gravações. O valor inicial preserva `FINDHUB_STORE_POSITION_HISTORY` da instalação. Quando a variável não existe, novas contas usam histórico habilitado. Templates antigos explicitamente `false` não são sobrescritos.
- `retentionDays`: padrão 30; 0 significa retenção indefinida. Valores positivos permitem excluir posições locais anteriores ao prazo.
- `reconciliationEnabled`: habilita a camada de reconciliação best effort sem alterar o tracking normal.
- `reconciliationOnBoot`: tenta reconciliar uma lacuna detectada quando a conta volta a conectar.
- `reconciliationPeriodicEnabled`: agenda novas reconciliações enquanto o runtime estiver online; desabilitado por padrão.
- `reconciliationPeriodSeconds`: periodicidade do scheduler quando habilitado.
- `reconciliationLookbackHours`: janela, padrão 48 horas, usada para procurar também lacunas internas entre posições já persistidas.
- `reconciliationMinGapSeconds`: duração mínima para considerar um intervalo uma lacuna; o intervalo normal configurado do dispositivo também é respeitado para evitar falso positivo.
- `reconciliationAttempts`: número de consultas Google por reconciliação, de 1 a 10; padrão 3.

Parâmetros persistidos da conta prevalecem sobre defaults do ambiente. Valores já gravados por dispositivo são alterados na ação de rastreamento desse dispositivo, não por uma mudança silenciosa na configuração de toda a conta.

Histórico e última posição são diferentes: desligar novas gravações não impede consultar a última posição, o mapa, eventos ou registros antigos ainda dentro da retenção. A limpeza é por instância, em lotes limitados, após conectar/restaurar a conta e a cada hora enquanto seu runtime estiver ativo. O tracking normal não fabrica nem reconstrói retroativamente um percurso. A reconciliação é uma tentativa separada: consulta novamente o Google e importa todos os relatórios válidos `RECENT`/`NETWORK` que o provider ainda devolver, inclusive fora da faixa usada como alvo, com deduplicação pelo fingerprint já existente. Isso não transforma o Find Hub em uma API de timeline arbitrária e não garante cobertura completa de uma lacuna. Uma posição antiga não substitui a mais recente. O histórico oferece filtro de datas, até 1000 posições por consulta e trilha no mapa. Consulte intervalos menores para conjuntos maiores. Retenção indefinida exige dimensionamento de disco e backups.

### Reconciliação e diagnóstico

A reconciliação pode ser acionada manualmente, no boot/reconexão ou pelo scheduler periódico. A detecção automática olha a janela configurada e considera tanto a cauda `última posição → agora` quanto lacunas internas entre posições persistidas, escolhendo de forma limitada a lacuna relevante por dispositivo para não transformar o processo em varredura ilimitada.

Cada tentativa coleta somente metadados técnicos seguros: quantidade de payloads FCM correlacionados, relatórios Google decodificados, relatórios com/sem localização criptografada, descriptografados, rejeitados, inválidos, válidos, duplicados, importados, já existentes, dentro/fora da faixa e descartados pela retenção. Latitude, longitude, nome do dispositivo, payload Google, tokens e credenciais **não são gravados no diagnóstico**.

O feedback distingue explicitamente:
- `no_provider_reports`: a consulta foi executada, mas nenhum relatório correlacionado foi devolvido pelo provider;
- `provider_reports_unusable`: houve relatório Google, porém nenhum virou posição válida após metadata/decrypt/validação;
- `duplicates_only`: o Google devolveu posições válidas, mas elas já existiam localmente;
- `imported_outside_target`: houve importação nova, porém fora do intervalo usado para medir a lacuna;
- `recovered`: pelo menos uma nova posição foi persistida dentro da lacuna;
- `retention_filtered`: posições válidas estavam fora da retenção configurada.

O diagnóstico usa o código `findhub.reconciliation` e registra apenas contadores limitados, trigger (`manual`, `boot`, `periodic`) e um identificador técnico de correlação. Isso permite auditar posteriormente se o Google não devolveu dados, se houve falha de decodificação ou se apenas ocorreu deduplicação, sem persistir coordenadas.

### Catálogo Google e permissões

São consultados os catálogos SPOT e Android, unindo identificadores de telefone e acessórios e eliminando duplicações. Falha na consulta complementar não apaga o catálogo principal. Acesso ao Google Find Hub, compartilhamento Family Link e acesso a tags não são permissões necessariamente equivalentes no protocolo privado. Não são fabricados dispositivos que o Google não retornar. A presença de um segundo aparelho na interface oficial, isoladamente, não comprova acesso pelo mesmo contrato privado. Essa compatibilidade permanece sujeita a teste autorizado da conta real.

## Traccar oficial, interno ou externo

Traccar **não é obrigatório** para o mapa/histórico Find Hub. Desabilitar Traccar interrompe apenas sua integração. A posição Google continua sendo entregue ao Manager e aos webhooks. Falhas no encaminhamento Traccar não descartam a posição local.

A camada `TraccarClient` utiliza REST oficial para sessão e provisionamento, protocolo OsmAnd para enviar posições e `/api/socket` para receber eventos. A sessão WebSocket usa `JSESSIONID` apenas no backend. Token administrativo nunca é devolvido ao frontend. O identificador remoto é derivado de instância + dispositivo; atributos remotos e vínculos locais são verificados. Eventos são filtrados pela conta e pelo ID vinculado antes de serem persistidos ou emitidos. Não há ciclo de reencaminhamento de eventos recebidos do Traccar para o próprio Traccar.

A tela da integração mostra: desabilitado, interno e externo. No interno não pede URL. No externo permite URL REST, URL do receptor e token; o GET retorna apenas `hasToken`. A troca de servidor invalida vínculos locais atomicamente, sem excluir dispositivos ou históricos do servidor antigo. É necessário provisionar os vínculos no novo destino. O modo legado manual continua disponível para origens autorizadas.

### Deploy interno

Em um dos diretórios de deploy existentes, edite seu `.env`:

```dotenv
TRACCAR_ENABLED=true
TRACCAR_MODE=internal
```

Execute o preparador existente ou o helper distribuído ao lado do Compose:

```bash
python3 ./prepare-traccar-env.py --env-file .env
python3 ./prepare-traccar-env.py --env-file .env --check
docker compose --env-file .env -f compose.yaml up -d
```

Use `-f docker-compose.yml` nos perfis que já usam esse nome. No checkout raiz, o helper está em `scripts/prepare-traccar-env.py` e os Compose existentes são `docker-compose.yaml`/`docker-compose.dev.yaml`.

O preparador gera uma única vez `TRACCAR_ADMIN_PASSWORD` e `TRACCAR_DATABASE_PASSWORD`, sem imprimir valores; preserva senhas válidas e os demais profiles, acrescentando `traccar` a `COMPOSE_PROFILES`. Valores duplicados/inválidos são recusados sem sobrescrever o ambiente. O Swarm existente usa `TRACCAR_REPLICAS=1`; desabilitado usa 0. Mudanças na UI não iniciam containers Docker: o profile precisa estar implantado pelo administrador.

O serviço recebe por rede interna:

```text
http://traccar:8082  REST/admin backend-only
http://traccar:5055  receptor OsmAnd
```

O Traccar tem banco PostgreSQL separado e volumes próprios. Não há dependência `depends_on` da API sobre ele. **Nenhuma porta Traccar é publicada no host por padrão**. O bootstrap cria o administrador somente em um banco novo, valida as credenciais existentes e desabilita registro público; nunca redefine senhas. Para acesso direto de um rastreador físico externo, publicar um receptor seguro é uma decisão adicional de infraestrutura; não exponha a administração indiscriminadamente.

O inventário completo dos nove Compose e defaults está em `docs/deployment/traccar-inventory.json`. Os geradores existentes de operações e Find Hub foram integrados ao gerador Traccar; `--check` detecta divergências sem editar arquivos.

### Traccar externo

```dotenv
TRACCAR_ENABLED=true
TRACCAR_MODE=external
TRACCAR_URL=https://traccar.example.invalid
TRACCAR_RECEIVER_URL=https://receptor.example.invalid
TRACCAR_ALLOWED_ORIGINS=https://traccar.example.invalid,https://receptor.example.invalid
TRACCAR_TOKEN=
```

Use domínios reais da instalação; os exemplos são reservados e não funcionam. O administrador configura a allowlist e a credencial via secret/env protegido, ou cada conta grava seu token pelo Manager. URL externa exige HTTPS, sem usuário/senha/query/path. A allowlist de origens é necessária para impedir acesso arbitrário do backend a destinos não autorizados. Um receptor externo precisa aceitar OsmAnd. Uma URL administrativa sozinha não é um receptor de posições. Token omitido preserva o anterior somente para o mesmo servidor. Credenciais salvas por conta usam o cofre existente; não rotacione sua chave.

### Traccar desabilitado

```dotenv
TRACCAR_ENABLED=false
TRACCAR_MODE=disabled
```

Execute o preparador para remover somente o profile Traccar. Nenhum segredo Traccar é obrigatório nesse modo. A integração local por conta também pode ficar desabilitada em uma instalação que oferece Traccar a outras contas.

### Bases GHCR

Imagem espelhada: `ghcr.io/wkarts/argws-connect-traccar:6.15.3-alpine`, no padrão existente. O workflow de infraestrutura verifica antes de copiar; não reconstrói bases em toda execução. Atualização forçada é explícita. Deploy usa o espelho GHCR, não depende de baixar o Traccar upstream a cada implantação. A política de limpeza preserva todas as versões das bases; uma aposentadoria futura exige processo explícito e não está automatizada nesta entrega.

## API e eventos

Além das rotas existentes, há snapshot, stream, parâmetros por conta e configuração/provisionamento Traccar. Todos reutilizam os guards existentes e o escopo da instância. Consulte a Scalar gerada para os corpos e respostas exatos:

```text
GET  /findhub/tracking/snapshot/:instanceName
GET  /findhub/tracking/stream/:instanceName
GET  /findhub/tracking/settings/:instanceName
PUT  /findhub/tracking/settings/:instanceName
GET  /findhub/traccar/configuration/:instanceName
PUT  /findhub/traccar/configuration/:instanceName
POST /findhub/traccar/provision/:deviceId/:instanceName
POST /findhub/locate/:deviceId/:instanceName     {timeoutMs?: number}
GET  /findhub/positions/:deviceId/:instanceName ?from=ISO&to=ISO&limit=1000
POST /findhub/positions/reconcile/:deviceId/:instanceName
POST /findhub/positions/reconcile/:instanceName
```

SSE usa `fetch` com `apikey` no header, nunca segredo na URL. Snapshot inicial, eventos existentes por conta, heartbeat15s, reconexão com autorização renovada a cada120s, máximo20 assinaturas por conta e backpressure. Essa reconexão não dispara uma localização por leitor. O cache do Manager não é a fonte de autoridade para acesso a dispositivos.

Tiles OpenStreetMap visíveis usam o cache normal do navegador e atribuição visível. Não há prefetch massivo, download offline ou proxy para burlar limites. O provedor de tiles recebe a área do mapa; `FINDHUB_MAP_TILE_URL` permite infraestrutura própria. O mapa não recebe credenciais Traccar.

## Retenção GHCR e caches

O manifesto `.github/retention-policy.json` protege permanentemente `1.1.3`, com digests reais de API/Manager/DOCs inventariados em modo somente leitura. O registro está em `docs/deployment/canonical-1.1.3-inventory.json`. Canonizações futuras são **append-only**: acrescente a versão e os pins verificados; nunca remova a anterior. Ausência/divergência de pin preserva o pacote inteiro, não apaga em modo aproximado.

`latest`, `develop`, aliases permanentes, bases e seus descendentes multi-arquitetura são preservados. Tags múltiplas são avaliadas por digest; uma tag temporária no mesmo digest de uma protegida não o torna descartável. Filhos de índice, atestações e referrers por subject são protegidos transitivamente. Metadados ausentes, filhos não inventariados, mídia desconhecida ou alias não reconhecido implicam preservar. O manifesto mantém a referência estável inicialmente1.1.3; o versionamento de releases não canoniza novas versões sozinho.

Cache: somente itens não acessados nem criados nas últimas2h podem ser candidatos. Imagens: janela conservadora48h, protegendo adicionalmente a release numérica mais recente para rollback. Até100 exclusões por execução. Imagens mais novas permanecem; cache é diferente de imagem. Artefatos intermediários: apenas prefixos de digests definidos no manifesto, de runs comprovadamente bem-sucedidas e antigos. ZIP/EXE/sourcearchives anexados a releases **jamais são alvo**. Os endpoints DELETE de Git tags, Releases e releaseassets são recusados pelo script.

O workflow reutilizável roda após publicação, confere o SHA realmente publicado, resultado de testes/builds/push/release e ausência de builds concorrentes. Pode aguardar até10min, sem ações destrutivas, para outros jobs concluírem. SHA substituído, falha ou dúvida bloqueiam a limpeza. Faz inventário/dryrun antes de apply e revalida tags e concorrência imediatamente antes de apagar. A opção `ARGWS_RETENTION_APPLY=false` no repositório suspende exclusões automáticas, preservando relatórios. O modo manual é dryrun por padrão. Aplicação offline de inventário está proibida.

```bash
python3 scripts/ghcr-retention.py --validate-policy
python3 scripts/ghcr-retention.py --output retention-report
# Somente com credenciais adequadas, publicação verificada e branches confiáveis:
python3 scripts/ghcr-retention.py --apply --verified-sha "$PUBLISHED_SHA" \
  --source-sha "$BUILD_SOURCE_SHA" --branch develop --output retention-applied
```

O inventário exige `gh`, `skopeo` e permissões correspondentes. Falha de API ou de leitura não vira autorização para remover. Relatórios registram preservados, candidatos e exclusões efetuadas. Nenhuma limpeza de volumes de VPS, cache global do host ou histórico WhatsApp é executada. Builders temporários dos hostedrunners são descartados pelo setupbuildx; o helper opcional `prune-owned-buildkit-cache.sh` só aceita um builder CI explicitamente indicado e publicação validada, nunca `docker system prune` indiscriminado.

### Rollback e aplicação

Esta alteração exige migrations aditivas, reconstrução da API/Manager/DOCs e atualização do deploy. A extensão de autenticação permanece0.1.6; não é necessário revincular uma conta que já funciona. Preserve `FINDHUB_CREDENTIALS_KEY`, segredos e volumes. Não execute rollback destrutivo das migrations para voltar uma imagem anterior. Não é feita promoção automática de1.1.3 ou troca de `latest` nesta featurebranch.

### Validação e limites

Testes cobrem escopo por conta, snapshots/SSE, timeout, retenção0, deduplicação/monotonicidade, reconciliação manual/automática, detecção de lacuna interna, telemetria sem coordenadas/segredos, origens autorizadas, provisionamento idempotente, ausência de segredos nofrontend, noveCompose, digests protegidos e condições de publicação. O workflow de integração usa Traccar/PostgreSQL descartáveis oficiais com coordenadas sintéticas para testar bootstrap, REST, OsmAnd e WebSocket. Nenhum teste automatizado autentica uma conta Google real. Aprovação da CI não comprova Family Link, tags ou entrega de localização de um smartphone específico.

Referências oficiais: https://www.traccar.org/traccar-api/ ; https://www.traccar.org/configuration-file/ ; https://www.traccar.org/osmand/ ; https://operations.osmfoundation.org/policies/tiles/ ; https://docs.github.com/en/rest/actions/cache ; https://docs.github.com/en/rest/packages/packages .

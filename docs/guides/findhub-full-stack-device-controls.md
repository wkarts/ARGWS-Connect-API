# Full stack e controles de dispositivo

## Deploys novos, originais preservados

`deploy/develop/full-stack` e `deploy/production/full-stack` são alternativas ao respectivo deploy pai.
API/Manager, DOCs, PostgreSQL principal, Redis, RabbitMQ, MinIO, Operations, NATS/JetStream,
Kafka/ZooKeeper, MySQL auxiliar, Traccar, PostgreSQL Traccar e bootstrap Traccar: 14 serviços.
Apenas a porta da API é publicada. O bootstrap termina com código 0; não é um serviço permanente.

Na nova pasta, use `bash prepare-env.sh --from-env ../.env` para importar uma instalação existente.
Não copie simplesmente os caminhos `./volumes`: o preparador resolve cada caminho em relação
à origem, preservando banco, sessões e cofre. Não use os dois Compose simultaneamente.
Nunca use `down -v` para atualizar. Faça backup antes de migrations/deploy.

Para uma instalação nova sem dados anteriores, `bash prepare-env.sh` gera segredos locais e grava
`.env` com permissão 0600. Para atualizar `.env` já preparado, o mesmo comando é idempotente.
`--all-services` seleciona os opcionais locais. NATS/Kafka ganham flags e profiles coerentes;
o modo externo Traccar já configurado é preservado, sem iniciar um Traccar interno conflitante.

SQS/Pusher e modelos de IA externos dependem das credenciais do administrador; habilitar seus
módulos não cria os respectivos serviços remotos. MySQL é auxiliar: PostgreSQL continua como banco
principal. Não se trata de trocar DATABASE_PROVIDER nem de migrar dados WhatsApp.

As imagens continuam `develop` no desenvolvimento e `latest` em produção. Novos endpoints exigem
uma imagem que contenha este código. A configuração não promove `latest` e não altera a canônica 1.1.3.

## Timeout versus frequência

O intervalo já aceita zero e segundos inteiros positivos. Zero consulta novamente depois de concluir
a operação anterior, sem sobreposição por dispositivo. O timeout de **localização** aceita de **1 a
2147483647 milissegundos** (limite representável por timers Node). Não é mantido o piso de 5000 ms.
O prazo inclui submissão e espera da resposta de localização. Expiração cancela a submissão e remove
a espera pendente; uma autenticação interna que terminar depois não inicia uma requisição atrasada.
Não altera timeouts de WhatsApp, de login Google ou dos outros serviços.

Um timeout de 1 ms provavelmente terminará antes de qualquer posição chegar. Reduzir o timeout não
acelera o GPS ou o Google. O intervalo recomendado é orientação, não um bloqueio à escolha do operador.
Não há promessa de amostragem física a cada milissegundo. Falhas conservam recuo controlado.

## Mapa no modal e zoom

A ação de acompanhamento no card e na instância abre modal do próprio Manager. A seleção é restrita
à conta e utiliza SSE autenticado, sem token em URL. Fechar o modal encerra somente sua conexão SSE;
não desliga o rastreamento persistido. Esc fecha a janela, o foco fica contido e retorna ao elemento original.
O mapa de página, de histórico e do modal usam o mesmo componente, com zoom pela roda do mouse,
ancorado na posição do cursor, limitado aos níveis de tile suportados. Ctrl/Meta+roda continuam do navegador.
O botão Centralizar retoma o acompanhamento após movimentação manual.

## Avatar individual, seguro e persistente

O Manager recorta PNG/JPEG/WebP em um avatar PNG de 128 × 128 antes de enviar. A API aceita
somente PNG RGB/RGBA não entrelaçado de até 256 × 256 e 128 KiB. Verifica estrutura, CRC, tamanho
descompactado e remove metadados. Não aceita SVG nem URL remota. Excluir o avatar envia `null`.
A sincronização do catálogo Google nunca sobrescreve a personalização.

- `PUT /findhub/device/avatar/{deviceId}/{instanceName}`: JSON `{ "avatar": "data:image/png;base64,..." }` ou `{ "avatar": null }`.
- `GET /findhub/device/avatar/{deviceId}/{instanceName}`: retorna `avatarData` somente após os guards da instância e verificação de propriedade do dispositivo.

Snapshots e eventos usam apenas `avatarVersion`, não a imagem completa. Apenas dispositivos exibidos
fazem a consulta autenticada da imagem. Isso evita multiplicar bytes de imagem a cada posição realtime.
A migration é aditiva e exclusiva de FindHubDevice; não muda tabelas nem dados WhatsApp.

## Credenciais já compartilhadas

Nenhum segredo fornecido no atendimento está no repositório. Planeje a rotação de senhas expostas
com backup e coordenação dos serviços. **Não troque diretamente FINDHUB_CREDENTIALS_KEY**: ela cifra
credenciais existentes. A chave da API também protege backups nativos; preserve o acesso aos backups
anteriores e faça uma migração planejada, não uma rotação automática durante este deploy.

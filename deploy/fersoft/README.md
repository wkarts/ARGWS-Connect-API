# Deployments Fersoft

Cada canal contém apenas `compose.yaml` e `env.example`. Preserve o `.env`
instalado, os segredos, os identificadores e todos os volumes.

A transcrição e o ditado agora usam somente `transcription-service-fersoft-connect-<canal>`.
Os workers anteriores não integram mais os manifests, imagens ou dependências novas.
O perfil `transcription` é opcional e não é incluído por padrão.
Nenhum envio/recebimento, áudio, vídeo, PTT, chamada ou provider depende do ASR.

A full stack mantém os perfis `operations,nats,kafka,mysql,traccar` e seus serviços.
Para habilitar fala, acrescente `transcription` sem remover outros perfis, configure
`SPEECH_ENABLED`, `TRANSCRIPTION_ENABLED`, `DICTATION_ENABLED` e
`MANAGER_FEATURE_TRANSCRIPTION` explicitamente, e provisione o modelo nativo com checksum.
Não copie o exemplo sobre um `.env` instalado. Migre o seletor de motor/modelo antes
 de habilitar. O antigo modelo Transformers não é reinterpretado como GGML.

O runtime padrão é whisper.cpp/base-q5_1, CPU-only. `SPEECH_SERVICE_MEMORY=1280m`,
`SPEECH_SERVICE_CPUS=1.00` e `SPEECH_SERVICE_TMPFS_SIZE=128m` são limites, não benchmarks.
O modelo pode descarregar quando ocioso; `SPEECH_MODEL_KEEP_WARM` e `SPEECH_PREWARM`
são opt-in. Uma inferência por vez atende as duas modalidades e todas as instâncias.
O bucket de fala permanece privado e separado do bucket público de mídia.

Antes da atualização: interrompa novas admissões de fala, drene/cancele os jobs em
andamento pelos contratos existentes e pare/remova apenas os containers antigos de
transcrição/ditado do projeto correto. Não apague volumes, banco, filas nem modelos.
Não use `down -v`. Substitua o Compose, migre somente as variáveis documentadas e
suba o novo serviço quando o modelo e a imagem correspondente estiverem disponíveis.
A PR não publica imagens nem altera VPS automaticamente.

Consulte `docs/guides/optional-transcription-service.md` para a matriz completa,
ativação offline, limites, retirada seletiva dos containers antigos e rollback Git.

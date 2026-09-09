from pathlib import Path
import json
import re

changes = {}
def read(file):
    return changes.get(file, Path(file).read_text())
def replace(file, old, new, count=1):
    text = read(file)
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{file}: expected {count} matches, got {actual}: {old[:90]!r}')
    changes[file] = text.replace(old, new)

base = 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts'
replace(base, "import { ZAPO_WHATSAPP_CAPABILITIES } from './whatsapp.provider.contract';", "import { ZAPO_WHATSAPP_CAPABILITIES } from './whatsapp.provider.contract';\nimport { connectCatalogPlugin } from './zapo.catalog.plugin';\nimport { ZapoGroupIdentityCache, GroupIdentity } from './zapo.group-identity';")
replace(base, '  private storeBackend: any = null;', '''  private readonly persistedGroups = new Map<string, GroupIdentity>();
  private readonly groupIdentities = new ZapoGroupIdentityCache(async (jid) => {
    const group = await this.client.group.queryGroupMetadata(jid);
    const picture = await this.profilePicture(jid).catch(() => null);
    return { subject: group.subject, avatar: picture?.profilePictureUrl || undefined };
  });
  private storeBackend: any = null;''')
replace(base, "    const plugins =\n      process.env.ZAPO_VOIP_ENABLED === 'false' ? [] : [voipPlugin({ maxConcurrentCalls, logLevel: 'warn' })];", '''    const plugins = [
      connectCatalogPlugin(),
      ...(process.env.ZAPO_VOIP_ENABLED === 'false' ? [] : [voipPlugin({ maxConcurrentCalls, logLevel: 'warn' })]),
    ];''')
replace(base, '    const rawRemoteJid = this.normalizeDeviceJid(String(event.key.remoteJid));', '''    const rawRemoteJid = this.normalizeDeviceJid(String(event.key.remoteJid));
    const isGroupMessage = rawRemoteJid.endsWith('@g.us');
    if (isGroupMessage && this.localSettings.groupsIgnore === true) return;''')
replace(base, '''    if (db.SAVE_DATA.CONTACTS) {
      await this.upsertContact(messageRaw.key.remoteJid, messageRaw.pushName);
    }

    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }''', '''    if (isGroupMessage) {
      // The group's author is NOT the group identity. Keep both namespaces.
      if (db.SAVE_DATA.CONTACTS && !messageRaw.key.fromMe && canonicalParticipant &&
          /@(s\\.whatsapp\\.net|lid)$/.test(canonicalParticipant)) {
        await this.upsertContact(canonicalParticipant, messageRaw.pushName);
      }
      if (db.SAVE_DATA.CHATS) await this.persistGroupConversation(rawRemoteJid);
    } else {
      if (db.SAVE_DATA.CONTACTS) await this.upsertContact(messageRaw.key.remoteJid, messageRaw.pushName);
      if (db.SAVE_DATA.CHATS) await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }''')
replace(base, '  private async handleIncomingMessage(event: any) {', '''  protected async persistGroupConversation(jid: string, known?: GroupIdentity): Promise<void> {
    const db = this.configService.get<Database>('DATABASE');
    if (!db.SAVE_DATA.CHATS || !jid.endsWith('@g.us')) return;
    if (known) this.groupIdentities.invalidate(jid);
    const info = known || await this.groupIdentities.resolve(jid);
    if (info && this.persistedGroups.get(jid) === info) return;
    await this.prismaRepository.chat.upsert({
      where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: jid } },
      update: info?.subject ? { name: info.subject } : {},
      create: { instanceId: this.instanceId, remoteJid: jid, name: info?.subject || 'Grupo WhatsApp' },
    });
    if (info && db.SAVE_DATA.CONTACTS) {
      // Existing group avatar cache, never a participant's pushName.
      await this.prismaRepository.contact.upsert({
        where: { remoteJid_instanceId: { remoteJid: jid, instanceId: this.instanceId } },
        update: { pushName: info.subject, ...(info.avatar ? { profilePicUrl: info.avatar } : {}) },
        create: { remoteJid: jid, instanceId: this.instanceId, pushName: info.subject, profilePicUrl: info.avatar },
      });
    }
    if (info) {
      this.persistedGroups.set(jid, info);
      if (this.persistedGroups.size > 256) this.persistedGroups.delete(this.persistedGroups.keys().next().value);
      this.sendDataWebhook(Events.GROUPS_UPDATE, [{ id: jid, subject: info.subject }]);
    }
  }

  private async handleIncomingMessage(event: any) {''')
replace(base, '''                // Do not oscillate a chat name based on later history rows.
                ...(Number.isFinite(info.unreadMessages) ? { unreadMessages: info.unreadMessages } : {}),''', '''                // Group thread names are authoritative metadata, not push names.
                ...(remoteJid.endsWith('@g.us') && info.name ? { name: info.name } : {}),
                ...(Number.isFinite(info.unreadMessages) ? { unreadMessages: info.unreadMessages } : {}),''')

group = 'src/api/integrations/channel/whatsapp/zapo.provider.group.extensions.ts'
replace(group, '''      const metadata = await this.groupClient().group.queryGroupMetadata(groupJid);
      return this.normalizeGroupMetadata(metadata);''', '''      const metadata = await this.groupClient().group.queryGroupMetadata(groupJid);
      await this.persistGroupConversation(groupJid, { subject: metadata.subject });
      return this.normalizeGroupMetadata(metadata);''')
identity = 'src/api/integrations/channel/whatsapp/zapo.identity.extensions.ts'
replace(identity, "import { Events } from '@api/types/wa.types';", "import { Events } from '@api/types/wa.types';\nimport { getCatalogDto, getCollectionsDto } from '@api/dto/business.dto';\nimport { readZapoCatalog, readZapoCollections } from './zapo.catalog.adapter';")
replace(identity, '  public async listCalls() {', '''  public async fetchCatalog(_instanceName: string, data: getCatalogDto) {
    return readZapoCatalog(this, data);
  }

  public async fetchCollections(_instanceName: string, data: getCollectionsDto) {
    return readZapoCollections(this, data);
  }

  public async listCalls() {''')
contract = 'src/api/integrations/channel/whatsapp/whatsapp.provider.contract.ts'
replace(contract, '''  // Zapo 1.6.3 exposes catalog notifications/MEX definitions but not a stable
  // typed public catalog coordinator equivalent to Baileys getCatalog yet.
  businessCatalog: false,''', '''  // Read-only commerce over ZAPO's public queryWithContext plugin surface.
  // Products, native cursors and collections share the existing API contract.
  businessCatalog: true,''')

normalizers = 'manager/src/services/normalizers.ts'
replace(normalizers, 'return { ...baseCapabilities, calls: true, voice: true, businessCatalog: false }', 'return { ...baseCapabilities, calls: true, voice: true, businessCatalog: true }')
replace(normalizers, ".filter((item) => item?.remoteJid !== 'status@broadcast' && !str(item?.remoteJid).endsWith('@broadcast'))", ".filter((item) => !/@(g\\.us|broadcast|newsletter)$/.test(str(item?.remoteJid || item?.jid)))")
replace(normalizers, "      const title = str(item.pushName || item.name || item.contactName || jidLocal(rawRef) || 'Conversa')", '''      const isGroup = rawRef.endsWith('@g.us')
      const title = isGroup
        ? str(item.subject || item.groupSubject || item.name || item.pushName || 'Grupo WhatsApp')
        : str(item.pushName || item.name || item.contactName || jidLocal(rawRef) || 'Conversa')''')
replace(normalizers, '        title,\n        subtitle: firstPhone', "        title,\n        isGroup,\n        subtitle: isGroup ? 'Grupo' : firstPhone")
replace(normalizers, "      direction: fromMe ? 'out' : 'in',\n      timestamp: item.messageTimestamp", '''      direction: fromMe ? 'out' : 'in',
      participantRef: item.key?.participant || item.participant || undefined,
      participantName: !fromMe && (item.key?.participant || item.participant)
        ? str(item.pushName || firstPhone(item.key?.participantAlt, item.key?.participant, item.participant) || 'Participante')
        : undefined,
      timestamp: item.messageTimestamp''')
types = 'manager/src/types/domain.ts'
replace(types, 'export type Conversation = {', 'export type Conversation = {\n  isGroup?: boolean')
replace(types, 'export type Message = {', 'export type Message = {\n  participantRef?: string\n  participantName?: string')
current = 'manager/src/services/current.ts'
replace(current, "import { runtime } from '@/config/runtime'", "import { runtime } from '@/config/runtime'\nimport { whatsappDestination } from './whatsapp-destination'")
replace(current, "data: { number: String(number).replace(/@.+$/, '').replace(/\\D/g, ''), text }", 'data: { number: whatsappDestination(number), text }')
replace(current, '  async sendText(id: string, number: string, text: string) {', '''  async groupInfo(id: string, groupJid: string) {
    return withInstance(id, async (_item, name, token) => api<any>(`/group/findGroupInfos/${encodeURIComponent(name)}`, {
      token, params: { groupJid },
    }))
  },

  async sendText(id: string, number: string, text: string) {''')
connect = 'manager/src/services/connect.ts'
replace(connect, '  sendText: (id: string, number: string, text: string): Promise<any>', "  groupInfo: (id: string, groupJid: string): Promise<any> => invoke('groupInfo', id, groupJid),\n  sendText: (id: string, number: string, text: string): Promise<any>")
view = 'manager/src/views/ConversationsView.vue'
replace(view, "const number = (chat.rawRef || chat.subtitle || '').split('@')[0]", "const number = chat.rawRef || chat.subtitle || ''")
replace(view, 'async function send() {', '''async function refreshGroup() {
  const chat = selectedChat.value
  if (!chat?.isGroup || !chat.rawRef) return
  try {
    const info = await connect.groupInfo(selectedInstance.value, chat.rawRef)
    if (info?.subject) { chat.title = info.subject; selectedChat.value = { ...chat } }
  } catch (e) { error.value = friendlyError(e) }
}

async function send() {''')
replace(view, '              <small>{{ selectedChat.subtitle }}</small>\n            </div>', '''              <small>{{ selectedChat.isGroup ? 'Grupo' : selectedChat.subtitle }}</small>
            </div>
            <button v-if="selectedChat.isGroup" class="btn compact" type="button" @click="refreshGroup">Atualizar grupo</button>''')
replace(view, '                <p>{{ message.text }}</p>', '''                <strong v-if="selectedChat.isGroup && message.direction === 'in'" class="message-author">{{ message.participantName || 'Participante' }}</strong>
                <p>{{ message.text }}</p>''')

index = 'src/api/routes/index.router.ts'
replace(index, "import { BusinessRouter } from './business.router';", "import { BusinessRouter } from './business.router';\nimport { OperationsRouter } from './operations.router';\nimport { observeOperations } from '@api/services/operations.service';")
replace(index, 'const router: Router = Router();', "const router: Router = Router();\nrouter.use(observeOperations);\nrouter.use('/operations', new OperationsRouter().router);")
replace(index, '''  const clientIPs = [
    req.ip,
    req.connection.remoteAddress,
    req.socket.remoteAddress,
    req.headers['x-forwarded-for'],
  ].filter((ip) => ip !== undefined);

  if (allowedIPs.filter((ip) => clientIPs.includes(ip)) === 0) {''', '''  // req.ip respects the configured trusted-proxy policy, unlike raw headers.
  const clientIP = String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!allowedIPs.some((ip) => ip.replace(/^::ffff:/, '') === clientIP)) {''')
replace('Dockerfile', 'COPY ./scripts ./scripts', 'COPY ./scripts ./scripts\nCOPY ./operations-agent ./operations-agent')
replace('Dockerfile', 'COPY --from=builder /argws-connect/scripts ./scripts', 'COPY --from=builder /argws-connect/scripts ./scripts\nCOPY --from=builder /argws-connect/operations-agent ./operations-agent')

for profile in ['develop', 'production']:
    file = f'deploy/{profile}/compose.yaml'
    replace(file, '      MANAGER_FEATURE_DOCS: ${MANAGER_FEATURE_DOCS:-true}', '''      OPERATIONS_ENABLED: ${OPERATIONS_ENABLED:-false}
      OPERATIONS_AGENT_URL: http://operations:8092
      OPERATIONS_INTERNAL_TOKEN: ${OPERATIONS_INTERNAL_TOKEN:-}
      MANAGER_FEATURE_DOCS: ${MANAGER_FEATURE_DOCS:-true}''')
    image = 'develop' if profile == 'develop' else 'latest'
    checks = [
      {'service':'api','type':'http','url':f'http://api-argws-connect-{profile}:8080/health'},
      {'service':'docs','type':'http','url':f'http://docs-argws-connect-{profile}:8080/health'},
      {'service':'database','type':'tcp','url':f'tcp://postgres-argws-connect-{profile}:5432'},
      {'service':'cache','type':'tcp','url':f'tcp://redis-argws-connect-{profile}:6379'},
      {'service':'events','type':'tcp','url':f'tcp://rabbitmq-argws-connect-{profile}:5672'},
      {'service':'storage','type':'http','url':f'http://minio-argws-connect-{profile}:9000/minio/health/live'},
    ]
    agent = f'''  operations:
    profiles: ["operations"]
    image: ${{ARGWS_CONNECT_API_IMAGE:-ghcr.io/wkarts/argws-connect-api:{image}}}
    pull_policy: always
    restart: unless-stopped
    entrypoint: ["node", "/argws-connect/operations-agent/server.cjs"]
    environment:
      TZ: ${{TZ:-America/Bahia}}
      OPERATIONS_INTERNAL_TOKEN: ${{OPERATIONS_INTERNAL_TOKEN:-}}
      OPERATIONS_DATA_PATH: /data
      OPERATIONS_HOT_DAYS: ${{OPERATIONS_HOT_DAYS:-3}}
      OPERATIONS_RETENTION_DAYS: ${{OPERATIONS_RETENTION_DAYS:-90}}
      OPERATIONS_CHECKS: '{json.dumps(checks, separators=(',', ':'))}'
    expose: ["8092"]
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 192m
    cpus: "0.50"
    pids_limit: 64
    volumes:
      - ${{ARGWS_CONNECT_OPERATIONS_DATA_PATH:-./volumes/operations}}:/data
    networks: [argws-connect-{profile}-net]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8092/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5
    logging: *default-logging

'''
    replace(file, f'  docs-argws-connect-{profile}:\n    image:', agent + f'  docs-argws-connect-{profile}:\n    image:')

for file in ['.env.example', 'env.example']:
    changes[file] = read(file) + '''\n# Optional private operational history (no WhatsApp payloads).
# Enable together with COMPOSE_PROFILES=operations in the selected deployment.
OPERATIONS_ENABLED=false
OPERATIONS_INTERNAL_TOKEN=
ARGWS_CONNECT_OPERATIONS_DATA_PATH=./volumes/operations
OPERATIONS_HOT_DAYS=3
OPERATIONS_RETENTION_DAYS=90
'''
for file in ['manager/src/components/SparkBars.vue','manager/src/components/SparkLine.vue']:
    text = read(file)
    updated = re.sub(r'props\.values\?\.length \? props\.values : \[[\d,]+\]', 'props.values?.length ? props.values : []', text)
    if updated == text: raise SystemExit(f'{file}: sample series not found')
    changes[file] = updated
replace('manager/src/components/SparkLine.vue', '(i/(d.length-1))*100', '(d.length > 1 ? i/(d.length-1) : 0.5)*100')

gen = 'docs/scripts/generate-openapi.mjs'
params = [{'name': name, 'in': 'query', 'required': name in ['from','to'], 'schema': {'type':'string'}, 'description': description} for name,description in [('from','Primeiro dia inclusivo, YYYY-MM-DD.'),('to','Último dia inclusivo, intervalo máximo de 31 dias.'),('cursor','Cursor de paginação retornado pela consulta anterior.'),('limit','Número de eventos por página, de 1 a 200.')]]
overrides = {
 'GET /operations/snapshot': {'summary':'Resumo operacional privado','description':'Exige a API key global. Somente verificações técnicas, sem canais ou conteúdo de mensagens. Retorna 503 quando o monitoramento está desabilitado ou indisponível.'},
 'GET /operations/history': {'summary':'Consultar histórico operacional','description':'Lê registros recentes e arquivos compactados sem restaurar dados no banco. Somente administrador da instalação.', 'parameters':params},
 'GET /operations/archives': {'summary':'Listar arquivos diários','description':'Índice de dias disponíveis, tamanhos e verificação. Sem conteúdo do WhatsApp.'},
 'GET /operations/export': {'summary':'Baixar diagnóstico compactado','description':'Exportação administrativa de um único dia, sem credenciais ou conteúdo de comunicação.', 'parameters':[{'name':'day','in':'query','required':True,'schema':{'type':'string','format':'date'}},{'name':'format','in':'query','schema':{'type':'string','enum':['text','jsonl'],'default':'text'}}], 'responses':{'200':{'description':'Arquivo GZIP de texto legível ou JSONL.','content':{'application/gzip':{'schema':{'type':'string','format':'binary'}}}}}},
}
addition = ''.join('  '+json.dumps(key)+': '+json.dumps(value,ensure_ascii=False)+',\n' for key,value in overrides.items())
replace(gen, 'const requestOverrides = {\n', 'const requestOverrides = {\n'+addition)
package = json.loads(read('package.json'))
package['scripts']['test:operations'] = 'node --test test/operations-groups-catalog.test.cjs'
changes['package.json'] = json.dumps(package, indent=2, ensure_ascii=False)+'\n'
backup = 'scripts/connect-stack-backup.sh'
replace(backup, 'api_service="$(find_service api)"', '\n'.join([
 'operations_service="$(find_service operations)"',
 'operation_event() {',
 '  [[ -n "$operations_service" ]] || return 0',
 '  compose exec -T "$operations_service" node /argws-connect/operations-agent/emit.cjs "$1" >/dev/null 2>&1 || true',
 '}', 'api_service="$(find_service api)"',
]))
replace(backup, '  echo "$output"\n}', '  operation_event backup.created\n  echo "$output"\n}')
replace(backup, '  echo "OK: $(basename "$file")"', '  operation_event backup.verified\n  echo "OK: $(basename "$file")"')
replace(backup, '  echo "Restore concluído: $(basename "$file")"', '  operation_event backup.restored\n  echo "Restore concluído: $(basename "$file")"')
for file,text in changes.items():
    Path(file).write_text(text)
print('Applied scoped changes:', len(changes))

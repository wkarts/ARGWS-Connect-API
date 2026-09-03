from pathlib import Path


def patch_template_engine():
    path = Path('src/api/services/template-engine.service.ts')
    source = path.read_text()

    dto_import = "import type { MicroAppSessionDto } from '@api/dto/micro-app.dto';\n"
    if dto_import not in source:
        marker = "import { InstanceDto } from '@api/dto/instance.dto';\n"
        if marker not in source:
            raise SystemExit('InstanceDto import marker not found')
        source = source.replace(marker, marker + dto_import, 1)

    helper_import = """import {
  buildMicroAppRuntimeContext,
  candidateRemoteJids,
  mergeRuntimeVariables,
  normalizeWhatsappNumber,
  resolveMicroAppAutoLaunch,
} from './micro-app-auto-launch';
"""
    if "from './micro-app-auto-launch'" not in source:
        marker = "import { WAMonitoringService } from './monitor.service';\n"
        if marker not in source:
            raise SystemExit('monitor import marker not found')
        source = source.replace(marker, helper_import + marker, 1)

    logger_marker = "  private readonly logger = new Logger('TemplateEngineService');\n"
    if 'setMicroAppSessionCreator' not in source:
        if logger_marker not in source:
            raise SystemExit('TemplateEngine logger marker not found')
        source = source.replace(
            logger_marker,
            logger_marker
            + """
  private microAppSessionCreator?: (
    instance: InstanceDto,
    data: MicroAppSessionDto,
  ) => Promise<{ url: string; appKey: string; pageKey: string; expiresAt?: string; token?: string }>;

  public setMicroAppSessionCreator(
    creator: (
      instance: InstanceDto,
      data: MicroAppSessionDto,
    ) => Promise<{ url: string; appKey: string; pageKey: string; expiresAt?: string; token?: string }>,
  ) {
    this.microAppSessionCreator = creator;
  }
""",
            1,
        )

    old_vars = """    const variables = (data.variables || {}) as Record<string, unknown>;
    const interactions = renderInteractionModelV2(template?.policy, variables);
"""
    if old_vars in source:
        source = source.replace(
            old_vars,
            """    let variables = (data.variables || {}) as Record<string, unknown>;
    const autoLaunch = await this.prepareMicroAppAutoLaunch(instance, instanceRow.id, template, data, variables);
    if (autoLaunch) variables = autoLaunch.variables;
    data.variables = variables;
    const interactions = renderInteractionModelV2(template?.policy, variables);
""",
            1,
        )
    elif 'const autoLaunch = await this.prepareMicroAppAutoLaunch' not in source:
        raise SystemExit('TemplateEngine variables marker not found')

    meta_marker = """      await this.sendRenderedInteractions(instanceRow.id, runtime, data, provider, template, rendered, transport);
      return result;
"""
    if 'sendMicroAppAutoLaunch(runtime, data, autoLaunch)' not in source:
        if meta_marker not in source:
            raise SystemExit('Meta return marker not found')
        source = source.replace(
            meta_marker,
            """      await this.sendRenderedInteractions(instanceRow.id, runtime, data, provider, template, rendered, transport);
      await this.sendMicroAppAutoLaunch(runtime, data, autoLaunch);
      return result;
""",
            1,
        )

    local_marker = """    await this.sendRenderedInteractions(instanceRow.id, runtime, data, provider, template, rendered, transport);
    return result;
  }

  public async preview"""
    if local_marker in source:
        source = source.replace(
            local_marker,
            """    await this.sendRenderedInteractions(instanceRow.id, runtime, data, provider, template, rendered, transport);
    await this.sendMicroAppAutoLaunch(runtime, data, autoLaunch);
    return result;
  }

  public async preview""",
            1,
        )
    elif source.count('sendMicroAppAutoLaunch(runtime, data, autoLaunch)') < 2:
        raise SystemExit('Local return marker not found')

    preview_marker = '  public async preview(instance: InstanceDto, data: any) {'
    if 'private async prepareMicroAppAutoLaunch(' not in source:
        if preview_marker not in source:
            raise SystemExit('preview marker not found')
        methods = """  private async prepareMicroAppAutoLaunch(
    instance: InstanceDto,
    instanceId: string,
    template: any,
    data: SendTemplateDto,
    baseVariables: Record<string, unknown>,
  ) {
    const policy = resolveMicroAppAutoLaunch(template?.policy);
    if (!policy || !this.microAppSessionCreator || !template) return null;

    const contact = await this.resolveWhatsappContact(instanceId, data.number);
    const initialContext = buildMicroAppRuntimeContext({
      appKey: policy.appKey,
      url: '',
      number: data.number,
      contactName: contact.name,
      remoteJid: contact.remoteJid,
    });
    const sessionVariables = mergeRuntimeVariables(baseVariables, initialContext);
    const session = await this.microAppSessionCreator(instance, {
      templateName: data.name,
      language: data.language || 'pt_BR',
      appKey: policy.appKey,
      number: data.number,
      variables: sessionVariables,
      ttlSeconds: policy.ttlSeconds,
    });
    const runtimeContext = buildMicroAppRuntimeContext({
      appKey: policy.appKey,
      url: session.url,
      expiresAt: session.expiresAt,
      number: data.number,
      contactName: contact.name,
      remoteJid: contact.remoteJid,
    });
    return {
      policy,
      session,
      variables: mergeRuntimeVariables(sessionVariables, runtimeContext),
    };
  }

  private async resolveWhatsappContact(instanceId: string, number: string) {
    const normalized = normalizeWhatsappNumber(number);
    if (!normalized) return { name: 'Contato WhatsApp', remoteJid: undefined as string | undefined };
    const candidates = candidateRemoteJids(number);
    const contact = await this.prisma.contact.findFirst({
      where: {
        instanceId,
        OR: [{ remoteJid: { in: candidates } }, { remoteJid: { startsWith: normalized } }],
      },
      select: { pushName: true, remoteJid: true },
    });
    const chat = await this.prisma.chat.findFirst({
      where: {
        instanceId,
        OR: [{ remoteJid: { in: candidates } }, { remoteJid: { startsWith: normalized } }],
      },
      select: { name: true, remoteJid: true },
    });
    return {
      name: contact?.pushName || chat?.name || normalized,
      remoteJid: contact?.remoteJid || chat?.remoteJid || candidates[0],
    };
  }

  private async sendMicroAppAutoLaunch(runtime: any, data: SendTemplateDto, autoLaunch: any) {
    if (!autoLaunch?.session?.url) return;
    await runtime.textMessage({
      number: data.number,
      text: `${autoLaunch.policy.messageText}\n${autoLaunch.session.url}`,
      delay: data.delay,
      quoted: data.quoted,
      linkPreview: autoLaunch.policy.linkPreview,
      mentionsEveryOne: data.mentionsEveryOne,
      mentioned: data.mentioned,
    });
  }

"""
        source = source.replace(preview_marker, methods + preview_marker, 1)

    path.write_text(source)


def patch_server_module():
    path = Path('src/api/server.module.ts')
    source = path.read_text()
    marker = """export const microAppService = new MicroAppService(
  prismaRepository,
  cache,
  configService,
  actionExecutionService,
  recipeService,
  templateEngine,
);
"""
    if 'templateEngine.setMicroAppSessionCreator' not in source:
        if marker not in source:
            raise SystemExit('MicroAppService wiring marker not found')
        source = source.replace(
            marker,
            marker + 'templateEngine.setMicroAppSessionCreator((instance, data) => microAppService.createSession(instance, data));\n',
            1,
        )
    path.write_text(source)


def patch_micro_app_service():
    path = Path('src/api/services/micro-app.service.ts')
    source = path.read_text()

    helper = "import { interpolateRuntimeString } from './micro-app-auto-launch';\n"
    if helper not in source:
        marker = "import type { ActionExecutionService } from './action-execution.service';\n"
        if marker not in source:
            raise SystemExit('MicroApp helper import marker not found')
        source = source.replace(marker, marker + helper, 1)

    access = "  accessMode?: 'CONVERSATION_SESSION' | 'AUTHENTICATED' | 'STRONG_AUTH';\n"
    if 'offline?: {' not in source:
        if access not in source:
            raise SystemExit('MicroAppDefinition access marker not found')
        source = source.replace(
            access,
            access
            + """  offline?: {
    enabled?: boolean;
    persistDraft?: boolean;
    queueSubmit?: boolean;
  };
""",
            1,
        )

    app_state = """        accessMode: app.accessMode || 'CONVERSATION_SESSION',
      },
"""
    if 'offline: app.offline' not in source:
        if app_state not in source:
            raise SystemExit('publicState app marker not found')
        source = source.replace(
            app_state,
            """        accessMode: app.accessMode || 'CONVERSATION_SESSION',
        offline: app.offline || { enabled: false },
      },
""",
            1,
        )

    component_state = '        components: page.components || [],\n'
    if 'resolveComponentVariables(page.components' not in source:
        if component_state not in source:
            raise SystemExit('publicState components marker not found')
        source = source.replace(
            component_state,
            '        components: this.resolveComponentVariables(page.components || [], session.variables),\n',
            1,
        )

    sign_marker = '  private sign(payload: { nonce: string; exp: number }) {'
    if 'private resolveComponentVariables(' not in source:
        if sign_marker not in source:
            raise SystemExit('sign marker not found')
        source = source.replace(
            sign_marker,
            """  private resolveComponentVariables(value: unknown, variables: Record<string, unknown>): any {
    if (Array.isArray(value)) return value.map((item) => this.resolveComponentVariables(item, variables));
    if (typeof value === 'string') return interpolateRuntimeString(value, variables);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        this.resolveComponentVariables(item, variables),
      ]),
    );
  }

"""
            + sign_marker,
            1,
        )

    text_component = "if(c.type==='TEXT')return '<div>'+esc(c.text||'')+'</div>';"
    if "c.type==='CLOCK'" not in source:
        if text_component not in source:
            raise SystemExit('runtime TEXT component marker not found')
        source = source.replace(
            text_component,
            """if(c.type==='CLOCK')return '<div class=\"micro-field\"><span>'+label+'</span><strong data-live-clock>--:--:--</strong><small data-live-date></small></div>';if(c.type==='STATUS')return '<div class=\"micro-status\" data-network-status></div>';if(c.type==='CONTACT')return '<div class=\"micro-option\"><strong>'+label+'</strong><div>'+esc(c.text||'')+'</div></div>';if(c.type==='TEXT')return '<div>'+esc(c.text||'')+'</div>';""",
            1,
        )

    capture_marker = 'function captureLocation(){'
    if 'function setupOfflineDraft(){' not in source:
        if capture_marker not in source:
            raise SystemExit('runtime captureLocation marker not found')
        helpers = """let liveClockTimer=null;function draftKey(){return 'connectapi:microapp:draft:'+token+':'+(state?.page?.key||'page')}function pendingKey(){return 'connectapi:microapp:pending:'+token}function refreshLiveWidgets(){if(liveClockTimer)clearInterval(liveClockTimer);const tick=()=>{const now=new Date();document.querySelectorAll('[data-live-clock]').forEach(n=>n.textContent=now.toLocaleTimeString('pt-BR'));document.querySelectorAll('[data-live-date]').forEach(n=>n.textContent=now.toLocaleDateString('pt-BR'))};const network=()=>document.querySelectorAll('[data-network-status]').forEach(n=>{n.textContent=navigator.onLine?'● Online · sincronização disponível':'● Offline · rascunho local ativo';n.style.color=navigator.onLine?'#157347':'#b54708'});tick();network();liveClockTimer=setInterval(tick,1000);window.addEventListener('online',network);window.addEventListener('offline',network)}function formValues(form){const fd=new FormData(form),values={};for(const [k,v] of fd.entries())values[k]=v;for(const box of form.querySelectorAll('input[type=checkbox][name]'))values[box.name]=box.checked;return values}function setupOfflineDraft(){const form=document.getElementById('microForm');if(!form||!state?.app?.offline?.enabled)return;try{const raw=localStorage.getItem(draftKey());if(raw){const saved=JSON.parse(raw);for(const [key,value] of Object.entries(saved||{})){const field=form.elements.namedItem(key);if(!field)continue;if(field.type==='checkbox')field.checked=Boolean(value);else field.value=value??''}}}catch{}const persist=()=>{if(state.app.offline.persistDraft===false)return;try{localStorage.setItem(draftKey(),JSON.stringify(formValues(form)))}catch{}};form.addEventListener('input',persist);form.addEventListener('change',persist);window.addEventListener('online',flushPending,{once:true});flushPending()}async function flushPending(){if(!navigator.onLine||!state?.app?.offline?.enabled||state.app.offline.queueSubmit===false)return;let payload=null;try{const raw=localStorage.getItem(pendingKey());if(raw)payload=JSON.parse(raw)}catch{}if(!payload)return;try{localStorage.removeItem(pendingKey());await submit(payload,true)}catch{try{localStorage.setItem(pendingKey(),JSON.stringify(payload))}catch{}}}"""
        source = source.replace(capture_marker, helpers + capture_marker, 1)

    render_tail = """document.getElementById('microForm')?.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.currentTarget),values={};for(const [k,v] of fd.entries())values[k]=v;for(const box of e.currentTarget.querySelectorAll('input[type=checkbox][name]'))values[box.name]=box.checked;submit({direction:'NEXT',values,location:locationValue});});if(p.location?.mode==='REQUIRED_AUTO')captureLocation();}"""
    if 'setupOfflineDraft();refreshLiveWidgets();' not in source:
        if render_tail not in source:
            raise SystemExit('runtime render tail marker not found')
        source = source.replace(
            render_tail,
            """document.getElementById('microForm')?.addEventListener('submit',e=>{e.preventDefault();const values=formValues(e.currentTarget);submit({direction:'NEXT',values,location:locationValue});});setupOfflineDraft();refreshLiveWidgets();if(p.location?.mode==='REQUIRED_AUTO')captureLocation();}""",
            1,
        )

    submit_marker = "async function submit(payload){const err=document.getElementById('microError');if(err)err.textContent='';const r=await fetch('/micro-app/submit/'"
    if 'async function submit(payload,fromQueue)' not in source:
        if submit_marker not in source:
            raise SystemExit('runtime submit marker not found')
        source = source.replace(
            submit_marker,
            """async function submit(payload,fromQueue){const err=document.getElementById('microError');if(err)err.textContent='';if(!navigator.onLine&&state?.app?.offline?.enabled&&state.app.offline.queueSubmit!==false){try{localStorage.setItem(pendingKey(),JSON.stringify(payload));localStorage.setItem(draftKey(),JSON.stringify(payload.values||{}))}catch{}if(err){err.className='micro-error';err.textContent='Sem conexão. Seus dados foram salvos neste dispositivo e serão enviados quando a internet voltar.'}return;}const currentDraft=draftKey();const r=await fetch('/micro-app/submit/'""",
            1,
        )
        success_marker = """const d=await r.json();if(!r.ok){if(err){err.className='micro-error';err.textContent=d.message||'Não foi possível continuar.';}return;}if(d.completed){"""
        if success_marker not in source:
            raise SystemExit('runtime submit success marker not found')
        source = source.replace(
            success_marker,
            """const d=await r.json();if(!r.ok){if(err){err.className='micro-error';err.textContent=d.message||'Não foi possível continuar.';}return;}try{localStorage.removeItem(currentDraft);if(fromQueue)localStorage.removeItem(pendingKey())}catch{}if(d.completed){""",
            1,
        )

    path.write_text(source)


def patch_package():
    path = Path('package.json')
    source = path.read_text()
    if 'test/micro-app/auto-launch.test.ts' not in source:
        marker = 'tsx ./test/template-studio/transfer-center.test.ts'
        if marker not in source:
            raise SystemExit('test:compat tail marker not found')
        source = source.replace(marker, marker + ' && tsx ./test/micro-app/auto-launch.test.ts', 1)
    path.write_text(source)


patch_template_engine()
patch_server_module()
patch_micro_app_service()
patch_package()
print('Micro App auto-launch patch applied')

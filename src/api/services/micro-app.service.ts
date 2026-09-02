import { MicroAppSessionDto, MicroAppSubmitDto } from '@api/dto/micro-app.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { Auth, ConfigService, HttpServer } from '@config/env.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { ActionExecutionService } from './action-execution.service';
import { CacheService } from './cache.service';
import { CapturedLocation, evaluateLocationPolicy, LocationPolicy } from './geolocation-policy';
import { resolveActionValue } from './action-value-resolver';
import { resolveDataPath } from './template-interaction-model';
import { RecipeService } from './recipe.service';
import { TemplateEngineService } from './template-engine.service';

type MicroAppOperation = {
  type: 'ACTION' | 'RECIPE';
  key: string;
  input?: unknown;
  resultPath?: string;
  confirmed?: boolean;
};

type MicroAppLocation = {
  mode?: 'DISABLED' | 'OPTIONAL' | 'REQUIRED' | 'REQUIRED_AUTO';
  capturePath?: string;
  policy?: LocationPolicy;
  reverseGeocode?: MicroAppOperation;
};

type MicroAppTransition = {
  next: string;
  when?: {
    path: string;
    operator?: 'EQUALS' | 'NOT_EQUALS' | 'EXISTS' | 'TRUTHY' | 'FALSY';
    value?: unknown;
  };
};

type MicroAppPage = {
  key: string;
  title?: string;
  description?: string;
  components?: any[];
  captureRoot?: string;
  location?: MicroAppLocation;
  load?: MicroAppOperation;
  submit?: MicroAppOperation;
  next?: string;
  transitions?: MicroAppTransition[];
};

type MicroAppDefinition = {
  key: string;
  title?: string;
  description?: string;
  startPage: string;
  ttlSeconds?: number;
  accessMode?: 'CONVERSATION_SESSION' | 'AUTHENTICATED' | 'STRONG_AUTH';
  pages: MicroAppPage[];
  completion?: {
    template?: {
      name: string;
      language?: string;
      variables?: unknown;
    };
  };
};

type MicroAppSession = {
  nonce: string;
  instanceId: string;
  instanceName: string;
  templateName: string;
  language: string;
  appKey: string;
  number: string;
  pageKey: string;
  history: string[];
  variables: Record<string, unknown>;
  loadedPages: string[];
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
};

const SESSION_PREFIX = 'micro-app:v1:';
const SAFE_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const SECRET_KEY = /(password|passwd|secret|token|credential|authorization|api.?key|cookie)/i;

export class MicroAppService {
  private readonly memory = new Map<string, MicroAppSession>();

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly actions: ActionExecutionService,
    private readonly recipes: RecipeService,
    private readonly templates: TemplateEngineService,
  ) {}

  public async createSession(instance: InstanceDto, data: MicroAppSessionDto) {
    const instanceRow = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true, name: true, integration: true },
    });
    if (!instanceRow) throw new NotFoundException(`Instance ${instance.instanceName} not found`);

    const language = data.language || 'pt_BR';
    const template = await this.prisma.template.findFirst({
      where: { instanceId: instanceRow.id, name: data.templateName, language, enabled: true },
    });
    if (!template) throw new NotFoundException(`Template ${data.templateName} (${language}) not found`);

    const app = this.findApp(template.policy, data.appKey);
    const startPage = this.findPage(app, app.startPage);
    const ttlSeconds = this.ttl(data.ttlSeconds || app.ttlSeconds || 900);
    const nonce = randomBytes(24).toString('base64url');
    const now = Date.now();
    const session: MicroAppSession = {
      nonce,
      instanceId: instanceRow.id,
      instanceName: instanceRow.name,
      templateName: data.templateName,
      language,
      appKey: app.key,
      number: data.number,
      pageKey: startPage.key,
      history: [],
      variables: this.clone(data.variables || {}),
      loadedPages: [],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    };
    await this.persist(session);

    const token = this.sign({ nonce, exp: Math.floor((now + ttlSeconds * 1000) / 1000) });
    return {
      token,
      url: `${this.publicBaseUrl()}/micro-app/${encodeURIComponent(token)}`,
      expiresAt: session.expiresAt,
      appKey: app.key,
      pageKey: session.pageKey,
    };
  }

  public async state(token: string) {
    const session = await this.requireSession(token);
    const { app, page, session: loadedSession } = await this.loadCurrentPage(session);
    return this.publicState(app, page, loadedSession);
  }

  public async submit(token: string, data: MicroAppSubmitDto, clientIp?: string) {
    let session = await this.requireSession(token);
    const definition = await this.definition(session);
    const page = this.findPage(definition.app, session.pageKey);

    if (data.direction === 'BACK') {
      const previous = session.history.pop();
      if (previous) session.pageKey = previous;
      session.loadedPages = session.loadedPages.filter((key) => key !== session.pageKey);
      await this.persist(session);
      const loaded = await this.loadCurrentPage(session);
      return this.publicState(loaded.app, loaded.page, loaded.session);
    }

    const values = this.clone(data.values || {});
    if (page.captureRoot) {
      this.setPath(session.variables, page.captureRoot, values);
    } else {
      session.variables = this.deepMerge(session.variables, values);
    }

    if (page.location?.mode && page.location.mode !== 'DISABLED') {
      session = await this.applyLocation(session, page, data.location, clientIp);
    }

    if (page.submit) {
      const result = await this.executeOperation(session, page.submit);
      if (page.submit.resultPath) this.setPath(session.variables, page.submit.resultPath, result);
    }

    const next = this.nextPage(page, session.variables);
    if (next) {
      this.findPage(definition.app, next);
      session.history.push(page.key);
      session.pageKey = next;
      await this.persist(session);
      const loaded = await this.loadCurrentPage(session);
      return this.publicState(loaded.app, loaded.page, loaded.session);
    }

    session.completedAt = new Date().toISOString();
    await this.persist(session);
    await this.complete(definition.app, session);
    return {
      completed: true,
      appKey: definition.app.key,
      pageKey: page.key,
      variables: this.sanitize(session.variables),
      completedAt: session.completedAt,
    };
  }

  public htmlShell(token: string) {
    const escapedToken = token.replace(/[^A-Za-z0-9._~-]/g, '');
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#ffffff" />
  <title>Connect|API Micro App</title>
  <style>
    :root{color-scheme:light;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f8fb;color:#172033}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f6f8fb}.micro-shell{max-width:620px;margin:0 auto;padding:20px 14px 40px}.micro-card{background:#fff;border:1px solid #dde5ef;border-radius:18px;box-shadow:0 12px 34px rgba(31,55,85,.08);overflow:hidden}.micro-head{padding:20px 20px 12px}.micro-head h1{font-size:20px;margin:0 0 6px}.micro-head p{margin:0;color:#667085;font-size:13px;line-height:1.45}.micro-body{padding:8px 20px 20px;display:grid;gap:14px}.micro-field{display:grid;gap:6px}.micro-field>span{font-size:12px;font-weight:700;color:#344054}.micro-field input,.micro-field select{width:100%;border:1px solid #ccd6e3;border-radius:11px;padding:11px 12px;background:#fff;color:#172033;font:inherit}.micro-options{display:grid;gap:8px}.micro-option{border:1px solid #d7e0eb;border-radius:12px;padding:11px;background:#fff}.micro-actions{padding:0 20px 20px;display:flex;gap:10px}.micro-actions button{border:0;border-radius:11px;padding:12px 16px;font-weight:800;cursor:pointer}.micro-primary{background:#1f5fd6;color:#fff;flex:1}.micro-secondary{background:#eef3f8;color:#344054}.micro-status{font-size:12px;color:#667085}.micro-error{padding:12px;border-radius:11px;background:#fff1f1;color:#a61b1b;font-size:12px}.micro-table{width:100%;border-collapse:collapse;font-size:12px}.micro-table th,.micro-table td{padding:8px;border-bottom:1px solid #e8edf3;text-align:left}.micro-image{max-width:100%;height:auto;border-radius:12px}
  </style>
</head>
<body>
  <main id="microApp" class="micro-shell" data-token="${escapedToken}"><div class="micro-card"><div class="micro-head"><h1>Carregando...</h1><p>Connect|API Micro App</p></div></div></main>
  <script src="/micro-app/runtime.js" defer></script>
</body>
</html>`;
  }

  public runtimeScript() {
    return `(function(){'use strict';const root=document.getElementById('microApp');if(!root)return;const token=root.dataset.token;let state=null,locationValue=null;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));const path=(o,p)=>String(p||'').split('.').filter(Boolean).reduce((a,k)=>a==null?undefined:a[k],o);function options(c){const src=c.source?path(state.variables,c.source):c.options;return Array.isArray(src)?src:[]}function renderComponent(c){const id=esc(c.id||c.name||'field');const label=esc(c.label||c.title||'');if(c.type==='TEXT')return '<div>'+esc(c.text||'')+'</div>';if(c.type==='IMAGE')return '<img class="micro-image" src="'+esc(c.src||'')+'" alt="'+label+'" />';if(c.type==='SELECT'||c.type==='LIST')return '<label class="micro-field"><span>'+label+'</span><select name="'+id+'">'+options(c).map((o,i)=>'<option value="'+esc(o.value??o.id??i)+'">'+esc(o.label??o.title??o.name??o)+'</option>').join('')+'</select></label>';if(c.type==='RADIO')return '<fieldset class="micro-field"><span>'+label+'</span><div class="micro-options">'+options(c).map((o,i)=>'<label class="micro-option"><input type="radio" name="'+id+'" value="'+esc(o.value??o.id??i)+'" /> '+esc(o.label??o.title??o.name??o)+'</label>').join('')+'</div></fieldset>';if(c.type==='CHECKBOX')return '<label class="micro-option"><input type="checkbox" name="'+id+'" /> '+label+'</label>';if(c.type==='TABLE'){const rows=options(c),cols=Array.isArray(c.columns)?c.columns:[];return '<table class="micro-table"><thead><tr>'+cols.map(x=>'<th>'+esc(x.label||x.key)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(x=>'<td>'+esc(path(r,x.key))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}if(c.type==='LOCATION')return '<div class="micro-field"><span>'+label+'</span><button class="micro-secondary" type="button" data-location>Obter localização</button><div class="micro-status" data-location-status>Aguardando localização.</div></div>';const type=c.type==='DATE'?'date':c.type==='TIME'?'time':(c.inputType||'text');return '<label class="micro-field"><span>'+label+'</span><input name="'+id+'" type="'+esc(type)+'" value="'+esc(c.value??'')+'" placeholder="'+esc(c.placeholder||'')+'" /></label>';}function render(){const p=state.page||{};root.innerHTML='<section class="micro-card"><header class="micro-head"><h1>'+esc(p.title||state.app.title||'Micro App')+'</h1><p>'+esc(p.description||state.app.description||'')+'</p></header><form id="microForm"><div class="micro-body">'+(p.components||[]).map(renderComponent).join('')+'<div id="microError"></div></div><footer class="micro-actions">'+(state.canGoBack?'<button class="micro-secondary" type="button" id="microBack">Voltar</button>':'')+'<button class="micro-primary" type="submit">Continuar</button></footer></form></section>';document.querySelectorAll('[data-location]').forEach(b=>b.addEventListener('click',captureLocation));document.getElementById('microBack')?.addEventListener('click',()=>submit({direction:'BACK'}));document.getElementById('microForm')?.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.currentTarget),values={};for(const [k,v] of fd.entries())values[k]=v;for(const box of e.currentTarget.querySelectorAll('input[type=checkbox][name]'))values[box.name]=box.checked;submit({direction:'NEXT',values,location:locationValue});});if(p.location?.mode==='REQUIRED_AUTO')captureLocation();}function captureLocation(){const out=document.querySelector('[data-location-status]');if(!navigator.geolocation){if(out)out.textContent='Geolocalização indisponível neste dispositivo.';return;}if(out)out.textContent='Obtendo localização...';navigator.geolocation.getCurrentPosition(pos=>{locationValue={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy,capturedAt:new Date(pos.timestamp).toISOString()};if(out)out.textContent='Localização obtida · precisão aproximada '+Math.round(pos.coords.accuracy)+' m.';},err=>{if(out)out.textContent='Não foi possível obter a localização: '+err.message;},{enableHighAccuracy:true,timeout:15000,maximumAge:0});}async function load(){const r=await fetch('/micro-app/state/'+encodeURIComponent(token),{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.message||'Micro App indisponível');state=d;render();}async function submit(payload){const err=document.getElementById('microError');if(err)err.textContent='';const r=await fetch('/micro-app/submit/'+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok){if(err){err.className='micro-error';err.textContent=d.message||'Não foi possível continuar.';}return;}if(d.completed){root.innerHTML='<section class="micro-card"><div class="micro-head"><h1>Concluído</h1><p>Você pode voltar para a conversa.</p></div></section>';return;}state=d;locationValue=null;render();}load().catch(e=>{root.innerHTML='<div class="micro-error">'+esc(e.message)+'</div>';});})();`;
  }

  private async loadCurrentPage(session: MicroAppSession) {
    const definition = await this.definition(session);
    const page = this.findPage(definition.app, session.pageKey);
    if (page.load && !session.loadedPages.includes(page.key)) {
      const result = await this.executeOperation(session, page.load);
      if (page.load.resultPath) this.setPath(session.variables, page.load.resultPath, result);
      session.loadedPages.push(page.key);
      await this.persist(session);
    }
    return { ...definition, page, session };
  }

  private async applyLocation(
    session: MicroAppSession,
    page: MicroAppPage,
    raw: MicroAppSubmitDto['location'],
    clientIp?: string,
  ) {
    const mode = page.location?.mode || 'DISABLED';
    const required = mode === 'REQUIRED' || mode === 'REQUIRED_AUTO';
    if (!raw) {
      if (required) throw new BadRequestException('LOCATION_REQUIRED');
      return session;
    }

    const location: CapturedLocation = {
      source: 'MICRO_APP_GPS',
      latitude: Number(raw.latitude),
      longitude: Number(raw.longitude),
      accuracy: raw.accuracy === undefined ? undefined : Number(raw.accuracy),
      capturedAt: raw.capturedAt || new Date().toISOString(),
    };
    const validation = evaluateLocationPolicy(location, page.location?.policy || {});
    if (!validation.accepted) throw new BadRequestException(validation.reason);

    const capturePath = page.location?.capturePath || 'location';
    this.setPath(session.variables, capturePath, {
      ...location,
      validation,
      clientIp: clientIp || undefined,
      serverTimestamp: new Date().toISOString(),
    });

    if (page.location?.reverseGeocode) {
      const result = await this.executeOperation(session, page.location.reverseGeocode, {
        location,
        validation,
        clientIp,
      });
      const resultPath = page.location.reverseGeocode.resultPath || `${capturePath}.address`;
      this.setPath(session.variables, resultPath, result);
    }
    return session;
  }

  private async executeOperation(session: MicroAppSession, operation: MicroAppOperation, extra: any = {}) {
    const instance = await this.prisma.instance.findUnique({
      where: { id: session.instanceId },
      select: { id: true, name: true, integration: true },
    });
    if (!instance) throw new NotFoundException(`Instance ${session.instanceName} not found`);
    const instanceDto: InstanceDto = {
      instanceName: instance.name,
      instanceId: instance.id,
      integration: instance.integration,
    };
    const context = {
      input: session.variables,
      session: { variables: session.variables, number: session.number, appKey: session.appKey },
      ...extra,
    };
    const input = resolveActionValue(operation.input || session.variables, context) as Record<string, unknown>;

    if (operation.type === 'RECIPE') {
      return this.recipes.execute(instanceDto, {
        recipeKey: operation.key,
        input,
        confirmed: operation.confirmed === true,
        dryRun: false,
      });
    }
    return this.actions.execute(instanceDto, {
      actionKey: operation.key,
      input,
      confirmed: operation.confirmed === true,
      dryRun: false,
    });
  }

  private async complete(app: MicroAppDefinition, session: MicroAppSession) {
    const configured = app.completion?.template;
    if (!configured?.name) return;
    const instance = await this.prisma.instance.findUnique({
      where: { id: session.instanceId },
      select: { id: true, name: true, integration: true },
    });
    if (!instance) return;
    const context = { input: session.variables, session: { variables: session.variables } };
    const variables = (resolveActionValue(configured.variables || session.variables, context) || {}) as Record<
      string,
      unknown
    >;
    await this.templates.send(
      { instanceName: instance.name, instanceId: instance.id, integration: instance.integration },
      {
        number: session.number,
        name: configured.name,
        language: configured.language || session.language,
        components: [],
        variables,
      },
    );
  }

  private nextPage(page: MicroAppPage, variables: Record<string, unknown>) {
    for (const transition of page.transitions || []) {
      if (!transition.when || this.matches(transition.when, variables)) return transition.next;
    }
    return page.next || null;
  }

  private matches(condition: NonNullable<MicroAppTransition['when']>, variables: Record<string, unknown>) {
    const actual = resolveDataPath(variables, condition.path);
    switch (condition.operator || 'EQUALS') {
      case 'NOT_EQUALS':
        return actual !== condition.value;
      case 'EXISTS':
        return actual !== undefined && actual !== null;
      case 'TRUTHY':
        return Boolean(actual);
      case 'FALSY':
        return !actual;
      default:
        return actual === condition.value;
    }
  }

  private async definition(session: MicroAppSession) {
    const template = await this.prisma.template.findFirst({
      where: {
        instanceId: session.instanceId,
        name: session.templateName,
        language: session.language,
        enabled: true,
      },
    });
    if (!template) throw new NotFoundException('Micro App template is no longer available');
    return { template, app: this.findApp(template.policy, session.appKey) };
  }

  private findApp(policy: unknown, appKey: string): MicroAppDefinition {
    const microApps = policy && typeof policy === 'object' ? (policy as any).microApps : null;
    const apps = Array.isArray(microApps?.apps) ? microApps.apps : [];
    const app = apps.find((candidate: any) => String(candidate?.key || '') === String(appKey || ''));
    if (!app) throw new NotFoundException(`Micro App ${appKey} not found in template policy`);
    if (!Array.isArray(app.pages) || !String(app.startPage || '')) {
      throw new BadRequestException(`Micro App ${appKey} has an invalid page definition`);
    }
    return app as MicroAppDefinition;
  }

  private findPage(app: MicroAppDefinition, pageKey: string): MicroAppPage {
    const page = app.pages.find((candidate) => candidate.key === pageKey);
    if (!page) throw new NotFoundException(`Micro App page ${pageKey} not found`);
    return page;
  }

  private publicState(app: MicroAppDefinition, page: MicroAppPage, session: MicroAppSession) {
    return {
      completed: false,
      app: {
        key: app.key,
        title: app.title,
        description: app.description,
        accessMode: app.accessMode || 'CONVERSATION_SESSION',
      },
      page: {
        key: page.key,
        title: page.title,
        description: page.description,
        components: page.components || [],
        location: page.location
          ? {
              mode: page.location.mode || 'DISABLED',
              policy: page.location.policy || {},
            }
          : undefined,
      },
      variables: this.sanitize(session.variables),
      canGoBack: session.history.length > 0,
      expiresAt: session.expiresAt,
    };
  }

  private sign(payload: { nonce: string; exp: number }) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verify(token: string) {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) throw new BadRequestException('Invalid Micro App token');
    const expected = createHmac('sha256', this.secret()).update(body).digest();
    const received = Buffer.from(signature, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new BadRequestException('Invalid Micro App token');
    }
    let payload: any;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid Micro App token');
    }
    if (!payload?.nonce || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Micro App token expired');
    }
    return payload as { nonce: string; exp: number };
  }

  private async requireSession(token: string) {
    const payload = this.verify(token);
    const key = `${SESSION_PREFIX}${payload.nonce}`;
    let raw = await this.cache.get(key);
    if (raw === undefined || raw === null) raw = this.memory.get(key);
    let session: MicroAppSession | null = null;
    if (typeof raw === 'string') {
      try {
        session = JSON.parse(raw) as MicroAppSession;
      } catch {
        session = null;
      }
    } else if (raw && typeof raw === 'object') {
      session = raw as MicroAppSession;
    }
    if (!session || session.nonce !== payload.nonce || Date.parse(session.expiresAt) <= Date.now()) {
      this.memory.delete(key);
      throw new NotFoundException('Micro App session expired or unavailable');
    }
    return session;
  }

  private async persist(session: MicroAppSession) {
    const key = `${SESSION_PREFIX}${session.nonce}`;
    const ttl = Math.max(1, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
    const raw = JSON.stringify(session);
    this.memory.set(key, session);
    await this.cache.set(key, raw, ttl);
  }

  private secret() {
    const auth = this.config.get<Auth>('AUTHENTICATION');
    const secret = process.env.MICRO_APP_SECRET || auth?.API_KEY?.KEY;
    if (!secret || secret.length < 12) throw new BadRequestException('MICRO_APP_SECRET is not configured securely');
    return secret;
  }

  private publicBaseUrl() {
    const server = this.config.get<HttpServer>('SERVER');
    return String(server?.URL || `${server?.TYPE || 'http'}://localhost:${server?.PORT || 8080}`).replace(/\/$/, '');
  }

  private ttl(value: number) {
    const ttl = Number.isFinite(Number(value)) ? Number(value) : 900;
    return Math.min(Math.max(Math.round(ttl), 60), 24 * 60 * 60);
  }

  private sanitize(value: unknown): any {
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, item]) => [key, this.sanitize(item)]),
    );
  }

  private clone<T>(value: T): T {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
    const result = this.clone(target || {});
    for (const [key, value] of Object.entries(source || {})) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        result[key] &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private setPath(target: Record<string, unknown>, path: string, value: unknown) {
    if (!SAFE_PATH.test(path)) throw new BadRequestException(`Invalid Micro App path ${path}`);
    const parts = path.split('.');
    let current: any = target;
    for (let index = 0; index < parts.length; index += 1) {
      const key = parts[index];
      if (index === parts.length - 1) current[key] = value;
      else {
        if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) current[key] = {};
        current = current[key];
      }
    }
  }
}

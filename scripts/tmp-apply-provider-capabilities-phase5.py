from pathlib import Path
import json

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text()

def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)

def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f'marker not found: {label}')
    return text.replace(old, new, 1)

# 1) Pure provider capability / transport planning module.
write('src/api/services/template-transport-planner.ts', r'''import { RenderedTemplate } from './template-renderer';

export type TemplateTransportMode = 'PROVIDER_NATIVE' | 'TEXT' | 'INTERACTIVE' | 'POLL_COMPAT' | 'TEXT_COMPAT';
export type CapabilityLevel = 'NATIVE' | 'POLL_COMPAT' | 'TEXT_COMPAT' | 'UNSUPPORTED';

export type ProviderTemplateCapabilities = {
  provider: string;
  providerNativeTemplates: boolean;
  canonicalTemplateContract: boolean;
  quickReply: CapabilityLevel;
  urlButton: CapabilityLevel;
  phoneButton: CapabilityLevel;
  copyCodeButton: CapabilityLevel;
  list: CapabilityLevel;
  transportNotes: string[];
};

export type PlannedButtonTransport = {
  id?: string;
  title: string;
  canonicalType: string;
  transport: 'NATIVE_BUTTON' | 'POLL_OPTION' | 'TEXT_LINK' | 'TEXT_PHONE' | 'TEXT_CODE' | 'TEXT_OPTION';
  degraded: boolean;
};

export type TemplateTransportPlan = {
  provider: string;
  mode: TemplateTransportMode;
  compatibilityTransport?: string;
  degraded: boolean;
  warnings: string[];
  buttons: PlannedButtonTransport[];
};

export function getProviderTemplateCapabilities(provider?: string): ProviderTemplateCapabilities {
  const normalized = String(provider || 'UNKNOWN').toUpperCase();

  if (normalized === 'WHATSAPP-BUSINESS') {
    return {
      provider: normalized,
      providerNativeTemplates: true,
      canonicalTemplateContract: true,
      quickReply: 'NATIVE',
      urlButton: 'NATIVE',
      phoneButton: 'NATIVE',
      copyCodeButton: 'NATIVE',
      list: 'NATIVE',
      transportNotes: ['Templates e interações são delegados ao provider oficial Meta.'],
    };
  }

  if (normalized === 'WHATSAPP-BAILEYS') {
    return {
      provider: normalized,
      providerNativeTemplates: false,
      canonicalTemplateContract: true,
      quickReply: 'POLL_COMPAT',
      urlButton: 'TEXT_COMPAT',
      phoneButton: 'TEXT_COMPAT',
      copyCodeButton: 'TEXT_COMPAT',
      list: 'TEXT_COMPAT',
      transportNotes: [
        'Quick replies usam poll de escolha única para compatibilidade real com WhatsApp Desktop e mobile.',
        'URL, telefone, copiar código e combinações não representáveis são preservados como conteúdo textual funcional.',
      ],
    };
  }

  return {
    provider: normalized,
    providerNativeTemplates: false,
    canonicalTemplateContract: true,
    quickReply: 'NATIVE',
    urlButton: 'NATIVE',
    phoneButton: 'NATIVE',
    copyCodeButton: 'NATIVE',
    list: 'TEXT_COMPAT',
    transportNotes: ['O provider usa o adaptador interativo existente com fallback textual.'],
  };
}

export function planTemplateTransport(provider: string | undefined, rendered: RenderedTemplate): TemplateTransportPlan {
  const capabilities = getProviderTemplateCapabilities(provider);
  const normalized = capabilities.provider;
  const buttons = rendered.buttons || [];

  if (normalized === 'WHATSAPP-BUSINESS') {
    return {
      provider: normalized,
      mode: 'PROVIDER_NATIVE',
      degraded: false,
      warnings: [],
      buttons: buttons.map((button) => ({
        id: button.id,
        title: String(button.displayText || ''),
        canonicalType: button.type,
        transport: 'NATIVE_BUTTON',
        degraded: false,
      })),
    };
  }

  if (!buttons.length) {
    return { provider: normalized, mode: 'TEXT', degraded: false, warnings: [], buttons: [] };
  }

  if (normalized === 'WHATSAPP-BAILEYS') {
    const replies = buttons.filter((button) => button.type === 'reply' && button.displayText);
    const replyOnly = replies.length > 0 && replies.length === buttons.length;
    if (replyOnly) {
      return {
        provider: normalized,
        mode: 'POLL_COMPAT',
        compatibilityTransport: 'BAILEYS_OFFICIAL_POLL',
        degraded: true,
        warnings: ['Quick replies serão exibidos como enquete de escolha única neste provider.'],
        buttons: replies.map((button) => ({
          id: button.id,
          title: String(button.displayText || ''),
          canonicalType: button.type,
          transport: 'POLL_OPTION',
          degraded: true,
        })),
      };
    }

    return {
      provider: normalized,
      mode: 'TEXT_COMPAT',
      compatibilityTransport: 'BAILEYS_TEXT',
      degraded: true,
      warnings: ['Este conjunto de interações será convertido para conteúdo textual funcional neste provider.'],
      buttons: buttons.map((button) => ({
        id: button.id,
        title: String(button.displayText || ''),
        canonicalType: button.type,
        transport:
          button.type === 'url'
            ? 'TEXT_LINK'
            : button.type === 'call'
              ? 'TEXT_PHONE'
              : button.type === 'copy'
                ? 'TEXT_CODE'
                : 'TEXT_OPTION',
        degraded: true,
      })),
    };
  }

  return {
    provider: normalized,
    mode: 'INTERACTIVE',
    degraded: false,
    warnings: [],
    buttons: buttons.map((button) => ({
      id: button.id,
      title: String(button.displayText || ''),
      canonicalType: button.type,
      transport: 'NATIVE_BUTTON',
      degraded: false,
    })),
  };
}
''')

# 2) DTO.
path = 'src/api/dto/template.dto.ts'
text = read(path)
if 'export class TemplatePreviewDto' not in text:
    text += r'''

export class TemplatePreviewDto {
  name?: string;
  language?: string;
  category?: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
  components?: any[];
  variables?: Record<string, unknown>;
}
'''
write(path, text)

# 3) Validation schema.
write('src/validate/templatePreview.schema.ts', r'''import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const templatePreviewSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    name: { type: 'string' },
    language: { type: 'string' },
    category: { type: 'string', enum: ['AUTHENTICATION', 'MARKETING', 'UTILITY'] },
    components: { type: 'array' },
    variables: { type: 'object' },
  },
  anyOf: [{ required: ['components'] }, { required: ['name'] }],
};
''')

# 4) TemplateService capabilities + side-effect-free preview.
path = 'src/api/services/template.service.ts'
text = read(path)
text = replace_once(
    text,
    "import { TemplateDto } from '@api/dto/template.dto';",
    "import { TemplateDto, TemplatePreviewDto } from '@api/dto/template.dto';",
    'template dto import',
)
if "from './template-renderer'" not in text:
    text = replace_once(
        text,
        "import { WAMonitoringService } from './monitor.service';",
        "import { WAMonitoringService } from './monitor.service';\nimport { renderTemplateDefinition } from './template-renderer';\nimport { getProviderTemplateCapabilities, planTemplateTransport } from './template-transport-planner';",
        'template service helper imports',
    )
marker = '  public async create(instance: InstanceDto, data: TemplateDto) {'
if 'public async capabilities(instance: InstanceDto)' not in text:
    methods = r'''  public async capabilities(instance: InstanceDto) {
    const runtimeInstance = await this.getRuntimeInstance(instance);
    return getProviderTemplateCapabilities(runtimeInstance.integration);
  }

  public async preview(instance: InstanceDto, data: TemplatePreviewDto) {
    const runtimeInstance = await this.getRuntimeInstance(instance);
    const provider = String(runtimeInstance.integration || 'UNKNOWN');
    const language = data.language || 'pt_BR';

    let definition: any = null;
    if (Array.isArray(data.components)) {
      definition = {
        name: data.name || 'draft_template',
        language,
        category: data.category || 'UTILITY',
        components: data.components,
      };
    } else {
      const templates = await this.find(instance);
      const list = Array.isArray(templates) ? templates : Array.isArray((templates as any)?.data) ? (templates as any).data : [];
      const selected = list.find(
        (template: any) => template.name === data.name && String(template.language || 'pt_BR') === language,
      );
      if (!selected) throw new NotFoundException(`Template ${data.name} (${language}) not found for this instance`);
      definition = selected;
    }

    const rendered = renderTemplateDefinition(definition, [], data.variables || {});
    const capabilities = getProviderTemplateCapabilities(provider);
    const transport = planTemplateTransport(provider, rendered);

    return {
      sideEffectFree: true,
      provider,
      template: {
        name: definition.name || data.name || 'draft_template',
        language: definition.language || language,
        category: definition.category || data.category || 'UTILITY',
      },
      capabilities,
      transport,
      rendered: {
        title: rendered.title || null,
        text: rendered.text || null,
        footer: rendered.footer || null,
        buttons: rendered.buttons,
      },
    };
  }

'''
    text = replace_once(text, marker, methods + marker, 'template service methods')
write(path, text)

# 5) Controller.
path = 'src/api/controllers/template.controller.ts'
text = read(path)
text = replace_once(
    text,
    "import { TemplateDeleteDto, TemplateDto, TemplateEditDto } from '@api/dto/template.dto';",
    "import { TemplateDeleteDto, TemplateDto, TemplateEditDto, TemplatePreviewDto } from '@api/dto/template.dto';",
    'controller dto import',
)
if 'previewTemplate' not in text:
    text = replace_once(
        text,
        '  public async editTemplate(instance: InstanceDto, data: TemplateEditDto) {',
        r'''  public async capabilities(instance: InstanceDto) {
    return this.templateService.capabilities(instance);
  }

  public async previewTemplate(instance: InstanceDto, data: TemplatePreviewDto) {
    return this.templateService.preview(instance, data);
  }

  public async editTemplate(instance: InstanceDto, data: TemplateEditDto) {''',
        'controller methods',
    )
write(path, text)

# 6) Routes.
path = 'src/api/routes/template.router.ts'
text = read(path)
text = replace_once(
    text,
    "import { TemplateDeleteDto, TemplateDto, TemplateEditDto } from '@api/dto/template.dto';",
    "import { TemplateDeleteDto, TemplateDto, TemplateEditDto, TemplatePreviewDto } from '@api/dto/template.dto';",
    'router dto import',
)
if "@validate/templatePreview.schema" not in text:
    text = replace_once(
        text,
        "import { templateEditSchema } from '@validate/templateEdit.schema';",
        "import { templateEditSchema } from '@validate/templateEdit.schema';\nimport { templatePreviewSchema } from '@validate/templatePreview.schema';",
        'router preview schema import',
    )
if ".post(this.routerPath('preview')" not in text:
    insertion = r'''      .get(this.routerPath('capabilities'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<InstanceDto>({
            request: req,
            schema: instanceSchema,
            ClassRef: InstanceDto,
            execute: (instance) => templateController.capabilities(instance),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const errorResponse = createMetaErrorResponse(error, 'template_capabilities');
          res.status(errorResponse.status).json(errorResponse);
        }
      })
      .post(this.routerPath('preview'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<TemplatePreviewDto>({
            request: req,
            schema: templatePreviewSchema,
            ClassRef: TemplatePreviewDto,
            execute: (instance, data) => templateController.previewTemplate(instance, data),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const errorResponse = createMetaErrorResponse(error, 'template_preview');
          res.status(errorResponse.status).json(errorResponse);
        }
      })
'''
    text = replace_once(
        text,
        "      .get(this.routerPath('find'), ...guards, async (req, res) => {",
        insertion + "      .get(this.routerPath('find'), ...guards, async (req, res) => {",
        'router new endpoints',
    )
write(path, text)

# 7) Test planner behavior.
write('test/template-engine/provider-capabilities.test.ts', r'''import assert from 'node:assert/strict';

import { renderTemplateDefinition } from '../../src/api/services/template-renderer';
import {
  getProviderTemplateCapabilities,
  planTemplateTransport,
} from '../../src/api/services/template-transport-planner';

const utility = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Olá {{1}}. Confirme.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
          { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
        ],
      },
    ],
  },
  [],
  { '1': 'Wallace' },
);

const baileys = planTemplateTransport('WHATSAPP-BAILEYS', utility);
assert.equal(baileys.mode, 'POLL_COMPAT');
assert.equal(baileys.compatibilityTransport, 'BAILEYS_OFFICIAL_POLL');
assert.deepEqual(baileys.buttons.map((button) => button.transport), ['POLL_OPTION', 'POLL_OPTION']);
assert.equal(baileys.degraded, true);

const meta = planTemplateTransport('WHATSAPP-BUSINESS', utility);
assert.equal(meta.mode, 'PROVIDER_NATIVE');
assert.equal(meta.degraded, false);
assert.deepEqual(meta.buttons.map((button) => button.transport), ['NATIVE_BUTTON', 'NATIVE_BUTTON']);

const withUrl = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Acesse.' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'https://example.com' }] },
    ],
  },
  [],
  {},
);
const baileysUrl = planTemplateTransport('WHATSAPP-BAILEYS', withUrl);
assert.equal(baileysUrl.mode, 'TEXT_COMPAT');
assert.equal(baileysUrl.buttons[0]?.transport, 'TEXT_LINK');

const plain = renderTemplateDefinition({ components: [{ type: 'BODY', text: 'Somente texto.' }] }, [], {});
assert.equal(planTemplateTransport('WHATSAPP-BAILEYS', plain).mode, 'TEXT');

const capabilities = getProviderTemplateCapabilities('WHATSAPP-BAILEYS');
assert.equal(capabilities.quickReply, 'POLL_COMPAT');
assert.equal(capabilities.urlButton, 'TEXT_COMPAT');
assert.equal(getProviderTemplateCapabilities('WHATSAPP-BUSINESS').quickReply, 'NATIVE');

console.log('provider template capabilities: ok');
''')

# Add test to compatibility suite.
path = 'package.json'
pkg = json.loads(read(path))
compat = pkg['scripts']['test:compat']
needle = 'tsx ./test/template-engine/baileys-compat.test.ts'
extra = 'tsx ./test/template-engine/provider-capabilities.test.ts'
if extra not in compat:
    compat = compat.replace(needle, needle + ' && ' + extra)
pkg['scripts']['test:compat'] = compat
write(path, json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

# 8) Studio Phase 5 provider-aware preview.
write('manager/dist/assets/template-editor-phase5.js', r'''(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { timer: null, lastKey: '', lastPreview: null };

  function apiKey() { return String($('apiKeyInput')?.value || '').trim(); }
  function instanceName() { return String($('instanceSelect')?.value || '').trim(); }
  function parseJson(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[c]); }

  function components() {
    const result = [];
    const header = String($('headerInput')?.value || '').trim();
    const body = String($('bodyInput')?.value || '');
    const footer = String($('footerInput')?.value || '').trim();
    if (header) result.push({ type: 'HEADER', format: 'TEXT', text: header });
    if (body) result.push({ type: 'BODY', text: body });
    if (footer) result.push({ type: 'FOOTER', text: footer });

    const buttons = Array.from(document.querySelectorAll('#buttonEditor .button-row, #buttonEditor [data-button-index]')).map((row) => {
      const fields = row.querySelectorAll('input,select');
      const type = String(fields[0]?.value || 'QUICK_REPLY').toUpperCase();
      const text = String(fields[1]?.value || '').trim();
      const id = String(fields[2]?.value || '').trim();
      if (!text) return null;
      if (type === 'URL') return { type, text, url: id };
      if (type === 'PHONE_NUMBER') return { type, text, phone_number: id };
      if (type === 'COPY_CODE') return { type, text, example: id };
      return { type: 'QUICK_REPLY', text, id };
    }).filter(Boolean);
    if (buttons.length) result.push({ type: 'BUTTONS', buttons });
    return result;
  }

  function ensureCard() {
    let card = $('providerTransportPreview');
    if (card) return card;
    const panel = document.querySelector('.preview-panel');
    if (!panel) return null;
    card = document.createElement('section');
    card.id = 'providerTransportPreview';
    card.className = 'provider-transport-card';
    card.innerHTML = '<div class="provider-transport-title">Transporte real</div><div class="provider-transport-body">Conecte uma instância para visualizar.</div>';
    const help = panel.querySelector('.preview-help');
    panel.insertBefore(card, help || null);
    return card;
  }

  function previewPoll(rendered) {
    const options = (rendered.buttons || []).map((button) => `<div class="phase5-poll-option"><span class="phase5-radio"></span><span>${esc(button.displayText || button.title || '')}</span></div>`).join('');
    return `${rendered.title ? `<div class="preview-header">${esc(rendered.title)}</div>` : ''}<div class="preview-body phase5-poll-body">${esc(rendered.text || 'Escolha uma opção')}</div><div class="phase5-poll-label">Selecione uma opção</div>${options}${rendered.footer ? `<div class="preview-footer">${esc(rendered.footer)}</div>` : ''}`;
  }

  function previewTextCompat(rendered) {
    const lines = [];
    if (rendered.title) lines.push(rendered.title);
    if (rendered.text) lines.push(rendered.text);
    if (rendered.footer) lines.push(rendered.footer);
    if ((rendered.buttons || []).length) {
      lines.push((rendered.buttons || []).map((button) => {
        if (button.type === 'url') return `${button.displayText}: ${button.url || ''}`;
        if (button.type === 'call') return `${button.displayText}: ${button.phoneNumber || ''}`;
        if (button.type === 'copy') return `${button.displayText}: ${button.copyCode || ''}`;
        return `• ${button.displayText || ''}`;
      }).join('\n'));
    }
    return `<div class="preview-body phase5-text-compat">${esc(lines.filter(Boolean).join('\n\n'))}</div>`;
  }

  function applyPreview(data) {
    state.lastPreview = data;
    const transport = data?.transport || {};
    const rendered = data?.rendered || {};
    const card = ensureCard();
    if (card) {
      const warning = (transport.warnings || []).map((item) => `<div class="phase5-warning">${esc(item)}</div>`).join('');
      card.innerHTML = `<div class="provider-transport-title"><span>Transporte real</span><span class="phase5-badge">${esc(data.provider || 'UNKNOWN')}</span></div><div class="phase5-mode-row"><strong>${esc(transport.mode || 'UNKNOWN')}</strong>${transport.degraded ? '<span class="phase5-degraded">compatibilidade</span>' : '<span class="phase5-native">nativo</span>'}</div>${warning}`;
    }

    const message = $('messagePreview');
    if (!message) return;
    if (transport.mode === 'POLL_COMPAT') message.innerHTML = previewPoll(rendered);
    else if (transport.mode === 'TEXT_COMPAT') message.innerHTML = previewTextCompat(rendered);
    else {
      const buttons = (rendered.buttons || []).map((button) => `<div class="preview-button">${esc(button.displayText || '')}</div>`).join('');
      message.innerHTML = `${rendered.title ? `<div class="preview-header">${esc(rendered.title)}</div>` : ''}<div class="preview-body">${esc(rendered.text || '')}</div>${rendered.footer ? `<div class="preview-footer">${esc(rendered.footer)}</div>` : ''}${buttons}`;
    }
  }

  async function refresh() {
    const instance = instanceName();
    const key = apiKey();
    if (!instance || !key) { ensureCard(); return; }
    const body = {
      name: String($('nameInput')?.value || '').trim() || 'draft_template',
      language: String($('languageInput')?.value || 'pt_BR'),
      category: String($('categoryInput')?.value || 'UTILITY'),
      components: components(),
      variables: parseJson($('variablesInput')?.value, {}),
    };
    const signature = JSON.stringify([instance, body]);
    if (signature === state.lastKey) return;
    state.lastKey = signature;
    const response = await fetch(`/template/preview/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.response?.message || data?.message || `HTTP ${response.status}`);
    applyPreview(data);
  }

  function schedule() {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => refresh().catch((error) => {
      const card = ensureCard();
      if (card) card.querySelector('.provider-transport-body')?.remove();
      if (card) card.insertAdjacentHTML('beforeend', `<div class="phase5-warning">Preview indisponível: ${esc(error.message)}</div>`);
    }), 320);
  }

  ensureCard();
  ['nameInput','languageInput','categoryInput','headerInput','footerInput','bodyInput','variablesInput','instanceSelect','apiKeyInput'].forEach((id) => {
    const node = $(id); if (node) { node.addEventListener('input', schedule); node.addEventListener('change', schedule); }
  });
  $('connectButton')?.addEventListener('click', () => window.setTimeout(schedule, 650));
  $('refreshButton')?.addEventListener('click', () => window.setTimeout(schedule, 400));
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { if (tab.dataset.tab === 'content' || tab.dataset.tab === 'test') schedule(); }));
  const editor = $('buttonEditor');
  if (editor) new MutationObserver(schedule).observe(editor, { childList: true, subtree: true, attributes: true });
  window.setTimeout(schedule, 900);
})();
''')

# Load Phase5 script.
path = 'manager/dist/template-editor.html'
text = read(path)
if 'template-editor-phase5.js' not in text:
    text = replace_once(
        text,
        '    <script src="/assets/template-editor-phase4.js"></script>',
        '    <script src="/assets/template-editor-phase4.js"></script>\n    <script src="/assets/template-editor-phase5.js"></script>',
        'phase5 script tag',
    )
write(path, text)

# Append scoped responsive styles.
path = 'manager/dist/assets/template-editor.css'
text = read(path)
if '/* Phase 5 provider transport preview */' not in text:
    text += r'''

/* Phase 5 provider transport preview */
.provider-transport-card{margin:16px 0 8px;padding:14px;border:1px solid #d7e1f1;border-radius:14px;background:#f8fbff;font-size:12px;line-height:1.45}
.provider-transport-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:800;color:#1b2b48}.phase5-badge{padding:4px 7px;border-radius:999px;background:#e7f0ff;color:#1658c6;font-size:10px;font-weight:800}.phase5-mode-row{display:flex;align-items:center;gap:7px;margin-top:8px;flex-wrap:wrap}.phase5-degraded,.phase5-native{padding:3px 6px;border-radius:999px;font-size:10px;font-weight:800}.phase5-degraded{background:#fff2ce;color:#8a5b00}.phase5-native{background:#dcf8e7;color:#14733d}.phase5-warning{margin-top:8px;padding:8px 9px;border-radius:9px;background:#fff8e8;color:#735100;border:1px solid #f4dfab}.phase5-poll-label{margin:9px 0 3px;color:#667085;font-size:10px;font-weight:700}.phase5-poll-option{display:flex;align-items:center;gap:8px;padding:9px 3px;border-top:1px solid #e5e7eb;color:#172033}.phase5-radio{width:15px;height:15px;border:2px solid #7d8798;border-radius:50%;display:inline-block;flex:0 0 auto}.phase5-text-compat{white-space:pre-wrap}.phase5-poll-body{font-weight:600}
@media (max-width:1200px){.provider-transport-card{margin:10px 12px}.preview-panel .provider-transport-card{max-width:none}}
@media (max-width:820px){.provider-transport-card{margin:10px 0}.phase5-mode-row{align-items:flex-start}.provider-transport-title{align-items:flex-start}}
'''
write(path, text)

# 9) Docs.
write('docs/guides/provider-capabilities-preview.md', r'''# Provider Capabilities e Preview de Transporte — Fase 5

O Template do Connect|API permanece canônico e independente do provider. A Fase 5 torna explícita a diferença entre **contrato lógico** e **transporte visual**.

## Capabilities

`GET /template/capabilities/{instanceName}` informa como o provider da instância executa cada interação.

- `WHATSAPP-BUSINESS`: templates e botões provider-native.
- `WHATSAPP-BAILEYS`: QUICK_REPLY usa `POLL_COMPAT`; URL, telefone e copiar código usam `TEXT_COMPAT` quando não houver representação confiável no cliente.
- O catálogo de Templates, Actions e Recipes não muda quando o provider muda.

## Preview side-effect-free

`POST /template/preview/{instanceName}` recebe um template persistido ou um draft com `components` e `variables`. O endpoint **não envia mensagem, não cria sessão e não executa Action/Recipe**.

A resposta contém:

- provider;
- capabilities;
- conteúdo canônico renderizado;
- transporte planejado (`PROVIDER_NATIVE`, `TEXT`, `INTERACTIVE`, `POLL_COMPAT` ou `TEXT_COMPAT`);
- decisão por botão;
- warnings de degradação.

O Template Studio usa esse contrato para mostrar a aparência funcional esperada antes do envio. Assim um QUICK_REPLY pode continuar sendo um botão lógico `confirm`, ainda que em Baileys seja apresentado ao usuário como opção de um poll.
''')

print('Phase 5 materialized.')

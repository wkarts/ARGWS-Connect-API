(() => {
  'use strict';
  if (window.__ARGWS_CONVERSATIONAL_PHASE4_UI__) return;
  window.__ARGWS_CONVERSATIONAL_PHASE4_UI__ = true;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
  const pretty = (value) => { try { return JSON.stringify(value, null, 2); } catch { return String(value); } };
  const instance = () => String($('instanceSelect')?.value || '').trim();
  const apiKey = () => String($('apiKeyInput')?.value || '').trim();

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (apiKey()) headers.apikey = apiKey();
    let body = options.body;
    if (body !== undefined && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(path, { ...options, headers, body });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const detail = data?.response?.message || data?.error?.message || data?.message || text || `HTTP ${response.status}`;
      throw new Error(Array.isArray(detail) ? detail.join('; ') : String(detail));
    }
    return data;
  }

  function conciseError(value) {
    const raw = String(value?.message || value || 'Erro desconhecido').replace(/\s+/g, ' ').trim();
    return raw.length > 260 ? `${raw.slice(0, 257)}...` : raw;
  }

  function toast(message, error = false) {
    const node = $('toast');
    if (!node) return;
    node.textContent = error ? conciseError(message) : message;
    node.classList.toggle('error', error);
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3600);
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .phase4-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0 0 18px}
      .phase4-card{background:#fff;border:1px solid var(--border,#dbe3ef);border-radius:16px;padding:16px;box-shadow:0 6px 22px rgba(23,32,51,.05)}
      .phase4-card h3{margin:3px 0 4px;font-size:15px}.phase4-card p{margin:0 0 14px;color:var(--muted,#667085);font-size:12px;line-height:1.45}
      .phase4-fields{display:grid;gap:10px}.phase4-fields.two{grid-template-columns:1fr 1fr}.phase4-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .phase4-console{margin:12px 0 0;max-height:230px;overflow:auto;white-space:pre-wrap;background:#0f172a;color:#dbeafe;border-radius:12px;padding:11px;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
      .phase4-pending{display:grid;gap:8px;margin-top:12px}.phase4-pending-item{border:1px solid var(--border,#dbe3ef);border-radius:12px;padding:10px;background:#f8fafc}
      .phase4-pending-item strong{font-size:12px}.phase4-pending-item small{display:block;color:#667085;margin-top:4px}.phase4-pending-item .phase4-actions{margin-top:8px}
      .policy-state{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.policy-pill{font-size:10px;font-weight:800;border-radius:999px;padding:4px 8px;background:#eef4ff;color:#174ea6}
      @media(max-width:1360px){.phase4-grid{grid-template-columns:1fr 1fr}.phase4-card:last-child{grid-column:1/-1}}
      @media(max-width:900px){.phase4-grid{grid-template-columns:1fr}.phase4-card:last-child{grid-column:auto}.phase4-fields.two{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function injectUI() {
    const panel = document.querySelector('[data-panel="integrations"]');
    if (!panel || $('phase4PlatformPanel')) return;
    const wrapper = document.createElement('section');
    wrapper.id = 'phase4PlatformPanel';
    wrapper.innerHTML = `
      <div class="integration-hero">
        <div><span class="eyebrow">Conversational Platform · Fase 4</span><h3>Política Meta, pacotes oficiais e aprovações críticas</h3><p>Administre a simulação de janela, instale receitas prontas e aprove operações STRONG sem sair do Template Studio.</p></div>
        <button id="phase4ReloadButton" class="button secondary" type="button">Atualizar Fase 4</button>
      </div>
      <div class="phase4-grid">
        <article class="phase4-card">
          <span class="eyebrow">Meta Policy</span><h3>Janela de atendimento</h3><p>PERMISSIVE preserva compatibilidade, OBSERVE audita e STRICT simula bloqueios Meta no /graph.</p>
          <div class="phase4-fields two">
            <label><span>Modo</span><select id="phase4PolicyMode"><option>PERMISSIVE</option><option>OBSERVE</option><option>STRICT</option></select></label>
            <label><span>Janela (horas)</span><input id="phase4WindowHours" type="number" min="1" max="720" value="24" /></label>
          </div>
          <label class="toggle-line"><input id="phase4TemplateRequired" type="checkbox" checked /><span>Exigir template fora da janela</span></label>
          <div id="phase4PolicyState" class="policy-state"></div>
          <div class="phase4-actions"><button id="phase4SavePolicy" class="button primary" type="button">Salvar política</button></div>
          <div class="phase4-fields" style="margin-top:12px"><label><span>Inspecionar número</span><input id="phase4Recipient" placeholder="5575988881111" inputmode="tel" /></label></div>
          <div class="phase4-actions"><button id="phase4InspectWindow" class="button secondary" type="button">Ver janela</button></div>
          <pre id="phase4PolicyResult" class="phase4-console">Selecione uma instância.</pre>
        </article>

        <article class="phase4-card">
          <span class="eyebrow">Official Recipes</span><h3>Pacotes prontos</h3><p>Instale Actions, Recipes e templates oficiais sem gravar segredos no catálogo.</p>
          <div id="phase4PackageList" class="registry-list"><div class="empty">Carregando biblioteca...</div></div>
          <div class="phase4-fields">
            <label><span>Base URL da integração</span><input id="phase4PackageBaseUrl" placeholder="https://scheduler.exemplo.com/api/v1" /></label>
            <label><span>credentialRef</span><input id="phase4PackageCredential" value="SCHEDULER_PRO" placeholder="SCHEDULER_PRO" /></label>
          </div>
          <label class="toggle-line"><input id="phase4PackagePrivate" type="checkbox" /><span>Permitir rede privada para esta instalação</span></label>
          <div class="phase4-actions"><button id="phase4InstallPackage" class="button primary" type="button">Instalar pacote selecionado</button></div>
          <pre id="phase4PackageResult" class="phase4-console">Nenhuma instalação executada.</pre>
        </article>

        <article class="phase4-card">
          <span class="eyebrow">Strong Confirmation</span><h3>Aprovações críticas</h3><p>Exige API key global. Um token de instância pode operar templates, mas não autoriza ações STRONG.</p>
          <label><span>Identificação do aprovador</span><input id="phase4Actor" placeholder="admin@empresa / Wallace" /></label>
          <button id="phase4LoadPending" class="button secondary" type="button" style="margin-top:10px">Carregar pendências</button>
          <div id="phase4PendingList" class="phase4-pending"><div class="empty">Nenhuma consulta realizada.</div></div>
          <pre id="phase4StrongResult" class="phase4-console">Aguardando.</pre>
        </article>
      </div>`;
    const hero = panel.querySelector('.integration-hero');
    if (hero) panel.insertBefore(wrapper, hero);
    else panel.prepend(wrapper);
  }

  let selectedPackage = 'scheduler-pro';

  async function loadPolicy() {
    if (!instance()) return;
    const data = await api(`/compat/meta/${encodeURIComponent(instance())}`);
    const policy = data?.policy || {};
    $('phase4PolicyMode').value = policy.mode || 'PERMISSIVE';
    $('phase4WindowHours').value = String(Math.max(1, Math.round(Number(policy.windowSeconds || 86400) / 3600)));
    $('phase4TemplateRequired').checked = policy.templateRequiredOutsideWindow !== false;
    $('phase4PolicyState').innerHTML = [
      `<span class="policy-pill">${esc(policy.mode || 'PERMISSIVE')}</span>`,
      `<span class="policy-pill">${esc(policy.windowSeconds || 86400)}s</span>`,
      `<span class="policy-pill">Meta Compatible sempre ativo</span>`
    ].join('');
    $('phase4PolicyResult').textContent = pretty(data);
  }

  async function savePolicy() {
    if (!instance()) throw new Error('Selecione uma instância.');
    const payload = {
      policyMode: $('phase4PolicyMode').value,
      windowSeconds: Math.round(Number($('phase4WindowHours').value || 24) * 3600),
      templateRequiredOutsideWindow: $('phase4TemplateRequired').checked,
    };
    const data = await api(`/compat/meta/${encodeURIComponent(instance())}`, { method: 'PUT', body: payload });
    $('phase4PolicyResult').textContent = pretty(data);
    await loadPolicy();
    toast('Política Meta atualizada.');
  }

  async function inspectWindow() {
    const recipient = String($('phase4Recipient').value || '').replace(/\D/g, '');
    if (!instance() || !recipient) throw new Error('Selecione a instância e informe o número.');
    const data = await api(`/compat/meta/${encodeURIComponent(instance())}/window/${encodeURIComponent(recipient)}`);
    $('phase4PolicyResult').textContent = pretty(data);
  }

  async function loadPackages() {
    if (!instance()) return;
    const data = await api(`/recipe/library/${encodeURIComponent(instance())}`);
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    $('phase4PackageList').innerHTML = list.length ? list.map((item) => `
      <button class="registry-item${selectedPackage === item.packageKey ? ' active' : ''}" data-phase4-package="${esc(item.packageKey)}" type="button">
        <strong>${esc(item.name || item.packageKey)}</strong><span>v${esc(item.version)} · ${esc((item.actions || []).length)} actions · ${esc((item.recipes || []).length)} recipes</span>
      </button>`).join('') : '<div class="empty">Nenhum pacote oficial disponível.</div>';
    document.querySelectorAll('[data-phase4-package]').forEach((node) => node.addEventListener('click', () => {
      selectedPackage = node.dataset.phase4Package;
      loadPackages().catch((e) => toast(e.message, true));
    }));
  }

  async function installPackage() {
    if (!instance()) throw new Error('Selecione uma instância.');
    const baseUrl = String($('phase4PackageBaseUrl').value || '').trim();
    if (!baseUrl) throw new Error('Informe a Base URL da integração.');
    const payload = {
      packageKey: selectedPackage,
      baseUrl,
      credentialRef: String($('phase4PackageCredential').value || '').trim() || undefined,
      allowPrivateNetwork: $('phase4PackagePrivate').checked,
    };
    const data = await api(`/recipe/install/${encodeURIComponent(instance())}`, { method: 'POST', body: payload });
    $('phase4PackageResult').textContent = pretty(data);
    $('refreshButton')?.click();
    toast('Pacote oficial instalado na instância.');
  }

  async function loadPending() {
    if (!instance()) throw new Error('Selecione uma instância.');
    const data = await api(`/interaction/strong/pending/${encodeURIComponent(instance())}`);
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    $('phase4PendingList').innerHTML = list.length ? list.map((item) => `
      <div class="phase4-pending-item">
        <strong>${esc(item.templateName || 'Operação crítica')} · ${esc(item.strongBindingId || '')}</strong>
        <small>${esc(item.remoteJid || '')} · ${esc(item.id)}</small>
        <div class="phase4-actions">
          <button class="button primary" data-strong-approve="${esc(item.id)}" type="button">Aprovar</button>
          <button class="button danger" data-strong-reject="${esc(item.id)}" type="button">Rejeitar</button>
        </div>
      </div>`).join('') : '<div class="empty">Nenhuma operação STRONG aguardando aprovação.</div>';
    document.querySelectorAll('[data-strong-approve]').forEach((node) => node.addEventListener('click', () => decideStrong(node.dataset.strongApprove, true)));
    document.querySelectorAll('[data-strong-reject]').forEach((node) => node.addEventListener('click', () => decideStrong(node.dataset.strongReject, false)));
  }

  async function decideStrong(sessionId, approve) {
    try {
      const actor = String($('phase4Actor').value || '').trim();
      if (!actor) throw new Error('Informe quem está aprovando/rejeitando.');
      const reason = window.prompt(approve ? 'Motivo/observação da aprovação (opcional):' : 'Motivo da rejeição (opcional):', '') || undefined;
      const op = approve ? 'approve' : 'reject';
      const data = await api(`/interaction/strong/${op}/${encodeURIComponent(instance())}`, { method: 'POST', body: { sessionId, actor, reason } });
      $('phase4StrongResult').textContent = pretty(data);
      await loadPending();
      toast(approve ? 'Operação aprovada e processada.' : 'Operação rejeitada.');
    } catch (error) { toast(error.message, true); }
  }

  async function refreshAll() {
    if (!instance() || !apiKey()) return;
    await Promise.all([
      loadPolicy().catch((e) => { $('phase4PolicyResult').textContent = `ERRO\n${e.message}`; }),
      loadPackages().catch((e) => { $('phase4PackageResult').textContent = `ERRO\n${e.message}`; }),
    ]);
  }

  function bind() {
    $('phase4ReloadButton')?.addEventListener('click', () => refreshAll());
    $('phase4SavePolicy')?.addEventListener('click', () => savePolicy().catch((e) => toast(e.message, true)));
    $('phase4InspectWindow')?.addEventListener('click', () => inspectWindow().catch((e) => toast(e.message, true)));
    $('phase4InstallPackage')?.addEventListener('click', () => installPackage().catch((e) => toast(e.message, true)));
    $('phase4LoadPending')?.addEventListener('click', () => loadPending().catch((e) => { $('phase4StrongResult').textContent = `ERRO\n${e.message}`; toast(e.message, true); }));
    $('instanceSelect')?.addEventListener('change', () => setTimeout(refreshAll, 150));
    $('connectButton')?.addEventListener('click', () => setTimeout(refreshAll, 450));
    $('refreshButton')?.addEventListener('click', () => setTimeout(refreshAll, 250));
  }

  injectStyle();
  injectUI();
  bind();
  setTimeout(refreshAll, 600);
})();

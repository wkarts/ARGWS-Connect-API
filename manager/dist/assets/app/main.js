// src/core/dom.js
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && key !== "style") {
      try {
        node[key] = value;
      } catch {
        node.setAttribute(key, value);
      }
    } else node.setAttribute(key, String(value));
  });
  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}
var clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};
var card = (...children) => el("section", { class: "card" }, ...children);
var button = (label, options = {}) => el("button", { class: `btn ${options.class || ""}`.trim(), type: options.type || "button", disabled: options.disabled || false, onclick: options.onclick }, options.icon ? el("span", { class: "btn-icon", text: options.icon }) : null, label);
var field = (label, input2, hint) => el("label", { class: "field" }, el("span", { text: label }), input2, hint ? el("small", { text: hint }) : null);
var input = (value = "", attrs = {}) => el("input", { class: "input", value, ...attrs });
var textarea = (value = "", attrs = {}) => el("textarea", { class: "textarea", value, ...attrs });
var select = (value, options, attrs = {}) => {
  const node = el("select", { class: "input", ...attrs });
  options.forEach((option) => node.append(el("option", { value: option.value ?? option, text: option.label ?? option, selected: String(option.value ?? option) === String(value) })));
  return node;
};
var badge = (status) => el("span", { class: `status status-${String(status || "unknown").toLowerCase()}`, text: status || "desconhecido" });
var spinner = () => el("span", { class: "spinner" });
var alertBox = (message, kind = "error") => el("div", { class: `alert ${kind}`, text: message });
function modal(title, content) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const close = () => backdrop.remove();
  const dialog = el("div", { class: "modal" }, el("header", {}, el("h3", { text: title }), button("\xD7", { class: "icon-btn", onclick: close })), content);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.append(dialog);
  document.body.append(backdrop);
  return { close, element: backdrop };
}
function toggle(label, checked, onChange) {
  const btn = el("button", { class: `switch ${checked ? "on" : ""}`, type: "button", onclick: () => {
    checked = !checked;
    btn.classList.toggle("on", checked);
    onChange(checked);
  } }, el("span"));
  return el("label", { class: "toggle-row" }, btn, el("span", { text: label }));
}
function jsonEditor(value, onChange) {
  const error = el("small", { class: "error-text" });
  const area = textarea(JSON.stringify(value || {}, null, 2), { rows: 14 });
  area.addEventListener("input", () => {
    try {
      const parsed = JSON.parse(area.value);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      error.textContent = "";
      onChange(parsed);
    } catch {
      error.textContent = "JSON inv\xE1lido";
    }
  });
  return field("JSON avan\xE7ado", el("div", {}, area, error));
}

// src/core/router.js
var renderer = null;
function setRenderer(fn) {
  renderer = fn;
}
function navigate(path, replace = false) {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  renderer?.();
}
function installRouter() {
  window.addEventListener("popstate", () => renderer?.());
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[data-nav]");
    if (!anchor) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(anchor.getAttribute("href"));
  });
}
function link(label, href, className = "") {
  const a = document.createElement("a");
  a.href = href;
  a.dataset.nav = "1";
  a.className = className;
  a.textContent = label;
  return a;
}

// src/core/session.js
var KEYS = {
  apiUrl: "apiUrl",
  token: "token",
  version: "version",
  clientName: "clientName",
  documentationUrl: "documentationUrl",
  instanceId: "instanceId",
  instanceName: "instanceName",
  instanceToken: "instanceToken",
  locale: "managerLocale",
  theme: "managerTheme"
};
var normalizeUrl = (value) => {
  const raw2 = String(value || "").trim();
  if (!raw2) return "";
  try {
    const url = new URL(raw2);
    if (/^\/manager(?:\/|$)/.test(url.pathname)) url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw2.replace(/\/+$/, "");
  }
};
function loadSession() {
  const apiUrl = localStorage.getItem(KEYS.apiUrl) || "";
  const apiKey = localStorage.getItem(KEYS.token) || "";
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey, version: localStorage.getItem(KEYS.version) || "", clientName: localStorage.getItem(KEYS.clientName) || "", documentationUrl: localStorage.getItem(KEYS.documentationUrl) || "" };
}
function saveSession(session) {
  localStorage.setItem(KEYS.apiUrl, normalizeUrl(session.apiUrl));
  localStorage.setItem(KEYS.token, String(session.apiKey || "").trim());
  if (session.version) localStorage.setItem(KEYS.version, session.version);
  if (session.clientName) localStorage.setItem(KEYS.clientName, session.clientName);
  session.documentationUrl ? localStorage.setItem(KEYS.documentationUrl, session.documentationUrl) : localStorage.removeItem(KEYS.documentationUrl);
}
function clearSession() {
  Object.values(KEYS).slice(0, 8).forEach((key) => localStorage.removeItem(key));
}
function saveSelectedInstance(instance) {
  localStorage.setItem(KEYS.instanceId, instance.id || "");
  localStorage.setItem(KEYS.instanceName, instance.name || "");
  localStorage.setItem(KEYS.instanceToken, instance.token || "");
}
function loadSelectedInstance() {
  const id = localStorage.getItem(KEYS.instanceId) || "";
  const name = localStorage.getItem(KEYS.instanceName) || "";
  const token = localStorage.getItem(KEYS.instanceToken) || "";
  return id || name ? { id, instanceId: id, name, instanceName: name, token } : null;
}
function getTheme() {
  return localStorage.getItem(KEYS.theme) === "dark" ? "dark" : "light";
}
function setTheme(theme) {
  localStorage.setItem(KEYS.theme, theme);
  document.documentElement.dataset.theme = theme;
}
function getLocale() {
  return localStorage.getItem(KEYS.locale) || "";
}
function setLocale(locale) {
  localStorage.setItem(KEYS.locale, locale);
}

// src/api/client.js
var ApiError = class extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
};
function messageFrom(data, fallback) {
  const value = data?.response?.message ?? data?.message ?? data?.error ?? fallback;
  return Array.isArray(value) ? value.join(", ") : String(value || fallback || "Erro na comunica\xE7\xE3o com a API");
}
async function rawRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw new ApiError(messageFrom(data, response.statusText), response.status, data);
  return data;
}
async function fetchRoot(apiUrl) {
  return rawRequest(`${apiUrl.replace(/\/$/, "")}/`, { signal: AbortSignal.timeout(15e3) });
}
async function verifyCredentials(apiUrl, apiKey) {
  return rawRequest(`${apiUrl.replace(/\/$/, "")}/verify-creds`, { method: "POST", headers: { apikey: apiKey }, signal: AbortSignal.timeout(15e3) });
}
async function request(session, path, { method = "GET", data, params, headers = {}, timeout = 3e4 } = {}, instanceToken = "") {
  const url = new URL(`${session.apiUrl}${path}`);
  if (params) Object.entries(params).forEach(([key, value]) => value != null && url.searchParams.set(key, String(value)));
  const config = { method, headers: { apikey: instanceToken || session.apiKey, ...headers }, signal: AbortSignal.timeout(timeout) };
  if (data !== void 0) {
    config.body = JSON.stringify(data);
    config.headers["content-type"] = config.headers["content-type"] || "application/json";
  }
  return rawRequest(url.toString(), config);
}
async function requestForm(session, path, formData, { params, timeout = 6e4 } = {}, instanceToken = "") {
  const url = new URL(`${session.apiUrl}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, String(value));
    });
  }
  return rawRequest(url.toString(), {
    method: "POST",
    headers: { apikey: instanceToken || session.apiKey },
    body: formData,
    signal: AbortSignal.timeout(timeout)
  });
}

// src/api/instances.js
async function fetchInstances(session, instanceId = "") {
  const data = await request(session, "/instance/fetchInstances", { params: instanceId ? { instanceId } : void 0 });
  return Array.isArray(data) ? data : data ? [data] : [];
}
var createInstance = (session, data) => request(session, "/instance/create", { method: "POST", data });
var deleteInstance = (session, instance) => request(session, `/instance/delete/${encodeURIComponent(instance.name)}`, { method: "DELETE" }, instance.token || "");
var logoutInstance = (session, instance) => request(session, `/instance/logout/${encodeURIComponent(instance.name)}`, { method: "DELETE" }, instance.token);
var restartInstance = (session, instance) => request(session, `/instance/restart/${encodeURIComponent(instance.name)}`, { method: "POST" }, instance.token);
var connectInstance = (session, instance, pairing = false) => request(session, `/instance/connect/${encodeURIComponent(instance.name)}`, { params: pairing && instance.number ? { number: instance.number } : void 0 }, instance.token);

// src/core/runtime-config.js
var allowedLocales = ["pt-BR", "en-US", "es-ES", "fr-FR"];
var raw = window.__CONNECT_MANAGER_CONFIG__ || {};
var extraLocalesEnabled = raw.locale?.extraLocalesEnabled === true;
var requestedLocales = Array.isArray(raw.locale?.enabledLocales) ? raw.locale.enabledLocales : [];
var enabledLocales = extraLocalesEnabled ? [.../* @__PURE__ */ new Set(["pt-BR", ...requestedLocales.filter((locale) => allowedLocales.includes(locale))])] : ["pt-BR"];
var requestedDefault = raw.locale?.defaultLocale;
var defaultLocale = extraLocalesEnabled && enabledLocales.includes(requestedDefault) ? requestedDefault : "pt-BR";
var runtimeConfig = Object.freeze({
  apiUrl: String(raw.apiUrl || "").trim().replace(/\/$/, ""),
  documentationUrl: String(raw.documentationUrl || "").trim(),
  locale: Object.freeze({ primaryLocale: "pt-BR", defaultLocale, extraLocalesEnabled, enabledLocales })
});

// src/pages/login.js
function renderLogin() {
  const server = input(runtimeConfig.apiUrl || window.location.origin, {
    type: "url",
    required: true,
    placeholder: "https://api.exemplo.com.br"
  });
  const key = input("", { type: "password", required: true });
  const error = el("div");
  const submit = button("Entrar", { class: "primary full", type: "submit" });
  const form = el(
    "form",
    { class: "form-stack" },
    field("Servidor", server),
    field("Chave da API", key),
    error,
    submit
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.replaceChildren(spinner(), "Validando...");
    error.replaceChildren();
    try {
      const apiUrl = normalizeUrl(server.value);
      const apiKey = String(key.value || "").trim();
      if (!apiUrl) throw new Error("Informe o endere\xE7o da API.");
      if (!apiKey) throw new Error("Informe a chave da API.");
      await verifyCredentials(apiUrl, apiKey);
      const session = {
        apiUrl,
        apiKey,
        version: "",
        clientName: "Connect|API",
        documentationUrl: runtimeConfig.documentationUrl || ""
      };
      saveSession(session);
      navigate("/manager/");
      void fetchRoot(apiUrl).then((root2) => {
        saveSession({
          ...session,
          version: root2?.version || "",
          clientName: root2?.clientName || "Connect|API",
          documentationUrl: runtimeConfig.documentationUrl || root2?.documentation || ""
        });
      }).catch(() => void 0);
    } catch (err) {
      error.replaceChildren(alertBox(err?.message || String(err)));
    } finally {
      submit.disabled = false;
      submit.textContent = "Entrar";
    }
  };
  return el(
    "div",
    { class: "login-page" },
    el(
      "div",
      { class: "login-wrap" },
      el("img", {
        class: "login-logo",
        src: "/assets/images/argws-connect-logo-horizontal.svg",
        alt: "Connect|API"
      }),
      card(
        el("h1", { text: "Acessar Manager" }),
        el("p", { class: "muted", text: "Informe o endere\xE7o da API e a chave de acesso." }),
        form
      )
    )
  );
}

// src/components/shell.js
function header(instance) {
  const session = loadSession();
  const theme = getTheme();
  const container = el("header", { class: "topbar" });
  const brand = el(
    "a",
    { class: "brand", href: "/manager/", dataset: { nav: "1" } },
    el("img", {
      src: theme === "dark" ? "/assets/images/argws-connect-logo-dark.svg" : "/assets/images/argws-connect-logo-horizontal.svg",
      alt: "Connect|API"
    })
  );
  container.append(
    brand,
    el(
      "div",
      { class: "topbar-meta" },
      instance ? el("span", { class: "instance-pill", text: instance.name }) : null,
      el("span", { class: "version-pill", text: `v${session?.version || "\u2014"}` })
    ),
    el("div", { class: "topbar-spacer" })
  );
  const actions = el("div", { class: "topbar-actions" });
  if (runtimeConfig.locale.extraLocalesEnabled && runtimeConfig.locale.enabledLocales.length > 1) {
    const current = getLocale() || runtimeConfig.locale.defaultLocale;
    const selector = el("select", { class: "input compact" });
    runtimeConfig.locale.enabledLocales.forEach(
      (locale) => selector.append(el("option", { value: locale, text: locale, selected: locale === current }))
    );
    selector.onchange = () => {
      setLocale(selector.value);
      location.reload();
    };
    actions.append(selector);
  }
  actions.append(
    button(theme === "dark" ? "\u2600" : "\u263E", {
      class: "icon-btn",
      onclick: () => {
        setTheme(theme === "dark" ? "light" : "dark");
        location.reload();
      }
    }),
    button("\u21AA", {
      class: "icon-btn danger",
      onclick: () => {
        clearSession();
        navigate("/manager/login");
      }
    })
  );
  container.append(actions);
  return container;
}
function navigationGroups(instance) {
  const principal = [
    ["Vis\xE3o geral", "dashboard", "\u25EB"],
    ["Chat", "chat", "\u25C9"]
  ];
  if (instance.integration === "WHATSAPP-ZAPO") {
    principal.push(["Chamadas WhatsApp", "calls", "\u260E"], ["VoIP", "voip", "\u25CD"]);
  }
  return [
    ["Principal", principal],
    ["Configura\xE7\xF5es", [["Comportamento", "settings", "\u2699"], ["Proxy", "proxy", "\u21C4"]]],
    ["Eventos", [["Webhook", "webhook", "\u2301"], ["WebSocket", "websocket", "\u25CC"], ["RabbitMQ", "rabbitmq", "\u25A4"], ["SQS", "sqs", "\u25A6"]]],
    ["Integra\xE7\xF5es", [["Chatwoot", "chatwoot", "\u2318"], ["Typebot", "typebot", "\u25C6"], ["OpenAI", "openai", "\u25C6"], ["Dify", "dify", "\u25C6"], ["n8n", "n8n", "\u25C6"], ["ConnectAI", "connectAI", "\u25C6"], ["ConnectBot", "connectBot", "\u25C6"], ["Flowise", "flowise", "\u25C6"]]]
  ];
}
function sidebar(instance, active) {
  const session = loadSession();
  const aside = el("aside", { class: "sidebar" });
  navigationGroups(instance).forEach(([title, items]) => {
    const section = el("section", {}, el("h4", { text: title }));
    items.forEach(([label, path, icon]) => {
      const a = link(
        "",
        `/manager/instance/${instance.id || instance.instanceId}/${path}`,
        `nav-item ${active === path ? "active" : ""}`
      );
      a.append(el("span", { class: "nav-icon", text: icon }), el("span", { text: label }));
      section.append(a);
    });
    aside.append(section);
  });
  const docs = runtimeConfig.documentationUrl || session?.documentationUrl;
  if (docs) {
    aside.append(
      el(
        "a",
        { class: "nav-item docs-link", href: docs, target: "_blank", rel: "noreferrer" },
        el("span", { text: "\u2197" }),
        el("span", { text: "Documenta\xE7\xE3o" })
      )
    );
  }
  return aside;
}
function pageHeader(title, description, actions = []) {
  return el(
    "div",
    { class: "page-header" },
    el("div", {}, el("h1", { text: title }), el("p", { text: description || "" })),
    el("div", { class: "actions" }, ...actions)
  );
}
function managerShell(content) {
  return el("div", { class: "app" }, header(), el("main", { class: "manager-main" }, content));
}
function instanceShell(instance, active, content) {
  return el(
    "div",
    { class: "app" },
    header(instance),
    el("div", { class: "instance-layout" }, sidebar(instance, active), el("main", { class: "instance-main" }, content))
  );
}

// src/pages/instances.js
function generateToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function statistic(value, label) {
  return el("span", {}, el("strong", { text: Number(value || 0).toLocaleString("pt-BR") }), label);
}
function instanceIdOf(instance) {
  return instance.id || instance.instanceId || "";
}
function secretInput(value) {
  const control = input(value, { required: true, autocomplete: "off", type: "password" });
  const toggle2 = button("Mostrar", {
    class: "secret-toggle",
    onclick: () => {
      const reveal = control.type === "password";
      control.type = reveal ? "text" : "password";
      toggle2.textContent = reveal ? "Ocultar" : "Mostrar";
    }
  });
  return { control, node: el("div", { class: "secret-field" }, control, toggle2) };
}
function renderInstances() {
  const session = loadSession();
  const page = el("div", { class: "page" });
  const grid = el("div", { class: "instance-grid" });
  const emptyState = el("div", { class: "instance-empty-state" });
  const feedback = el("div");
  const search = input("", { placeholder: "Buscar inst\xE2ncia" });
  let items = [];
  async function reload() {
    emptyState.replaceChildren();
    grid.replaceChildren(el("div", { class: "center" }, spinner()));
    feedback.replaceChildren();
    try {
      items = await fetchInstances(session);
      draw();
    } catch (error) {
      grid.replaceChildren();
      emptyState.replaceChildren();
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }
  function drawEmpty(title, description, action = null) {
    grid.hidden = true;
    emptyState.hidden = false;
    emptyState.replaceChildren(
      el("div", { class: "empty-state-icon", text: "+" }),
      el("strong", { text: title }),
      el("span", { text: description }),
      action
    );
  }
  function draw() {
    const term = search.value.trim().toLowerCase();
    const visible = items.filter(
      (item) => String(item.name || item.instanceName || "").toLowerCase().includes(term)
    );
    grid.replaceChildren();
    emptyState.replaceChildren();
    if (!items.length) {
      drawEmpty(
        "Nenhuma conex\xE3o configurada",
        "Crie sua primeira inst\xE2ncia para come\xE7ar.",
        button("Nova inst\xE2ncia", { class: "primary", onclick: openCreate })
      );
      return;
    }
    if (!visible.length) {
      drawEmpty("Nenhum resultado", "Nenhuma inst\xE2ncia corresponde \xE0 busca atual.");
      return;
    }
    grid.hidden = false;
    emptyState.hidden = true;
    visible.forEach((item) => {
      const id = instanceIdOf(item);
      const name = item.name || item.instanceName || id;
      const identity = item.profilePicUrl ? el("img", { class: "instance-avatar", src: item.profilePicUrl, alt: "" }) : el("div", { class: "instance-avatar fallback", text: name[0]?.toUpperCase() || "?" });
      const manage = button("Gerenciar", {
        class: "primary",
        disabled: !id,
        onclick: () => id && navigate(`/manager/instance/${encodeURIComponent(id)}/dashboard`)
      });
      const remove = button("Excluir", {
        class: "danger",
        onclick: async () => {
          if (!window.confirm(`Excluir definitivamente ${name}?`)) return;
          remove.disabled = true;
          try {
            await deleteInstance(session, { ...item, name });
            items = items.filter((candidate) => instanceIdOf(candidate) !== id && candidate.name !== name);
            draw();
            feedback.replaceChildren(alertBox("Inst\xE2ncia e dados associados removidos.", "success"));
          } catch (error) {
            feedback.replaceChildren(alertBox(error.message || String(error)));
            remove.disabled = false;
          }
        }
      });
      grid.append(
        card(
          el(
            "div",
            { class: "instance-card-head" },
            el(
              "div",
              { class: "instance-identity" },
              identity,
              el(
                "div",
                {},
                el("h3", { text: name }),
                el("span", {
                  class: "muted",
                  text: item.profileName || item.number || item.integration || "Sem perfil conectado"
                })
              )
            ),
            badge(item.connectionStatus)
          ),
          el(
            "div",
            { class: "stats" },
            statistic(item._count?.Contact, "contatos"),
            statistic(item._count?.Chat, "chats"),
            statistic(item._count?.Message, "mensagens")
          ),
          el("div", { class: "card-actions" }, manage, remove)
        )
      );
    });
  }
  function openCreate() {
    const name = input("", { required: true, autocomplete: "off" });
    const integration = select("WHATSAPP-BAILEYS", [
      { value: "WHATSAPP-BAILEYS", label: "WhatsApp (Baileys)" },
      { value: "WHATSAPP-ZAPO", label: "WhatsApp (Zapo)" },
      { value: "WHATSAPP-BUSINESS", label: "WhatsApp Business / Cloud" }
    ]);
    const generated = secretInput(generateToken());
    const token = generated.control;
    const number = input("", {
      type: "tel",
      placeholder: "5575999999999",
      inputmode: "numeric",
      autocomplete: "off"
    });
    const businessId = input("", { autocomplete: "off" });
    const businessField = field("Business ID", businessId, "Usado somente pelo WhatsApp Business / Cloud.");
    const syncProviderFields = () => {
      const isBusiness = integration.value === "WHATSAPP-BUSINESS";
      businessField.hidden = !isBusiness;
      businessId.required = isBusiness;
    };
    integration.addEventListener("change", syncProviderFields);
    syncProviderFields();
    const formFeedback = el("div");
    const form = el(
      "form",
      { class: "form-stack" },
      formFeedback,
      field("Nome", name),
      field("Canal", integration),
      field("Token da inst\xE2ncia", generated.node, "UUID seguro gerado automaticamente; pode ser personalizado."),
      field("N\xFAmero", number, "Opcional para Baileys/Zapo; DDI + DDD + n\xFAmero."),
      businessField,
      button("Criar inst\xE2ncia", { class: "primary", type: "submit" })
    );
    const dialog = modal("Nova inst\xE2ncia", form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      formFeedback.replaceChildren();
      const instanceName2 = name.value.trim();
      if (!instanceName2) return;
      try {
        const payload = {
          instanceName: instanceName2,
          integration: integration.value,
          token: token.value.trim()
        };
        const normalizedNumber = number.value.replace(/\D/g, "");
        if (normalizedNumber) payload.number = normalizedNumber;
        if (integration.value === "WHATSAPP-BUSINESS") {
          const value = businessId.value.trim();
          if (value) payload.businessId = value;
        }
        await createInstance(session, payload);
        dialog.close();
        feedback.replaceChildren(alertBox("Inst\xE2ncia criada.", "success"));
        await reload();
      } catch (error) {
        formFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
  }
  page.append(
    pageHeader("Inst\xE2ncias", "Gerencie as conex\xF5es dispon\xEDveis nesta API.", [
      button("Atualizar", { onclick: reload }),
      button("Nova inst\xE2ncia", { class: "primary", onclick: openCreate })
    ]),
    el("div", { class: "toolbar" }, el("div", { class: "search-box" }, "\u2315", search)),
    feedback,
    emptyState,
    grid
  );
  search.addEventListener("input", draw);
  void reload();
  return managerShell(page);
}

// src/pages/dashboard.js
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function tokenControl(value) {
  let visible = false;
  const code = el("code", { class: "token-line secret", text: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" });
  const toggle2 = button("Mostrar", {
    onclick: () => {
      visible = !visible;
      code.textContent = visible ? value || "" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      toggle2.textContent = visible ? "Ocultar" : "Mostrar";
    }
  });
  const copy = button("Copiar", {
    onclick: async () => {
      await navigator.clipboard.writeText(value || "");
      copy.textContent = "Copiado";
      setTimeout(() => copy.textContent = "Copiar", 1200);
    }
  });
  return el("div", { class: "token-control" }, code, el("div", { class: "actions" }, toggle2, copy));
}
function renderDashboard(instance, reloadInstance) {
  const session = loadSession();
  const page = el("div", { class: "page" });
  const error = el("div");
  const instanceId = instance.id || instance.instanceId;
  async function watchConnection(dialog) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (!document.body.contains(dialog.element)) return;
      await sleep(1500);
      try {
        const fresh = (await fetchInstances(session, instanceId))[0];
        if (fresh?.connectionStatus === "open") {
          dialog.close();
          await reloadInstance();
          return;
        }
      } catch {
      }
    }
  }
  async function run(kind) {
    error.replaceChildren();
    try {
      if (kind === "restart") {
        await restartInstance(session, instance);
        await reloadInstance();
        return;
      }
      if (kind === "logout") {
        await logoutInstance(session, instance);
        await reloadInstance();
        return;
      }
      if (kind === "qr") {
        const data = await connectInstance(session, instance, false);
        const dialog = showQr(data);
        void watchConnection(dialog);
        return;
      }
      if (kind === "pair") {
        const data = await connectInstance(session, instance, true);
        const dialog = showPair(data);
        void watchConnection(dialog);
      }
    } catch (e) {
      error.replaceChildren(alertBox(e.message || String(e)));
    }
  }
  function showQr(data) {
    const code = data?.base64 || data?.qrcode?.base64 || data?.code || data?.qrcode?.code || "";
    const content = el("div", { class: "qr-wrap" });
    if (String(code).startsWith("data:image")) content.append(el("img", { src: code, alt: "QR Code" }));
    else content.append(el("pre", { class: "qr-text", text: code || "QR Code n\xE3o retornado pela API" }));
    return modal("QR Code", content);
  }
  function showPair(data) {
    const code = data?.pairingCode || data?.qrcode?.pairingCode || data?.code || "";
    return modal("C\xF3digo de pareamento", el("div", { class: "pairing-code", text: code || "C\xF3digo n\xE3o retornado" }));
  }
  const picture = instance.profilePicUrl ? el("img", { class: "profile-avatar", src: instance.profilePicUrl, alt: "" }) : el("div", {
    class: "profile-avatar fallback",
    text: (instance.profileName || instance.name || "?")[0].toUpperCase()
  });
  page.append(
    el(
      "div",
      { class: "profile-heading" },
      picture,
      pageHeader(instance.name, instance.profileName || instance.ownerJid || "Aguardando conex\xE3o", [
        badge(instance.connectionStatus)
      ])
    ),
    error,
    card(
      el(
        "div",
        { class: "dashboard-row" },
        el(
          "div",
          { class: "token-section" },
          el("span", { class: "muted", text: "Token da inst\xE2ncia" }),
          tokenControl(instance.token || "")
        ),
        el(
          "div",
          { class: "actions" },
          button("Atualizar", { onclick: reloadInstance }),
          button("Reiniciar", { onclick: () => run("restart") }),
          button("Desconectar", { class: "danger", onclick: () => run("logout") })
        )
      ),
      instance.connectionStatus !== "open" ? el(
        "div",
        { class: "connect-panel" },
        el("strong", { text: "Conecte o WhatsApp desta inst\xE2ncia" }),
        el(
          "div",
          { class: "actions" },
          button("Gerar QR Code", { class: "primary", onclick: () => run("qr") }),
          instance.number ? button("C\xF3digo de pareamento", { onclick: () => run("pair") }) : null
        )
      ) : null
    ),
    el(
      "div",
      { class: "metric-grid" },
      metric("Contatos", instance._count?.Contact, "\u2637"),
      metric("Chats", instance._count?.Chat, "\u25C9"),
      metric("Mensagens", instance._count?.Message, "\u2709")
    )
  );
  return instanceShell(instance, "dashboard", page);
}
function metric(label, value, icon) {
  return card(
    el("span", { class: "metric-icon", text: icon }),
    el("strong", { text: Number(value || 0).toLocaleString("pt-BR") }),
    el("span", { text: label })
  );
}

// src/api/chat.js
async function findChats(session, instance) {
  const data = await request(
    session,
    `/chat/findChats/${encodeURIComponent(instance.name)}`,
    { method: "POST", data: { where: {} } },
    instance.token
  );
  return Array.isArray(data) ? data : data ? data.records || data : [];
}
async function findMessages(session, instance, remoteJid) {
  const data = await request(
    session,
    `/chat/findMessages/${encodeURIComponent(instance.name)}`,
    { method: "POST", data: { where: { key: { remoteJid } } } },
    instance.token
  );
  return data?.messages?.records || (Array.isArray(data) ? data : []);
}
async function fetchProfilePicture(session, instance, remoteJid) {
  const number = String(remoteJid || "").replace(/@.+$/, "");
  if (!number) return null;
  return request(
    session,
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(instance.name)}`,
    { method: "POST", data: { number } },
    instance.token
  );
}
var sendText = (session, instance, remoteJid, text) => request(
  session,
  `/message/sendText/${encodeURIComponent(instance.name)}`,
  { method: "POST", data: { number: remoteJid.replace(/@.+$/, ""), text } },
  instance.token
);
async function sendMedia(session, instance, remoteJid, file, caption = "") {
  const type = String(file.type || "").split("/")[0];
  const mediatype = ["image", "video", "audio"].includes(type) ? type : "document";
  const form = new FormData();
  form.set("file", file, file.name || "arquivo");
  form.set("number", remoteJid.replace(/@.+$/, ""));
  form.set("mediatype", mediatype);
  form.set("mimetype", file.type || "application/octet-stream");
  form.set("fileName", file.name || "arquivo");
  if (caption) form.set("caption", caption);
  return requestForm(
    session,
    `/message/sendMedia/${encodeURIComponent(instance.name || instance.instanceName)}`,
    form,
    {},
    instance.token
  );
}

// src/pages/chat.js
function rawChatJid(chat) {
  return chat?.remoteJid || chat?.id || chat?.key?.remoteJid || "";
}
function chatAltJid(chat) {
  return chat?.remoteJidAlt || chat?.lastMessage?.key?.remoteJidAlt || chat?.key?.remoteJidAlt || "";
}
function canonicalJid(chat) {
  const raw2 = rawChatJid(chat);
  const alt = chatAltJid(chat);
  return raw2.endsWith("@lid") && alt && !alt.endsWith("@lid") ? alt : raw2;
}
function chatName(chat) {
  const jid = canonicalJid(chat);
  return chat?.pushName || chat?.name || jid.split("@")[0] || "Conversa";
}
function messageText(message) {
  const payload = message?.message || {};
  return payload.conversation || payload.extendedTextMessage?.text || payload.imageMessage?.caption || (payload.imageMessage ? "\u{1F4F7} Imagem" : "") || payload.videoMessage?.caption || (payload.videoMessage ? "\u{1F3A5} V\xEDdeo" : "") || payload.documentMessage?.fileName || (payload.audioMessage ? "\u{1F3A4} \xC1udio" : "") || message?.messageType || "[m\xEDdia]";
}
function messageTimestamp(message) {
  const value = Number(message?.messageTimestamp || message?.timestamp || 0);
  if (!value) return "";
  const date = new Date(value > 1e10 ? value : value * 1e3);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
function renderChat(instance, initialJid = "", { embedded = false } = {}) {
  const session = loadSession();
  const layout = el("div", { class: "chat-layout whatsapp-like" });
  const list = el("aside", { class: "chat-list" });
  const conversation = el("section", { class: "conversation" });
  const aliases = /* @__PURE__ */ new Map();
  const avatarCache = /* @__PURE__ */ new Map();
  let chats = [];
  let selected = initialJid;
  let polling;
  let loadingChats = false;
  let loadingMessages = false;
  function registerAliases(chat) {
    const canonical = canonicalJid(chat);
    if (!canonical) return;
    const set = aliases.get(canonical) || /* @__PURE__ */ new Set();
    [rawChatJid(chat), chatAltJid(chat), canonical].filter(Boolean).forEach((jid) => set.add(jid));
    aliases.set(canonical, set);
  }
  function dedupeChats(rows) {
    const map = /* @__PURE__ */ new Map();
    rows.forEach((chat) => {
      registerAliases(chat);
      const jid = canonicalJid(chat);
      if (!jid) return;
      const current = map.get(jid);
      if (!current || new Date(chat.updatedAt || 0) > new Date(current.updatedAt || 0)) map.set(jid, chat);
    });
    return [...map.values()];
  }
  function avatar(chat, size = "") {
    const jid = canonicalJid(chat);
    const name = chatName(chat);
    const node = el("div", { class: `avatar ${size}`.trim(), text: name[0]?.toUpperCase() || "?" });
    if (!jid || jid.endsWith("@g.us") || jid.endsWith("@lid")) return node;
    const cached = avatarCache.get(jid);
    if (cached) {
      node.replaceChildren(el("img", { src: cached, alt: "" }));
      return node;
    }
    void fetchProfilePicture(session, instance, jid).then((data) => {
      const url = data?.profilePictureUrl || data?.url || data?.profilePicture?.url;
      if (url && document.body.contains(node)) {
        avatarCache.set(jid, url);
        node.replaceChildren(el("img", { src: url, alt: "" }));
      }
    }).catch(() => void 0);
    return node;
  }
  async function loadChats({ silent = false } = {}) {
    if (loadingChats) return;
    loadingChats = true;
    if (!silent) {
      list.replaceChildren(
        el("div", { class: "chat-list-head" }, el("strong", { text: "Conversas" })),
        el("div", { class: "center" }, spinner())
      );
    }
    try {
      chats = dedupeChats(await findChats(session, instance));
      drawChats();
    } catch (error) {
      if (!silent) list.append(alertBox(error.message || String(error)));
    } finally {
      loadingChats = false;
    }
  }
  function drawChats() {
    const search = input("", { placeholder: "Pesquisar ou iniciar nova conversa" });
    const rows = el("div", { class: "chat-rows" });
    const header2 = el(
      "div",
      { class: "chat-list-toolbar" },
      el("strong", { text: "Conversas" }),
      button("\u21BB", { class: "icon-btn", onclick: () => loadChats() })
    );
    const drawRows = () => {
      const term = search.value.trim().toLowerCase();
      rows.replaceChildren();
      const visible = chats.filter((chat) => `${chatName(chat)} ${canonicalJid(chat)}`.toLowerCase().includes(term));
      if (!visible.length) {
        rows.append(el("div", { class: "empty small" }, el("span", { text: "Nenhuma conversa." })));
        return;
      }
      visible.forEach((chat) => {
        const jid = canonicalJid(chat);
        const preview = messageText(chat.lastMessage || {});
        const row = el(
          "button",
          {
            class: `chat-row ${selected === jid ? "active" : ""}`,
            onclick: () => {
              selected = jid;
              history.replaceState(
                {},
                "",
                embedded ? `/manager/embed-chat/${encodeURIComponent(jid)}` : `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/chat/${encodeURIComponent(jid)}`
              );
              drawChats();
              void loadMessages();
            }
          },
          avatar(chat),
          el(
            "div",
            { class: "chat-row-body" },
            el(
              "div",
              { class: "chat-row-top" },
              el("strong", { text: chatName(chat) }),
              el("small", { text: messageTimestamp(chat.lastMessage) })
            ),
            el(
              "div",
              { class: "chat-row-bottom" },
              el("span", { text: preview || jid.split("@")[0] }),
              Number(chat.unreadCount || 0) > 0 ? el("b", { class: "unread-badge", text: String(chat.unreadCount) }) : null
            )
          )
        );
        rows.append(row);
      });
    };
    search.addEventListener("input", drawRows);
    list.replaceChildren(header2, el("div", { class: "chat-search" }, search), rows);
    drawRows();
  }
  async function loadMessages({ silent = false } = {}) {
    if (loadingMessages || !selected) {
      if (!selected && !silent) {
        conversation.replaceChildren(
          el(
            "div",
            { class: "empty conversation-empty" },
            el("strong", { text: "Connect|API Chat" }),
            el("span", { text: "Selecione uma conversa para come\xE7ar." })
          )
        );
      }
      return;
    }
    loadingMessages = true;
    const chat = chats.find((item) => canonicalJid(item) === selected) || { remoteJid: selected };
    const header2 = el(
      "div",
      { class: "conversation-head" },
      el(
        "div",
        { class: "conversation-person" },
        avatar(chat, "large"),
        el(
          "div",
          {},
          el("strong", { text: chatName(chat) }),
          el("small", { text: selected.replace(/@.+$/, "") })
        )
      ),
      el(
        "div",
        { class: "actions" },
        instance.integration === "WHATSAPP-ZAPO" ? button("\u260E", {
          class: "icon-btn",
          onclick: () => location.href = `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`
        }) : null,
        button("\u21BB", { class: "icon-btn", onclick: () => loadMessages() })
      )
    );
    const messages = el("div", { class: "messages" }, silent ? null : spinner());
    const text = input("", { placeholder: "Digite uma mensagem", autocomplete: "off" });
    const file = el("input", { type: "file", class: "file-input" });
    const attach = button("\uFF0B", { class: "icon-btn", onclick: () => file.click() });
    const formFeedback = el("div", { class: "composer-feedback" });
    const form = el(
      "form",
      { class: "composer" },
      attach,
      file,
      text,
      button("\u27A4", { class: "primary send-btn", type: "submit" })
    );
    const composer = el("div", {}, formFeedback, form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = text.value.trim();
      const attachment = file.files?.[0];
      if (!body && !attachment) return;
      formFeedback.replaceChildren();
      try {
        if (attachment) await sendMedia(session, instance, selected, attachment, body);
        else await sendText(session, instance, selected, body);
        text.value = "";
        file.value = "";
        await loadMessages();
      } catch (error) {
        formFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
    if (!silent) conversation.replaceChildren(header2, messages, composer);
    try {
      const ids = [...aliases.get(selected) || /* @__PURE__ */ new Set([selected])];
      const batches = await Promise.all(ids.map((jid) => findMessages(session, instance, jid).catch(() => [])));
      const unique = /* @__PURE__ */ new Map();
      batches.flat().forEach(
        (message) => unique.set(message.id || message.key?.id || JSON.stringify(message.key), message)
      );
      const rows = [...unique.values()].sort(
        (a, b) => Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
      );
      const target = silent ? conversation.querySelector(".messages") : messages;
      if (target) renderMessageRows(target, rows);
    } catch (error) {
      if (!silent) messages.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loadingMessages = false;
    }
  }
  function renderMessageRows(target, rows) {
    target.replaceChildren();
    rows.forEach(
      (message) => target.append(
        el(
          "div",
          { class: `bubble ${message.key?.fromMe ? "mine" : ""}` },
          el("span", { text: messageText(message) }),
          el("small", { text: messageTimestamp(message) })
        )
      )
    );
    target.scrollTop = target.scrollHeight;
  }
  layout.append(list, conversation);
  void loadChats().then(() => loadMessages());
  polling = setInterval(() => {
    if (!document.body.contains(layout)) {
      clearInterval(polling);
      return;
    }
    void loadChats({ silent: true });
    if (selected) void loadMessages({ silent: true });
  }, 4e3);
  return embedded ? el("main", { class: "embedded-chat" }, layout) : instanceShell(instance, "chat", layout);
}

// src/api/configuration.js
var configTitles = { settings: "Comportamento", proxy: "Proxy", webhook: "Webhook", websocket: "WebSocket", rabbitmq: "RabbitMQ", sqs: "SQS", chatwoot: "Chatwoot" };
async function loadConfiguration(session, instance, kind) {
  return request(session, `/${kind}/find/${encodeURIComponent(instance.name)}`, {}, instance.token);
}
async function saveConfiguration(session, instance, kind, payload) {
  let data = payload;
  if (kind === "webhook") data = { webhook: payload };
  if (kind === "websocket") data = { websocket: payload };
  if (kind === "rabbitmq") data = { rabbitmq: payload };
  if (kind === "sqs") data = { sqs: payload };
  return request(session, `/${kind}/set/${encodeURIComponent(instance.name)}`, { method: "POST", data }, instance.token);
}

// src/pages/config.js
var EVENT_NAMES = [
  "APPLICATION_STARTUP",
  "QRCODE_UPDATED",
  "MESSAGES_SET",
  "MESSAGES_UPSERT",
  "MESSAGES_EDITED",
  "MESSAGES_UPDATE",
  "MESSAGES_DELETE",
  "SEND_MESSAGE",
  "SEND_MESSAGE_UPDATE",
  "CONTACTS_SET",
  "CONTACTS_UPSERT",
  "CONTACTS_UPDATE",
  "PRESENCE_UPDATE",
  "CHATS_SET",
  "CHATS_UPSERT",
  "CHATS_UPDATE",
  "CHATS_DELETE",
  "GROUPS_UPSERT",
  "GROUPS_UPDATE",
  "GROUP_UPDATE",
  "GROUP_PARTICIPANTS_UPDATE",
  "CONNECTION_UPDATE",
  "LABELS_EDIT",
  "LABELS_ASSOCIATION",
  "CALL",
  "TYPEBOT_START",
  "TYPEBOT_CHANGE_STATUS",
  "REMOVE_INSTANCE",
  "LOGOUT_INSTANCE",
  "INSTANCE_CREATE",
  "INSTANCE_DELETE",
  "STATUS_INSTANCE"
];
function clone(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : {};
}
function normalize(kind, data) {
  if (!data) return {};
  if (["settings", "proxy", "chatwoot"].includes(kind)) return data;
  return data?.[kind] || data || {};
}
function numberOrEmpty(value) {
  if (value === "" || value == null) return void 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : void 0;
}
function eventSelector(current, onChange) {
  const selected = new Set(Array.isArray(current) ? current : []);
  const grid = el("div", { class: "event-grid" });
  const sync = () => onChange([...selected]);
  EVENT_NAMES.forEach((eventName) => {
    const checkbox = el("input", {
      type: "checkbox",
      checked: selected.has(eventName)
    });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(eventName);
      else selected.delete(eventName);
      sync();
    });
    grid.append(el("label", { class: "event-option" }, checkbox, el("span", { text: eventName })));
  });
  return el(
    "div",
    { class: "form-stack" },
    el(
      "div",
      { class: "actions" },
      button("Selecionar todos", {
        onclick: () => {
          EVENT_NAMES.forEach((name) => selected.add(name));
          grid.querySelectorAll("input").forEach((node) => {
            node.checked = true;
          });
          sync();
        }
      }),
      button("Limpar", {
        onclick: () => {
          selected.clear();
          grid.querySelectorAll("input").forEach((node) => {
            node.checked = false;
          });
          sync();
        }
      })
    ),
    grid
  );
}
function renderConfig(instance, kind) {
  const session = loadSession();
  const page = el("div", { class: "page" });
  const body = el("div");
  const feedback = el("div");
  let value = {};
  function set(key, next) {
    value = { ...value, [key]: next };
  }
  function bindText(key, initial = value[key] ?? "", attrs = {}) {
    const control = input(initial, attrs);
    control.addEventListener("input", () => set(key, control.value));
    return control;
  }
  function bindNumber(key, initial = value[key] ?? "") {
    const control = input(initial, { type: "number" });
    control.addEventListener("input", () => set(key, numberOrEmpty(control.value)));
    return control;
  }
  async function load() {
    body.replaceChildren(el("div", { class: "center" }, spinner()));
    feedback.replaceChildren();
    try {
      value = clone(normalize(kind, await loadConfiguration(session, instance, kind)));
      draw();
    } catch (error) {
      body.replaceChildren();
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }
  async function save() {
    feedback.replaceChildren();
    try {
      await saveConfiguration(session, instance, kind, value);
      feedback.replaceChildren(alertBox("Configura\xE7\xE3o salva.", "success"));
      await load();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }
  function draw() {
    const form = el("div", { class: "form-stack" });
    if (kind === "settings") {
      value = {
        rejectCall: false,
        groupsIgnore: false,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
        ...value
      };
      form.append(
        toggle("Rejeitar chamadas", Boolean(value.rejectCall), (next) => set("rejectCall", next)),
        field("Mensagem ao rejeitar", bindText("msgCall")),
        toggle("Ignorar grupos", Boolean(value.groupsIgnore), (next) => set("groupsIgnore", next)),
        toggle("Sempre online", Boolean(value.alwaysOnline), (next) => set("alwaysOnline", next)),
        toggle("Marcar mensagens como lidas", Boolean(value.readMessages), (next) => set("readMessages", next)),
        toggle("Ler status", Boolean(value.readStatus), (next) => set("readStatus", next)),
        toggle("Sincronizar hist\xF3rico completo", Boolean(value.syncFullHistory), (next) => set("syncFullHistory", next))
      );
    } else if (kind === "proxy") {
      value = { enabled: false, host: "", port: "", protocol: "http", ...value };
      form.append(
        toggle("Usar proxy", Boolean(value.enabled), (next) => set("enabled", next)),
        field("Servidor", bindText("host")),
        field("Porta", bindText("port")),
        field("Protocolo", bindText("protocol")),
        field("Usu\xE1rio", bindText("username")),
        field("Senha", bindText("password", value.password || "", { type: "password", autocomplete: "new-password" }))
      );
    } else if (kind === "webhook") {
      value = { enabled: false, url: "", headers: {}, byEvents: false, base64: false, events: [], ...value };
      const headersArea = textarea(JSON.stringify(value.headers || {}, null, 2), { rows: 6 });
      const headersFeedback = el("small", { class: "error-text" });
      headersArea.addEventListener("input", () => {
        try {
          const parsed = JSON.parse(headersArea.value || "{}");
          if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
          headersFeedback.textContent = "";
          set("headers", parsed);
        } catch {
          headersFeedback.textContent = "JSON de headers inv\xE1lido";
        }
      });
      form.append(
        toggle("Webhook ativo", Boolean(value.enabled), (next) => set("enabled", next)),
        field("URL", bindText("url", value.url || "", { type: "url" })),
        toggle("Separar por eventos", Boolean(value.byEvents), (next) => set("byEvents", next)),
        toggle("Enviar m\xEDdia em Base64", Boolean(value.base64), (next) => set("base64", next)),
        field("Headers HTTP", el("div", {}, headersArea, headersFeedback)),
        field("Eventos", eventSelector(value.events, (events) => set("events", events)))
      );
    } else if (["websocket", "rabbitmq", "sqs"].includes(kind)) {
      value = { enabled: false, events: [], ...value };
      form.append(
        toggle("Integra\xE7\xE3o ativa", Boolean(value.enabled), (next) => set("enabled", next)),
        field("Eventos", eventSelector(value.events, (events) => set("events", events)))
      );
    } else if (kind === "chatwoot") {
      value = {
        enabled: false,
        signMsg: false,
        reopenConversation: false,
        conversationPending: false,
        autoCreate: false,
        importContacts: false,
        mergeBrazilContacts: false,
        importMessages: false,
        ignoreJids: [],
        ...value
      };
      const ignored = textarea(Array.isArray(value.ignoreJids) ? value.ignoreJids.join("\n") : "", { rows: 4 });
      ignored.addEventListener("input", () => {
        set(
          "ignoreJids",
          ignored.value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)
        );
      });
      form.append(
        toggle("Chatwoot ativo", Boolean(value.enabled), (next) => set("enabled", next)),
        field("URL", bindText("url", value.url || "", { type: "url" })),
        field("Account ID", bindText("accountId")),
        field("Token", bindText("token", value.token || "", { type: "password", autocomplete: "new-password" })),
        field("Nome da caixa", bindText("nameInbox")),
        field("Delimitador da assinatura", bindText("signDelimiter")),
        toggle("Assinar mensagens", Boolean(value.signMsg), (next) => set("signMsg", next)),
        toggle("Reabrir conversa", Boolean(value.reopenConversation), (next) => set("reopenConversation", next)),
        toggle("Criar conversa como pendente", Boolean(value.conversationPending), (next) => set("conversationPending", next)),
        toggle("Criar automaticamente", Boolean(value.autoCreate), (next) => set("autoCreate", next)),
        toggle("Importar contatos", Boolean(value.importContacts), (next) => set("importContacts", next)),
        toggle("Mesclar contatos do Brasil", Boolean(value.mergeBrazilContacts), (next) => set("mergeBrazilContacts", next)),
        toggle("Importar mensagens", Boolean(value.importMessages), (next) => set("importMessages", next)),
        field("Limite de dias para importar mensagens", bindNumber("daysLimitImportMessages")),
        field("JIDs ignorados", ignored, "Um JID por linha.")
      );
    }
    form.append(
      el(
        "details",
        {},
        el("summary", { text: "Configura\xE7\xE3o avan\xE7ada" }),
        jsonEditor(value, (next) => {
          value = next;
        })
      )
    );
    body.replaceChildren(card(form));
  }
  page.append(
    pageHeader(
      configTitles[kind] || kind,
      `Configura\xE7\xE3o da inst\xE2ncia ${instance.name || instance.instanceName}.`,
      [button("Salvar", { class: "primary", onclick: save })]
    ),
    feedback,
    body
  );
  void load();
  return instanceShell(instance, kind, page);
}

// src/api/integrations.js
var triggerFields = [
  {
    key: "triggerType",
    label: "Gatilho",
    type: "select",
    required: true,
    defaultValue: "all",
    options: ["all", "keyword", "none", "advanced"]
  },
  {
    key: "triggerOperator",
    label: "Operador",
    type: "select",
    defaultValue: "contains",
    options: ["equals", "contains", "startsWith", "endsWith", "regex"]
  },
  { key: "triggerValue", label: "Valor do gatilho" },
  { key: "expire", label: "Expira\xE7\xE3o (segundos)", type: "number", defaultValue: 0 },
  { key: "keywordFinish", label: "Palavra para encerrar" },
  { key: "delayMessage", label: "Atraso da mensagem (ms)", type: "number", defaultValue: 0 },
  { key: "unknownMessage", label: "Mensagem desconhecida", type: "textarea" },
  { key: "listeningFromMe", label: "Processar mensagens enviadas por mim", type: "boolean" },
  { key: "stopBotFromMe", label: "Permitir interrup\xE7\xE3o pelo operador", type: "boolean" },
  { key: "keepOpen", label: "Manter sess\xE3o aberta", type: "boolean" },
  { key: "debounceTime", label: "Debounce (ms)", type: "number", defaultValue: 0 },
  { key: "ignoreJids", label: "JIDs ignorados", type: "list", hint: "Um JID por linha." }
];
var messagingFields = [
  { key: "splitMessages", label: "Dividir respostas longas", type: "boolean" },
  { key: "timePerChar", label: "Tempo por caractere (ms)", type: "number", defaultValue: 0 }
];
var baseFields = [
  { key: "enabled", label: "Ativo", type: "boolean", defaultValue: true },
  { key: "description", label: "Descri\xE7\xE3o" }
];
var commonSettings = {
  expire: 0,
  keywordFinish: "#sair",
  delayMessage: 0,
  unknownMessage: "",
  listeningFromMe: false,
  stopBotFromMe: false,
  keepOpen: false,
  debounceTime: 0,
  ignoreJids: []
};
var messagingSettings = {
  ...commonSettings,
  splitMessages: false,
  timePerChar: 0
};
var definitions = {
  typebot: {
    title: "Typebot",
    fields: [
      ...baseFields,
      { key: "url", label: "URL", type: "url", required: true },
      { key: "typebot", label: "Typebot", required: true },
      ...triggerFields
    ],
    defaultSettings: {
      ...commonSettings,
      typebotIdFallback: ""
    }
  },
  dify: {
    title: "Dify",
    fields: [
      ...baseFields,
      {
        key: "botType",
        label: "Tipo",
        type: "select",
        required: true,
        defaultValue: "chatBot",
        options: ["chatBot", "textGenerator", "agent", "workflow"]
      },
      { key: "apiUrl", label: "URL da API", type: "url" },
      { key: "apiKey", label: "Chave da API", type: "password" },
      ...triggerFields,
      ...messagingFields
    ],
    defaultSettings: {
      ...messagingSettings,
      difyIdFallback: ""
    }
  },
  n8n: {
    title: "n8n",
    fields: [
      ...baseFields,
      { key: "webhookUrl", label: "URL do Webhook", type: "url", required: true },
      { key: "basicAuthUser", label: "Usu\xE1rio Basic Auth" },
      { key: "basicAuthPass", label: "Senha Basic Auth", type: "password" },
      ...triggerFields,
      ...messagingFields
    ],
    defaultSettings: {
      ...messagingSettings,
      botIdFallback: ""
    }
  },
  connectAI: {
    title: "ConnectAI",
    fields: [
      ...baseFields,
      { key: "agentUrl", label: "URL do agente", type: "url", required: true },
      { key: "apiKey", label: "Chave da API", type: "password" },
      ...triggerFields,
      ...messagingFields
    ],
    defaultSettings: {
      ...messagingSettings,
      connectAIIdFallback: ""
    }
  },
  connectBot: {
    title: "ConnectBot",
    fields: [
      ...baseFields,
      { key: "apiUrl", label: "URL da API", type: "url", required: true },
      { key: "apiKey", label: "Chave da API", type: "password" },
      ...triggerFields,
      ...messagingFields
    ],
    defaultSettings: {
      ...messagingSettings,
      botIdFallback: ""
    }
  },
  flowise: {
    title: "Flowise",
    fields: [
      ...baseFields,
      { key: "apiUrl", label: "URL da API", type: "url", required: true },
      { key: "apiKey", label: "Chave da API", type: "password" },
      ...triggerFields,
      ...messagingFields
    ],
    defaultSettings: {
      ...commonSettings,
      flowiseIdFallback: "",
      splitMessages: false,
      timePerChar: 0
    }
  },
  openai: {
    title: "OpenAI",
    fields: [
      ...baseFields,
      { key: "openaiCredsId", label: "Credencial", required: true },
      {
        key: "botType",
        label: "Tipo",
        type: "select",
        required: true,
        defaultValue: "assistant",
        options: ["assistant", "chatCompletion"]
      },
      { key: "assistantId", label: "Assistant ID" },
      { key: "functionUrl", label: "URL de fun\xE7\xF5es", type: "url" },
      { key: "model", label: "Modelo" },
      { key: "systemMessages", label: "Mensagens de sistema", type: "list" },
      { key: "assistantMessages", label: "Mensagens do assistente", type: "list" },
      { key: "userMessages", label: "Mensagens do usu\xE1rio", type: "list" },
      { key: "maxTokens", label: "M\xE1ximo de tokens", type: "number" },
      ...triggerFields
    ],
    defaultSettings: {
      ...commonSettings,
      openaiCredsId: "",
      openaiIdFallback: "",
      speechToText: false
    }
  }
};
function instanceName(instance) {
  return encodeURIComponent(instance.name || instance.instanceName || "");
}
async function findIntegrations(session, instance, key) {
  const data = await request(session, `/${key}/find/${instanceName(instance)}`, {}, instance.token);
  return Array.isArray(data) ? data : data ? [data] : [];
}
var createIntegration = (session, instance, key, data) => request(session, `/${key}/create/${instanceName(instance)}`, { method: "POST", data }, instance.token);
var updateIntegration = (session, instance, key, id, data) => request(
  session,
  `/${key}/update/${encodeURIComponent(id)}/${instanceName(instance)}`,
  { method: "PUT", data },
  instance.token
);
var deleteIntegration = (session, instance, key, id) => request(
  session,
  `/${key}/delete/${encodeURIComponent(id)}/${instanceName(instance)}`,
  { method: "DELETE" },
  instance.token
);
async function fetchSettings(session, instance, key) {
  const data = await request(
    session,
    `/${key}/fetchSettings/${instanceName(instance)}`,
    {},
    instance.token
  );
  if (Array.isArray(data)) return data[0] || definitions[key]?.defaultSettings || {};
  return data || definitions[key]?.defaultSettings || {};
}
var saveSettings = (session, instance, key, data) => request(
  session,
  `/${key}/settings/${instanceName(instance)}`,
  { method: "POST", data },
  instance.token
);
var fetchSessions = (session, instance, key, id) => request(
  session,
  `/${key}/fetchSessions/${encodeURIComponent(id)}/${instanceName(instance)}`,
  {},
  instance.token
);
var changeIntegrationStatus = (session, instance, key, remoteJid, status) => request(
  session,
  `/${key}/changeStatus/${instanceName(instance)}`,
  { method: "POST", data: { remoteJid, status } },
  instance.token
);
var changeIgnoredJid = (session, instance, key, remoteJid, action) => request(
  session,
  `/${key}/ignoreJid/${instanceName(instance)}`,
  { method: "POST", data: { remoteJid, action } },
  instance.token
);
var findOpenAiCredentials = (session, instance) => request(session, `/openai/creds/${instanceName(instance)}`, {}, instance.token);
var createOpenAiCredential = (session, instance, data) => request(
  session,
  `/openai/creds/${instanceName(instance)}`,
  { method: "POST", data },
  instance.token
);
var deleteOpenAiCredential = (session, instance, id) => request(
  session,
  `/openai/creds/${encodeURIComponent(id)}/${instanceName(instance)}`,
  { method: "DELETE" },
  instance.token
);
var getId = (item) => String(
  item?.id || item?.openaiBotId || item?.typebotId || item?.difyId || item?.n8nId || item?.connectAIId || item?.connectBotId || item?.flowiseId || ""
);

// src/pages/integration.js
function cloneObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return typeof globalThis.structuredClone === "function" ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}
function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  return data ? [data] : [];
}
function normalizeNumber(value) {
  if (value === "" || value == null) return void 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : void 0;
}
function cleanPayload(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== void 0)
  );
}
function renderIntegration(instance, key) {
  const session = loadSession();
  const definition = definitions[key];
  const page = el("div", { class: "page" });
  const body = el("div");
  const feedback = el("div");
  let items = [];
  if (!definition) {
    body.append(alertBox(`Integra\xE7\xE3o n\xE3o suportada pelo Manager: ${key}`));
    page.append(pageHeader("Integra\xE7\xE3o", instance.name), body);
    return instanceShell(instance, key, page);
  }
  function setFeedback(message, kind = "error") {
    feedback.replaceChildren(alertBox(message, kind));
  }
  async function load() {
    feedback.replaceChildren();
    body.replaceChildren(el("div", { class: "center" }, spinner()));
    try {
      items = normalizeList(await findIntegrations(session, instance, key));
      draw();
    } catch (error) {
      body.replaceChildren();
      setFeedback(error.message || String(error));
    }
  }
  function draw() {
    body.replaceChildren();
    if (!items.length) {
      body.append(
        el(
          "div",
          { class: "empty" },
          el("strong", { text: `Nenhuma configura\xE7\xE3o ${definition.title}` }),
          el("span", { text: "Adicione uma configura\xE7\xE3o para come\xE7ar." })
        )
      );
      return;
    }
    const stack = el("div", { class: "list-stack" });
    items.forEach((item, index) => {
      const id = getId(item);
      stack.append(
        card(
          el(
            "div",
            { class: "list-row" },
            el(
              "div",
              {},
              el("strong", {
                text: item.description || item.name || `${definition.title} ${index + 1}`
              }),
              el("span", {
                class: "muted",
                text: `${item.enabled === false ? "Desativado" : "Ativo"} \xB7 ${id || "sem id"}`
              })
            ),
            el(
              "div",
              { class: "actions" },
              id ? button("Sess\xF5es", {
                onclick: () => showSessions(item)
              }) : null,
              button("Editar", { onclick: () => void openEditor(item) }),
              id ? button("Excluir", {
                class: "danger",
                onclick: () => remove(item)
              }) : null
            )
          )
        )
      );
    });
    body.append(stack);
  }
  async function openEditor(item = null) {
    let value = item ? cloneObject(item) : {
      enabled: true,
      triggerType: "all",
      triggerOperator: "contains",
      expire: 0,
      delayMessage: 0,
      listeningFromMe: false,
      stopBotFromMe: false,
      keepOpen: false,
      debounceTime: 0,
      ignoreJids: []
    };
    const form = el("form", { class: "form-stack" });
    const formFeedback = el("div");
    form.append(formFeedback);
    for (const descriptor of definition.fields) {
      const current = value[descriptor.key];
      if (descriptor.type === "boolean") {
        form.append(
          toggle(descriptor.label, Boolean(current ?? descriptor.defaultValue), (next) => {
            value[descriptor.key] = next;
          })
        );
        continue;
      }
      let dynamicOptions = descriptor.options || [];
      if (key === "openai" && descriptor.key === "openaiCredsId") {
        try {
          const creds = await findOpenAiCredentials(session, instance);
          dynamicOptions = (Array.isArray(creds) ? creds : creds ? [creds] : []).map((credential) => ({
            value: credential.id || credential.openaiCredsId || "",
            label: credential.name || credential.id || credential.openaiCredsId || "Credencial"
          }));
        } catch {
          dynamicOptions = [];
        }
      }
      let control;
      if (descriptor.type === "select" || key === "openai" && descriptor.key === "openaiCredsId") {
        control = select(
          current ?? descriptor.defaultValue ?? "",
          [
            { value: "", label: "Selecione" },
            ...dynamicOptions.map(
              (option) => typeof option === "string" ? { value: option, label: option } : option
            )
          ]
        );
      } else if (descriptor.type === "textarea") {
        control = textarea(current ?? "", { rows: descriptor.rows || 4 });
      } else if (descriptor.type === "list") {
        control = textarea(Array.isArray(current) ? current.join("\n") : "", {
          rows: descriptor.rows || 4,
          placeholder: "Um item por linha"
        });
      } else {
        control = input(current ?? "", {
          type: descriptor.type === "password" ? "password" : descriptor.type === "number" ? "number" : descriptor.type === "url" ? "url" : "text",
          required: descriptor.required === true,
          placeholder: descriptor.placeholder || ""
        });
      }
      const updateValue = () => {
        if (descriptor.type === "number") {
          value[descriptor.key] = normalizeNumber(control.value);
        } else if (descriptor.type === "list") {
          value[descriptor.key] = control.value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
        } else {
          value[descriptor.key] = control.value;
        }
      };
      control.addEventListener("input", updateValue);
      control.addEventListener("change", updateValue);
      form.append(field(descriptor.label, control, descriptor.hint));
    }
    const advanced = el(
      "details",
      {},
      el("summary", { text: "JSON avan\xE7ado" }),
      jsonEditor(value, (next) => {
        value = next;
      })
    );
    form.append(advanced, button("Salvar", { class: "primary", type: "submit" }));
    const dialog = modal(
      item ? `Editar ${definition.title}` : `Novo ${definition.title}`,
      form
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      formFeedback.replaceChildren();
      try {
        const payload = cleanPayload(value);
        const id = getId(item);
        if (id) {
          await updateIntegration(session, instance, key, id, payload);
        } else {
          await createIntegration(session, instance, key, payload);
        }
        dialog.close();
        setFeedback("Configura\xE7\xE3o salva.", "success");
        await load();
      } catch (error) {
        formFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
  }
  async function remove(item) {
    const id = getId(item);
    if (!id || !window.confirm("Excluir esta integra\xE7\xE3o?")) return;
    try {
      await deleteIntegration(session, instance, key, id);
      setFeedback("Integra\xE7\xE3o exclu\xEDda.", "success");
      await load();
    } catch (error) {
      setFeedback(error.message || String(error));
    }
  }
  async function manageOpenAiCredentials() {
    feedback.replaceChildren();
    const content = el("div", { class: "form-stack" });
    const credentialsList = el("div", { class: "list-stack" });
    const credentialFeedback = el("div");
    const name = input("", { required: true, autocomplete: "off" });
    const apiKey = input("", { type: "password", required: true, autocomplete: "new-password" });
    const createForm = el(
      "form",
      { class: "form-stack" },
      el("h4", { text: "Nova credencial" }),
      field("Nome", name),
      field("Chave da API", apiKey),
      button("Adicionar credencial", { class: "primary", type: "submit" })
    );
    async function reloadCredentials() {
      credentialsList.replaceChildren(el("div", { class: "center" }, spinner()));
      try {
        const data = await findOpenAiCredentials(session, instance);
        const rows = Array.isArray(data) ? data : data ? [data] : [];
        credentialsList.replaceChildren();
        if (!rows.length) {
          credentialsList.append(el("div", { class: "empty small" }, el("span", { text: "Nenhuma credencial cadastrada." })));
          return;
        }
        rows.forEach((credential) => {
          const id = credential.id || credential.openaiCredsId;
          credentialsList.append(
            card(
              el(
                "div",
                { class: "list-row" },
                el("div", {}, el("strong", { text: credential.name || id || "Credencial" }), el("span", { class: "muted", text: id || "" })),
                id ? button("Excluir", {
                  class: "danger",
                  onclick: async () => {
                    if (!window.confirm("Excluir esta credencial?")) return;
                    try {
                      await deleteOpenAiCredential(session, instance, id);
                      await reloadCredentials();
                    } catch (error) {
                      credentialFeedback.replaceChildren(alertBox(error.message || String(error)));
                    }
                  }
                }) : null
              )
            )
          );
        });
      } catch (error) {
        credentialsList.replaceChildren(alertBox(error.message || String(error)));
      }
    }
    createForm.onsubmit = async (event) => {
      event.preventDefault();
      credentialFeedback.replaceChildren();
      try {
        await createOpenAiCredential(session, instance, {
          name: name.value.trim(),
          apiKey: apiKey.value.trim()
        });
        name.value = "";
        apiKey.value = "";
        await reloadCredentials();
      } catch (error) {
        credentialFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
    content.append(credentialFeedback, credentialsList, createForm);
    modal("Credenciais OpenAI", content);
    await reloadCredentials();
  }
  async function openSettings() {
    feedback.replaceChildren();
    try {
      let value = await fetchSettings(session, instance, key);
      if (Array.isArray(value)) value = value[0] || {};
      value = cloneObject(value);
      const content = el("div", { class: "form-stack" });
      const settingsFeedback = el("div");
      const editor = jsonEditor(value, (next) => {
        value = next;
      });
      content.append(settingsFeedback, editor);
      const dialog = modal(`Configura\xE7\xF5es ${definition.title}`, content);
      content.append(
        button("Salvar configura\xE7\xF5es", {
          class: "primary",
          onclick: async () => {
            settingsFeedback.replaceChildren();
            try {
              await saveSettings(session, instance, key, cleanPayload(value));
              dialog.close();
              setFeedback("Configura\xE7\xF5es salvas.", "success");
            } catch (error) {
              settingsFeedback.replaceChildren(alertBox(error.message || String(error)));
            }
          }
        })
      );
    } catch (error) {
      setFeedback(error.message || String(error));
    }
  }
  async function showSessions(item) {
    const id = getId(item);
    if (!id) return;
    feedback.replaceChildren();
    const content = el("div", { class: "form-stack" });
    const sessionFeedback = el("div");
    const rowsHost = el("div", { class: "list-stack" });
    content.append(sessionFeedback, rowsHost);
    modal(`Sess\xF5es ${definition.title}`, content);
    const loadSessions = async () => {
      rowsHost.replaceChildren(el("div", { class: "center" }, spinner()));
      sessionFeedback.replaceChildren();
      try {
        const rows = normalizeList(await fetchSessions(session, instance, key, id));
        rowsHost.replaceChildren();
        if (!rows.length) {
          rowsHost.append(
            el("div", { class: "empty small" }, el("span", { text: "Nenhuma sess\xE3o encontrada." }))
          );
          return;
        }
        for (const row of rows) {
          const remoteJid = row.remoteJid || row.jid || "";
          const status = row.status || "desconhecido";
          const actions = el("div", { class: "actions" });
          if (remoteJid) {
            for (const [label, nextStatus, className] of [
              ["Abrir", "opened", ""],
              ["Pausar", "paused", ""],
              ["Fechar", "closed", ""],
              ["Excluir", "delete", "danger"]
            ]) {
              actions.append(
                button(label, {
                  class: className,
                  onclick: async () => {
                    sessionFeedback.replaceChildren();
                    try {
                      await changeIntegrationStatus(session, instance, key, remoteJid, nextStatus);
                      await loadSessions();
                    } catch (error) {
                      sessionFeedback.replaceChildren(alertBox(error.message || String(error)));
                    }
                  }
                })
              );
            }
            actions.append(
              button("Ignorar JID", {
                onclick: async () => {
                  sessionFeedback.replaceChildren();
                  try {
                    await changeIgnoredJid(session, instance, key, remoteJid, "add");
                    sessionFeedback.replaceChildren(alertBox("JID adicionado \xE0 lista de ignorados.", "success"));
                  } catch (error) {
                    sessionFeedback.replaceChildren(alertBox(error.message || String(error)));
                  }
                }
              })
            );
          }
          rowsHost.append(
            card(
              el(
                "div",
                { class: "list-row" },
                el(
                  "div",
                  {},
                  el("strong", { text: remoteJid || "Sess\xE3o" }),
                  el("span", { class: "muted", text: `Status: ${status}` })
                ),
                actions
              )
            )
          );
        }
      } catch (error) {
        rowsHost.replaceChildren();
        sessionFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
    await loadSessions();
  }
  page.append(
    pageHeader(
      definition.title,
      `Gerencie automa\xE7\xF5es vinculadas \xE0 inst\xE2ncia ${instance.name}.`,
      [
        button("Atualizar", { onclick: load }),
        key === "openai" ? button("Credenciais", { onclick: () => void manageOpenAiCredentials() }) : null,
        button("Configura\xE7\xF5es", { onclick: openSettings }),
        button("Adicionar", { class: "primary", onclick: () => void openEditor() })
      ]
    ),
    feedback,
    body
  );
  void load();
  return instanceShell(instance, key, page);
}

// src/api/calls.js
var nameOf = (instance) => instance.name || instance.instanceName;
var listCalls = (session, instance) => request(session, `/call/list/${encodeURIComponent(nameOf(instance))}`, {}, instance.token);
var offerCall = (session, instance, number) => request(session, `/call/offer/${encodeURIComponent(nameOf(instance))}`, {
  method: "POST",
  data: { number, isVideo: false }
}, instance.token);
var acceptCall = (session, instance, callId) => request(session, `/call/accept/${encodeURIComponent(nameOf(instance))}`, { method: "POST", data: { callId } }, instance.token);
var rejectCall = (session, instance, callId) => request(session, `/call/reject/${encodeURIComponent(nameOf(instance))}`, { method: "POST", data: { callId } }, instance.token);
var endCall = (session, instance, callId) => request(session, `/call/end/${encodeURIComponent(nameOf(instance))}`, { method: "POST", data: { callId } }, instance.token);
var muteCall = (session, instance, callId, muted) => request(session, `/call/mute/${encodeURIComponent(nameOf(instance))}`, { method: "POST", data: { callId, muted } }, instance.token);

// src/pages/calls.js
function peer(call) {
  return String(call?.peerJid || call?.peer || "").replace(/@.+$/, "") || "Desconhecido";
}
function renderCalls(instance) {
  const session = loadSession();
  const page = el("div", { class: "page calls-page" });
  const feedback = el("div");
  const list = el("div", { class: "call-list" });
  const number = input("", { type: "tel", inputmode: "numeric", placeholder: "5575999999999" });
  let loading = false;
  let polling;
  async function act(action, callId, value) {
    try {
      if (action === "accept") await acceptCall(session, instance, callId);
      if (action === "reject") await rejectCall(session, instance, callId);
      if (action === "end") await endCall(session, instance, callId);
      if (action === "mute") await muteCall(session, instance, callId, value);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }
  function draw(calls) {
    list.replaceChildren();
    if (!calls.length) {
      list.append(
        el(
          "div",
          { class: "empty small" },
          el("strong", { text: "Nenhuma chamada ativa" }),
          el("span", { text: "As chamadas WhatsApp via Zapo aparecer\xE3o aqui." })
        )
      );
      return;
    }
    calls.forEach((call) => {
      const callId = call.callId || call.id;
      const state = call.state || call.stateData?.state || "unknown";
      const actions = [];
      if (call.canAccept) actions.push(button("Atender", { class: "primary", onclick: () => act("accept", callId) }));
      if (call.canReject) actions.push(button("Recusar", { class: "danger", onclick: () => act("reject", callId) }));
      actions.push(button("Silenciar", { onclick: () => act("mute", callId, true) }));
      actions.push(button("Encerrar", { class: "danger", onclick: () => act("end", callId) }));
      list.append(
        card(
          el(
            "div",
            { class: "call-row" },
            el(
              "div",
              { class: "call-peer" },
              el("span", { class: "call-icon", text: call.direction === "incoming" ? "\u2199" : "\u2197" }),
              el(
                "div",
                {},
                el("strong", { text: peer(call) }),
                el("small", { text: call.direction === "incoming" ? "Recebida" : "Efetuada" })
              )
            ),
            badge(state),
            el("div", { class: "actions" }, ...actions)
          )
        )
      );
    });
  }
  async function reload({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    if (!silent) list.replaceChildren(el("div", { class: "center" }, spinner()));
    try {
      const data = await listCalls(session, instance);
      draw(Array.isArray(data) ? data : data?.calls || []);
    } catch (error) {
      if (!silent) list.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loading = false;
    }
  }
  const callForm = el(
    "form",
    { class: "call-dialer" },
    field("N\xFAmero para chamada", number),
    button("Ligar", { class: "primary", type: "submit" })
  );
  callForm.onsubmit = async (event) => {
    event.preventDefault();
    const target = number.value.replace(/\D/g, "");
    if (!target) return;
    feedback.replaceChildren();
    try {
      await offerCall(session, instance, target);
      number.value = "";
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };
  page.append(
    pageHeader("Chamadas WhatsApp", "Controle de chamadas de voz nativas do provider Zapo.", [
      button("Atualizar", { onclick: reload })
    ]),
    feedback,
    card(callForm),
    list
  );
  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) return clearInterval(polling);
    void reload({ silent: true });
  }, 2500);
  return instanceShell(instance, "calls", page);
}

// src/pages/voip.js
function renderVoip(instance) {
  const session = loadSession();
  const page = el("div", { class: "page" });
  const status = el("div", { class: "voip-status" }, spinner());
  async function reload() {
    try {
      const calls = await listCalls(session, instance);
      const active = Array.isArray(calls) ? calls.length : calls?.calls?.length || 0;
      status.replaceChildren(
        card(el("span", { class: "muted", text: "Provider" }), el("strong", { text: "Zapo" })),
        card(
          el("span", { class: "muted", text: "Voz WhatsApp" }),
          badge(instance.connectionStatus === "open" ? "open" : "close")
        ),
        card(el("span", { class: "muted", text: "Chamadas ativas" }), el("strong", { text: String(active) })),
        card(el("span", { class: "muted", text: "V\xEDdeo" }), el("strong", { text: "Ainda n\xE3o habilitado" }))
      );
    } catch (error) {
      status.replaceChildren(alertBox(error.message || String(error)));
    }
  }
  page.append(
    pageHeader(
      "VoIP",
      "Camada de voz WhatsApp da inst\xE2ncia. O \xE1udio permanece no plano de m\xEDdia e n\xE3o \xE9 enviado pelo EventManager.",
      [button("Atualizar", { onclick: reload })]
    ),
    el(
      "div",
      { class: "voip-hero" },
      el(
        "div",
        {},
        el("h2", { text: "Zapo VoIP" }),
        el("p", {
          class: "muted",
          text: "Chamadas de voz nativas do WhatsApp, prontas para integra\xE7\xE3o com o Voice Core/PBX."
        })
      ),
      button("Abrir chamadas", {
        class: "primary",
        onclick: () => navigate(`/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`)
      })
    ),
    status
  );
  void reload();
  return instanceShell(instance, "voip", page);
}

// src/main.js
var root = document.getElementById("root");
setTheme(getTheme());
var configKinds = /* @__PURE__ */ new Set([
  "settings",
  "proxy",
  "webhook",
  "websocket",
  "rabbitmq",
  "sqs",
  "chatwoot"
]);
var integrationKinds = /* @__PURE__ */ new Set([
  "typebot",
  "openai",
  "dify",
  "n8n",
  "connectAI",
  "connectBot",
  "flowise"
]);
async function render() {
  clear(root);
  const path = location.pathname;
  if (path === "/" || path === "") {
    navigate("/manager/login", true);
    return;
  }
  if (path === "/manager/login") {
    root.append(renderLogin());
    return;
  }
  const session = loadSession();
  if (!session) {
    navigate("/manager/login", true);
    return;
  }
  if (path === "/manager" || path === "/manager/") {
    root.append(renderInstances());
    return;
  }
  if (path.startsWith("/manager/embed-chat")) {
    const selected = loadSelectedInstance();
    if (!selected) {
      navigate("/manager/", true);
      return;
    }
    const encodedJid = path.split("/").slice(3).join("/");
    root.append(
      renderChat(selected, encodedJid ? decodeURIComponent(encodedJid) : "", {
        embedded: true
      })
    );
    return;
  }
  const match = path.match(/^\/manager\/instance\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?$/);
  if (!match) {
    navigate("/manager/", true);
    return;
  }
  const [, instanceId, section = "dashboard", tail = ""] = match;
  root.append(el("div", { class: "center" }, spinner()));
  try {
    const instance = (await fetchInstances(session, instanceId))[0];
    if (!instance) throw new Error("Inst\xE2ncia n\xE3o encontrada");
    saveSelectedInstance(instance);
    const reload = async () => {
      const fresh = (await fetchInstances(session, instanceId))[0];
      if (!fresh) return;
      saveSelectedInstance(fresh);
      void render();
    };
    clear(root);
    if (section === "dashboard") {
      root.append(renderDashboard(instance, reload));
    } else if (section === "chat") {
      root.append(renderChat(instance, tail ? decodeURIComponent(tail) : ""));
    } else if (section === "calls" && instance.integration === "WHATSAPP-ZAPO") {
      root.append(renderCalls(instance));
    } else if (section === "voip" && instance.integration === "WHATSAPP-ZAPO") {
      root.append(renderVoip(instance));
    } else if (configKinds.has(section)) {
      root.append(renderConfig(instance, section));
    } else if (integrationKinds.has(section)) {
      root.append(renderIntegration(instance, section));
    } else {
      root.append(renderDashboard(instance, reload));
    }
  } catch (error) {
    clear(root).append(alertBox(error.message || String(error)));
  }
}
setRenderer(render);
installRouter();
void render();
//# sourceMappingURL=main.js.map

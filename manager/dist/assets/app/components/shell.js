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
var button = (label, options = {}) => el("button", { class: `btn ${options.class || ""}`.trim(), type: options.type || "button", disabled: options.disabled || false, onclick: options.onclick }, options.icon ? el("span", { class: "btn-icon", text: options.icon }) : null, label);
var badge = (status) => el("span", { class: `status status-${String(status || "unknown").toLowerCase()}`, text: status || "desconhecido" });

// src/core/router.js
var renderer = null;
function navigate(path, replace = false) {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  renderer?.();
}
function link(label, href, className = "") {
  const a = document.createElement("a");
  a.href = href;
  a.dataset.nav = "1";
  a.className = className;
  a.textContent = label;
  return a;
}

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
function loadSession() {
  const apiUrl = localStorage.getItem(KEYS.apiUrl) || "";
  const apiKey = localStorage.getItem(KEYS.token) || "";
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey, version: localStorage.getItem(KEYS.version) || "", clientName: localStorage.getItem(KEYS.clientName) || "", documentationUrl: localStorage.getItem(KEYS.documentationUrl) || "" };
}
function clearSession() {
  Object.values(KEYS).slice(0, 8).forEach((key) => localStorage.removeItem(key));
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
function instanceStatus(instance) {
  return badge(instance.connectionStatus);
}
export {
  header,
  instanceShell,
  instanceStatus,
  managerShell,
  pageHeader,
  sidebar
};
//# sourceMappingURL=shell.js.map

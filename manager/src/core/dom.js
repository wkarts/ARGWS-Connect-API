export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'style') { try { node[key] = value; } catch { node.setAttribute(key, String(value)); } }
    else node.setAttribute(key, String(value));
  });
  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
export const card = (...children) => el('section', { class: 'card' }, ...children);
export const button = (label, options = {}) => el('button', { class: `btn ${options.class || ''}`.trim(), type: options.type || 'button', disabled: options.disabled || false, onclick: options.onclick }, options.icon ? el('span', { class: 'btn-icon', text: options.icon }) : null, label);
export const field = (label, inputNode, hint) => el('label', { class: 'field' }, el('span', { text: label }), inputNode, hint ? el('small', { text: hint }) : null);
export const input = (value = '', attrs = {}) => el('input', { class: 'input', value, ...attrs });
export const textarea = (value = '', attrs = {}) => el('textarea', { class: 'textarea', value, ...attrs });
export const select = (value, options, attrs = {}) => {
  const node = el('select', { class: 'input', ...attrs });
  options.forEach((option) => node.append(el('option', { value: option.value ?? option, text: option.label ?? option, selected: String(option.value ?? option) === String(value) })));
  return node;
};
export const spinner = () => el('span', { class: 'spinner' });
export const alertBox = (message, kind = 'error') => el('div', { class: `alert ${kind}`, text: message });
export const badge = (status) => {
  const raw = String(status || 'unknown').toLowerCase();
  const config = raw === 'open' || raw === 'connected' || raw === 'ok' || raw === 'healthy' ? ['Saudável', 'success'] : raw === 'connecting' || raw === 'configured' || raw === 'unknown' ? ['Atenção', 'warning'] : raw === 'not_configured' ? ['Não configurado', 'neutral'] : ['Indisponível', 'danger'];
  return el('span', { class: `badge badge-${config[1]}` }, el('span', { class: 'status-dot' }), config[0]);
};
export function modal(title, content, options = {}) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const dismissible = options.dismissible !== false;
  const close = () => backdrop.remove();
  const header = el('header', {},
    el('div', {}, el('h3', { text: title }), options.subtitle ? el('p', { text: options.subtitle }) : null),
    dismissible ? button('×', { class: 'icon-btn ghost', onclick: close }) : null,
  );
  const dialog = el('div', { class: `modal ${options.wide ? 'modal-wide' : ''} ${options.class || ''}`.trim(), role: 'dialog', 'aria-modal': 'true' }, header, content);
  if (dismissible) backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  backdrop.append(dialog);
  document.body.append(backdrop);
  return { close, element: backdrop, dialog };
}
export function confirmDialog(title, message, confirmLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const body = el('div', { class: 'form-stack' }, el('p', { text: message }), el('div', { class: 'actions end' }));
    const dialog = modal(title, body);
    body.querySelector('.actions').append(button('Cancelar', { onclick: () => { dialog.close(); resolve(false); } }), button(confirmLabel, { class: 'danger solid', onclick: () => { dialog.close(); resolve(true); } }));
  });
}
export function metric(label, value, meta = '', icon = '◈') {
  return card(el('div', { class: 'metric-top' }, el('span', { class: 'metric-icon', text: icon }), meta ? el('span', { class: 'metric-meta', text: meta }) : null), el('strong', { class: 'metric-value', text: value }), el('span', { class: 'metric-label', text: label }));
}
export function emptyState(title, description, action) {
  return el('div', { class: 'empty' }, el('div', { class: 'empty-icon', text: '◇' }), el('strong', { text: title }), el('span', { text: description }), action || null);
}

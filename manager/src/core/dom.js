export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && key !== 'style') { try { node[key] = value; } catch { node.setAttribute(key, value); } }
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
export const field = (label, input, hint) => el('label', { class: 'field' }, el('span', { text: label }), input, hint ? el('small', { text: hint }) : null);
export const input = (value = '', attrs = {}) => el('input', { class: 'input', value, ...attrs });
export const textarea = (value = '', attrs = {}) => el('textarea', { class: 'textarea', value, ...attrs });
export const select = (value, options, attrs = {}) => {
  const node = el('select', { class: 'input', ...attrs });
  options.forEach((option) => node.append(el('option', { value: option.value ?? option, text: option.label ?? option, selected: String(option.value ?? option) === String(value) })));
  return node;
};
export const badge = (status) => el('span', { class: `status status-${String(status || 'unknown').toLowerCase()}`, text: status || 'desconhecido' });
export const spinner = () => el('span', { class: 'spinner' });
export const alertBox = (message, kind = 'error') => el('div', { class: `alert ${kind}`, text: message });
export function modal(title, content) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const close = () => backdrop.remove();
  const dialog = el('div', { class: 'modal' }, el('header', {}, el('h3', { text: title }), button('×', { class: 'icon-btn', onclick: close })), content);
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); }); backdrop.append(dialog); document.body.append(backdrop); return { close, element: backdrop };
}
export function toggle(label, checked, onChange) {
  const btn = el('button', { class: `switch ${checked ? 'on' : ''}`, type: 'button', onclick: () => { checked = !checked; btn.classList.toggle('on', checked); onChange(checked); } }, el('span'));
  return el('label', { class: 'toggle-row' }, btn, el('span', { text: label }));
}
export function jsonEditor(value, onChange) {
  const error = el('small', { class: 'error-text' });
  const area = textarea(JSON.stringify(value || {}, null, 2), { rows: 14 });
  area.addEventListener('input', () => { try { const parsed = JSON.parse(area.value); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); error.textContent = ''; onChange(parsed); } catch { error.textContent = 'JSON inválido'; } });
  return field('JSON avançado', el('div', {}, area, error));
}

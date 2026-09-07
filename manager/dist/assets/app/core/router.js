let renderer = null;
export function setRenderer(fn) { renderer = fn; }
export function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  renderer?.();
}
export function installRouter() {
  window.addEventListener('popstate', () => renderer?.());
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[data-nav]');
    if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(anchor.getAttribute('href'));
  });
}
export function link(label, href, className = '') {
  const node = document.createElement('a');
  node.href = href;
  node.dataset.nav = '1';
  node.className = className;
  node.textContent = label;
  return node;
}

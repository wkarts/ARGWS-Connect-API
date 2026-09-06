/*
 * Connect|API Manager - public links policy
 *
 * The bundled Manager is distributed without its source tree in this repository.
 * Keep public external-link behavior isolated here until the Manager is rebuilt.
 *
 * Policy:
 * - GitHub, Postman, Discord and Premium Support links are never exposed.
 * - Documentation is exposed only when the API root returns `documentation`.
 * - The API root derives `documentation` from ARGWS_CONNECT_DOCS_PUBLIC_URL.
 */
(() => {
  'use strict';

  if (window.__CONNECT_PUBLIC_LINKS_POLICY_LOADED__) return;
  window.__CONNECT_PUBLIC_LINKS_POLICY_LOADED__ = true;

  const blockedLabels = ['discord', 'postman', 'github', 'suporte premium'];
  const blockedHrefPatterns = [/github\.com/i, /postman\.com/i, /discord(?:\.gg|\.com)/i];
  const documentationLabels = ['docs', 'documentacao'];

  let documentationResolved = false;
  let documentationUrl = '';
  let applyScheduled = false;

  const normalizeText = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const linkLabel = (link) => normalizeText(link.textContent || link.getAttribute('aria-label') || link.title);
  const linkHref = (link) => String(link.getAttribute('href') || '').trim();

  const isBlockedLink = (link) => {
    const label = linkLabel(link);
    const href = linkHref(link);

    return (
      blockedLabels.some((blockedLabel) => label.includes(blockedLabel)) ||
      blockedHrefPatterns.some((pattern) => pattern.test(href))
    );
  };

  const isDocumentationLink = (link) => {
    const label = linkLabel(link);
    return documentationLabels.some((documentationLabel) => label === documentationLabel || label.includes(documentationLabel));
  };

  const hideDocumentationLink = (link) => {
    if (link.dataset.connectDocsPolicy === 'hidden') return;
    link.dataset.connectDocsPolicy = 'hidden';
    link.style.setProperty('display', 'none', 'important');
    link.setAttribute('aria-hidden', 'true');
    link.setAttribute('tabindex', '-1');
  };

  const showDocumentationLink = (link) => {
    if (link.getAttribute('href') !== documentationUrl) link.setAttribute('href', documentationUrl);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.removeAttribute('aria-hidden');
    link.removeAttribute('tabindex');

    if (link.dataset.connectDocsPolicy === 'hidden') {
      link.style.removeProperty('display');
    }
    link.dataset.connectDocsPolicy = 'visible';
  };

  const applyPolicy = () => {
    applyScheduled = false;

    document.querySelectorAll('a').forEach((link) => {
      if (isBlockedLink(link)) {
        link.remove();
        return;
      }

      if (!isDocumentationLink(link)) return;

      if (!documentationResolved || !documentationUrl) {
        hideDocumentationLink(link);
        return;
      }

      showDocumentationLink(link);
    });
  };

  const schedulePolicy = () => {
    if (applyScheduled) return;
    applyScheduled = true;
    window.requestAnimationFrame(applyPolicy);
  };

  const loadPublicConfiguration = async () => {
    try {
      const response = await fetch('/', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const payload = await response.json();
        documentationUrl = typeof payload?.documentation === 'string' ? payload.documentation.trim() : '';
      }
    } catch (error) {
      console.warn('[Connect|API Manager] Não foi possível carregar a configuração pública de documentação.', error);
      documentationUrl = '';
    } finally {
      documentationResolved = true;
      schedulePolicy();
    }
  };

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest('a');
      if (!link) return;

      if (isBlockedLink(link) || (isDocumentationLink(link) && (!documentationResolved || !documentationUrl))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  const start = () => {
    const observer = new MutationObserver(schedulePolicy);
    observer.observe(document.body, { childList: true, subtree: true });
    schedulePolicy();
    void loadPublicConfiguration();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

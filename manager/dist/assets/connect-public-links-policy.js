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

  if (window.__CONNECT_PUBLIC_LINKS_POLICY_V2_LOADED__) return;
  window.__CONNECT_PUBLIC_LINKS_POLICY_V2_LOADED__ = true;

  const blockedLabels = ['discord', 'postman', 'github', 'suporte premium', 'premium support'];
  const blockedHrefPatterns = [/github\.com/i, /postman\.com/i, /discord(?:\.gg|\.com)/i];
  const documentationLabels = ['docs', 'documentacao', 'documentation'];
  const interactiveSelector = 'a,button,[role="link"],[role="button"],li,[data-menu-item],[data-sidebar-item]';

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

  const elementLabel = (element) =>
    normalizeText(
      element.textContent ||
        element.getAttribute?.('aria-label') ||
        element.getAttribute?.('title') ||
        element.getAttribute?.('data-label'),
    );

  const elementHref = (element) => String(element.getAttribute?.('href') || '').trim();

  const isBlockedElement = (element) => {
    const label = elementLabel(element);
    const href = elementHref(element);

    return (
      blockedLabels.some((blockedLabel) => label === blockedLabel || label.includes(blockedLabel)) ||
      blockedHrefPatterns.some((pattern) => pattern.test(href))
    );
  };

  const isDocumentationElement = (element) => {
    const label = elementLabel(element);
    return documentationLabels.some((documentationLabel) => label === documentationLabel || label.includes(documentationLabel));
  };

  const closestInteractive = (element) => element.closest?.(interactiveSelector) || element;

  const removeElement = (element) => {
    const target = closestInteractive(element);
    if (!target || target.dataset?.connectPublicLinkRemoved === 'true') return;

    if (target.dataset) target.dataset.connectPublicLinkRemoved = 'true';
    target.remove();
  };

  const hideDocumentationElement = (element) => {
    const target = closestInteractive(element);
    if (!target || target.dataset?.connectDocsPolicy === 'hidden') return;

    target.dataset.connectDocsPolicy = 'hidden';
    target.style.setProperty('display', 'none', 'important');
    target.setAttribute('aria-hidden', 'true');
    target.setAttribute('tabindex', '-1');
  };

  const showDocumentationElement = (element) => {
    const target = closestInteractive(element);
    if (!target) return;

    if (target instanceof HTMLAnchorElement) {
      if (target.getAttribute('href') !== documentationUrl) target.setAttribute('href', documentationUrl);
      target.setAttribute('target', '_blank');
      target.setAttribute('rel', 'noopener noreferrer');
    } else {
      target.dataset.connectDocumentationUrl = documentationUrl;
      target.setAttribute('role', target.getAttribute('role') || 'link');
    }

    target.removeAttribute('aria-hidden');
    target.removeAttribute('tabindex');
    target.style.removeProperty('display');
    target.dataset.connectDocsPolicy = 'visible';
  };

  const sanitizeUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return '';

    try {
      const parsed = new URL(value.trim(), window.location.origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      return parsed.href.replace(/\/$/, '');
    } catch (_error) {
      return '';
    }
  };

  const applyPolicy = () => {
    applyScheduled = false;

    document.querySelectorAll(interactiveSelector).forEach((element) => {
      if (isBlockedElement(element)) {
        removeElement(element);
        return;
      }

      if (!isDocumentationElement(element)) return;

      if (!documentationResolved || !documentationUrl) {
        hideDocumentationElement(element);
        return;
      }

      showDocumentationElement(element);
    });

    // Fallback for menu implementations that render labels inside non-semantic wrappers.
    document.querySelectorAll('span,div,p').forEach((element) => {
      const label = elementLabel(element);
      if (!label || label.length > 80) return;

      if (blockedLabels.some((blockedLabel) => label === blockedLabel)) {
        removeElement(element);
        return;
      }

      if (!documentationLabels.some((documentationLabel) => label === documentationLabel)) return;

      if (!documentationResolved || !documentationUrl) hideDocumentationElement(element);
      else showDocumentationElement(element);
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
        documentationUrl = sanitizeUrl(payload?.documentation);
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

      const interactive = target.closest(interactiveSelector);
      if (!interactive) return;

      if (isBlockedElement(interactive)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        removeElement(interactive);
        return;
      }

      if (!isDocumentationElement(interactive)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (!documentationResolved || !documentationUrl) {
        hideDocumentationElement(interactive);
        return;
      }

      window.open(documentationUrl, '_blank', 'noopener,noreferrer');
    },
    true,
  );

  const start = () => {
    const observer = new MutationObserver(schedulePolicy);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'aria-label', 'title'],
    });

    schedulePolicy();
    void loadPublicConfiguration();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

/** Resolve a documentation asset without allowing request data to choose a host. */
export function internalDocsTarget(baseUrl: string, requestUrl: string): URL {
  const target = new URL(baseUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Invalid internal documentation service');
  }
  if (typeof requestUrl !== 'string' || requestUrl.length > 8192 || /[\u0000-\u001f\u007f\\]/.test(requestUrl)) {
    throw new Error('Invalid documentation path');
  }
  // Request URLs may select only a path and query. Never resolve an untrusted
  // relative URL against the internal service: //host would change the origin.
  const question = requestUrl.indexOf('?');
  const pathname = question < 0 ? requestUrl : requestUrl.slice(0, question);
  if (pathname.includes('#') || (pathname && !pathname.startsWith('/')) || pathname.startsWith('//')) {
    throw new Error('Invalid documentation path');
  }
  const decoded = decodeURIComponent(pathname);
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || decoded.startsWith('//') || decoded.split('/').includes('..')) {
    throw new Error('Invalid documentation path');
  }
  target.pathname = pathname || '/';
  target.search = question < 0 ? '' : requestUrl.slice(question);
  target.hash = '';
  return target;
}

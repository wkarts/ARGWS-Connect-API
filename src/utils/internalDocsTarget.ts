function hasForbiddenCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === '\\';
  });
}

/** Resolve a documentation asset without allowing request data to choose a host. */
export function internalDocsTarget(baseUrl: string, requestUrl: string): URL {
  const target = new URL(baseUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Invalid internal documentation service');
  }
  if (typeof requestUrl !== 'string' || requestUrl.length > 8192 || hasForbiddenCharacter(requestUrl)) {
    throw new Error('Invalid documentation path');
  }
  // Untrusted data can select only a path/query, never authority or protocol.
  const question = requestUrl.indexOf('?');
  const pathname = question < 0 ? requestUrl : requestUrl.slice(0, question);
  if (pathname.includes('#') || (pathname && !pathname.startsWith('/')) || pathname.startsWith('//')) {
    throw new Error('Invalid documentation path');
  }
  const decoded = decodeURIComponent(pathname);
  if (hasForbiddenCharacter(decoded) || decoded.startsWith('//') || decoded.split('/').includes('..')) {
    throw new Error('Invalid documentation path');
  }
  target.pathname = pathname || '/';
  target.search = question < 0 ? '' : requestUrl.slice(question);
  target.hash = '';
  return target;
}

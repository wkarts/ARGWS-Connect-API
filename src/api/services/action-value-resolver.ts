function getPath(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function resolveString(value: string, context: Record<string, unknown>): unknown {
  const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (exact) return getPath(context, exact[1].trim());

  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path) => {
    const resolved = getPath(context, String(path).trim());
    return resolved === null || resolved === undefined ? '' : String(resolved);
  });
}

export function resolveActionValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') return resolveString(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveActionValue(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveActionValue(item, context)]),
    );
  }
  return value;
}

export function getActionValue(source: unknown, path: string): unknown {
  return getPath(source, path);
}

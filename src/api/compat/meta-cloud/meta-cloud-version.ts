export const isMetaGraphVersion = (version: string) => /^v[0-9]+\.[0-9]+$/.test(version || '');

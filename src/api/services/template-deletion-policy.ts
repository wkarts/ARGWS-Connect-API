export type TemplateDeletionCandidate = {
  origin?: string | null;
  isDefault?: boolean | null;
};

export function isProtectedTemplate(candidate: TemplateDeletionCandidate | null | undefined): boolean {
  if (!candidate) return false;
  return candidate.isDefault === true || String(candidate.origin || '').toUpperCase() === 'SYSTEM';
}

export function containsProtectedTemplate(candidates: TemplateDeletionCandidate[] | null | undefined): boolean {
  return Array.isArray(candidates) && candidates.some(isProtectedTemplate);
}

type Phase6Binding = {
  id: string;
  matchTitle?: string;
  interactionType?: string;
  type?: 'ACTION' | 'RECIPE' | 'NONE';
  key?: string;
  input?: unknown;
  capture?: unknown;
  locationPolicy?: unknown;
  confirmOnInteraction?: boolean;
  keepSessionOpen?: boolean;
  retryOnError?: boolean;
  response?: unknown;
  onError?: unknown;
  phase6Generated?: boolean;
};

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function rows(item: any) {
  if (String(item?.type || '').toUpperCase() === 'LIST') {
    return (Array.isArray(item.sections) ? item.sections : []).flatMap((section: any) =>
      Array.isArray(section?.rows) ? section.rows : [],
    );
  }
  return Array.isArray(item?.options) ? item.options : [];
}

function transportReplyTypes(item: any) {
  return String(item?.type || '').toUpperCase() === 'LIST'
    ? ['list_reply', 'text_reply']
    : ['button_reply', 'list_reply', 'poll_reply', 'text_reply'];
}

export function mergePolicyInteractionBindings(actions: unknown, policy: unknown) {
  const source = asObject(actions);
  const manual = (Array.isArray(source.bindings) ? source.bindings : []).filter(
    (binding: any) => binding?.phase6Generated !== true,
  );
  const byId = new Map<string, Phase6Binding>();
  for (const binding of manual) {
    const id = String(binding?.id || '').trim();
    if (id) byId.set(id, { ...binding });
  }

  const interactions = asObject(policy).interactionsV2;
  const items = Number(interactions?.version) === 2 && Array.isArray(interactions?.items) ? interactions.items : [];

  for (const item of items) {
    const interactionId = String(item?.id || '').trim();
    if (!interactionId) continue;

    for (const row of rows(item)) {
      const id = String(row?.id || '').trim();
      if (!id || (!row?.capture && !row?.binding && !row?.locationPolicy)) continue;
      const current = byId.get(id) || ({ id } as Phase6Binding);
      byId.set(id, {
        ...current,
        id,
        matchTitle: row?.title ? String(row.title) : current.matchTitle,
        type: row?.binding?.type || current.type || 'NONE',
        key: row?.binding?.key || current.key,
        input: row?.binding?.input ?? current.input,
        capture: row?.capture ?? current.capture,
        locationPolicy: row?.locationPolicy ?? current.locationPolicy,
        confirmOnInteraction: row?.binding?.confirmOnInteraction ?? current.confirmOnInteraction,
        keepSessionOpen: row?.binding?.keepSessionOpen ?? current.keepSessionOpen ?? true,
        retryOnError: row?.binding?.retryOnError ?? current.retryOnError,
        response: row?.binding?.response ?? current.response,
        onError: row?.binding?.onError ?? current.onError,
        phase6Generated: true,
      });
    }

    const sourceDefinition = item?.source;
    if (sourceDefinition?.capture || sourceDefinition?.binding || sourceDefinition?.locationPolicy) {
      for (const replyType of transportReplyTypes(item)) {
        const id = `__phase6_${interactionId}_${replyType}`;
        byId.set(id, {
          id,
          interactionType: replyType,
          type: sourceDefinition?.binding?.type || 'NONE',
          key: sourceDefinition?.binding?.key,
          input: sourceDefinition?.binding?.input,
          capture: sourceDefinition?.capture,
          locationPolicy: sourceDefinition?.locationPolicy,
          confirmOnInteraction: sourceDefinition?.binding?.confirmOnInteraction,
          keepSessionOpen: sourceDefinition?.binding?.keepSessionOpen ?? true,
          retryOnError: sourceDefinition?.binding?.retryOnError,
          response: sourceDefinition?.binding?.response,
          onError: sourceDefinition?.binding?.onError,
          phase6Generated: true,
        });
      }
    }
  }

  return { ...source, bindings: [...byId.values()] };
}

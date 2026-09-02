export type InteractionChoiceMode = 'SINGLE' | 'MULTIPLE';

export type InteractionCapture = {
  path: string;
  value?: unknown;
  includePayload?: boolean;
};

export type InteractionRowDefinition = {
  id: string;
  title: string;
  description?: string;
  capture?: InteractionCapture;
};

export type InteractionSectionDefinition = {
  title?: string;
  rows: InteractionRowDefinition[];
};

export type DynamicCollectionSource = {
  path: string;
  id: string;
  title: string;
  description?: string;
  sectionTitle?: string;
};

export type ListInteractionDefinition = {
  type: 'LIST';
  id: string;
  title?: string;
  body?: string;
  footer?: string;
  buttonText?: string;
  sections?: InteractionSectionDefinition[];
  source?: DynamicCollectionSource;
};

export type ChoiceOptionDefinition = {
  id: string;
  title: string;
  description?: string;
  capture?: InteractionCapture;
};

export type ChoiceInteractionDefinition = {
  type: 'CHOICE';
  id: string;
  title?: string;
  body?: string;
  footer?: string;
  mode?: InteractionChoiceMode;
  options?: ChoiceOptionDefinition[];
  source?: DynamicCollectionSource;
};

export type TemplateInteractionDefinition = ListInteractionDefinition | ChoiceInteractionDefinition;

export type InteractionModelV2 = {
  version: 2;
  items: TemplateInteractionDefinition[];
};

export type RenderedInteractionRow = {
  id: string;
  title: string;
  description?: string;
  capture?: InteractionCapture;
};

export type RenderedListInteraction = {
  type: 'list';
  id: string;
  title?: string;
  body?: string;
  footer?: string;
  buttonText: string;
  sections: Array<{ title?: string; rows: RenderedInteractionRow[] }>;
};

export type RenderedChoiceInteraction = {
  type: 'choice';
  id: string;
  title?: string;
  body?: string;
  footer?: string;
  mode: InteractionChoiceMode;
  options: RenderedInteractionRow[];
};

export type RenderedTemplateInteraction = RenderedListInteraction | RenderedChoiceInteraction;

const SAFE_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\[(?:\d+)\]|\.[A-Za-z_$][A-Za-z0-9_$]*|\["[^"]+"\]|\['[^']+'\])*$/;

export function resolveDataPath(source: unknown, path: string): unknown {
  const normalized = String(path || '')
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/^result\.?/, '');
  if (!normalized) return source;
  if (!SAFE_PATH.test(normalized)) return undefined;

  const parts = normalized
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\["([^"]+)"\]/g, '.$1')
    .replace(/\['([^']+)'\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: any = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function interpolateInteractionValue(template: unknown, context: Record<string, unknown>): string {
  return String(template ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path) => {
    return stringifyValue(resolveDataPath(context, String(path)));
  });
}

function normalizeRow(row: any): InteractionRowDefinition | null {
  const id = String(row?.id || '').trim();
  const title = String(row?.title || row?.text || '').trim();
  if (!id || !title) return null;
  return {
    id,
    title,
    description: row?.description ? String(row.description) : undefined,
    capture: row?.capture,
  };
}

function dynamicRows(source: DynamicCollectionSource, variables: Record<string, unknown>): RenderedInteractionRow[] {
  const values = resolveDataPath(variables, source.path);
  if (!Array.isArray(values)) return [];

  return values.flatMap((item, index): RenderedInteractionRow[] => {
    const context = { ...variables, item, index };
    const id = interpolateInteractionValue(source.id, context).trim();
    const title = interpolateInteractionValue(source.title, context).trim();
    if (!id || !title) return [];
    const description = source.description
      ? interpolateInteractionValue(source.description, context).trim()
      : undefined;
    return [{ id, title, description: description || undefined }];
  });
}

function staticRows(rows: unknown): RenderedInteractionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeRow).filter((item): item is InteractionRowDefinition => Boolean(item));
}

export function interactionModelFromPolicy(policy: unknown): InteractionModelV2 {
  const raw = policy && typeof policy === 'object' ? (policy as any).interactionsV2 : undefined;
  if (!raw || Number(raw.version) !== 2 || !Array.isArray(raw.items)) return { version: 2, items: [] };

  const items = raw.items.filter((item: any) => {
    const type = String(item?.type || '').toUpperCase();
    return (type === 'LIST' || type === 'CHOICE') && String(item?.id || '').trim();
  }) as TemplateInteractionDefinition[];

  return { version: 2, items };
}

export function renderInteractionModelV2(
  policy: unknown,
  variables: Record<string, unknown> = {},
): RenderedTemplateInteraction[] {
  const model = interactionModelFromPolicy(policy);

  return model.items
    .map((definition): RenderedTemplateInteraction | null => {
      if (definition.type === 'LIST') {
        const sections = Array.isArray(definition.sections)
          ? definition.sections
              .map((section) => ({ title: section.title, rows: staticRows(section.rows) }))
              .filter((section) => section.rows.length > 0)
          : [];

        if (definition.source) {
          const rows = dynamicRows(definition.source, variables);
          if (rows.length) sections.push({ title: definition.source.sectionTitle, rows });
        }

        if (!sections.length) return null;
        return {
          type: 'list',
          id: definition.id,
          title: definition.title,
          body: definition.body,
          footer: definition.footer,
          buttonText: definition.buttonText || 'Ver opções',
          sections,
        };
      }

      const options = [
        ...staticRows(definition.options),
        ...(definition.source ? dynamicRows(definition.source, variables) : []),
      ];
      if (!options.length) return null;
      return {
        type: 'choice',
        id: definition.id,
        title: definition.title,
        body: definition.body,
        footer: definition.footer,
        mode: definition.mode === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE',
        options,
      };
    })
    .filter((item): item is RenderedTemplateInteraction => Boolean(item));
}

export function interactionTextFallback(interaction: RenderedTemplateInteraction): string {
  const lines = [interaction.title, interaction.body].filter(Boolean) as string[];
  const rows = interaction.type === 'list' ? interaction.sections.flatMap((section) => section.rows) : interaction.options;
  if (rows.length) {
    lines.push(
      ['Responda com o nome da opção:', ...rows.map((row) => `• ${row.title}${row.description ? ` — ${row.description}` : ''}`)].join(
        '\n',
      ),
    );
  }
  if (interaction.footer) lines.push(interaction.footer);
  return lines.join('\n\n').trim();
}

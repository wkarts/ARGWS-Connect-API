export type TemplateRenderButton = {
  type: 'reply' | 'copy' | 'url' | 'call';
  displayText?: string;
  id?: string;
  url?: string;
  copyCode?: string;
  phoneNumber?: string;
};

export type RenderedTemplate = {
  title?: string;
  text: string;
  footer?: string;
  buttons: TemplateRenderButton[];
};

function normalizeComponentType(value?: string) {
  return String(value || '').trim().toUpperCase();
}

function stringifyParameter(parameter: any): string {
  if (parameter === null || parameter === undefined) return '';
  if (typeof parameter === 'string' || typeof parameter === 'number' || typeof parameter === 'boolean') {
    return String(parameter);
  }

  if (parameter.text !== undefined) return String(parameter.text);
  if (parameter.currency?.fallback_value !== undefined) return String(parameter.currency.fallback_value);
  if (parameter.date_time?.fallback_value !== undefined) return String(parameter.date_time.fallback_value);
  if (parameter.payload !== undefined) return String(parameter.payload);

  const media = parameter.image || parameter.video || parameter.document;
  if (media?.link) return String(media.link);
  if (media?.id) return String(media.id);

  return '';
}

function requestParameters(components: any[], type: string, index?: number) {
  const normalized = normalizeComponentType(type);
  const match = components.find((component) => {
    if (normalizeComponentType(component?.type) !== normalized) return false;
    if (index === undefined) return true;
    return Number(component?.index ?? component?.sub_type_index ?? -1) === index;
  });
  return Array.isArray(match?.parameters) ? match.parameters : [];
}

function interpolate(text: string, positional: any[], variables: Record<string, any>) {
  let rendered = String(text || '');

  rendered = rendered.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, rawIndex) => {
    const value = positional[Number(rawIndex) - 1];
    return stringifyParameter(value);
  });

  rendered = rendered.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, (_match, key) => {
    const value = variables?.[key];
    return value === undefined || value === null ? '' : String(value);
  });

  return rendered;
}

function buttonFromDefinition(button: any, index: number, requestComponents: any[], variables: Record<string, any>) {
  const type = normalizeComponentType(button?.type);
  const parameters = requestParameters(requestComponents, 'BUTTON', index);
  const firstParameter = parameters[0];
  const label = interpolate(button?.text || button?.title || `Opção ${index + 1}`, parameters, variables);

  if (type === 'URL') {
    const suffix = stringifyParameter(firstParameter);
    const rawUrl = interpolate(button?.url || '', parameters, variables);
    return {
      type: 'url' as const,
      displayText: label,
      url: suffix && rawUrl.includes('{{1}}') ? rawUrl.replace('{{1}}', encodeURIComponent(suffix)) : rawUrl,
    };
  }

  if (type === 'PHONE_NUMBER') {
    return { type: 'call' as const, displayText: label, phoneNumber: String(button?.phone_number || '') };
  }

  if (type === 'COPY_CODE') {
    return {
      type: 'copy' as const,
      displayText: label,
      copyCode: stringifyParameter(firstParameter) || String(button?.example || button?.code || ''),
    };
  }

  return {
    type: 'reply' as const,
    displayText: label,
    id: String(firstParameter?.payload || firstParameter?.text || button?.id || button?.payload || `template_button_${index}`),
  };
}

export function renderTemplateDefinition(
  definition: any,
  requestComponents: any[] = [],
  variables: Record<string, any> = {},
): RenderedTemplate {
  const components = Array.isArray(definition?.components) ? definition.components : [];
  const textParts: string[] = [];
  let title: string | undefined;
  let footer: string | undefined;
  const buttons: TemplateRenderButton[] = [];

  for (const component of components) {
    const type = normalizeComponentType(component?.type);

    if (type === 'HEADER' && component?.format && normalizeComponentType(component.format) !== 'TEXT') continue;

    if (type === 'HEADER' && component?.text) {
      title = interpolate(component.text, requestParameters(requestComponents, 'HEADER'), variables).trim();
      continue;
    }

    if (type === 'BODY' && component?.text) {
      const body = interpolate(component.text, requestParameters(requestComponents, 'BODY'), variables).trim();
      if (body) textParts.push(body);
      continue;
    }

    if (type === 'FOOTER' && component?.text) {
      footer = interpolate(component.text, requestParameters(requestComponents, 'FOOTER'), variables).trim();
      continue;
    }

    if (type === 'BUTTONS' && Array.isArray(component?.buttons)) {
      component.buttons.forEach((button: any, index: number) => {
        buttons.push(buttonFromDefinition(button, index, requestComponents, variables));
      });
    }
  }

  if (title && !buttons.length) textParts.unshift(title);
  if (footer && !buttons.length) textParts.push(footer);

  const text = textParts.filter(Boolean).join('\n\n').trim();
  return { title, text, footer, buttons };
}

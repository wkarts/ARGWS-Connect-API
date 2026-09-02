import { RenderedTemplate } from './template-renderer';

export type TemplateTransportMode = 'PROVIDER_NATIVE' | 'TEXT' | 'INTERACTIVE' | 'POLL_COMPAT' | 'TEXT_COMPAT';
export type CapabilityLevel = 'NATIVE' | 'POLL_COMPAT' | 'TEXT_COMPAT' | 'UNSUPPORTED';

export type ProviderTemplateCapabilities = {
  provider: string;
  providerNativeTemplates: boolean;
  canonicalTemplateContract: boolean;
  quickReply: CapabilityLevel;
  urlButton: CapabilityLevel;
  phoneButton: CapabilityLevel;
  copyCodeButton: CapabilityLevel;
  list: CapabilityLevel;
  transportNotes: string[];
};

export type PlannedButtonTransport = {
  id?: string;
  title: string;
  canonicalType: string;
  transport: 'NATIVE_BUTTON' | 'POLL_OPTION' | 'TEXT_LINK' | 'TEXT_PHONE' | 'TEXT_CODE' | 'TEXT_OPTION';
  degraded: boolean;
};

export type TemplateTransportPlan = {
  provider: string;
  mode: TemplateTransportMode;
  compatibilityTransport?: string;
  degraded: boolean;
  warnings: string[];
  buttons: PlannedButtonTransport[];
};

function plannedTextButton(button: RenderedTemplate['buttons'][number]): PlannedButtonTransport {
  return {
    id: button.id,
    title: String(button.displayText || ''),
    canonicalType: button.type,
    transport:
      button.type === 'url'
        ? 'TEXT_LINK'
        : button.type === 'call'
          ? 'TEXT_PHONE'
          : button.type === 'copy'
            ? 'TEXT_CODE'
            : 'TEXT_OPTION',
    degraded: true,
  };
}

function textCompatibilityPlan(
  provider: string,
  rendered: RenderedTemplate,
  compatibilityTransport: string,
  warning: string,
): TemplateTransportPlan {
  return {
    provider,
    mode: 'TEXT_COMPAT',
    compatibilityTransport,
    degraded: true,
    warnings: [warning],
    buttons: rendered.buttons.map(plannedTextButton),
  };
}

export function getProviderTemplateCapabilities(provider?: string): ProviderTemplateCapabilities {
  const normalized = String(provider || 'UNKNOWN').toUpperCase();

  if (normalized === 'WHATSAPP-BUSINESS') {
    return {
      provider: normalized,
      providerNativeTemplates: true,
      canonicalTemplateContract: true,
      quickReply: 'NATIVE',
      urlButton: 'NATIVE',
      phoneButton: 'NATIVE',
      copyCodeButton: 'NATIVE',
      list: 'NATIVE',
      transportNotes: ['Templates e interações são delegados ao provider oficial Meta.'],
    };
  }

  if (normalized === 'WHATSAPP-BAILEYS') {
    return {
      provider: normalized,
      providerNativeTemplates: false,
      canonicalTemplateContract: true,
      quickReply: 'POLL_COMPAT',
      urlButton: 'TEXT_COMPAT',
      phoneButton: 'TEXT_COMPAT',
      copyCodeButton: 'TEXT_COMPAT',
      list: 'TEXT_COMPAT',
      transportNotes: [
        'Quick replies usam poll de escolha única para compatibilidade real com WhatsApp Desktop e mobile.',
        'URL, telefone, copiar código e combinações não representáveis são preservados como conteúdo textual funcional.',
      ],
    };
  }

  if (normalized === 'CONNECT') {
    return {
      provider: normalized,
      providerNativeTemplates: false,
      canonicalTemplateContract: true,
      quickReply: 'NATIVE',
      urlButton: 'NATIVE',
      phoneButton: 'NATIVE',
      copyCodeButton: 'NATIVE',
      list: 'UNSUPPORTED',
      transportNotes: [
        'Templates locais usam o adaptador buttonMessage já existente no provider CONNECT.',
        'Listas não são declaradas como suportadas porque listMessage é indisponível no provider CONNECT atual.',
      ],
    };
  }

  return {
    provider: normalized,
    providerNativeTemplates: false,
    canonicalTemplateContract: true,
    quickReply: 'UNSUPPORTED',
    urlButton: 'UNSUPPORTED',
    phoneButton: 'UNSUPPORTED',
    copyCodeButton: 'UNSUPPORTED',
    list: 'UNSUPPORTED',
    transportNotes: [
      'Provider sem capability interativa declarada; o Template Engine preserva o conteúdo com transporte textual.',
    ],
  };
}

export function planTemplateTransport(provider: string | undefined, rendered: RenderedTemplate): TemplateTransportPlan {
  const capabilities = getProviderTemplateCapabilities(provider);
  const normalized = capabilities.provider;
  const buttons = rendered.buttons || [];

  if (normalized === 'WHATSAPP-BUSINESS') {
    return {
      provider: normalized,
      mode: 'PROVIDER_NATIVE',
      degraded: false,
      warnings: [],
      buttons: buttons.map((button) => ({
        id: button.id,
        title: String(button.displayText || ''),
        canonicalType: button.type,
        transport: 'NATIVE_BUTTON',
        degraded: false,
      })),
    };
  }

  if (!buttons.length) {
    return { provider: normalized, mode: 'TEXT', degraded: false, warnings: [], buttons: [] };
  }

  if (normalized === 'WHATSAPP-BAILEYS') {
    const replies = buttons.filter((button) => button.type === 'reply' && button.displayText);
    const replyOnly = replies.length > 0 && replies.length === buttons.length;
    if (replyOnly) {
      return {
        provider: normalized,
        mode: 'POLL_COMPAT',
        compatibilityTransport: 'BAILEYS_OFFICIAL_POLL',
        degraded: true,
        warnings: ['Quick replies serão exibidos como enquete de escolha única neste provider.'],
        buttons: replies.map((button) => ({
          id: button.id,
          title: String(button.displayText || ''),
          canonicalType: button.type,
          transport: 'POLL_OPTION',
          degraded: true,
        })),
      };
    }

    return textCompatibilityPlan(
      normalized,
      rendered,
      'BAILEYS_TEXT',
      'Este conjunto de interações será convertido para conteúdo textual funcional neste provider.',
    );
  }

  if (normalized === 'CONNECT') {
    return {
      provider: normalized,
      mode: 'INTERACTIVE',
      degraded: false,
      warnings: [],
      buttons: buttons.map((button) => ({
        id: button.id,
        title: String(button.displayText || ''),
        canonicalType: button.type,
        transport: 'NATIVE_BUTTON',
        degraded: false,
      })),
    };
  }

  return textCompatibilityPlan(
    normalized,
    rendered,
    'GENERIC_TEXT',
    'Provider sem capability interativa declarada; as interações serão preservadas como conteúdo textual funcional.',
  );
}

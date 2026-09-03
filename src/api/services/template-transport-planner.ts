import { RenderedTemplateInteraction } from './template-interaction-model';
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
  choice: CapabilityLevel;
  microApp: CapabilityLevel;
  transportNotes: string[];
};

export type PlannedButtonTransport = {
  id?: string;
  title: string;
  canonicalType: string;
  transport: 'NATIVE_BUTTON' | 'POLL_OPTION' | 'TEXT_LINK' | 'TEXT_PHONE' | 'TEXT_CODE' | 'TEXT_OPTION';
  degraded: boolean;
};

export type PlannedInteractionTransport = {
  id: string;
  type: RenderedTemplateInteraction['type'];
  mode: TemplateTransportMode;
  compatibilityTransport?: string;
  degraded: boolean;
  warnings: string[];
};

export type TemplateTransportPlan = {
  provider: string;
  mode: TemplateTransportMode;
  compatibilityTransport?: string;
  degraded: boolean;
  warnings: string[];
  buttons: PlannedButtonTransport[];
  interactions: PlannedInteractionTransport[];
};

export type TemplateRenderEnvelope = RenderedTemplate & {
  interactions?: RenderedTemplateInteraction[];
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

function interactionPlans(provider: string, rendered: TemplateRenderEnvelope): PlannedInteractionTransport[] {
  const interactions = rendered.interactions || [];

  return interactions.map((interaction) => {
    if (provider === 'WHATSAPP-BUSINESS') {
      return {
        id: interaction.id,
        type: interaction.type,
        mode: 'INTERACTIVE',
        compatibilityTransport: interaction.type === 'list' ? 'META_LIST' : 'META_INTERACTIVE_CHOICE',
        degraded: false,
        warnings: [],
      };
    }

    if (provider === 'WHATSAPP-BAILEYS' && interaction.type === 'list') {
      return {
        id: interaction.id,
        type: interaction.type,
        mode: 'INTERACTIVE',
        compatibilityTransport: 'BAILEYS_LIST',
        degraded: false,
        warnings: [],
      };
    }

    if (provider === 'WHATSAPP-BAILEYS' && interaction.type === 'choice' && interaction.mode === 'SINGLE') {
      return {
        id: interaction.id,
        type: interaction.type,
        mode: 'INTERACTIVE',
        compatibilityTransport: interaction.options.length <= 3 ? 'BAILEYS_BUTTONS' : 'BAILEYS_LIST',
        degraded: false,
        warnings: [],
      };
    }

    if (provider === 'WHATSAPP-BAILEYS' && interaction.type === 'choice') {
      return {
        id: interaction.id,
        type: interaction.type,
        mode: 'POLL_COMPAT',
        compatibilityTransport: 'BAILEYS_OFFICIAL_POLL',
        degraded: true,
        warnings: ['Escolhas múltiplas continuam usando poll oficial do Baileys.'],
      };
    }

    if (provider === 'CONNECT' && interaction.type === 'choice' && interaction.options.length <= 3) {
      return {
        id: interaction.id,
        type: interaction.type,
        mode: 'INTERACTIVE',
        compatibilityTransport: 'CONNECT_BUTTONS',
        degraded: false,
        warnings: [],
      };
    }

    return {
      id: interaction.id,
      type: interaction.type,
      mode: 'TEXT_COMPAT',
      compatibilityTransport: provider === 'WHATSAPP-BAILEYS' ? 'BAILEYS_TEXT' : 'GENERIC_TEXT',
      degraded: true,
      warnings: [
        interaction.type === 'list'
          ? 'A lista será preservada como opções textuais funcionais neste provider.'
          : 'A escolha será preservada como opções textuais funcionais neste provider.',
      ],
    };
  });
}

function textCompatibilityPlan(
  provider: string,
  rendered: TemplateRenderEnvelope,
  compatibilityTransport: string,
  warning: string,
): TemplateTransportPlan {
  const interactions = interactionPlans(provider, rendered);
  return {
    provider,
    mode: 'TEXT_COMPAT',
    compatibilityTransport,
    degraded: true,
    warnings: [warning],
    buttons: rendered.buttons.map(plannedTextButton),
    interactions,
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
      choice: 'NATIVE',
      microApp: 'NATIVE',
      transportNotes: [
        'Templates são delegados ao provider oficial Meta.',
        'Listas e escolhas do Interaction Model v2 são enviadas como interações posteriores ao template.',
        'Micro Apps são links seguros do Connect|API e não alteram o contrato do template Meta.',
      ],
    };
  }

  if (normalized === 'WHATSAPP-BAILEYS') {
    return {
      provider: normalized,
      providerNativeTemplates: false,
      canonicalTemplateContract: true,
      quickReply: 'NATIVE',
      urlButton: 'NATIVE',
      phoneButton: 'NATIVE',
      copyCodeButton: 'NATIVE',
      list: 'NATIVE',
      choice: 'NATIVE',
      microApp: 'NATIVE',
      transportNotes: [
        'Botões usam interactiveMessage direto com o nó biz/native_flow exigido pelo WhatsApp Web/Desktop.',
        'Listas usam listMessage SINGLE_SELECT com o nó biz/list para compatibilidade Web/Desktop e mobile.',
        'Escolhas múltiplas podem continuar usando poll oficial; falhas reais degradam pelo fallback do Template Engine.',
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
      choice: 'NATIVE',
      microApp: 'NATIVE',
      transportNotes: [
        'Templates locais usam o adaptador buttonMessage já existente no provider CONNECT.',
        'Escolhas pequenas usam botões; coleções maiores e listas degradam para texto quando necessário.',
        'Micro Apps são links seguros do Connect|API.',
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
    choice: 'UNSUPPORTED',
    microApp: 'NATIVE',
    transportNotes: [
      'Provider sem capability interativa declarada; o Template Engine preserva o conteúdo com transporte textual.',
      'Micro Apps continuam disponíveis por URL segura quando o canal aceita links.',
    ],
  };
}

export function planTemplateTransport(
  provider: string | undefined,
  rendered: TemplateRenderEnvelope,
): TemplateTransportPlan {
  const capabilities = getProviderTemplateCapabilities(provider);
  const normalized = capabilities.provider;
  const buttons = rendered.buttons || [];
  const interactions = interactionPlans(normalized, rendered);

  if (normalized === 'WHATSAPP-BUSINESS') {
    return {
      provider: normalized,
      mode: 'PROVIDER_NATIVE',
      degraded: interactions.some((item) => item.degraded),
      warnings: interactions.flatMap((item) => item.warnings),
      buttons: buttons.map((button) => ({
        id: button.id,
        title: String(button.displayText || ''),
        canonicalType: button.type,
        transport: 'NATIVE_BUTTON',
        degraded: false,
      })),
      interactions,
    };
  }

  if (!buttons.length) {
    return {
      provider: normalized,
      mode: 'TEXT',
      degraded: interactions.some((item) => item.degraded),
      warnings: interactions.flatMap((item) => item.warnings),
      buttons: [],
      interactions,
    };
  }

  if (normalized === 'WHATSAPP-BAILEYS') {
    const replyOnly = buttons.every((button) => button.type === 'reply' && button.displayText);
    const ctaOnly = buttons.every((button) => ['url', 'call', 'copy'].includes(button.type) && button.displayText);
    const supportedInteractive = (replyOnly && buttons.length <= 3) || (ctaOnly && buttons.length <= 2);

    if (supportedInteractive) {
      return {
        provider: normalized,
        mode: 'INTERACTIVE',
        compatibilityTransport: 'BAILEYS_NATIVE_INTERACTIVE',
        degraded: interactions.some((item) => item.degraded),
        warnings: interactions.flatMap((item) => item.warnings),
        buttons: buttons.map((button) => ({
          id: button.id,
          title: String(button.displayText || ''),
          canonicalType: button.type,
          transport: 'NATIVE_BUTTON',
          degraded: false,
        })),
        interactions,
      };
    }

    return textCompatibilityPlan(
      normalized,
      rendered,
      'BAILEYS_TEXT',
      'Combinação de botões não representável com segurança; usando fallback textual.',
    );
  }

  if (normalized === 'CONNECT') {
    return {
      provider: normalized,
      mode: 'INTERACTIVE',
      degraded: interactions.some((item) => item.degraded),
      warnings: interactions.flatMap((item) => item.warnings),
      buttons: buttons.map((button) => ({
        id: button.id,
        title: String(button.displayText || ''),
        canonicalType: button.type,
        transport: 'NATIVE_BUTTON',
        degraded: false,
      })),
      interactions,
    };
  }

  return textCompatibilityPlan(
    normalized,
    rendered,
    'GENERIC_TEXT',
    'Provider sem capability interativa declarada; as interações serão preservadas como conteúdo textual funcional.',
  );
}

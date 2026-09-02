export type NormalizedInteraction = {
  type: string;
  id: string;
  title?: string;
  contextMessageId?: string;
  payload?: Record<string, unknown>;
};

function parseParamsJson(value?: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function contextId(node: any): string | undefined {
  return node?.contextInfo?.stanzaId || node?.context?.id || node?.context?.message_id || undefined;
}

function normalizedText(value: unknown) {
  const text = String(value || '').trim();
  if (!text || text.length > 500) return '';
  return text;
}

function fromBaileysNode(node: any): NormalizedInteraction | null {
  if (!node || typeof node !== 'object') return null;

  if (node.buttonsResponseMessage) {
    const response = node.buttonsResponseMessage;
    const id = response.selectedButtonId || response.selectedDisplayText;
    if (id) {
      return {
        type: 'button_reply',
        id: String(id),
        title: response.selectedDisplayText || undefined,
        contextMessageId: contextId(response),
        payload: response,
      };
    }
  }

  if (node.templateButtonReplyMessage) {
    const response = node.templateButtonReplyMessage;
    const id = response.selectedId || response.selectedDisplayText;
    if (id) {
      return {
        type: 'template_button_reply',
        id: String(id),
        title: response.selectedDisplayText || undefined,
        contextMessageId: contextId(response),
        payload: response,
      };
    }
  }

  if (node.listResponseMessage) {
    const response = node.listResponseMessage;
    const reply = response.singleSelectReply || {};
    const id = reply.selectedRowId || response.title;
    if (id) {
      return {
        type: 'list_reply',
        id: String(id),
        title: response.title || reply.title || undefined,
        contextMessageId: contextId(response),
        payload: response,
      };
    }
  }

  if (node.interactiveResponseMessage) {
    const response = node.interactiveResponseMessage;
    const nativeFlow = response.nativeFlowResponseMessage || {};
    const params = parseParamsJson(nativeFlow.paramsJson);
    const id =
      params.id ||
      params.selected_id ||
      params.selectedId ||
      params.row_id ||
      params.button_id ||
      params.payload ||
      nativeFlow.name;
    if (id) {
      return {
        type: String(nativeFlow.name || 'interactive_reply'),
        id: String(id),
        title: String(params.display_text || params.title || params.text || '') || undefined,
        contextMessageId: contextId(response),
        payload: params,
      };
    }
  }

  const text = normalizedText(node.conversation || node.extendedTextMessage?.text);
  if (text) {
    return {
      type: 'text_reply',
      id: text,
      title: text,
      contextMessageId: contextId(node.extendedTextMessage || node),
      payload: { text },
    };
  }

  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    const nested = fromBaileysNode(value);
    if (nested) return nested;
  }

  return null;
}

export function extractBaileysInteraction(message: any): NormalizedInteraction | null {
  return fromBaileysNode(message);
}

export function extractBaileysPollInteraction(message: any): NormalizedInteraction | null {
  const updates = Array.isArray(message?.pollUpdates) ? message.pollUpdates : [];
  const selectedOptions = updates
    .filter((update: any) => Array.isArray(update?.voters) && update.voters.length > 0 && update?.name)
    .map((update: any) => String(update.name));
  if (!selectedOptions.length) return null;

  const selected = selectedOptions[0];
  return {
    type: 'poll_reply',
    id: selected,
    title: selected,
    contextMessageId: message?.message?.pollUpdateMessage?.pollCreationMessageKey?.id || undefined,
    payload: { selectedOptions },
  };
}

export function extractMetaInteraction(message: any): NormalizedInteraction | null {
  if (!message || typeof message !== 'object') return null;

  if (message.interactive) {
    const interactive = message.interactive;
    const reply = interactive[interactive.type] || interactive.button_reply || interactive.list_reply || {};
    const id = reply.id || reply.payload || reply.title;
    if (id) {
      return {
        type: String(interactive.type || 'interactive_reply'),
        id: String(id),
        title: reply.title || reply.text || undefined,
        contextMessageId: message.context?.id,
        payload: reply,
      };
    }
  }

  if (message.button) {
    const button = message.button;
    const id = button.payload || button.id || button.text;
    if (id) {
      return {
        type: 'button_reply',
        id: String(id),
        title: button.text || undefined,
        contextMessageId: message.context?.id,
        payload: button,
      };
    }
  }

  const text = normalizedText(message.text?.body || message.text);
  if (text) {
    return {
      type: 'text_reply',
      id: text,
      title: text,
      contextMessageId: message.context?.id,
      payload: { text },
    };
  }

  return null;
}

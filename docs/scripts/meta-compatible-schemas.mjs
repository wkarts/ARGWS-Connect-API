const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const string = (description, extra = {}) => ({ type: 'string', ...(description ? { description } : {}), ...extra });

export const metaCompatibilityAdminSchemas = {
  MetaCompatibilityConfig: {
    type: 'object',
    description: 'Identidade Graph derivada da instância Connect|API e configuração opcional do webhook Meta Compatible.',
    properties: {
      enabled: { type: 'boolean', const: true, description: 'Mantido por compatibilidade. Meta Compatible é sempre habilitado para instâncias endereçáveis.' },
      instanceName: string('Nome exato da instância Connect|API.'),
      provider: string('Provider real da instância.', { enum: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'CONNECT'] }),
      phoneNumberId: string('Identificador telefônico usado nas rotas /graph.'),
      businessAccountId: string('Identificador business usado nas rotas de templates.'),
      displayPhoneNumber: string('Número telefônico real normalizado da instância.'),
      graphUrl: string('URL base da fachada Meta Compatible.', { format: 'uri' }),
      webhookUrl: { type: ['string', 'null'], format: 'uri', description: 'Webhook Meta Compatible opcional.' },
    },
    required: ['enabled', 'instanceName', 'provider', 'phoneNumberId', 'businessAccountId', 'displayPhoneNumber', 'graphUrl'],
  },
  MetaCompatibilityUpdateRequest: {
    type: 'object',
    description: 'Configuração opcional do webhook Meta Compatible. Não existe toggle de ativação do /graph.',
    properties: {
      webhookUrl: { type: ['string', 'null'], format: 'uri', description: 'URL absoluta HTTP(S) ou null para remover.' },
    },
    additionalProperties: false,
  },
};

export const metaCompatibleSchemas = {
  MetaTextContent: {
    type: 'object',
    properties: { body: string('Texto da mensagem.') },
    required: ['body'],
    additionalProperties: false,
  },
  MetaImageContent: {
    type: 'object',
    description: 'Imagem referenciada por link público ou id previamente enviado ao endpoint de mídia.',
    properties: {
      link: string('URL da imagem.', { format: 'uri' }),
      id: string('ID de mídia temporário retornado por /media.'),
      caption: string('Legenda opcional.'),
      mime_type: string('MIME type opcional.'),
    },
    anyOf: [{ required: ['link'] }, { required: ['id'] }],
    additionalProperties: false,
  },
  MetaVideoContent: {
    type: 'object',
    description: 'Vídeo referenciado por link público ou id previamente enviado ao endpoint de mídia.',
    properties: {
      link: string('URL do vídeo.', { format: 'uri' }),
      id: string('ID de mídia temporário retornado por /media.'),
      caption: string('Legenda opcional.'),
      mime_type: string('MIME type opcional.'),
    },
    anyOf: [{ required: ['link'] }, { required: ['id'] }],
    additionalProperties: false,
  },
  MetaDocumentContent: {
    type: 'object',
    description: 'Documento referenciado por link público ou id previamente enviado ao endpoint de mídia.',
    properties: {
      link: string('URL do documento.', { format: 'uri' }),
      id: string('ID de mídia temporário retornado por /media.'),
      filename: string('Nome do arquivo enviado ao destinatário.'),
      caption: string('Legenda opcional.'),
      mime_type: string('MIME type opcional.'),
    },
    anyOf: [{ required: ['link'] }, { required: ['id'] }],
    additionalProperties: false,
  },
  MetaAudioContent: {
    type: 'object',
    description: 'Áudio referenciado por link público ou id previamente enviado ao endpoint de mídia.',
    properties: {
      link: string('URL do áudio.', { format: 'uri' }),
      id: string('ID de mídia temporário retornado por /media.'),
      mime_type: string('MIME type opcional.'),
    },
    anyOf: [{ required: ['link'] }, { required: ['id'] }],
    additionalProperties: false,
  },
  MetaLocationContent: {
    type: 'object',
    properties: {
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      name: string('Nome opcional do local.'),
      address: string('Endereço opcional do local.'),
    },
    required: ['latitude', 'longitude'],
    additionalProperties: false,
  },
  MetaContactName: {
    type: 'object',
    properties: {
      formatted_name: string('Nome completo formatado.'),
      first_name: string('Primeiro nome.'),
      last_name: string('Sobrenome.'),
    },
    additionalProperties: true,
  },
  MetaContactPhone: {
    type: 'object',
    properties: {
      phone: string('Número telefônico do contato.'),
      wa_id: string('WhatsApp ID numérico alternativo ao campo phone.'),
      type: string('Tipo do telefone, quando fornecido.'),
    },
    anyOf: [{ required: ['phone'] }, { required: ['wa_id'] }],
    additionalProperties: true,
  },
  MetaContactEmail: {
    type: 'object',
    properties: { email: string('E-mail do contato.', { format: 'email' }), type: string('Tipo do e-mail.') },
    required: ['email'],
    additionalProperties: true,
  },
  MetaContactUrl: {
    type: 'object',
    properties: { url: string('URL do contato.', { format: 'uri' }), type: string('Tipo da URL.') },
    required: ['url'],
    additionalProperties: true,
  },
  MetaContactOrg: {
    type: 'object',
    properties: { company: string('Empresa/organização do contato.') },
    additionalProperties: true,
  },
  MetaContact: {
    type: 'object',
    properties: {
      name: ref('MetaContactName'),
      phones: { type: 'array', minItems: 1, items: ref('MetaContactPhone') },
      emails: { type: 'array', items: ref('MetaContactEmail') },
      urls: { type: 'array', items: ref('MetaContactUrl') },
      org: ref('MetaContactOrg'),
    },
    required: ['name', 'phones'],
    additionalProperties: true,
  },
  MetaReactionContent: {
    type: 'object',
    properties: {
      message_id: string('ID real da mensagem/provider que receberá a reação.'),
      emoji: string('Emoji da reação. String vazia pode representar remoção quando suportado pelo provider.'),
    },
    required: ['message_id', 'emoji'],
    additionalProperties: false,
  },
  MetaInteractiveText: {
    type: 'object',
    properties: { text: string('Texto exibido no bloco interativo.') },
    required: ['text'],
    additionalProperties: false,
  },
  MetaInteractiveButtonReply: {
    type: 'object',
    properties: { id: string('Identificador da resposta.'), title: string('Texto exibido no botão.') },
    required: ['id', 'title'],
    additionalProperties: false,
  },
  MetaInteractiveButton: {
    type: 'object',
    properties: { type: { type: 'string', const: 'reply' }, reply: ref('MetaInteractiveButtonReply') },
    required: ['type', 'reply'],
    additionalProperties: false,
  },
  MetaInteractiveListRow: {
    type: 'object',
    properties: {
      id: string('Identificador da linha.'),
      title: string('Título da opção.'),
      description: string('Descrição opcional da opção.'),
    },
    required: ['id', 'title'],
    additionalProperties: false,
  },
  MetaInteractiveListSection: {
    type: 'object',
    properties: {
      title: string('Título da seção.'),
      rows: { type: 'array', minItems: 1, items: ref('MetaInteractiveListRow') },
    },
    required: ['rows'],
    additionalProperties: false,
  },
  MetaInteractiveButtonContent: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'button' },
      header: ref('MetaInteractiveText'),
      body: ref('MetaInteractiveText'),
      footer: ref('MetaInteractiveText'),
      action: {
        type: 'object',
        properties: { buttons: { type: 'array', minItems: 1, items: ref('MetaInteractiveButton') } },
        required: ['buttons'],
        additionalProperties: false,
      },
    },
    required: ['type', 'action'],
    additionalProperties: false,
  },
  MetaInteractiveListContent: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'list' },
      header: ref('MetaInteractiveText'),
      body: ref('MetaInteractiveText'),
      footer: ref('MetaInteractiveText'),
      action: {
        type: 'object',
        properties: {
          button: string('Texto do botão que abre a lista.'),
          sections: { type: 'array', minItems: 1, items: ref('MetaInteractiveListSection') },
        },
        required: ['sections'],
        additionalProperties: false,
      },
    },
    required: ['type', 'action'],
    additionalProperties: false,
  },
  MetaInteractiveContent: {
    oneOf: [ref('MetaInteractiveButtonContent'), ref('MetaInteractiveListContent')],
    description: 'Interativo suportado atualmente: button ou list.',
  },
  MetaMessageBase: {
    type: 'object',
    properties: {
      messaging_product: { type: 'string', const: 'whatsapp' },
      recipient_type: { type: 'string', enum: ['individual'] },
      to: string('Número internacional do destinatário; caracteres não numéricos são normalizados pelo adapter.'),
    },
    required: ['to'],
  },
  MetaTextMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'text' }, text: ref('MetaTextContent') }, required: ['type', 'text'] }],
  },
  MetaImageMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'image' }, image: ref('MetaImageContent') }, required: ['type', 'image'] }],
  },
  MetaVideoMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'video' }, video: ref('MetaVideoContent') }, required: ['type', 'video'] }],
  },
  MetaDocumentMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'document' }, document: ref('MetaDocumentContent') }, required: ['type', 'document'] }],
  },
  MetaAudioMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'audio' }, audio: ref('MetaAudioContent') }, required: ['type', 'audio'] }],
  },
  MetaLocationMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'location' }, location: ref('MetaLocationContent') }, required: ['type', 'location'] }],
  },
  MetaContactsMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'contacts' }, contacts: { type: 'array', minItems: 1, items: ref('MetaContact') } }, required: ['type', 'contacts'] }],
  },
  MetaReactionMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'reaction' }, reaction: ref('MetaReactionContent') }, required: ['type', 'reaction'] }],
  },
  MetaInteractiveMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'interactive' }, interactive: ref('MetaInteractiveContent') }, required: ['type', 'interactive'] }],
  },
  MetaTemplateLanguage: {
    type: 'object',
    properties: {
      code: string('Código do idioma do template, por exemplo pt_BR.'),
      policy: string('Política de idioma opcional para compatibilidade com clientes Meta.'),
    },
    required: ['code'],
    additionalProperties: false,
  },
  MetaTemplateParameter: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['text', 'currency', 'date_time', 'image', 'video', 'document', 'payload'] },
      text: string('Valor textual do parâmetro.'),
      payload: string('Payload de botão/resposta rápida.'),
      currency: { type: 'object', additionalProperties: true },
      date_time: { type: 'object', additionalProperties: true },
      image: { type: 'object', additionalProperties: true },
      video: { type: 'object', additionalProperties: true },
      document: { type: 'object', additionalProperties: true },
    },
    required: ['type'],
    additionalProperties: true,
  },
  MetaTemplateComponent: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['header', 'body', 'button'] },
      sub_type: string('Subtipo do componente, como quick_reply ou url.'),
      index: { type: 'integer', minimum: 0 },
      parameters: { type: 'array', items: ref('MetaTemplateParameter') },
    },
    required: ['type'],
    additionalProperties: true,
  },
  MetaTemplateContent: {
    type: 'object',
    description: 'Template canônico da instância. Em WHATSAPP-BUSINESS é executado como template Meta real; em providers compatíveis é renderizado pelo Connect|API.',
    properties: {
      name: string('Nome do template.'),
      language: ref('MetaTemplateLanguage'),
      components: { type: 'array', items: ref('MetaTemplateComponent') },
    },
    required: ['name', 'language'],
    additionalProperties: false,
  },
  MetaTemplateMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'template' }, template: ref('MetaTemplateContent') }, required: ['type', 'template'] }],
  },
  MetaReadReceiptRequest: {
    type: 'object',
    properties: {
      messaging_product: { type: 'string', const: 'whatsapp' },
      status: { type: 'string', const: 'read' },
      message_id: string('ID real da mensagem/provider a marcar como lida.'),
    },
    required: ['status', 'message_id'],
    additionalProperties: false,
  },
  MetaMessageRequest: {
    oneOf: [
      ref('MetaTextMessageRequest'), ref('MetaImageMessageRequest'), ref('MetaVideoMessageRequest'),
      ref('MetaDocumentMessageRequest'), ref('MetaAudioMessageRequest'), ref('MetaLocationMessageRequest'),
      ref('MetaContactsMessageRequest'), ref('MetaReactionMessageRequest'), ref('MetaInteractiveMessageRequest'),
      ref('MetaTemplateMessageRequest'), ref('MetaReadReceiptRequest'),
    ],
    description: 'Union dos formatos de mensagem aceitos atualmente pela fachada Meta Compatible.',
  },
  MetaMessageContact: {
    type: 'object',
    properties: { input: string('Destinatário normalizado.'), wa_id: string('WhatsApp ID normalizado.') },
    required: ['input', 'wa_id'],
    additionalProperties: false,
  },
  MetaMessageId: {
    type: 'object',
    properties: { id: string('ID real retornado pelo provider; não é criado wamid artificial.') },
    required: ['id'],
    additionalProperties: false,
  },
  MetaMessageResponse: {
    type: 'object',
    properties: {
      messaging_product: { type: 'string', const: 'whatsapp' },
      contacts: { type: 'array', items: ref('MetaMessageContact') },
      messages: { type: 'array', items: ref('MetaMessageId') },
    },
    required: ['messaging_product', 'contacts', 'messages'],
    additionalProperties: false,
  },
  MetaReadReceiptResponse: {
    type: 'object',
    properties: { success: { type: 'boolean', const: true } },
    required: ['success'],
    additionalProperties: false,
  },
  MetaMediaUploadRequest: {
    type: 'object',
    properties: {
      file: { type: 'string', format: 'binary' },
      type: string('MIME type declarado; se ausente é usado o MIME do upload.'),
      messaging_product: { type: 'string', const: 'whatsapp' },
    },
    required: ['file'],
  },
  MetaMediaUploadResponse: {
    type: 'object',
    properties: { id: string('ID temporário de mídia válido para a instância.') },
    required: ['id'],
    additionalProperties: false,
  },
  MetaMediaResponse: {
    type: 'object',
    properties: {
      id: string('ID real/temporário da mídia.'),
      mime_type: string('MIME type persistido.'),
      url: string('URL presigned temporária para download.', { format: 'uri' }),
    },
    required: ['id', 'mime_type', 'url'],
    additionalProperties: false,
  },
  MetaTemplate: {
    type: 'object',
    description: 'Template retornado pelo provider oficial. A estrutura adicional é preservada porque varia conforme o provider/versão.',
    properties: {
      id: string('Identificador do template.'),
      name: string('Nome do template.'),
      status: string('Status do template.'),
      language: string('Idioma do template.'),
      category: string('Categoria do template.'),
      components: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    additionalProperties: true,
  },
  MetaTemplateListResponse: {
    type: 'object',
    properties: { data: { type: 'array', items: ref('MetaTemplate') } },
    required: ['data'],
    additionalProperties: true,
  },
  MetaWebhookMessage: {
    type: 'object',
    description: 'Mensagem serializada no formato Meta Compatible. O conteúdo específico depende do tipo recebido.',
    properties: {
      id: string('ID real da mensagem/provider.'),
      from: string('Remetente normalizado.'),
      timestamp: string('Timestamp Meta-compatible.'),
      type: string('Tipo da mensagem.'),
      text: ref('MetaTextContent'),
      image: { type: 'object', additionalProperties: true },
      video: { type: 'object', additionalProperties: true },
      document: { type: 'object', additionalProperties: true },
      audio: { type: 'object', additionalProperties: true },
    },
    required: ['id'],
    additionalProperties: true,
  },
  MetaWebhookStatus: {
    type: 'object',
    properties: {
      id: string('ID real da mensagem/provider.'),
      status: { type: 'string', enum: ['sent', 'delivered', 'read', 'failed', 'deleted'] },
      timestamp: string('Timestamp do status.'),
      recipient_id: string('Destinatário quando disponível.'),
    },
    required: ['id', 'status'],
    additionalProperties: true,
  },
  MetaWebhookValue: {
    type: 'object',
    properties: {
      messaging_product: { type: 'string', const: 'whatsapp' },
      metadata: { type: 'object', additionalProperties: true },
      contacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
      messages: { type: 'array', items: ref('MetaWebhookMessage') },
      statuses: { type: 'array', items: ref('MetaWebhookStatus') },
    },
    required: ['messaging_product'],
    additionalProperties: true,
  },
  MetaWebhookChange: {
    type: 'object',
    properties: { field: { type: 'string', const: 'messages' }, value: ref('MetaWebhookValue') },
    required: ['field', 'value'],
    additionalProperties: false,
  },
  MetaWebhookEntry: {
    type: 'object',
    properties: { id: string('Business account/identity do evento.'), changes: { type: 'array', items: ref('MetaWebhookChange') } },
    required: ['id', 'changes'],
    additionalProperties: false,
  },
  MetaWebhookPayload: {
    type: 'object',
    properties: { object: { type: 'string', const: 'whatsapp_business_account' }, entry: { type: 'array', items: ref('MetaWebhookEntry') } },
    required: ['object', 'entry'],
    additionalProperties: false,
  },
  GraphErrorDetail: {
    type: 'object',
    properties: {
      message: string('Mensagem segura do erro.'),
      type: string('Tipo Graph-compatible do erro.'),
      code: { type: 'integer', description: 'Código Graph/OAuth compatível.' },
      fbtrace_id: string('Trace id opcional quando disponível.'),
    },
    required: ['message', 'type', 'code'],
    additionalProperties: true,
  },
  GraphError: {
    type: 'object',
    properties: { error: ref('GraphErrorDetail') },
    required: ['error'],
    additionalProperties: false,
  },
};

from pathlib import Path
import re


SERVICE = Path('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts')
PLANNER = Path('src/api/services/template-transport-planner.ts')
ENGINE = Path('src/api/services/template-engine.service.ts')
PACKAGE = Path('package.json')


def patch_service():
    text = SERVICE.read_text()

    if '  BinaryNode,\n' not in text:
        marker = '  AnyMessageContent,\n  BufferedEventData,\n'
        if marker not in text:
            raise SystemExit('Baileys BinaryNode import marker not found')
        text = text.replace(marker, '  AnyMessageContent,\n  BinaryNode,\n  BufferedEventData,\n', 1)

    helper_import = "import { buildInteractiveBizNode, buildListBizNode } from './helpers/interactiveMessage.helper';\n"
    if helper_import not in text:
        marker = "import { BaileysMessageProcessor } from './baileysMessage.processor';\n"
        if marker not in text:
            raise SystemExit('Baileys helper import marker not found')
        text = text.replace(marker, marker + helper_import, 1)

    if 'additionalNodes?: BinaryNode[]' not in text:
        marker = '    contextInfo?: any,\n    // participants?: GroupParticipant[],\n'
        if marker not in text:
            raise SystemExit('sendMessage signature marker not found')
        text = text.replace(marker, '    contextInfo?: any,\n    additionalNodes?: BinaryNode[],\n    // participants?: GroupParticipant[],\n', 1)

    old_condition = "    if (message['viewOnceMessage']) {"
    if old_condition in text:
        text = text.replace(
            old_condition,
            "    if (message['viewOnceMessage'] || message['interactiveMessage'] || message['listMessage']) {",
            1,
        )
    elif "message['interactiveMessage'] || message['listMessage']" not in text:
        raise SystemExit('raw relay interactive condition marker not found')

    old_relay = '      const id = await this.client.relayMessage(sender, message, { messageId });\n'
    if old_relay in text:
        text = text.replace(
            old_relay,
            "      const id = await this.client.relayMessage(sender, message, {\n        messageId,\n        ...(additionalNodes?.length ? { additionalNodes } : {}),\n      });\n",
            1,
        )
    elif '...(additionalNodes?.length ? { additionalNodes } : {})' not in text:
        raise SystemExit('relayMessage marker not found')

    old_typing = """  private async sendMessageWithTyping<T = proto.IMessage>(
    number: string,
    message: T,
    options?: Options,
    isIntegration = false,
  ) {
"""
    if old_typing in text:
        text = text.replace(
            old_typing,
            """  private async sendMessageWithTyping<T = proto.IMessage>(
    number: string,
    message: T,
    options?: Options,
    isIntegration = false,
    additionalNodes?: BinaryNode[],
  ) {
""",
            1,
        )
    elif 'additionalNodes?: BinaryNode[]' not in text[text.find('private async sendMessageWithTyping'):text.find('private async sendMessageWithTyping') + 300]:
        raise SystemExit('sendMessageWithTyping marker not found')

    group_call = """          group?.ephemeralDuration,
          previewContext,
          // group?.participants,
"""
    if group_call in text:
        text = text.replace(
            group_call,
            """          group?.ephemeralDuration,
          previewContext,
          additionalNodes,
          // group?.participants,
""",
            1,
        )

    user_call = """          undefined,
          contextInfo,
        );
"""
    typing_start = text.find('private async sendMessageWithTyping')
    tail = text[typing_start:]
    if user_call in tail and '          additionalNodes,\n        );' not in tail[:12000]:
        tail = tail.replace(
            user_call,
            """          undefined,
          contextInfo,
          additionalNodes,
        );
""",
            1,
        )
        text = text[:typing_start] + tail

    button_pattern = re.compile(r"  public async buttonMessage\(data: SendButtonsDto\) \{.*?\n  public async locationMessage", re.S)
    button_match = button_pattern.search(text)
    if not button_match:
        raise SystemExit('buttonMessage block not found')

    button_block = """  public async buttonMessage(data: SendButtonsDto) {
    if (!data.buttons || data.buttons.length === 0) {
      throw new BadRequestException('At least one button is required');
    }

    const hasReplyButtons = data.buttons.some((btn) => btn.type === 'reply');
    const hasPixButton = data.buttons.some((btn) => btn.type === 'pix');
    const hasCTAButtons = data.buttons.some((btn) => btn.type === 'url' || btn.type === 'call' || btn.type === 'copy');

    if (hasReplyButtons) {
      if (data.buttons.length > 3) throw new BadRequestException('Maximum of 3 reply buttons allowed');
      if (hasCTAButtons || hasPixButton) {
        throw new BadRequestException('Reply buttons cannot be mixed with CTA or PIX buttons');
      }
    }

    if (hasPixButton) {
      if (data.buttons.length > 1) throw new BadRequestException('Only one PIX button is allowed');
      if (hasReplyButtons || hasCTAButtons) {
        throw new BadRequestException('PIX button cannot be mixed with other button types');
      }

      const message: proto.IMessage = {
        interactiveMessage: {
          nativeFlowMessage: {
            buttons: [{ name: this.mapType.get('pix'), buttonParamsJson: this.toJSONString(data.buttons[0]) }],
            messageParamsJson: JSON.stringify({ from: 'api', templateId: v4() }),
          },
        },
      };

      return await this.sendMessageWithTyping(
        data.number,
        message,
        {
          delay: data?.delay,
          presence: 'composing',
          quoted: data?.quoted,
          mentionsEveryOne: data?.mentionsEveryOne,
          mentioned: data?.mentioned,
        },
        false,
        [buildInteractiveBizNode()],
      );
    }

    if (hasCTAButtons) {
      if (data.buttons.length > 2) throw new BadRequestException('Maximum of 2 CTA buttons allowed');
      if (hasReplyButtons) throw new BadRequestException('CTA buttons cannot be mixed with reply buttons');
    }

    const generatedMedia = data?.thumbnailUrl
      ? await this.prepareMediaMessage({ mediatype: 'image', media: data.thumbnailUrl })
      : null;

    const buttons = data.buttons.map((btn) => ({
      name: this.mapType.get(btn.type),
      buttonParamsJson: this.toJSONString(btn),
    }));

    const message: proto.IMessage = {
      interactiveMessage: {
        body: {
          text: [data.title ? `*${data.title}*` : '', data.description || ''].filter(Boolean).join('\\n\\n'),
        },
        footer: data?.footer ? { text: data.footer } : undefined,
        header: generatedMedia?.message?.imageMessage
          ? { hasMediaAttachment: true, imageMessage: generatedMedia.message.imageMessage }
          : undefined,
        nativeFlowMessage: {
          buttons,
          messageParamsJson: JSON.stringify({ from: 'api', templateId: v4() }),
        },
      },
    };

    return await this.sendMessageWithTyping(
      data.number,
      message,
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      false,
      [buildInteractiveBizNode()],
    );
  }

  public async locationMessage"""
    text = button_pattern.sub(button_block, text, count=1)

    list_pattern = re.compile(r"  public async listMessage\(data: SendListDto\) \{.*?\n  public async contactMessage", re.S)
    list_match = list_pattern.search(text)
    if not list_match:
        raise SystemExit('listMessage block not found')
    list_block = """  public async listMessage(data: SendListDto) {
    const message: proto.IMessage = {
      listMessage: {
        title: data.title || '',
        description: data.description || '',
        buttonText: data.buttonText || 'Ver Menu',
        footerText: data.footerText || '',
        listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
        sections: (data.sections || []).map((section) => ({
          title: section.title || '',
          rows: (section.rows || []).map((row) => ({
            title: row.title || '',
            description: row.description || '',
            rowId: row.rowId || '',
          })),
        })),
      },
    };

    return await this.sendMessageWithTyping(
      data.number,
      message,
      {
        delay: data?.delay,
        presence: 'composing',
        quoted: data?.quoted,
        mentionsEveryOne: data?.mentionsEveryOne,
        mentioned: data?.mentioned,
      },
      false,
      [buildListBizNode()],
    );
  }

  public async contactMessage"""
    text = list_pattern.sub(list_block, text, count=1)

    SERVICE.write_text(text)


def patch_planner():
    text = PLANNER.read_text()

    old_interaction = """    if (provider === 'WHATSAPP-BAILEYS' && interaction.type === 'choice' && interaction.mode === 'SINGLE') {
      return {
        id: interaction.id,
        type: interaction.type,
        mode: 'POLL_COMPAT',
        compatibilityTransport: 'BAILEYS_OFFICIAL_POLL',
        degraded: true,
        warnings: ['A escolha única será exibida como enquete para compatibilidade real neste provider.'],
      };
    }
"""
    new_interaction = """    if (provider === 'WHATSAPP-BAILEYS' && interaction.type === 'list') {
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
"""
    if old_interaction in text:
        text = text.replace(old_interaction, new_interaction, 1)
    elif "compatibilityTransport: 'BAILEYS_LIST'" not in text:
        raise SystemExit('Baileys interaction planner marker not found')

    cap_pattern = re.compile(r"  if \(normalized === 'WHATSAPP-BAILEYS'\) \{\n    return \{.*?\n    \};\n  \}\n\n  if \(normalized === 'CONNECT'\)", re.S)
    cap_match = cap_pattern.search(text)
    if not cap_match:
        raise SystemExit('Baileys capability block not found')
    cap_block = """  if (normalized === 'WHATSAPP-BAILEYS') {
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

  if (normalized === 'CONNECT')"""
    text = cap_pattern.sub(cap_block, text, count=1)

    plan_pattern = re.compile(r"  if \(normalized === 'WHATSAPP-BAILEYS'\) \{\n    const replies = .*?\n  \}\n\n  if \(normalized === 'CONNECT'\)", re.S)
    plan_match = plan_pattern.search(text)
    if not plan_match:
        raise SystemExit('Baileys template plan block not found')
    plan_block = """  if (normalized === 'WHATSAPP-BAILEYS') {
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

  if (normalized === 'CONNECT')"""
    text = plan_pattern.sub(plan_block, text, count=1)

    PLANNER.write_text(text)


def patch_engine():
    text = ENGINE.read_text()

    text = text.replace(
        "if (planned.compatibilityTransport === 'META_LIST' && interaction.type === 'list') {",
        "if (\n          (planned.compatibilityTransport === 'META_LIST' || planned.compatibilityTransport === 'BAILEYS_LIST') &&\n          interaction.type === 'list'\n        ) {",
        1,
    )

    old_list_choice = """          planned.compatibilityTransport === 'META_INTERACTIVE_CHOICE' &&
          interaction.type === 'choice' &&
          interaction.options.length > 3 &&
"""
    if old_list_choice in text:
        text = text.replace(
            old_list_choice,
            """          (planned.compatibilityTransport === 'META_INTERACTIVE_CHOICE' ||
            planned.compatibilityTransport === 'BAILEYS_LIST') &&
          interaction.type === 'choice' &&
          interaction.options.length > 3 &&
""",
            1,
        )

    old_button_choice = """          (planned.compatibilityTransport === 'META_INTERACTIVE_CHOICE' ||
            planned.compatibilityTransport === 'CONNECT_BUTTONS') &&
"""
    if old_button_choice in text:
        text = text.replace(
            old_button_choice,
            """          (planned.compatibilityTransport === 'META_INTERACTIVE_CHOICE' ||
            planned.compatibilityTransport === 'CONNECT_BUTTONS' ||
            planned.compatibilityTransport === 'BAILEYS_BUTTONS') &&
""",
            1,
        )

    ENGINE.write_text(text)


def patch_package():
    text = PACKAGE.read_text()
    test = 'tsx ./test/template-engine/baileys-native-interactive.test.ts'
    if test not in text:
        marker = 'tsx ./test/template-engine/baileys-compat.test.ts'
        if marker not in text:
            raise SystemExit('test:compat Baileys marker not found')
        text = text.replace(marker, marker + ' && ' + test, 1)
    PACKAGE.write_text(text)


patch_service()
patch_planner()
patch_engine()
patch_package()

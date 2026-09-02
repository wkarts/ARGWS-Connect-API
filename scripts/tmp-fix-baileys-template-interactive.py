from pathlib import Path

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'marker not found: {label}')
    return text.replace(old, new, 1)

# Template Engine: official Baileys must not emit unsupported nativeFlow payloads.
path = 'src/api/services/template-engine.service.ts'
text = read(path)
text = replace_once(
    text,
    """    if (rendered.buttons.length) {\n      result = await this.sendInteractiveWithFallback(runtime, data, rendered, template);\n    } else {""",
    """    if (rendered.buttons.length) {\n      result =\n        provider === 'WHATSAPP-BAILEYS'\n          ? await this.sendBaileysCompatibleInteraction(runtime, data, rendered, template)\n          : await this.sendInteractiveWithFallback(runtime, data, rendered, template);\n    } else {""",
    'provider-aware template interaction',
)
text = replace_once(
    text,
    '    await this.registerInteractionSession(instanceRow.id, template, data, result);\n    return result;\n  }\n\n  private async sendInteractiveWithFallback(',
    '    await this.registerInteractionSession(instanceRow.id, template, data, result, rendered);\n    return result;\n  }\n\n  private async sendBaileysCompatibleInteraction(\n    runtime: any,\n    data: SendTemplateDto,\n    rendered: RenderedTemplate,\n    template: any,\n  ) {\n    const replyButtons = rendered.buttons.filter((button) => button.type === \'reply\' && button.displayText);\n    const replyOnly = replyButtons.length > 0 && replyButtons.length === rendered.buttons.length;\n\n    if (replyOnly && typeof runtime.pollMessage === \'function\') {\n      try {\n        const result = await runtime.pollMessage({\n          number: data.number,\n          name: this.pollPrompt(rendered),\n          selectableCount: 1,\n          values: replyButtons.map((button) => String(button.displayText)),\n          delay: data.delay,\n          quoted: data.quoted,\n          linkPreview: data.linkPreview,\n          mentionsEveryOne: data.mentionsEveryOne,\n          mentioned: data.mentioned,\n        });\n        this.attachDiagnostics(result, {\n          provider: \'WHATSAPP-BAILEYS\',\n          templateName: data.name,\n          language: data.language || \'pt_BR\',\n          category: template.category,\n          mode: \'POLL_COMPAT\',\n          buttonCount: rendered.buttons.length,\n          fallback: false,\n          compatibilityTransport: \'BAILEYS_OFFICIAL_POLL\',\n        });\n        return result;\n      } catch (error) {\n        const reason = error instanceof Error ? error.message : String(error);\n        this.logger.warn(`Baileys poll compatibility for template ${data.name} failed; using text fallback: ${reason}`);\n        return this.sendBaileysTextCompatibility(runtime, data, rendered, template, reason);\n      }\n    }\n\n    return this.sendBaileysTextCompatibility(\n      runtime,\n      data,\n      rendered,\n      template,\n      \'Official Baileys does not reliably render nativeFlow interactive messages.\',\n    );\n  }\n\n  private async sendBaileysTextCompatibility(\n    runtime: any,\n    data: SendTemplateDto,\n    rendered: RenderedTemplate,\n    template: any,\n    reason: string,\n  ) {\n    const result = await runtime.textMessage({\n      number: data.number,\n      text: this.textFallback(rendered),\n      delay: data.delay,\n      quoted: data.quoted,\n      linkPreview: data.linkPreview,\n      mentionsEveryOne: data.mentionsEveryOne,\n      mentioned: data.mentioned,\n    });\n    this.attachDiagnostics(result, {\n      provider: \'WHATSAPP-BAILEYS\',\n      templateName: data.name,\n      language: data.language || \'pt_BR\',\n      category: template.category,\n      mode: \'TEXT_COMPAT\',\n      buttonCount: rendered.buttons.length,\n      fallback: true,\n      fallbackReason: reason,\n      compatibilityTransport: \'BAILEYS_TEXT\',\n    });\n    return result;\n  }\n\n  private pollPrompt(rendered: RenderedTemplate) {\n    return ([rendered.title, rendered.text, rendered.footer].filter(Boolean) as string[]).join(\'\\n\\n\').trim() || \'Escolha uma opção\';\n  }\n\n  private async sendInteractiveWithFallback(',
    'insert Baileys compatibility methods',
)
text = replace_once(
    text,
    '  private async registerInteractionSession(instanceId: string, template: any, data: SendTemplateDto, result: any) {\n    if (!template || !this.hasBindings(template.actions)) return;',
    """  private actionsWithRenderedAliases(actions: unknown, rendered?: RenderedTemplate): unknown {\n    if (!actions || typeof actions !== 'object' || !rendered?.buttons?.length) return actions;\n\n    const labels = new Map(\n      rendered.buttons\n        .filter((button) => button.type === 'reply' && button.id && button.displayText)\n        .map((button) => [String(button.id), String(button.displayText)]),\n    );\n    if (!labels.size) return actions;\n\n    const source = actions as any;\n    if (Array.isArray(source.bindings)) {\n      return {\n        ...source,\n        bindings: source.bindings.map((binding: any) => ({\n          ...binding,\n          matchTitle: binding.matchTitle || labels.get(String(binding.id || '')) || undefined,\n        })),\n      };\n    }\n\n    if (source.interactions && typeof source.interactions === 'object') {\n      return {\n        ...source,\n        interactions: Object.fromEntries(\n          Object.entries(source.interactions).map(([id, binding]: [string, any]) => [\n            id,\n            { ...binding, matchTitle: binding?.matchTitle || labels.get(id) || undefined },\n          ]),\n        ),\n      };\n    }\n\n    return actions;\n  }\n\n  private async registerInteractionSession(\n    instanceId: string,\n    template: any,\n    data: SendTemplateDto,\n    result: any,\n    rendered?: RenderedTemplate,\n  ) {\n    const sessionActions = this.actionsWithRenderedAliases(template?.actions, rendered);\n    if (!template || !this.hasBindings(sessionActions)) return;""",
    'interaction aliases',
)
text = text.replace('        actions: template.actions as any,', '        actions: sessionActions as any,')
write(path, text)

# Interaction Engine: convert decrypted Baileys poll updates into the same normalized interaction contract.
path = 'src/api/services/interaction-engine.service.ts'
text = read(path)
text = replace_once(
    text,
    '    const message = eventData.data as any;\n    const interaction = message?.interaction;\n    if (!interaction?.id || message?.key?.fromMe) return;',
    '    const message = eventData.data as any;\n    const interaction = message?.interaction || this.pollInteraction(message);\n    if (!interaction?.id || message?.key?.fromMe) return;',
    'poll normalized interaction',
)
text = replace_once(
    text,
    '  private async findSession(instanceId: string, message: any, interaction: any) {',
    """  private pollInteraction(message: any) {\n    const updates = Array.isArray(message?.pollUpdates) ? message.pollUpdates : [];\n    const selectedOptions = updates\n      .filter((update: any) => Array.isArray(update?.voters) && update.voters.length > 0 && update?.name)\n      .map((update: any) => String(update.name));\n    if (!selectedOptions.length) return null;\n\n    const selected = selectedOptions[0];\n    return {\n      type: 'poll_reply',\n      id: selected,\n      title: selected,\n      contextMessageId: message?.message?.pollUpdateMessage?.pollCreationMessageKey?.id || undefined,\n      payload: { selectedOptions },\n    };\n  }\n\n  private async findSession(instanceId: string, message: any, interaction: any) {""",
    'pollInteraction method',
)
write(path, text)

# Regression test with mocked runtime: nativeFlow/buttonMessage must never be called for Baileys templates.
write('test/template-engine/baileys-compat.test.ts', r'''import assert from 'node:assert/strict';

import { InteractionEngineService } from '../../src/api/services/interaction-engine.service';
import { TemplateEngineService } from '../../src/api/services/template-engine.service';

async function main() {
  const calls: Array<{ type: string; payload: any }> = [];
  let storedSession: any = null;
  const runtime = {
    instance: { integration: 'WHATSAPP-BAILEYS' },
    async buttonMessage(payload: any) {
      calls.push({ type: 'button', payload });
      throw new Error('buttonMessage must not be called for official Baileys template compatibility');
    },
    async pollMessage(payload: any) {
      calls.push({ type: 'poll', payload });
      return { key: { id: 'poll-outbound-1', remoteJid: '557599999999@s.whatsapp.net' } };
    },
    async textMessage(payload: any) {
      calls.push({ type: 'text', payload });
      return { key: { id: 'text-outbound-1', remoteJid: '557599999999@s.whatsapp.net' } };
    },
  };

  const template = {
    category: 'UTILITY',
    language: 'pt_BR',
    enabled: true,
    template: {
      components: [
        { type: 'BODY', text: 'Olá {{1}}, confirme sua solicitação.' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
            { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
          ],
        },
      ],
    },
    actions: {
      bindings: [
        { id: 'confirm', type: 'NONE' },
        { id: 'cancel', type: 'NONE' },
      ],
    },
    policy: {},
  };

  const prisma: any = {
    instance: {
      findUnique: async () => ({ id: 'instance-1', integration: 'WHATSAPP-BAILEYS' }),
    },
    template: {
      findFirst: async () => template,
    },
    templateInteractionSession: {
      upsert: async (args: any) => {
        storedSession = args;
        return args.create;
      },
    },
  };

  const service = new TemplateEngineService({ waInstances: { Demo: runtime } } as any, prisma);
  const result: any = await service.send(
    { instanceName: 'Demo', integration: 'WHATSAPP-BAILEYS' } as any,
    {
      number: '557599999999',
      name: 'sample_utility',
      language: 'pt_BR',
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Wallace' }] }],
    } as any,
  );

  assert.equal(calls.some((call) => call.type === 'button'), false, 'nativeFlow button path must stay disabled');
  assert.equal(calls.filter((call) => call.type === 'poll').length, 1);
  assert.deepEqual(calls.find((call) => call.type === 'poll')?.payload.values, ['Confirmar', 'Cancelar']);
  assert.equal(calls.find((call) => call.type === 'poll')?.payload.selectableCount, 1);
  assert.equal(result.templateExecution.mode, 'POLL_COMPAT');
  assert.equal(result.templateExecution.compatibilityTransport, 'BAILEYS_OFFICIAL_POLL');
  assert.equal(storedSession.create.outboundMessageId, 'poll-outbound-1');
  assert.equal(storedSession.create.actions.bindings[0].matchTitle, 'Confirmar');
  assert.equal(storedSession.create.actions.bindings[1].matchTitle, 'Cancelar');

  const interactionEngine = new InteractionEngineService({} as any, {} as any, {} as any, {} as any, {} as any);
  const normalized = (interactionEngine as any).pollInteraction({
    message: { pollUpdateMessage: { pollCreationMessageKey: { id: 'poll-outbound-1' } } },
    pollUpdates: [
      { name: 'Confirmar', voters: ['557599999999@s.whatsapp.net'] },
      { name: 'Cancelar', voters: [] },
    ],
  });
  assert.equal(normalized.type, 'poll_reply');
  assert.equal(normalized.id, 'Confirmar');
  assert.equal(normalized.contextMessageId, 'poll-outbound-1');

  calls.length = 0;
  template.template = {
    components: [
      { type: 'BODY', text: 'Acompanhe sua solicitação.' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'https://example.com/item/1' }] },
    ],
  };
  template.actions = {};
  const textResult: any = await service.send(
    { instanceName: 'Demo', integration: 'WHATSAPP-BAILEYS' } as any,
    { number: '557599999999', name: 'sample_url', language: 'pt_BR', components: [] } as any,
  );
  assert.equal(calls.some((call) => call.type === 'button'), false);
  assert.equal(calls.filter((call) => call.type === 'text').length, 1);
  assert.match(calls.find((call) => call.type === 'text')?.payload.text || '', /https:\/\/example\.com\/item\/1/);
  assert.equal(textResult.templateExecution.mode, 'TEXT_COMPAT');

  console.log('baileys template compatibility: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
''')

# Keep the compatibility test inside the canonical compatibility suite.
path = 'package.json'
text = read(path)
text = replace_once(
    text,
    'tsx ./test/conversational-platform/foundation.test.ts\"',
    'tsx ./test/conversational-platform/foundation.test.ts && tsx ./test/template-engine/baileys-compat.test.ts\"',
    'test:compat script',
)
write(path, text)

# Document the provider capability behavior explicitly.
path = 'docs/guides/conversational-platform-phase4.md'
text = read(path)
section = '''\n\n## Compatibilidade de interação por provider\n\nO Connect|API mantém o contrato lógico de Template/Interaction independente do provider, mas escolhe o transporte visual conforme a capacidade real do canal.\n\n- `WHATSAPP-BUSINESS`: templates e botões continuam provider-native, sob as regras oficiais da Meta.\n- `WHATSAPP-BAILEYS`: quick replies são emitidos como poll de escolha única (`POLL_COMPAT`) no Baileys oficial, evitando `nativeFlowMessage` que pode receber ACK e ainda ser descartado pelos clientes WhatsApp.\n- Botões URL, telefone e copiar no Baileys usam `TEXT_COMPAT`, preservando texto, URL, número ou código como conteúdo utilizável.\n- O `Interaction Engine` converte a seleção do poll para `poll_reply` e associa o texto exibido ao mesmo binding lógico do botão original.\n\nAssim, a Recipe/Action ligada a `confirm`, `cancel` etc. continua independente de Meta ou Baileys, sem enviar mensagens interativas incompatíveis ao cliente.\n'''
if '## Compatibilidade de interação por provider' not in text:
    text += section
write(path, text)

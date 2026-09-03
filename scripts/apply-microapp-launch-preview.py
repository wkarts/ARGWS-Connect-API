from pathlib import Path


def patch_helper():
    path = Path('src/api/services/micro-app-auto-launch.ts')
    text = path.read_text()
    if 'buttonText?: string;' not in text:
        text = text.replace(
            "  messageText?: string;\n  linkPreview?: boolean;\n",
            "  messageText?: string;\n  buttonText?: string;\n  launchMode?: 'BUTTON' | 'LINK';\n  linkPreview?: boolean;\n",
            1,
        )
    if 'buttonText: String(autoLaunch.buttonText' not in text:
        text = text.replace(
            "    messageText: String(autoLaunch.messageText || '').trim() || 'Abrir Mini App',\n    linkPreview: autoLaunch.linkPreview !== false,\n",
            "    messageText: String(autoLaunch.messageText || '').trim() || 'Mini App disponível',\n    buttonText: String(autoLaunch.buttonText || '').trim() || 'Abrir Mini App',\n    launchMode: String(autoLaunch.launchMode || '').toUpperCase() === 'LINK' ? 'LINK' : 'BUTTON',\n    linkPreview: autoLaunch.linkPreview !== false,\n",
            1,
        )
    path.write_text(text)


def patch_engine():
    path = Path('src/api/services/template-engine.service.ts')
    text = path.read_text()
    if 'MICRO_APP_CTA_FALLBACK' in text:
        return
    old = """  private async sendMicroAppAutoLaunch(runtime: any, data: SendTemplateDto, autoLaunch: any) {
    if (!autoLaunch?.session?.url) return;
    await runtime.textMessage({
      number: data.number,
      text: `${autoLaunch.policy.messageText}\n${autoLaunch.session.url}`,
      delay: data.delay,
      quoted: data.quoted,
      linkPreview: autoLaunch.policy.linkPreview,
      mentionsEveryOne: data.mentionsEveryOne,
      mentioned: data.mentioned,
    });
  }
"""
    new = """  private async sendMicroAppAutoLaunch(runtime: any, data: SendTemplateDto, autoLaunch: any) {
    if (!autoLaunch?.session?.url) return;

    if (autoLaunch.policy.launchMode !== 'LINK' && typeof runtime.buttonMessage === 'function') {
      try {
        return await runtime.buttonMessage({
          number: data.number,
          title: autoLaunch.policy.messageText || 'Mini App disponível',
          description: 'Abra a experiência segura do Connect|API.',
          footer: 'Connect|API',
          buttons: [
            {
              type: 'url',
              displayText: autoLaunch.policy.buttonText || 'Abrir Mini App',
              url: autoLaunch.session.url,
            },
          ],
          delay: data.delay,
          quoted: data.quoted,
          mentionsEveryOne: data.mentionsEveryOne,
          mentioned: data.mentioned,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`MICRO_APP_CTA_FALLBACK: ${reason}`);
      }
    }

    return runtime.textMessage({
      number: data.number,
      text: `${autoLaunch.policy.messageText}\n${autoLaunch.session.url}`,
      delay: data.delay,
      quoted: data.quoted,
      linkPreview: autoLaunch.policy.linkPreview,
      mentionsEveryOne: data.mentionsEveryOne,
      mentioned: data.mentioned,
    });
  }
"""
    if old not in text:
        raise SystemExit('sendMicroAppAutoLaunch marker not found')
    path.write_text(text.replace(old, new, 1))


def patch_html():
    path = Path('manager/dist/template-editor.html')
    text = path.read_text()
    script = '    <script src="/assets/template-studio-microapp-preview.js"></script>\n'
    if script not in text:
        marker = '    <script src="/assets/template-studio-transfer.js"></script>\n'
        if marker not in text:
            raise SystemExit('template transfer script marker not found')
        text = text.replace(marker, marker + script, 1)
    path.write_text(text)


def patch_package():
    path = Path('package.json')
    text = path.read_text()
    test = 'tsx ./test/template-studio/microapp-preview.test.ts'
    if test not in text:
        marker = 'tsx ./test/template-studio/transfer-center.test.ts'
        if marker not in text:
            raise SystemExit('test:compat marker not found')
        text = text.replace(marker, marker + ' && ' + test, 1)
    path.write_text(text)


patch_helper()
patch_engine()
patch_html()
patch_package()

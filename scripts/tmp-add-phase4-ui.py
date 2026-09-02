from pathlib import Path

path = Path('manager/dist/template-editor.html')
text = path.read_text()
script = '    <script src="/assets/template-editor-phase4.js"></script>\n'
if 'template-editor-phase4.js' not in text:
    marker = '    <script src="/assets/template-editor-v2.js"></script>\n'
    if marker not in text:
        raise SystemExit('template-editor-v2 marker not found')
    text = text.replace(marker, marker + script, 1)
path.write_text(text)

# Acrescenta referência funcional ao guia, sem acoplar a regra de negócio à UI.
guide = Path('docs/guides/conversational-platform-phase4.md')
g = guide.read_text()
if 'Template Studio v2' not in g:
    g += '''\n## Template Studio v2\n\nA aba Integrações expõe controles para a política Meta, instalação de pacotes oficiais e fila de Strong Confirmation. A interface é cliente do contrato HTTP; toda regra permanece no backend e pode ser reutilizada por um frontend futuro.\n'''
    guide.write_text(g)

print('phase4 ui integrated')

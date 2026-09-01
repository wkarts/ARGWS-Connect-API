from pathlib import Path
import json
import re
import shutil

root = Path('.')
bundle = root / 'manager/dist/assets/index-CO3NSIFj.js'
runtime = root / 'manager/dist/assets/argws-runtime-fixes.js'
index = root / 'manager/dist/index.html'
manifest = root / 'manager/dist/manifest.webmanifest'

text = bundle.read_text(encoding='utf-8')
replacements = [
    ('ARGWS Connect API - Connect|API', 'Connect|API'),
    ('ARGWS Connect API', 'Connect|API'),
    ('ARGWS Connect', 'Connect|API'),
    ('Connect Manager v2', 'Connect|API'),
    ('Connect Manager', 'Connect|API'),
]
for old, new in replacements:
    print(f'{old}: {text.count(old)}')
    text = text.replace(old, new)
bundle.write_text(text, encoding='utf-8')

data = json.loads(manifest.read_text(encoding='utf-8'))
data['name'] = 'Connect|API'
data['short_name'] = 'Connect|API'
data['description'] = 'Connect|API — Communication & Integration Platform'
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

rt = runtime.read_text(encoding='utf-8')
rt = rt.replace("const VERSION = '2026.09.01.2';", "const VERSION = '2026.09.01.3';")
marker = "  const getUrl = (value) => {\n"
branding = """  const PUBLIC_BRAND = 'Connect|API';

  const enforcePublicBrand = () => {
    let title = document.querySelector('title');
    if (!title) {
      title = document.createElement('title');
      document.head.appendChild(title);
    }
    if (title.textContent !== PUBLIC_BRAND) title.textContent = PUBLIC_BRAND;
    if (document.title !== PUBLIC_BRAND) document.title = PUBLIC_BRAND;
  };

  const startBrandGuard = () => {
    enforcePublicBrand();
    const observer = new MutationObserver(enforcePublicBrand);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startBrandGuard, { once: true });
  } else {
    startBrandGuard();
  }

"""
if 'const PUBLIC_BRAND' not in rt:
    if marker not in rt:
        raise SystemExit('runtime branding insertion marker not found')
    rt = rt.replace(marker, branding + marker, 1)
runtime.write_text(rt, encoding='utf-8')

html = index.read_text(encoding='utf-8')
html = re.sub(r'argws-runtime-fixes\.js\?v=[0-9.]+', 'argws-runtime-fixes.js?v=20260901.3', html)
html = re.sub(r'<title>.*?</title>', '<title>Connect|API</title>', html, count=1, flags=re.S)
index.write_text(html, encoding='utf-8')

branding_dir = root / 'manager/dist/assets/branding'
textual = []
for p in (root / 'manager/dist').rglob('*'):
    if not p.is_file() or branding_dir in p.parents:
        continue
    if p.suffix.lower() in {'.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt'}:
        textual.append((p, p.read_text(encoding='utf-8', errors='ignore')))
refs = [str(p) for p, s in textual if '/assets/branding/' in s or 'assets/branding/' in s]
if refs:
    raise SystemExit('branding package is still referenced: ' + ', '.join(refs))
if branding_dir.exists():
    shutil.rmtree(branding_dir)

for candidate in [
    root / 'manager/dist/assets/images/ARGWS_CONNECT_API_logo_primary_transparent.png',
    root / 'manager/dist/assets/images/argws-connect-logo.png',
]:
    if candidate.exists() and not any(candidate.name in s for _, s in textual):
        candidate.unlink()

for tmp in [
    root / '.github/workflows/_branding-audit.yml',
    root / '.github/workflows/_branding-apply.yml',
    root / '.github/scripts/_apply_connect_api_branding.py',
]:
    if tmp.exists():
        tmp.unlink()

#!/usr/bin/env python3
from __future__ import annotations
import argparse, re, sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print('Dependência ausente: pip install pyyaml', file=sys.stderr); raise SystemExit(2)

ROOT=Path(__file__).resolve().parents[1]
SKIP_DIRS={'.git','node_modules','.venv','dist','build','__pycache__'}
SKIP_FILES={'MANIFEST.sha256'}

def flatten(cfg):
    p=cfg['project']; b=cfg['branding']; n=cfg['network']; c=cfg['containers']; d=cfg['persistence']; o=cfg['observability']
    return {
      'Connect|API Platform': b['product_name'],
      'connect-api-platform': p['slug'],
      'connect-api.example.com': n['public_host'],
      'control.connect-api.example.com': n['control_host'],
      'admin.connect-api.example.com': n['admin_host'],
      'api.connect-api.example.com': n['api_host'],
      'demo.connect-api.example.com': n['demo_host'],
      'ghcr.io/YOUR_ORG/connect-api-platform-api': f"{c['registry']}/{c['api_image']}",
      'ghcr.io/YOUR_ORG/connect-api-platform-web': f"{c['registry']}/{c['web_image']}",
      'ghcr.io/YOUR_ORG/connect-api-platform-gateway': f"{c['registry']}/{c['gateway_image']}",
      'connect-api': f"{o['service_prefix']}-api",
      'connect-web': f"{o['service_prefix']}-web",
      'connect-gateway': f"{o['service_prefix']}-gateway",
    }

def iter_text_files():
    for p in ROOT.rglob('*'):
        if not p.is_file() or p.name in SKIP_FILES or any(x in SKIP_DIRS for x in p.parts): continue
        try: p.read_text('utf-8')
        except Exception: continue
        yield p

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--config', default='template.config.yaml')
    ap.add_argument('--dry-run', action='store_true')
    args=ap.parse_args()
    cfg=yaml.safe_load((ROOT/args.config).read_text('utf-8'))
    mapping=flatten(cfg)
    changed=[]
    for p in iter_text_files():
        s=p.read_text('utf-8'); ns=s
        for a,b in mapping.items(): ns=ns.replace(a,str(b))
        if ns!=s:
            changed.append(str(p.relative_to(ROOT)))
            if not args.dry_run: p.write_text(ns,'utf-8')
    print(('PLANO' if args.dry_run else 'ALTERADO')+f': {len(changed)} arquivo(s)')
    for x in changed: print(' -',x)
    print('\nATENÇÃO: este script só aplica identidade/infraestrutura. A remoção semântica do domínio financeiro deve seguir AI_MASTER_PROMPT.md.')
if __name__=='__main__': main()

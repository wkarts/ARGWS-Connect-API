from pathlib import Path
import re

ROOT = Path('.')
UTILITY = ROOT / 'src/utils/prismaJsonPath.ts'
UTILITY.write_text(
    """import { configService, Database } from '@config/env.config';\n\n/**\n * Prisma uses different JSON-path representations per provider:\n * PostgreSQL: ['key', 'nested']\n * MySQL:      $.key.nested\n *\n * The provider-specific Prisma clients also expose different TypeScript types,\n * so this narrow database-boundary helper intentionally returns `any`.\n */\nexport function prismaJsonPath(...segments: string[]): any {\n  const provider = configService.get<Database>('DATABASE').PROVIDER;\n  return provider === 'mysql' ? `$.${segments.join('.')}` : segments;\n}\n""",
    encoding='utf-8',
)

pattern = re.compile(r"path:\s*\[([^\]]+)\]")
updated = []
for path in (ROOT / 'src').rglob('*.ts'):
    text = path.read_text(encoding='utf-8')
    if not pattern.search(text):
        continue

    new_text, count = pattern.subn(lambda m: f"path: prismaJsonPath({m.group(1).strip()})", text)
    if count == 0:
        continue

    import_line = "import { prismaJsonPath } from '@utils/prismaJsonPath';\n"
    if import_line not in new_text:
        # Insert with the other top-level imports; ESLint --fix will sort it.
        first_import = new_text.find('import ')
        if first_import < 0:
            raise RuntimeError(f'No import block found in {path}')
        new_text = new_text[:first_import] + import_line + new_text[first_import:]

    path.write_text(new_text, encoding='utf-8')
    updated.append((str(path), count))

if not updated:
    raise RuntimeError('No Prisma JSON path filters were found to normalize')

print('Normalized Prisma JSON paths:')
for path, count in updated:
    print(f'- {path}: {count}')

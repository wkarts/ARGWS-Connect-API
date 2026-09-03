#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const workspacePackage = path.join(process.cwd(), 'package.json')
const workspaceRequire = createRequire(fs.existsSync(workspacePackage) ? workspacePackage : import.meta.url)
const scriptRequire = createRequire(import.meta.url)

const resolvers = [
  () => workspaceRequire('typescript'),
  () => scriptRequire('typescript'),
  () => scriptRequire('/usr/local/lib/node_modules/typescript/lib/typescript.js'),
]

let ts = null
for (const resolve of resolvers) {
  try {
    ts = resolve()
    break
  } catch {
    // tenta o próximo resolver conhecido
  }
}

if (!ts) {
  console.error(`TypeScript não está disponível para o workspace ${process.cwd()}.`)
  process.exit(2)
}

const root = path.resolve(process.argv[2] ?? 'platform/web/src')
const errors = []
let checked = 0

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function validateScript(file, source, kind = ts.ScriptKind.TS) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const position = diagnostic.start != null
      ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
      : null
    errors.push(`${file}${position ? `:${position.line + 1}:${position.character + 1}` : ''}: ${message}`)
  }
  checked += 1
}

for (const file of walk(root).sort()) {
  const ext = path.extname(file)
  if (!['.ts', '.tsx', '.vue'].includes(ext)) continue
  const source = fs.readFileSync(file, 'utf8')

  if (ext !== '.vue') {
    validateScript(file, source, ext === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    continue
  }

  const scriptRegex = /<script(?:\s+setup)?(?:\s+lang=["'](?:ts|tsx)["'])?[^>]*>([\s\S]*?)<\/script>/gi
  const scripts = [...source.matchAll(scriptRegex)]
  scripts.forEach((match, index) => validateScript(`${file}.script-${index + 1}.ts`, match[1]))

  const withoutScripts = source.replace(scriptRegex, '')
  const templateOpen = (withoutScripts.match(/<template(?:\s[^>]*)?>/gi) ?? []).length
  const templateClose = (withoutScripts.match(/<\/template>/gi) ?? []).length
  if (templateOpen < 1 || templateClose < 1) {
    errors.push(`${file}: bloco <template> principal ausente ou incompleto`)
  }
}

if (errors.length) {
  console.error(`Frontend inválido: ${errors.length} erro(s).`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`Frontend válido: ${checked} bloco(s) TypeScript verificado(s) em ${root}.`)

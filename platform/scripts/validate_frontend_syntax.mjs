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

function isTagBoundary(char) {
  return char === undefined || char === '>' || /\s/.test(char)
}

function findClosingTag(sourceLower, tagName, fromIndex) {
  const needle = `</${tagName}`
  let cursor = fromIndex
  while (cursor < sourceLower.length) {
    const start = sourceLower.indexOf(needle, cursor)
    if (start < 0) return null
    let end = start + needle.length
    if (!isTagBoundary(sourceLower[end])) {
      cursor = end
      continue
    }
    while (end < sourceLower.length && /\s/.test(sourceLower[end])) end += 1
    if (sourceLower[end] === '>') return { start, end }
    cursor = end + 1
  }
  return null
}

function extractVueScripts(file, source) {
  const lower = source.toLowerCase()
  let cursor = 0
  let scriptIndex = 0

  while (cursor < lower.length) {
    const start = lower.indexOf('<script', cursor)
    if (start < 0) break
    const boundary = lower[start + '<script'.length]
    if (!isTagBoundary(boundary)) {
      cursor = start + '<script'.length
      continue
    }

    const openEnd = lower.indexOf('>', start + '<script'.length)
    if (openEnd < 0) {
      errors.push(`${file}: bloco <script> sem fechamento do cabeçalho`)
      return
    }

    const closing = findClosingTag(lower, 'script', openEnd + 1)
    if (!closing) {
      errors.push(`${file}: bloco <script> sem </script> correspondente`)
      return
    }

    scriptIndex += 1
    validateScript(`${file}.script-${scriptIndex}.ts`, source.slice(openEnd + 1, closing.start))
    cursor = closing.end + 1
  }
}

function countTags(source, tagName, closing = false) {
  const lower = source.toLowerCase()
  const needle = closing ? `</${tagName}` : `<${tagName}`
  let cursor = 0
  let count = 0

  while (cursor < lower.length) {
    const start = lower.indexOf(needle, cursor)
    if (start < 0) break
    const boundary = lower[start + needle.length]
    if (isTagBoundary(boundary)) count += 1
    cursor = start + needle.length
  }
  return count
}

for (const file of walk(root).sort()) {
  const ext = path.extname(file)
  if (!['.ts', '.tsx', '.vue'].includes(ext)) continue
  const source = fs.readFileSync(file, 'utf8')

  if (ext !== '.vue') {
    validateScript(file, source, ext === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    continue
  }

  extractVueScripts(file, source)

  const templateOpen = countTags(source, 'template')
  const templateClose = countTags(source, 'template', true)
  if (templateOpen < 1 || templateClose < 1 || templateOpen !== templateClose) {
    errors.push(`${file}: bloco <template> principal ausente ou incompleto`)
  }
}

if (errors.length) {
  console.error(`Frontend inválido: ${errors.length} erro(s).`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`Frontend válido: ${checked} bloco(s) TypeScript verificado(s) em ${root}.`)

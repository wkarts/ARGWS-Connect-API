import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('src')
const failures = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.name.endsWith('.vue')) {
      const text = fs.readFileSync(file, 'utf8')
      const scripts = (text.match(/<script\b[^>]*>/gi) || []).length
      const scriptEnds = (text.match(/<\/script\s*>/gi) || []).length
      const templates = (text.match(/<template\b[^>]*>/gi) || []).length
      const templateEnds = (text.match(/<\/template\s*>/gi) || []).length
      if (scripts !== scriptEnds) failures.push(`${file}: bloco script incompleto`)
      if (templates !== templateEnds) failures.push(`${file}: bloco template incompleto`)
      const scriptEnd = text.search(/<\/script\s*>/i)
      const templateStart = text.search(/<template\b/i)
      if (scripts > 0 && templateStart >= 0 && scriptEnd > templateStart) failures.push(`${file}: template antes do fechamento do script`)

      // This validates source structure, not user HTML. vue-tsc remains the
      // authoritative SFC parser. Require a newline before a script closing tag.
      if (/<script\b[^>]*>[^\n]*\S[^\n]*<\/script\s*>/i.test(text)) {
        failures.push(`${file}: feche o bloco script em uma linha separada`)
      }
    }
  }
}
walk(root)
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('Estrutura dos componentes validada.')

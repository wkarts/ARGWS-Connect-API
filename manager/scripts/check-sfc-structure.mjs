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
      const scripts = (text.match(/<script\b[^>]*>/g) || []).length
      const scriptEnds = (text.match(/<\/script>/g) || []).length
      const templates = (text.match(/<template\b[^>]*>/g) || []).length
      const templateEnds = (text.match(/<\/template>/g) || []).length
      if (scripts !== scriptEnds) failures.push(`${file}: bloco script incompleto`)
      if (templates !== templateEnds) failures.push(`${file}: bloco template incompleto`)
      if (scripts > 0 && text.indexOf('</script>') > text.indexOf('<template')) failures.push(`${file}: template antes do fechamento do script`)

      // vue-tsc parses the script body as TypeScript. Keeping </script> on the
      // same physical line as TypeScript code can make the closing tag reach
      // the TS parser in generated SFC code. Require a line break so the CI
      // catches this regression before the expensive Docker build.
      if (/<script\b[^>]*>[^\n]*\S[^\n]*<\/script>/i.test(text)) {
        failures.push(`${file}: feche o bloco script em uma linha separada`)
      }
    }
  }
}
walk(root)
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('Estrutura dos componentes validada.')

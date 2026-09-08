import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const failures = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile() && entry.name.endsWith('.vue')) validate(full)
  }
}

function validate(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    const number = index + 1
    if (/<script\b[^>]*>\S/.test(line)) failures.push(`${path.relative(root, file)}:${number}: mantenha a abertura de <script> em linha própria`)
    if (/<\/script>/.test(line) && line.trim() !== '</script>') failures.push(`${path.relative(root, file)}:${number}: mantenha </script> em linha própria`)
  })
}

walk(root)
if (failures.length) {
  console.error('Estrutura de componentes inválida:')
  failures.forEach((item) => console.error(`- ${item}`))
  process.exit(1)
}
console.log('Estrutura dos componentes validada.')

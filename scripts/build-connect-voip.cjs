'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// The application's bundler consumes engine source directly. This independent
// dual-format build runs the same source through the existing CJS/ESM matrix.
// It never reads or modifies an installed VoIP package.
function buildConnectVoip({ projectRoot = path.resolve(__dirname, '..') } = {}) {
  const source = path.join(projectRoot, 'src/api/integrations/channel/whatsapp/voip/engine');
  const output = path.join(projectRoot, '.generated/connect-voip');
  const files = [];
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Connect VoIP sources must not contain symbolic links');
      if (entry.isDirectory()) collect(filename);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(filename);
    }
  }
  collect(source);
  if (!files.length || !fs.existsSync(path.join(source, 'index.js'))) throw new Error('Connect VoIP source is incomplete');
  const prepared = files.map(filename => {
    const content = fs.readFileSync(filename, 'utf8');
    const relative = path.relative(source, filename);
    const compiled = ts.transpileModule(content, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        newLine: ts.NewLineKind.LineFeed,
      },
    });
    const errors = (compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(`Invalid Connect VoIP source ${relative}: ${ts.flattenDiagnosticMessageText(errors[0].messageText, ' ')}`);
    return { relative, content, compiled: compiled.outputText };
  });
  // All source validation completes before the previous test build is replaced.
  fs.rmSync(output, { recursive: true, force: true });
  for (const entry of prepared) {
    const cjs = path.join(output, 'dist', entry.relative);
    const esm = path.join(output, 'dist/esm', entry.relative);
    fs.mkdirSync(path.dirname(cjs), { recursive: true });
    fs.mkdirSync(path.dirname(esm), { recursive: true });
    fs.writeFileSync(cjs, entry.compiled);
    fs.writeFileSync(esm, entry.content);
  }
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ name: '@argws/connect-voip-test-build', private: true, type: 'commonjs', main: 'dist/index.js' }) + '\n');
  fs.writeFileSync(path.join(output, 'dist/esm/package.json'), '{"type":"module"}\n');
  return { files: prepared.length, output };
}

module.exports = { buildConnectVoip };
if (require.main === module) {
  try {
    const result = buildConnectVoip();
    console.log(`Connect VoIP build OK (${result.files} source modules, CJS + ESM, no dependency mutation)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const [inputFile, outputDir] = process.argv.slice(2);

if (!inputFile || !outputDir) {
  console.error('Usage: node extract-components.mjs <input.js> <output-dir>');
  process.exit(1);
}

const source = fs.readFileSync(inputFile, 'utf8');
const ast = parse(source, {
  sourceType: 'module',
  allowReturnOutsideFunction: true,
  errorRecovery: false,
});

fs.mkdirSync(outputDir, { recursive: true });

const wantedSymbols = new Map([
  ['Fse', 'pages/LandingPage.Fse.js'],
  ['Dse', 'pages/LoginPage.Dse.js'],
  ['CZ', 'pages/InstancesPage.CZ.js'],
  ['PX', 'pages/InstanceDashboard.PX.js'],
  ['tk', 'pages/ChatPage.tk.js'],
  ['qre', 'pages/SettingsPage.qre.js'],
  ['Tk', 'pages/OpenAIPage.Tk.js'],
  ['jse', 'pages/WebhookPage.jse.js'],
  ['Ose', 'pages/WebSocketPage.Ose.js'],
  ['Bre', 'pages/RabbitMQPage.Bre.js'],
  ['Yre', 'pages/SQSPage.Yre.js'],
  ['yX', 'pages/ChatwootPage.yX.js'],
  ['Nk', 'pages/TypebotPage.Nk.js'],
  ['xk', 'pages/DifyPage.xk.js'],
  ['jk', 'pages/N8nPage.jk.js'],
  ['Ck', 'pages/ConnectAIPage.Ck.js'],
  ['Ek', 'pages/ConnectBotPage.Ek.js'],
  ['kk', 'pages/FlowisePage.kk.js'],
  ['Ore', 'pages/ProxyPage.Ore.js'],
  ['Sk', 'pages/EmbedChatPage.Sk.js'],

  ['Lse', 'router/Router.Lse.js'],

  ['jL', 'layout/LoginGuard.jL.js'],
  ['tn', 'layout/ManagerGuard.tn.js'],
  ['B5', 'layout/ManagerShell.B5.js'],
  ['un', 'layout/InstanceShell.un.js'],
  ['zM', 'layout/ManagerHeader.zM.js'],
  ['j5', 'layout/InstanceSidebar.j5.js'],
  ['Vb', 'layout/ManagerFooter.Vb.js'],

  ['Dae', 'i18n/SidebarPtBR.Dae.js'],
  ['goe', 'i18n/SidebarEnUS.goe.js'],
  ['Boe', 'i18n/SidebarEsES.Boe.js'],
  ['dae', 'i18n/SidebarFrFR.dae.js'],
  ['Ve', 'i18n/useTranslation.Ve.js'],
  ['iM', 'i18n/LanguageSwitcher.iM.js'],

  ['sn', 'services/httpClient.sn.js'],
  ['nT', 'services/createHttpClient.nT.js'],
  ['yd', 'services/httpClientBase.yd.js'],
  ['bd', 'services/authenticatedHttpClient.bd.js'],
  ['Ee', 'services/instanceHttpClient.Ee.js'],
  ['sT', 'services/fetchServerStatus.sT.js'],
  ['Ise', 'services/validateCredentials.Ise.js'],
  ['nt', 'services/useMutationAction.nt.js'],
  ['Hh', 'services/useInstanceActions.Hh.js'],
  ['q5', 'services/useInstancesQuery.q5.js'],
  ['H5', 'services/fetchInstances.H5.js'],
  ['V5', 'services/instancesQueryKey.V5.js'],
  ['vT', 'services/useInstanceQuery.vT.js'],
  ['Q5', 'services/connectInstance.Q5.js'],
  ['Z5', 'services/updateInstanceSettings.Z5.js'],
  ['J5', 'services/deleteInstance.J5.js'],
  ['G5', 'services/logoutInstance.G5.js'],
  ['W5', 'services/restartInstance.W5.js'],
  ['K5', 'services/createInstance.K5.js'],
  ['ct', 'services/useInstanceContext.ct.js'],

  ['UM', 'context/InstanceContext.UM.js'],
  ['VM', 'context/InstanceProvider.VM.js'],

  ['Rj', 'session/saveSession.Rj.js'],
  ['Pj', 'session/clearSession.Pj.js'],
  ['jn', 'session/StorageKeys.jn.js'],
  ['dr', 'session/readStorage.dr.js'],

  ['tc', 'theme/useTheme.tc.js'],
  ['lM', 'theme/ThemeSwitcher.lM.js'],

  ['dQ', 'components/CreateInstanceDialog.dQ.js'],
  ['c_', 'components/TokenField.c_.js'],
  ['l_', 'components/ConnectionStatus.l_.js'],
]);

const requiredSymbols = new Set(['Fse', 'Dse', 'CZ', 'PX', 'Lse', 'Dae']);
const extracted = [];
const symbols = [];
const extractedSymbols = new Set();
const visited = new Set();

const writeContent = (content, fileName, symbol, kind, sourceStart, sourceEnd) => {
  if (extractedSymbols.has(symbol)) return;
  const normalized = content.trimEnd() + '\n';
  const filePath = path.join(outputDir, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalized);
  extracted.push({
    symbol,
    kind,
    file: fileName,
    bytes: Buffer.byteLength(normalized),
    sourceStart,
    sourceEnd,
  });
  extractedSymbols.add(symbol);
};

const writeFunction = (node, fileName, symbol) => {
  writeContent(
    source.slice(node.start, node.end),
    fileName,
    symbol,
    'function',
    node.start,
    node.end,
  );
};

const writeVariable = (declarationNode, declarator, fileName, symbol) => {
  if (!declarator.init) return;
  const initializer = source.slice(declarator.init.start, declarator.init.end);
  writeContent(
    `${declarationNode.kind} ${symbol} = ${initializer};`,
    fileName,
    symbol,
    'variable',
    declarator.start,
    declarator.end,
  );
};

const inspectNode = (node) => {
  if (!node || typeof node !== 'object' || visited.has(node)) return;
  visited.add(node);

  if (node.type === 'FunctionDeclaration' && node.id?.name) {
    const name = node.id.name;
    symbols.push({ kind: 'function', name, start: node.start, end: node.end });
    const fileName = wantedSymbols.get(name);
    if (fileName) writeFunction(node, fileName, name);
  }

  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations ?? []) {
      if (declarator.id?.type !== 'Identifier') continue;
      const name = declarator.id.name;
      symbols.push({ kind: 'variable', name, start: declarator.start, end: declarator.end });
      const fileName = wantedSymbols.get(name);
      if (fileName) writeVariable(node, declarator, fileName, name);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) {
      for (const child of value) inspectNode(child);
    } else if (value && typeof value === 'object') {
      inspectNode(value);
    }
  }
};

inspectNode(ast.program);

const expected = [...wantedSymbols.keys()];
const found = new Set(extracted.map((entry) => entry.symbol));
const missing = expected.filter((symbol) => !found.has(symbol));
const missingRequired = [...requiredSymbols].filter((symbol) => !found.has(symbol));

const routeComponentMap = [
  { path: '/', symbol: 'Fse', recoveredName: 'LandingPage' },
  { path: '/manager/login', symbol: 'Dse', recoveredName: 'LoginPage' },
  { path: '/manager/', symbol: 'CZ', recoveredName: 'InstancesPage' },
  { path: '/manager/instance/:instanceId/dashboard', symbol: 'PX', recoveredName: 'InstanceDashboard' },
  { path: '/manager/instance/:instanceId/chat', symbol: 'tk', recoveredName: 'ChatPage' },
  { path: '/manager/instance/:instanceId/chat/:remoteJid', symbol: 'tk', recoveredName: 'ChatPage' },
  { path: '/manager/instance/:instanceId/settings', symbol: 'qre', recoveredName: 'SettingsPage' },
  { path: '/manager/instance/:instanceId/openai', symbol: 'Tk', recoveredName: 'OpenAIPage' },
  { path: '/manager/instance/:instanceId/openai/:botId', symbol: 'Tk', recoveredName: 'OpenAIPage' },
  { path: '/manager/instance/:instanceId/webhook', symbol: 'jse', recoveredName: 'WebhookPage' },
  { path: '/manager/instance/:instanceId/websocket', symbol: 'Ose', recoveredName: 'WebSocketPage' },
  { path: '/manager/instance/:instanceId/rabbitmq', symbol: 'Bre', recoveredName: 'RabbitMQPage' },
  { path: '/manager/instance/:instanceId/sqs', symbol: 'Yre', recoveredName: 'SQSPage' },
  { path: '/manager/instance/:instanceId/chatwoot', symbol: 'yX', recoveredName: 'ChatwootPage' },
  { path: '/manager/instance/:instanceId/typebot', symbol: 'Nk', recoveredName: 'TypebotPage' },
  { path: '/manager/instance/:instanceId/typebot/:typebotId', symbol: 'Nk', recoveredName: 'TypebotPage' },
  { path: '/manager/instance/:instanceId/dify', symbol: 'xk', recoveredName: 'DifyPage' },
  { path: '/manager/instance/:instanceId/dify/:difyId', symbol: 'xk', recoveredName: 'DifyPage' },
  { path: '/manager/instance/:instanceId/n8n', symbol: 'jk', recoveredName: 'N8nPage' },
  { path: '/manager/instance/:instanceId/n8n/:n8nId', symbol: 'jk', recoveredName: 'N8nPage' },
  { path: '/manager/instance/:instanceId/connectAI', symbol: 'Ck', recoveredName: 'ConnectAIPage' },
  { path: '/manager/instance/:instanceId/connectAI/:connectAIId', symbol: 'Ck', recoveredName: 'ConnectAIPage' },
  { path: '/manager/instance/:instanceId/connectBot', symbol: 'Ek', recoveredName: 'ConnectBotPage' },
  { path: '/manager/instance/:instanceId/connectBot/:connectBotId', symbol: 'Ek', recoveredName: 'ConnectBotPage' },
  { path: '/manager/instance/:instanceId/flowise', symbol: 'kk', recoveredName: 'FlowisePage' },
  { path: '/manager/instance/:instanceId/flowise/:flowiseId', symbol: 'kk', recoveredName: 'FlowisePage' },
  { path: '/manager/instance/:instanceId/proxy', symbol: 'Ore', recoveredName: 'ProxyPage' },
  { path: '/manager/embed-chat', symbol: 'Sk', recoveredName: 'EmbedChatPage' },
  { path: '/manager/embed-chat/:remoteJid', symbol: 'Sk', recoveredName: 'EmbedChatPage' },
];

const architectureHints = {
  login: {
    page: 'Dse',
    rawHttpClient: 'sn',
    createHttpClient: 'nT',
    httpClientBase: 'yd',
    serverStatus: 'sT',
    credentialsValidation: 'Ise',
    saveSession: 'Rj',
    clearSession: 'Pj',
  },
  instances: {
    page: 'CZ',
    authenticatedHttpClient: 'bd',
    instanceHttpClient: 'Ee',
    query: 'q5',
    fetchInstances: 'H5',
    queryKey: 'V5',
    fetchInstanceQuery: 'vT',
    actions: 'Hh',
    mutationAdapter: 'nt',
    connect: 'Q5',
    updateSettings: 'Z5',
    deleteInstance: 'J5',
    logout: 'G5',
    restart: 'W5',
    createInstance: 'K5',
    createInstanceDialog: 'dQ',
  },
  instanceDashboard: {
    page: 'PX',
    instanceContext: 'UM',
    instanceProvider: 'VM',
    useInstanceContext: 'ct',
    actions: 'Hh',
    storageKeys: 'jn',
    readStorage: 'dr',
  },
  layout: {
    managerShell: 'B5',
    instanceShell: 'un',
    header: 'zM',
    instanceSidebar: 'j5',
    footer: 'Vb',
  },
  preferences: {
    languageSwitcher: 'iM',
    themeSwitcher: 'lM',
    theme: 'tc',
    translation: 'Ve',
  },
  shared: {
    tokenField: 'c_',
    connectionStatus: 'l_',
  },
};

const inventory = {
  generatedAt: new Date().toISOString(),
  input: path.normalize(inputFile),
  parser: '@babel/parser',
  discoveredSymbolCount: symbols.length,
  extracted,
  missing,
  missingRequired,
};

fs.writeFileSync(path.join(outputDir, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'route-component-map.json'), `${JSON.stringify(routeComponentMap, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'architecture-hints.json'), `${JSON.stringify(architectureHints, null, 2)}\n`);

const readme = `# Manager recovered — análise de componentes\n\n` +
  `Arquivos extraídos automaticamente do bundle legado formatado. Eles ainda usam identificadores minificados e não são o fonte final.\n\n` +
  `## Mapeamentos confirmados\n\n` +
  `- \`Fse\` → landing page raiz do Manager.\n` +
  `- \`Dse\` → página de login do Manager.\n` +
  `- \`CZ\` → lista principal de instâncias.\n` +
  `- \`PX\` → dashboard da instância.\n` +
  `- \`Lse\` → tabela principal de rotas React Router.\n` +
  `- \`Dae\` → labels pt-BR da sidebar, incluindo os links públicos legados.\n` +
  `- \`sn\` → cliente HTTP utilizado pelo login e pelos serviços recuperados.\n` +
  `- \`UM\` / \`VM\` → contexto e provider da instância.\n` +
  `- \`zM\`, \`j5\`, \`Vb\` → header, sidebar da instância e footer.\n` +
  `- \`iM\` / \`lM\` → seletores de idioma e tema, recuperados para aplicação futura da política pt-BR-first.\n\n` +
  `Os arquivos \`route-component-map.json\`, \`architecture-hints.json\`, \`dependency-graph.json\` e \`dependency-candidates.json\` documentam as rotas e as dependências recuperadas que serão renomeadas durante a reconstrução.\n\n` +
  `## Regra desta fase\n\n` +
  `Esses arquivos servem como prova e referência para reconstrução. O \`manager/dist\` de produção não é substituído nesta etapa.\n`;

fs.writeFileSync(path.join(outputDir, 'README.md'), readme);

if (missingRequired.length) {
  console.error(`Required symbols not found: ${missingRequired.join(', ')}`);
  process.exit(2);
}

if (missing.length) {
  console.warn(`Optional symbols not found: ${missing.join(', ')}`);
}

console.log(`Extracted ${extracted.length} recovered symbols into ${outputDir}`);

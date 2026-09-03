import fs from 'fs';
import path from 'path';

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const service = fs.readFileSync(
  path.join(root, 'src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts'),
  'utf8',
);
const helper = fs.readFileSync(
  path.join(root, 'src/api/integrations/channel/whatsapp/helpers/interactiveMessage.helper.ts'),
  'utf8',
);
const planner = fs.readFileSync(path.join(root, 'src/api/services/template-transport-planner.ts'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/api/services/template-engine.service.ts'), 'utf8');

const buttonStart = service.indexOf('public async buttonMessage');
const buttonEnd = service.indexOf('public async locationMessage', buttonStart);
const buttonBlock = service.slice(buttonStart, buttonEnd);
expect(buttonStart >= 0 && buttonEnd > buttonStart, 'buttonMessage block must exist');
expect(!buttonBlock.includes('viewOnceMessage'), 'Baileys interactive buttons must not use viewOnceMessage wrapper');
expect(buttonBlock.includes('interactiveMessage'), 'Baileys buttons must use interactiveMessage directly');
expect(buttonBlock.includes('buildInteractiveBizNode'), 'Baileys buttons must attach the native-flow biz node');

const listStart = service.indexOf('public async listMessage');
const listEnd = service.indexOf('public async contactMessage', listStart);
const listBlock = service.slice(listStart, listEnd);
expect(listStart >= 0 && listEnd > listStart, 'listMessage block must exist');
expect(listBlock.includes('ListType.SINGLE_SELECT'), 'Baileys list must use SINGLE_SELECT');
expect(listBlock.includes('buildListBizNode'), 'Baileys list must attach the list biz node');

expect(service.includes("message['interactiveMessage'] || message['listMessage']"), 'raw relay path must include interactive/list messages');
expect(service.includes('additionalNodes?: BinaryNode[]'), 'send pipeline must accept additionalNodes');
expect(service.includes('...(additionalNodes?.length ? { additionalNodes } : {})'), 'relayMessage must receive additionalNodes');

expect(helper.includes("attrs: { type: 'native_flow', v: '1' }"), 'interactive biz node contract missing');
expect(helper.includes("attrs: { type: 'product_list', v: '2' }"), 'list biz node contract missing');

expect(planner.includes("quickReply: 'NATIVE'"), 'Baileys quick reply capability must be native after transport fix');
expect(planner.includes("list: 'NATIVE'"), 'Baileys list capability must be native after transport fix');
expect(planner.includes("compatibilityTransport: 'BAILEYS_LIST'"), 'planner must route Baileys lists natively');
expect(planner.includes("compatibilityTransport: 'BAILEYS_BUTTONS'"), 'planner must route Baileys choices to buttons');
expect(engine.includes("planned.compatibilityTransport === 'BAILEYS_LIST'"), 'Template Engine must execute Baileys list transport');
expect(engine.includes("planned.compatibilityTransport === 'BAILEYS_BUTTONS'"), 'Template Engine must execute Baileys button transport');

console.log('Baileys native interactive transport contract: OK');

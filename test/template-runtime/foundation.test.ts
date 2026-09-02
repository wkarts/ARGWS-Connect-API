import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const baileys = readFileSync('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts', 'utf8');
const studio = readFileSync('manager/dist/assets/template-editor-v2.js', 'utf8');
const css = readFileSync('manager/dist/assets/template-editor.css', 'utf8');

describe('template runtime persistence and responsive studio', () => {
  it('keeps normalized interaction out of the legacy Prisma Message payload', () => {
    expect(baileys).toContain('message?.key?.fromMe ? null : extractBaileysInteraction');
    expect(baileys).toContain('private messageForPersistence(');
    expect(baileys).toContain('delete messageData.interaction');
    expect(baileys).toContain('delete messageData.pollUpdates');
  });

  it('distinguishes transport acceptance from asynchronous delivery', () => {
    expect(studio).toContain("transportStatus: response.ok ? 'ACCEPTED_BY_PROVIDER' : 'REJECTED'");
    expect(studio).toContain("deliveryStatus: response.ok ? 'PENDING_OR_UNKNOWN' : 'NOT_SENT'");
  });

  it('has fluid and stacked layouts before mobile widths', () => {
    expect(css).toContain('@media (max-width: 1360px)');
    expect(css).toContain('@media (max-width: 1024px)');
    expect(css).toContain('scroll-snap-type:x proximity');
    expect(css).toContain('overflow-wrap:anywhere');
  });
});

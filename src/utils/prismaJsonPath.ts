import { configService, Database } from '@config/env.config';

/**
 * Prisma uses different JSON-path representations per provider:
 * PostgreSQL: ['key', 'nested']
 * MySQL:      $.key.nested
 *
 * The provider-specific Prisma clients expose different TypeScript path types,
 * so this narrow database-boundary helper intentionally returns `any`.
 */
export function prismaJsonPath(...segments: string[]): any {
  const provider = configService.get<Database>('DATABASE').PROVIDER;
  return provider === 'mysql' ? `$.${segments.join('.')}` : segments;
}

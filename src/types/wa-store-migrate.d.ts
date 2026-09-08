declare module 'wa-store-migrate' {
  export type MigrationLoss = {
    severity?: string;
    domain?: string;
    count?: number;
    reason?: string;
    [key: string]: unknown;
  };

  export function migrate(input: {
    from: 'baileys' | 'zapo';
    to: 'baileys' | 'zapo';
    data: unknown;
  }): {
    data: unknown;
    snapshot: unknown;
    losses: MigrationLoss[];
  };
}

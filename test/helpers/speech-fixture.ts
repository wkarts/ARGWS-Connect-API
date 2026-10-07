import { randomUUID } from 'node:crypto';

// A transaction fixture for fault injection, not a substitute for the SQL integration suite.
export function speechFixture() {
  let tables: Record<string, any[]> = { transcriptionJob: [], speechPool: [], speechUploadReservation: [], speechOutbox: [], speechWorker: [] };
  let transactionTail = Promise.resolve();
  const failures: Record<string, number> = {};
  const queries: Array<{ table: string; operation: string; args: any }> = [];
  const comparable = (value: any) => value instanceof Date ? value.getTime() : value;
  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([key, expected]: [string, any]) => {
    if (key === 'OR') return expected.some((part: any) => matches(row, part));
    if (key === 'AND') return expected.every((part: any) => matches(row, part));
    if (key === 'jobId_generation') return matches(row, expected);
    const value = row[key] ?? null;
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, criterion]: [string, any]) => {
        if (operator === 'in') return criterion.includes(value);
        if (operator === 'notIn') return !criterion.includes(value);
        if (operator === 'not') return value !== criterion;
        if (operator === 'lt') return value !== null && comparable(value) < comparable(criterion);
        if (operator === 'lte') return value !== null && comparable(value) <= comparable(criterion);
        if (operator === 'gt') return value !== null && comparable(value) > comparable(criterion);
        if (operator === 'gte') return value !== null && comparable(value) >= comparable(criterion);
        if (operator === 'startsWith') return String(value).startsWith(criterion);
        throw new Error('Unsupported fixture operator ' + operator);
      });
    }
    return comparable(value) === comparable(expected ?? null);
  });
  const apply = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = value && typeof value === 'object' && 'increment' in value ? Number(row[key] || 0) + Number(value.increment) : value;
    }
    row.updatedAt = new Date();
    return structuredClone(row);
  };
  const repository: any = { $connect: async () => {}, $disconnect: async () => {} };
  for (const table of Object.keys(tables)) {
    const log = (operation: string, args: any) => {
      queries.push({ table, operation, args });
      const target = table + '.' + operation;
      if (failures[target]) { failures[target] -= 1; throw new Error('Injected failure ' + target); }
    };
    const find = (args: any) => tables[table].find((row) => matches(row, args.where));
    repository[table] = {
      findUnique: async (args: any) => { log('findUnique', args); return structuredClone(find(args) || null); },
      findFirst: async (args: any) => { log('findFirst', args); return structuredClone(find(args) || null); },
      findMany: async (args: any = {}) => { log('findMany', args); let rows = tables[table].filter((row) => matches(row, args.where));
        if (args.orderBy) { const [field, direction] = Object.entries(args.orderBy)[0]; rows = [...rows].sort((a,b) => (comparable(a[field]) > comparable(b[field]) ? 1 : -1) * (direction === 'asc' ? 1 : -1)); }
        return structuredClone(rows.slice(0, args.take || rows.length)); },
      count: async (args: any) => { log('count', args); return tables[table].filter((row) => matches(row, args.where)).length; },
      aggregate: async (args: any) => { log('aggregate', args); const rows = tables[table].filter((row) => matches(row, args.where));
        return { _sum: Object.fromEntries(Object.keys(args._sum).map((field) => [field, rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)])) }; },
      create: async (args: any) => { log('create', args); const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), status: 'pending', ...args.data };
        tables[table].push(row); return structuredClone(row); },
      update: async (args: any) => { log('update', args); const row = find(args); if (!row) throw new Error('Fixture record not found'); return apply(row, args.data); },
      updateMany: async (args: any) => { log('updateMany', args); const rows = tables[table].filter((row) => matches(row, args.where)); rows.forEach((row) => apply(row,args.data)); return { count: rows.length }; },
      deleteMany: async (args: any) => { log('deleteMany', args); const count = tables[table].filter((row) => matches(row, args.where)).length; tables[table] = tables[table].filter((row) => !matches(row, args.where)); return { count }; },
      upsert: async (args: any) => { log('upsert', args); const row = find(args); if (row) return apply(row,args.update);
        return repository[table].create({ data: args.create }); },
    };
  }
  repository.$transaction = async (operation: (tx: any) => Promise<any>) => {
    let release!: () => void;
    const previous = transactionTail;
    transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const backup = structuredClone(tables);
    try { return await operation(repository); }
    catch (error) { tables = backup; throw error; }
    finally { release(); }
  };
  return { repository, queries, failures, rows: (table: string) => tables[table], seed: (table: string, row: any) => tables[table].push(structuredClone(row)) };
}

export function queuedSpeechJob(input: any = {}) {
  return { id: randomUUID(), poolId: process.env.SPEECH_POOL_ID || process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect',
    scopeKey: 'admin:global', protocolVersion: 2, instanceId: null, mode: 'transcription', status: 'queued', stage: 'queued',
    dedupKey: randomUUID(), generation: 1, attempts: 1, executionId: null, leaseExpiresAt: null,
    sourceKey: 'transcriptions/test/audio.ogg', sourceMimeType: 'audio/ogg', audioHash: 'abc', sourceType: 'upload',
    model: 'Xenova/whisper-small', requestedModel: 'Xenova/whisper-small', provider: 'local',
    requestedEngine: 'transformers', requestedRevision: 'pinned-revision', reservedDurationMs: 3_600_000,
    reservedBytes: 1000, sizeBytes: 1000, createdAt: new Date(), updatedAt: new Date(),
    deadlineAt: new Date(Date.now() + 600_000), ...input };
}

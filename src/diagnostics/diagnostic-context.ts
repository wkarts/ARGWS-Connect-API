import { AsyncLocalStorage } from 'node:async_hooks';

export const diagnosticContext = new AsyncLocalStorage<{ traceId: string }>();

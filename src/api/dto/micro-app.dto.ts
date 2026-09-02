export class MicroAppSessionDto {
  templateName: string;
  language?: string;
  appKey: string;
  number: string;
  variables?: Record<string, unknown>;
  ttlSeconds?: number;
}

export class MicroAppSubmitDto {
  direction?: 'NEXT' | 'BACK';
  values?: Record<string, unknown>;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    capturedAt?: string;
  };
}

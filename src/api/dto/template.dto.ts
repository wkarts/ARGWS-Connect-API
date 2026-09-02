export class TemplateDto {
  name: string;
  category: string;
  allowCategoryChange: boolean;
  language: string;
  components: any;
  actions?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  enabled?: boolean;
  webhookUrl?: string;
}

export class TemplateEditDto {
  templateId: string;
  name?: string;
  language?: string;
  category?: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
  allowCategoryChange?: boolean;
  ttl?: number;
  components?: any;
  actions?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  enabled?: boolean;
  webhookUrl?: string;
}

export class TemplateDeleteDto {
  name: string;
  hsmId?: string;
}

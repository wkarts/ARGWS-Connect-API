export type MetaCloudMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'audio'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'interactive'
  | 'template';

export interface MetaCloudMessageRequest {
  messaging_product?: string;
  recipient_type?: string;
  to?: string;
  type?: MetaCloudMessageType;
  text?: { body?: string };
  image?: { link?: string; id?: string; caption?: string; mime_type?: string };
  video?: { link?: string; id?: string; caption?: string; mime_type?: string };
  document?: { link?: string; id?: string; filename?: string; caption?: string; mime_type?: string };
  audio?: { link?: string; id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: any[];
  reaction?: { message_id?: string; emoji?: string };
  interactive?: any;
  template?: {
    name?: string;
    language?: { code?: string; policy?: string };
    components?: any[];
  };
  status?: 'read';
  message_id?: string;
}

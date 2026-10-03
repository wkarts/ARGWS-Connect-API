export type MetaCloudMessageType =
  | 'template'
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'audio'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'interactive';

export interface MetaCloudMessageRequest {
  messaging_product?: string;
  recipient_type?: string;
  to?: string;
  type?: MetaCloudMessageType;
  template?: { name?: string; language?: { code?: string }; components?: any[]; connect_api_version?: number };
  text?: { body?: string };
  image?: { link?: string; id?: string; caption?: string; mime_type?: string };
  video?: { link?: string; id?: string; caption?: string; mime_type?: string };
  document?: { link?: string; id?: string; filename?: string; caption?: string; mime_type?: string };
  audio?: { link?: string; id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: any[];
  reaction?: { message_id?: string; emoji?: string };
  interactive?: any;
  status?: 'read';
  message_id?: string;
}

export type MetaCloudStatusType = 'text' | 'image' | 'video' | 'audio';

export interface MetaCloudStatusRequest {
  messaging_product?: string;
  type?: MetaCloudStatusType;
  content?: string;
  text?: { body?: string; background_color?: string; font?: number };
  image?: { link?: string; id?: string; caption?: string; mime_type?: string };
  video?: { link?: string; id?: string; caption?: string; mime_type?: string };
  audio?: { link?: string; id?: string; mime_type?: string };
  caption?: string;
  background_color?: string;
  font?: number;
  status_jid_list?: string[] | string;
  all_contacts?: boolean | string;
}

export interface MetaCloudTranscriptionRequest {
  messaging_product?: string;
  message_id?: string;
  language?: string;
  model?: string;
}

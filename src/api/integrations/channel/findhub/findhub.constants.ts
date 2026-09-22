export const FINDHUB_INTEGRATION = 'GOOGLE-FIND-HUB';

export const FINDHUB_EVENTS = {
  AUTH_UPDATE: 'findhub.auth.update',
  DEVICES_UPDATED: 'findhub.devices.updated',
  LOCATION_UPDATED: 'findhub.location.updated',
  TRACKING_UPDATE: 'findhub.tracking.update',
  ERROR: 'findhub.error',
} as const;

export const GOOGLE_ENDPOINTS = {
  embeddedSetup: 'https://accounts.google.com/EmbeddedSetup',
  androidAuth: 'https://android.clients.google.com/auth',
  novaBase: 'https://android.googleapis.com/nova',
  spotAuthority: 'https://spot-pa.googleapis.com',
  spotPath: '/google.internal.spot.v1.SpotService',
  checkin: 'https://android.clients.google.com/checkin',
  gcmRegister: 'https://android.clients.google.com/c2dm/register3',
  fcmInstall: 'https://firebaseinstallations.googleapis.com/v1/projects/google.com:api-project-289722593072/installations',
  fcmRegisterBase: 'https://fcmregistrations.googleapis.com/v1/projects/google.com:api-project-289722593072/registrations',
  fcmSendBase: 'https://fcm.googleapis.com/fcm/send/',
  mcsHost: 'mtalk.google.com',
  mcsPort: 5228,
} as const;

export const GOOGLE_ADM_CONFIG = {
  projectId: 'google.com:api-project-289722593072',
  appId: '1:289722593072:android:3cfcf5bc359f0308',
  apiKey: 'AIzaSyD_gko3P392v6how2H7UpdeXQ0v2HLettc',
  senderId: '289722593072',
  androidPackage: 'com.google.android.apps.adm',
  androidCertSha1: '38918a453d07199354f8b19af05ec6562ced5788',
  clientSig: '38918a453d07199354f8b19af05ec6562ced5788',
  chromeId: 'org.chromium.linux',
  chromeVersion: '94.0.4606.51',
  fmdUserAgent: 'fmd/20006320; gzip',
  spotUserAgent: 'com.google.android.gms/244433022 grpc-java-cronet/1.69.0-SNAPSHOT',
  googlePlayServicesVersion: '244433022',
  vapidKey: 'BDOU99-h67HcA6JeFXHbSNMu7e2yNNu3RzoMj8TM4W88jITfq7ZmPvIM1Iv-4_l2LxQcYwhqby2xGpWwzjfAnG4',
} as const;

export const NOVA_SCOPES = {
  listDevices: 'nbe_list_devices',
  executeAction: 'nbe_execute_action',
} as const;

export const GOOGLE_OAUTH_SCOPES = {
  adm: 'android_device_manager',
  spot: 'spot',
} as const;

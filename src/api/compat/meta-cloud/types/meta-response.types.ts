export interface MetaCloudIdentity {
  instanceId: string;
  instanceName: string;
  provider: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  token?: string;
  instance: any;
}

export interface MetaGraphErrorBody {
  error: {
    message: string;
    type: string;
    code: number;
  };
}

import { ConfigService, S3 } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import * as MinIo from 'minio';
import { join } from 'path';
import { Readable, Transform } from 'stream';

const logger = new Logger('S3 Service');
const BUCKET = new ConfigService().get<S3>('S3');

interface Metadata extends MinIo.ItemBucketMetadata {
  'Content-Type': string;
}

const minioClient = (() => {
  if (BUCKET?.ENABLE) {
    return new MinIo.Client({
      endPoint: BUCKET.ENDPOINT,
      port: BUCKET.PORT,
      useSSL: BUCKET.USE_SSL,
      accessKey: BUCKET.ACCESS_KEY,
      secretKey: BUCKET.SECRET_KEY,
      region: BUCKET.REGION,
    });
  }
})();

const bucketName = BUCKET.BUCKET_NAME;

export type StoredObjectSummary = {
  key: string;
  size: number;
  lastModified: string | null;
  etag?: string;
};

/**
 * The application only owns objects that are explicitly written through the
 * `argws-connect-api/` prefix. Other prefixes may belong to backups or an
 * external integration and are deliberately reported but never cleaned by
 * the Manager storage tools.
 */
export const MANAGED_OBJECT_PREFIX = 'argws-connect-api/';
const MAX_OBJECTS_PER_SCAN = 100_000;

export const minioEnabled = () => Boolean(minioClient && BUCKET?.ENABLE && bucketName);

const listBucketObjects = async (): Promise<{ objects: StoredObjectSummary[]; truncated: boolean }> => {
  if (!minioEnabled()) return { objects: [], truncated: false };

  return await new Promise((resolve, reject) => {
    const objects: StoredObjectSummary[] = [];
    let truncated = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ objects, truncated });
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const stream = minioClient.listObjectsV2(bucketName, '', true);

    stream.on('data', (item: MinIo.BucketItem) => {
      if (objects.length >= MAX_OBJECTS_PER_SCAN) {
        truncated = true;
        stream.destroy?.();
        return;
      }
      const key = String(item?.name || '');
      if (!key) return;
      objects.push({
        key,
        size: Number.isFinite(Number(item?.size)) ? Number(item.size) : 0,
        lastModified: item?.lastModified ? new Date(item.lastModified).toISOString() : null,
        etag: item?.etag ? String(item.etag) : undefined,
      });
    });
    stream.on('error', fail);
    stream.on('end', finish);
    stream.on('close', () => {
      // Destroying the stream at the safety limit can emit close without end.
      if (truncated) finish();
    });
  });
};

export const managedObjectKey = (fileName: string): string | null => {
  const value = String(fileName || '')
    .replace(/\\/g, '/')
    .trim();
  if (!value || value.includes('\0') || value.startsWith('/') || value.split('/').includes('..')) return null;
  return `${MANAGED_OBJECT_PREFIX}${value.replace(/^\.\//, '')}`;
};

const bucketExists = async () => {
  if (minioClient) {
    try {
      const list = await minioClient.listBuckets();
      return list.find((bucket) => bucket.name === bucketName);
    } catch {
      return false;
    }
  }
};

const setBucketPolicy = async () => {
  if (minioClient) {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucketName}/*`],
        },
      ],
    };
    await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
  }
};

const createBucket = async () => {
  if (minioClient) {
    try {
      const exists = await bucketExists();
      if (!exists) {
        await minioClient.makeBucket(bucketName);
      }
      if (!BUCKET.SKIP_POLICY) {
        await setBucketPolicy();
      }
      logger.info(`S3 Bucket ${bucketName} - ON`);
      return true;
    } catch (error) {
      logger.error('S3 ERROR:');
      logger.error(error);
      return false;
    }
  }
};

createBucket();

const uploadFile = async (fileName: string, file: Buffer | Transform | Readable, size: number, metadata: Metadata) => {
  if (minioClient) {
    const objectName = join('argws-connect-api', fileName);
    try {
      metadata['custom-header-application'] = 'argws-connect-api';
      return await minioClient.putObject(bucketName, objectName, file, size, metadata);
    } catch (error) {
      logger.error(error);
      return error;
    }
  }
};

const getObjectUrl = async (fileName: string, expiry?: number) => {
  if (minioClient) {
    try {
      const objectName = join('argws-connect-api', fileName);
      if (expiry) {
        return await minioClient.presignedGetObject(bucketName, objectName, expiry);
      }
      return await minioClient.presignedGetObject(bucketName, objectName);
    } catch (error) {
      throw new BadRequestException(error?.message);
    }
  }
};

/**
 * Open a stored object through the server-side MinIO client.
 *
 * This deliberately keeps the internal S3 endpoint private. Public consumers
 * must receive a Connect|API URL and the API streams the object from MinIO,
 * instead of leaking an internal Docker hostname in a presigned URL.
 */
const getObjectStream = async (fileName: string) => {
  if (!minioClient) return null;

  try {
    const objectName = join('argws-connect-api', fileName);
    return await minioClient.getObject(bucketName, objectName);
  } catch (error) {
    throw new BadRequestException(error?.message);
  }
};

const uploadTempFile = async (
  folder: string,
  fileName: string,
  file: Buffer | Transform | Readable,
  size: number,
  metadata: Metadata,
) => {
  if (minioClient) {
    const objectName = join(folder, fileName);
    try {
      metadata['custom-header-application'] = 'argws-connect-api';
      return await minioClient.putObject(bucketName, objectName, file, size, metadata);
    } catch (error) {
      logger.error(error);
      return error;
    }
  }
};

const deleteFile = async (folder: string, fileName: string) => {
  if (minioClient) {
    const objectName = join(folder, fileName);
    try {
      return await minioClient.removeObject(bucketName, objectName);
    } catch (error) {
      logger.error(error);
      return error;
    }
  }
};

const deleteStoredFile = async (fileName: string): Promise<boolean> => {
  if (!minioClient) return false;

  try {
    await minioClient.removeObject(bucketName, join('argws-connect-api', fileName));
    return true;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

export {
  BUCKET,
  bucketName,
  deleteFile,
  deleteStoredFile,
  getObjectStream,
  getObjectUrl,
  listBucketObjects,
  uploadFile,
  uploadTempFile,
};

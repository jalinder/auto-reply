import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Module } from '@nestjs/common';
import { config } from '../../common/config';

@Injectable()
export class StorageService {
  private readonly internal: S3Client;
  private readonly publicSigner: S3Client;

  constructor() {
    const base = {
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: config.s3.accessKeyId ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey! } : undefined,
    };
    this.internal = new S3Client({ ...base, endpoint: config.s3.endpoint });
    // Signed URLs must use a host reachable by clients (e.g. MinIO on localhost in dev).
    this.publicSigner = new S3Client({ ...base, endpoint: config.s3.publicEndpoint });
  }

  presignPut(key: string, mimeType: string, sizeBytes: number, expiresIn = 600) {
    return getSignedUrl(
      this.publicSigner,
      new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, ContentType: mimeType, ContentLength: sizeBytes, ServerSideEncryption: config.s3.endpoint ? undefined : 'AES256' }),
      { expiresIn },
    );
  }

  presignGet(key: string, fileName: string, expiresIn = 300) {
    return getSignedUrl(
      this.publicSigner,
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: key, ResponseContentDisposition: `inline; filename="${fileName.replace(/["\\\r\n]/g, '')}"` }),
      { expiresIn },
    );
  }

  async head(key: string) {
    try {
      const r = await this.internal.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType, etag: r.ETag?.replace(/"/g, '') };
    } catch {
      return null;
    }
  }

  async readRange(key: string, bytes: number): Promise<Buffer> {
    const r = await this.internal.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async read(key: string): Promise<Buffer> {
    const r = await this.internal.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async put(key: string, body: Buffer | string, contentType: string) {
    await this.internal.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: config.s3.endpoint ? undefined : 'AES256' }));
  }

  /** Deletes every object under a prefix (used when purging a deleted workspace). */
  async deletePrefix(prefix: string) {
    let token: string | undefined;
    do {
      const page = await this.internal.send(new ListObjectsV2Command({ Bucket: config.s3.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await this.internal.send(new DeleteObjectsCommand({ Bucket: config.s3.bucket, Delete: { Objects: keys, Quiet: true } }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async delete(key: string) {
    await this.internal.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}

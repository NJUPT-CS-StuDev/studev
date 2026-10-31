import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getStore } from '@edgeone/pages-blob';

export function metadataStore() {
  return getStore({ name: 'studev-collections', consistency: 'strong' });
}

export function oscaGateway(config) {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
  return {
    async presignUpload(record, expiresIn) {
      const command = new PutObjectCommand({ Bucket: config.bucket, Key: record.objectKey, ContentType: record.contentType, ContentLength: record.fileSize });
      return {
        url: await getSignedUrl(client, command, { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) }),
        method: 'PUT', headers: { 'Content-Type': record.contentType },
        expiresAt: Date.now() + expiresIn * 1000,
      };
    },
    async head(objectKey) {
      try {
        const command = new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey });
        command.middlewareStack.add((next) => async (args) => {
          // OSCA's public gateway otherwise may describe a gzip representation with a weak ETag.
          args.request.headers['accept-encoding'] = 'identity';
          return next(args);
        }, { step: 'build', name: 'oscaIdentityRepresentation' });
        const object = await client.send(command);
        return { size: object.ContentLength, etag: object.ETag, contentType: object.ContentType };
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
        throw error;
      }
    },
    async copy(sourceObjectKey, finalObjectKey, etag) {
      const source = `${config.bucket}/${sourceObjectKey}`.split('/').map(encodeURIComponent).join('/');
      await client.send(new CopyObjectCommand({
        Bucket: config.bucket, Key: finalObjectKey, CopySource: source,
        CopySourceIfMatch: etag, MetadataDirective: 'COPY',
      }));
    },
    async delete(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
    },
    async presignDownload(record, etag, expiresIn) {
      const fallbackName = record.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
      const contentDisposition = `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(record.fileName).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`;
      const command = new GetObjectCommand({
        Bucket: config.bucket, Key: record.finalObjectKey, IfMatch: etag,
        ResponseContentType: 'application/octet-stream', ResponseContentDisposition: contentDisposition,
      });
      return {
        url: await getSignedUrl(client, command, { expiresIn, signableHeaders: new Set(['if-match']) }),
        method: 'GET', headers: { 'If-Match': etag }, fileName: record.fileName,
        expiresAt: Date.now() + expiresIn * 1000,
      };
    },
  };
}

import { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

let cachedClient: S3Client | null = null;
let cachedConfig: { endpoint: string; accessKey: string; secretKey: string } | null = null;

function readS3Config() {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error("MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY required");
  }
  return { endpoint, accessKey, secretKey };
}

/** 获取 S3 client（singleton，懒加载）。env 变更后调 resetS3Client() 清缓存。 */
export function getS3Client(): S3Client {
  const cfg = readS3Config();
  if (cachedClient && cachedConfig && cachedConfig.endpoint === cfg.endpoint) {
    return cachedClient;
  }
  cachedClient = new S3Client({
    endpoint: cfg.endpoint,
    region: "us-east-1", // MinIO 不在意，AWS SDK 需要任意值
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true, // MinIO 必须 path-style
  });
  cachedConfig = cfg;
  return cachedClient;
}

export function resetS3Client(): void {
  cachedClient = null;
  cachedConfig = null;
}

export function getBucketName(): string {
  const bucket = process.env.MINIO_BUCKET;
  if (!bucket) throw new Error("MINIO_BUCKET required");
  return bucket;
}

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** 拉对象为 Buffer（小文件用） */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const client = getS3Client();
  const res = await client.send(new GetObjectCommand({ Bucket: getBucketName(), Key: key }));
  if (!res.Body) throw new Error("empty body");
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** 拉对象为 stream（preview 子资源反代用） */
export async function getObjectStream(key: string): Promise<{
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}> {
  const client = getS3Client();
  const res = await client.send(new GetObjectCommand({ Bucket: getBucketName(), Key: key }));
  if (!res.Body) throw new Error("empty body");
  return {
    stream: res.Body as Readable,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}

export async function objectExists(key: string): Promise<boolean> {
  const client = getS3Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: getBucketName(), Key: key }));
    return true;
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      ((e as { name?: string }).name === "NotFound" ||
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
    ) {
      return false;
    }
    throw e;
  }
}

/** 启动时确保 bucket 存在（idempotent；权限不足时给清晰提示） */
export async function ensureBucket(): Promise<void> {
  const { CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
  const client = getS3Client();
  const bucket = getBucketName();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (e: unknown) {
    const code = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (code !== 404 && code !== 301) throw e;
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}

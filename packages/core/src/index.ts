export * from "./db/schema";
export { db, getDb, closeDb } from "./db/client";
export {
  getS3Client,
  resetS3Client,
  getBucketName,
  uploadFile,
  getObjectBuffer,
  getObjectStream,
  objectExists,
  ensureBucket,
} from "./s3";
export {
  issueToken,
  issueShareToken,
  verifyToken,
  type TokenKind,
  type TokenPayload,
  type VerifyResult,
} from "./hmac-token";
export {
  issueShareCookie,
  verifyShareCookie,
  shareSessionId,
  type ShareCookiePayload,
  type VerifyShareCookieResult,
} from "./hmac-token/share-cookie";
export { hashPassword, verifyPassword } from "./password";
export { generateShareId } from "./share-id";
export {
  generateApiToken,
  hashApiToken,
  verifyApiToken,
  type GeneratedApiToken,
} from "./api-token";
export {
  parseAndValidateZip,
  detectEntryMode,
  ZIP_LIMITS,
  type ZipFile,
  type ParseZipResult,
  type ParseZipError,
  type EntryMode,
} from "./zip-utils";
export {
  parseRendererManifest,
  type RendererManifest,
  type ParseManifestError,
  type ParseManifestResult,
} from "./zip-utils/manifest";
// 注意：renderer 相关 export 已迁到 `@prd-lab/core/renderers` 子路径
// (renderer-codex-followup sprint Step 2 修复，详见 KNOWLEDGE R12 同源教训：
// 根 export 会让所有 `@prd-lab/core` 消费者隐式依赖 renderer 包 dist-node 产物，
// clean clone 上未 build 时触发 ENOENT)

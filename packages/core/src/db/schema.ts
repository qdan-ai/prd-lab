import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Schema 按 docs/01-data-model.md 演进：
 *   S0：users
 *   S1：+ projects、versions
 *   S2：+ snapshots、snapshot_files、idempotency_keys
 *   S5：+ share_links（单一 active link）
 *   S6：+ api_tokens
 *   S7：snapshots + version_label（活跃内唯一）
 *   S8：snapshots 升格平行版本；share_links 绑 snapshot_id
 *   S9：架构简化
 *   S14：迁移至 MySQL 5.7
 *        - uuid → varchar(36) + 应用侧 randomUUID()
 *        - pgEnum → mysqlEnum
 *        - timestamp(withTimezone) → datetime(fsp:3)（应用层统一 UTC）
 *        - jsonb → json；MySQL 5.7 不支持 JSON 默认值，改用 $defaultFn
 *        - partial unique WHERE → 生成列 + 普通 unique（NULL 不参与 UNIQUE）
 *        - text → varchar(N) for 索引列，长度算清 utf8mb4 上限
 *   S15：移除评论/标注协作层（comments / annotation_links 表与相关 route 从未在 MySQL 落地，已删）
 *   preview-renderer-adapter：snapshots + renderer_name / renderer_metadata
 *        - 上传时由 zip 根的 prd-renderer.json 声明 renderer；缺失 = default（NULL）
 *        - INSERT 一次性写入，禁止 UPDATE（snapshot immutable，详见 DESIGN §4.4 / D12）
 *   upload-renderer-selector：声明渠道从 zip 内 manifest 迁至 multipart `renderer` form 字段
 *        - 上传时由 multipart form 字段 `renderer` 声明；`default` / 未传 = NULL
 *        - schema 列定义保持不变，落库逻辑不变，仅数据来源变更（D7 / D11）
 */

const uuidPk = () =>
  varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID());

const datetimeFsp = (name: string) => datetime(name, { fsp: 3, mode: "date" });
const nowDefault = () => sql`CURRENT_TIMESTAMP(3)`;

// ---- users ----
export const users = mysqlTable("users", {
  id: uuidPk(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  passwordHash: varchar("password_hash", { length: 255 }),
  createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
  archivedAt: datetimeFsp("archived_at"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ---- projects ----
export const projects = mysqlTable(
  "projects",
  {
    id: uuidPk(),
    name: varchar("name", { length: 255 }).notNull(),
    ownerId: varchar("owner_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    visibility: mysqlEnum("visibility", ["private", "team"]).notNull().default("private"),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    archivedAt: datetimeFsp("archived_at"),
    // 生成列：archived_at IS NULL 时等于 name，否则 NULL；NULL 不参与 UNIQUE → 等价 partial unique
    nameActive: varchar("name_active", { length: 255 }).generatedAlwaysAs(
      sql`(CASE WHEN \`archived_at\` IS NULL THEN \`name\` END)`,
    ),
  },
  (t) => [uniqueIndex("projects_owner_name_active_unique").on(t.ownerId, t.nameActive)],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// ---- versions ----
export const versions = mysqlTable(
  "versions",
  {
    id: uuidPk(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    seqNo: int("seq_no").notNull(),
    createdBy: varchar("created_by", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    archivedAt: datetimeFsp("archived_at"),
  },
  (t) => [
    unique("versions_project_name_unique").on(t.projectId, t.name),
    unique("versions_project_seq_unique").on(t.projectId, t.seqNo),
  ],
);

export type Version = typeof versions.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;

// ---- snapshots ----
export const snapshots = mysqlTable(
  "snapshots",
  {
    id: uuidPk(),
    versionId: varchar("version_id", { length: 36 })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    seqNo: int("seq_no").notNull(),
    entryHtmlPath: varchar("entry_html_path", { length: 512 }).notNull().default("index.html"),
    rendererName: varchar("renderer_name", { length: 64 }),
    rendererMetadata: json("renderer_metadata"),
    totalSizeBytes: bigint("total_size_bytes", { mode: "number" }).notNull(),
    fileCount: int("file_count").notNull(),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    uploaderId: varchar("uploader_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    uploaderType: mysqlEnum("uploader_type", ["user", "mcp", "cli"]).notNull().default("user"),
    changeNote: text("change_note").notNull(),
    versionLabel: varchar("version_label", { length: 64 }),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    archivedAt: datetimeFsp("archived_at"),
    archivedBy: varchar("archived_by", { length: 36 }).references(() => users.id, {
      onDelete: "set null",
    }),
    // 生成列：仅当 archived_at IS NULL 且 version_label IS NOT NULL 时取 version_label，否则 NULL
    versionLabelActive: varchar("version_label_active", { length: 64 }).generatedAlwaysAs(
      sql`(CASE WHEN \`archived_at\` IS NULL AND \`version_label\` IS NOT NULL THEN \`version_label\` END)`,
    ),
  },
  (t) => [
    unique("snapshots_version_seq_unique").on(t.versionId, t.seqNo),
    uniqueIndex("snapshots_version_label_active_unique").on(t.versionId, t.versionLabelActive),
  ],
);

export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;

// ---- snapshot_files ----
// rel_path 上限收紧到 varchar(700)：
//   utf8mb4 索引前缀限制 3072 字节，(varchar(36) + varchar(N)*4) ≤ 3072 → N ≤ 732
//   原 PG 时 preview 路由校验 ≤ 1024 字符，S14 起改 ≤ 700 字符
export const snapshotFiles = mysqlTable(
  "snapshot_files",
  {
    id: uuidPk(),
    snapshotId: varchar("snapshot_id", { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    relPath: varchar("rel_path", { length: 700 }).notNull(),
    s3Key: varchar("s3_key", { length: 1024 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
  },
  (t) => [unique("snapshot_files_snapshot_relpath_unique").on(t.snapshotId, t.relPath)],
);

export type SnapshotFile = typeof snapshotFiles.$inferSelect;
export type NewSnapshotFile = typeof snapshotFiles.$inferInsert;

// ---- idempotency_keys（上传幂等用） ----
export const idempotencyKeys = mysqlTable(
  "idempotency_keys",
  {
    key: varchar("key", { length: 128 }).notNull(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    responseJson: json("response_json").notNull(),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
  },
  (t) => [primaryKey({ columns: [t.key, t.userId] })],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;

// ---- share_links ----
// 单一 active link per snapshot：用生成列 snapshotIdActive 在 revoked_at IS NULL 时取 snapshot_id
export const shareLinks = mysqlTable(
  "share_links",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    snapshotId: varchar("snapshot_id", { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    passwordVersion: int("password_version").notNull().default(1),
    allowExternalApi: boolean("allow_external_api").notNull().default(false),
    externalApiAllowlist: json("external_api_allowlist")
      .notNull()
      .$type<string[]>()
      .$defaultFn(() => []),
    createdBy: varchar("created_by", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    revokedAt: datetimeFsp("revoked_at"),
    snapshotIdActive: varchar("snapshot_id_active", { length: 36 }).generatedAlwaysAs(
      sql`(CASE WHEN \`revoked_at\` IS NULL THEN \`snapshot_id\` END)`,
    ),
  },
  (t) => [uniqueIndex("share_links_snapshot_active_unique").on(t.snapshotIdActive)],
);

export type ShareLink = typeof shareLinks.$inferSelect;
export type NewShareLink = typeof shareLinks.$inferInsert;

// ---- api_tokens ----
export const apiTokens = mysqlTable(
  "api_tokens",
  {
    id: uuidPk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
    tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
    scopes: json("scopes")
      .notNull()
      .$type<string[]>()
      .$defaultFn(() => ["read_write"]),
    lastUsedAt: datetimeFsp("last_used_at"),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    revokedAt: datetimeFsp("revoked_at"),
  },
  (t) => [index("api_tokens_user_revoked_idx").on(t.userId, t.revokedAt)],
);

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;

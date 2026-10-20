import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  datetime,
  index,
  int,
  json,
  mediumtext,
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
 *   S19：share_links 绑定改回 version（方案级分享，访客可切换方案内所有版本）
 *        - snapshot_id → version_id；生成列/唯一索引同步改名
 *        - 删除从未消费的 allow_external_api / external_api_allowlist
 *   repo-push：G-canvas 仓库式推送
 *        - projects + kind（upload / repo）
 *        - + repo_state（一仓库一行：系统方案、上线标记、最近推送）
 *        - + repo_versions（版本图元数据，一行对应系统方案下的一个快照）
 *        - + repo_blobs（项目内按内容指纹登记已上传文件，MinIO 键 projects/<pid>/blobs/<sha256>）
 *   repo-push 字段对齐（迁移 0005）：repo_versions + manifest（机器清单）；repo_state + summary（项目简介）
 *   多人协作（迁移 0006）：团队内容挂在「团队方案」（repo_state.team_version_id）下，快照标 audience='team'；
 *        + project_members / team_lines / team_line_history / merge_requests / team_sealing /
 *          team_discussions / team_progress / team_events
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
    // upload = 普通项目（zip 上传 / prd push）；repo = G-canvas 仓库项目（仓库式推送，见 repo_state）
    kind: mysqlEnum("kind", ["upload", "repo"]).notNull().default("upload"),
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
    // 读者范围：guest = 访客级内容（访客链接、分享页、预览站能读）；team = 团队内容，只经团队接口读
    audience: mysqlEnum("audience", ["guest", "team"]).notNull().default("guest"),
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
    // 团队文件表才有：git 文件模式（如 100644）与对象号
    gitMode: char("git_mode", { length: 6 }),
    gitOid: char("git_oid", { length: 40 }),
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
// S19 起分享绑定 version（方案）：访客可查看方案下所有活跃 snapshot 并切换。
// 单一 active link per version：用生成列 versionIdActive 在 revoked_at IS NULL 时取 version_id
export const shareLinks = mysqlTable(
  "share_links",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    versionId: varchar("version_id", { length: 36 })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    // NULL = 无密码分享（点开直接看）；非 NULL = bcrypt hash。密码为可选项，默认无。
    passwordHash: varchar("password_hash", { length: 255 }),
    passwordVersion: int("password_version").notNull().default(1),
    createdBy: varchar("created_by", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    revokedAt: datetimeFsp("revoked_at"),
    versionIdActive: varchar("version_id_active", { length: 36 }).generatedAlwaysAs(
      sql`(CASE WHEN \`revoked_at\` IS NULL THEN \`version_id\` END)`,
    ),
  },
  (t) => [uniqueIndex("share_links_version_active_unique").on(t.versionIdActive)],
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

// ---- repo_state（仓库项目状态，一仓库一行）----
// 仓库项目 = projects.kind='repo'；其快照、文件、分享链接挂在 version_id 指向的系统方案下。
export const repoState = mysqlTable("repo_state", {
  projectId: varchar("project_id", { length: 36 })
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  versionId: varchar("version_id", { length: 36 })
    .notNull()
    .unique()
    .references(() => versions.id, { onDelete: "cascade" }),
  format: varchar("format", { length: 32 }),
  onlineKey: varchar("online_key", { length: 128 }),
  onlinePeriods: json("online_periods"),
  // 项目简介：G-canvas 推送时带上（sync.project.summary），访客页与主站项目页显示
  summary: text("summary"),
  lastPushedAt: datetimeFsp("last_pushed_at"),
  lastPushedBy: varchar("last_pushed_by", { length: 36 }).references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
  // ---- 团队协作（未开启时全为空）----
  // 团队方案：不可分享的方案，团队快照挂在它下面；非空 = 项目已开启团队协作
  teamVersionId: varchar("team_version_id", { length: 36 })
    .unique()
    .references(() => versions.id, { onDelete: "set null" }),
  teamSince: datetimeFsp("team_since"),
  // 上传完成时间；为空时不能加人、成员看不到
  teamReadyAt: datetimeFsp("team_ready_at"),
  // 版本记录、上线标记、访客草稿每改一次加一
  stateRev: int("state_rev").notNull().default(0),
  idLedger: json("id_ledger"),
  startTeamSnapshotId: varchar("start_team_snapshot_id", { length: 36 }).references(() => snapshots.id, {
    onDelete: "set null",
  }),
});

export type RepoState = typeof repoState.$inferSelect;
export type NewRepoState = typeof repoState.$inferInsert;

// ---- repo_versions（版本图元数据，可变；内容在 snapshot_id 指向的不可变快照里）----
// key = 本机稳定身份（封版提交号；草稿由服务端按内容派生），版本号 number 只用于显示与 ?v=。
// 撤回 = withdrawn_at 非空（软删，访客不可见，可恢复）。
export const repoVersions = mysqlTable(
  "repo_versions",
  {
    id: uuidPk(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 128 }).notNull(),
    snapshotId: varchar("snapshot_id", { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", ["version", "baseline", "draft", "hidden"]).notNull(),
    number: varchar("number", { length: 64 }),
    name: varchar("name", { length: 255 }),
    summary: text("summary"),
    line: varchar("line", { length: 64 }),
    parentKey: varchar("parent_key", { length: 128 }),
    patchOf: varchar("patch_of", { length: 128 }),
    sealedAt: datetimeFsp("sealed_at"),
    changes: json("changes"),
    specDocs: json("spec_docs"),
    // 机器清单（prdlab-change/1）：随新版本推来，校验通过才存；已存的不再改写
    manifest: json("manifest"),
    // 团队版本：团队方案下的快照、提交原文（base64）、完整版本记录（不含本机专属字段）；访客读取不读这三列
    teamSnapshotId: varchar("team_snapshot_id", { length: 36 }).references(() => snapshots.id, {
      onDelete: "set null",
    }),
    commitRawB64: mediumtext("commit_raw_b64"),
    teamRecord: json("team_record"),
    withdrawnAt: datetimeFsp("withdrawn_at"),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    updatedAt: datetimeFsp("updated_at").notNull().default(nowDefault()),
  },
  (t) => [
    unique("repo_versions_project_key_unique").on(t.projectId, t.key),
    index("repo_versions_snapshot_idx").on(t.snapshotId),
  ],
);

export type RepoVersion = typeof repoVersions.$inferSelect;
export type NewRepoVersion = typeof repoVersions.$inferInsert;

// ---- repo_blobs（项目内已上传文件登记；先写 MinIO 再登记，登记即对象存在）----
export const repoBlobs = mysqlTable(
  "repo_blobs",
  {
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sha256: char("sha256", { length: 64 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    // 写入时算好的 git 对象号；核对团队文件表用它，不从对象存储重读
    gitOid: char("git_oid", { length: 40 }),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.sha256] })],
);

export type RepoBlob = typeof repoBlobs.$inferSelect;
export type NewRepoBlob = typeof repoBlobs.$inferInsert;

// ---- 多人协作（迁移 0006）----

// project_members：团队成员。负责人恰好一位，同时是 projects.owner_id。
// 移除只写 removed_at，行留着，供历史显示名字与「（已移除）」。
export const projectMembers = mysqlTable(
  "project_members",
  {
    id: uuidPk(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: mysqlEnum("role", ["lead", "admin", "member"]).notNull(),
    addedBy: varchar("added_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    addedAt: datetimeFsp("added_at").notNull().default(nowDefault()),
    removedAt: datetimeFsp("removed_at"),
    removedBy: varchar("removed_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    // 生成列：未移除时等于 user_id，否则 NULL；配合唯一索引 = 「同一项目同一用户只有一行未移除」
    userIdActive: varchar("user_id_active", { length: 36 }).generatedAlwaysAs(
      sql`(CASE WHEN \`removed_at\` IS NULL THEN \`user_id\` END)`,
    ),
  },
  (t) => [
    uniqueIndex("project_members_project_user_active_unique").on(t.projectId, t.userIdActive),
    index("project_members_user_idx").on(t.userId),
  ],
);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;

// team_lines：团队主线（一期只有 main），每次推进 rev + 1
export const teamLines = mysqlTable(
  "team_lines",
  {
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    line: varchar("line", { length: 64 }).notNull(),
    rev: int("rev").notNull(),
    headSnapshotId: varchar("head_snapshot_id", { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: "restrict" }),
    baseVersionKey: varchar("base_version_key", { length: 128 }),
    updatedBy: varchar("updated_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    updatedAt: datetimeFsp("updated_at").notNull().default(nowDefault()),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.line] })],
);

export type TeamLine = typeof teamLines.$inferSelect;
export type NewTeamLine = typeof teamLines.$inferInsert;

// team_line_history：每个 rev 的样子都留着（拉取读我的基准那一份，合入基于旧 rev 的请求读请求基于的那一份）
export const teamLineHistory = mysqlTable(
  "team_line_history",
  {
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    line: varchar("line", { length: 64 }).notNull(),
    rev: int("rev").notNull(),
    snapshotId: varchar("snapshot_id", { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: "restrict" }),
    reason: mysqlEnum("reason", ["init", "merge", "seal"]).notNull(),
    mrId: varchar("mr_id", { length: 36 }),
    byUserId: varchar("by_user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    at: datetimeFsp("at").notNull().default(nowDefault()),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.line, t.rev] })],
);

export type TeamLineHistory = typeof teamLineHistory.$inferSelect;
export type NewTeamLineHistory = typeof teamLineHistory.$inferInsert;

// merge_requests：合并请求
export const mergeRequests = mysqlTable(
  "merge_requests",
  {
    id: uuidPk(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    seq: int("seq").notNull(),
    line: varchar("line", { length: 64 }).notNull(),
    authorId: varchar("author_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 255 }).notNull(),
    note: text("note"),
    items: json("items"),
    snapshotId: varchar("snapshot_id", { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: "restrict" }),
    baseRev: int("base_rev").notNull(),
    status: mysqlEnum("status", ["open", "merged", "returned", "withdrawn"]).notNull().default("open"),
    withdrawReason: mysqlEnum("withdraw_reason", ["author", "member_removed"]),
    returnNote: text("return_note"),
    decidedBy: varchar("decided_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    decidedAt: datetimeFsp("decided_at"),
    mergedRev: int("merged_rev"),
    createdAt: datetimeFsp("created_at").notNull().default(nowDefault()),
    // 合入时的改号对照表；没有改号为空
    renumberMap: json("renumber_map"),
  },
  (t) => [
    unique("merge_requests_project_seq_unique").on(t.projectId, t.seq),
    index("merge_requests_project_status_idx").on(t.projectId, t.status),
  ],
);

export type MergeRequest = typeof mergeRequests.$inferSelect;
export type NewMergeRequest = typeof mergeRequests.$inferInsert;

// team_sealing：「正在封版」提示；seen_at 超过 30 分钟视为没有
export const teamSealing = mysqlTable(
  "team_sealing",
  {
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    line: varchar("line", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: varchar("device_id", { length: 64 }).notNull(),
    since: datetimeFsp("since").notNull().default(nowDefault()),
    seenAt: datetimeFsp("seen_at").notNull().default(nowDefault()),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.line, t.userId, t.deviceId] })],
);

export type TeamSealing = typeof teamSealing.$inferSelect;
export type NewTeamSealing = typeof teamSealing.$inferInsert;

// team_discussions：讨论通道，每位作者最新一份（快照在团队方案下）
export const teamDiscussions = mysqlTable(
  "team_discussions",
  {
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: varchar("author_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshotId: varchar("snapshot_id", { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: "restrict" }),
    pushedAt: datetimeFsp("pushed_at").notNull().default(nowDefault()),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.authorId] })],
);

export type TeamDiscussion = typeof teamDiscussions.$inferSelect;
export type NewTeamDiscussion = typeof teamDiscussions.$inferInsert;

// team_progress：成员各设备的进度摘要（项名最多 50 个与总数），不存内容
export const teamProgress = mysqlTable(
  "team_progress",
  {
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: varchar("device_id", { length: 64 }).notNull(),
    line: varchar("line", { length: 64 }).notNull(),
    baseRev: int("base_rev").notNull(),
    summary: json("summary"),
    pushedAt: datetimeFsp("pushed_at").notNull().default(nowDefault()),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId, t.deviceId, t.line] })],
);

export type TeamProgress = typeof teamProgress.$inferSelect;
export type NewTeamProgress = typeof teamProgress.$inferInsert;

// team_events：操作留痕（开启、成员与角色、请求提交 / 撤回 / 合入 / 退回、封版、上线标记、访客草稿）
export const teamEvents = mysqlTable(
  "team_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: varchar("project_id", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: varchar("actor_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    type: varchar("type", { length: 64 }).notNull(),
    payload: json("payload"),
    at: datetimeFsp("at").notNull().default(nowDefault()),
  },
  (t) => [index("team_events_project_idx").on(t.projectId, t.id)],
);

export type TeamEvent = typeof teamEvents.$inferSelect;
export type NewTeamEvent = typeof teamEvents.$inferInsert;

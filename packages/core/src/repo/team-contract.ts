/**
 * G-canvas 与 PRD-Lab 之间「团队协作」接口的线上契约：每个接口的路径与方法、请求与响应的 JSON 形状、
 * 错误码与 HTTP 状态、团队格式版本请求头。
 *
 * 规则写在 html_canvas 仓库的 `ai/goals/多人协作（PRD-Lab-GitHub-式）/contract.md`，样例在同目录 `contract/*.json`，
 * 本目录 `team-contract-samples/` 是那组样例的副本（契约测试读副本，并核对副本与原件一致）；
 * G-canvas 的 `viewer/src/shared/team-contract.ts` 是同一份契约的另一份写法。改契约要两边同时改，并同步改样例。
 *
 * 形状用下面的小型描述器写一次：TypeScript 类型由描述器推出（`Infer`），运行时用 `checkShape` 拿同一个描述器核对 JSON，
 * 路由校验请求体也用它。对象形状（`t.obj`）不认识的字段算错；只有标了 `t.open` 的对象放过多出的字段
 * （内容由 G-canvas 定、PRD-Lab 原样存取的那几块）。
 */

// ---------------------------------------------------------------------------
// 描述器
// ---------------------------------------------------------------------------

export interface Shape<T> {
  /** 只给类型推导用，运行时不存在 */
  readonly _type?: T;
  /** 不符时往 problems 里追加「位置: 原因」 */
  check(value: unknown, at: string, problems: string[]): void;
}

/** 对象里可以不出现的字段；出现了就必须符合 `shape` */
export interface OptionalField<T> {
  readonly optional: true;
  readonly shape: Shape<T>;
}

type Field = Shape<unknown> | OptionalField<unknown>;
type Fields = Record<string, Field>;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type Infer<S> = S extends Shape<infer T> ? T : never;

type ObjectOf<F extends Fields> = Simplify<
  {
    [K in keyof F as F[K] extends OptionalField<unknown> ? never : K]: F[K] extends Shape<infer T>
      ? T
      : never;
  } & {
    [K in keyof F as F[K] extends OptionalField<unknown> ? K : never]?: F[K] extends OptionalField<infer T>
      ? T
      : never;
  }
>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function preview(v: unknown): string {
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function isJsonValue(v: unknown): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (isPlainObject(v)) return Object.values(v).every(isJsonValue);
  return false;
}

function checkFields(fields: Fields, v: Record<string, unknown>, at: string, problems: string[]): void {
  for (const [name, field] of Object.entries(fields)) {
    const here = `${at}.${name}`;
    if ("optional" in field) {
      if (name in v) field.shape.check(v[name], here, problems);
    } else if (!(name in v)) {
      problems.push(`${here}: 缺少`);
    } else {
      field.check(v[name], here, problems);
    }
  }
}

export const t = {
  str(opts: { min?: number; max?: number; re?: RegExp } = {}): Shape<string> {
    return {
      check(v, at, problems) {
        if (typeof v !== "string") return void problems.push(`${at}: 应为字符串，实为 ${preview(v)}`);
        if (opts.min !== undefined && v.length < opts.min) problems.push(`${at}: 至少 ${opts.min} 个字符`);
        if (opts.max !== undefined && v.length > opts.max) problems.push(`${at}: 最多 ${opts.max} 个字符`);
        if (opts.re && !opts.re.test(v)) problems.push(`${at}: ${preview(v)} 不符合 ${opts.re}`);
      },
    };
  },
  int(opts: { min?: number; max?: number } = {}): Shape<number> {
    return {
      check(v, at, problems) {
        if (typeof v !== "number" || !Number.isSafeInteger(v))
          return void problems.push(`${at}: 应为整数，实为 ${preview(v)}`);
        if (opts.min !== undefined && v < opts.min) problems.push(`${at}: 不能小于 ${opts.min}`);
        if (opts.max !== undefined && v > opts.max) problems.push(`${at}: 不能大于 ${opts.max}`);
      },
    };
  },
  bool(): Shape<boolean> {
    return {
      check: (v, at, problems) => void (typeof v !== "boolean" && problems.push(`${at}: 应为 true / false`)),
    };
  },
  lit<const L extends string | number | boolean | null>(value: L): Shape<L> {
    return {
      check: (v, at, problems) =>
        void (v !== value && problems.push(`${at}: 应为 ${preview(value)}，实为 ${preview(v)}`)),
    };
  },
  oneOf<const L extends readonly string[]>(values: L): Shape<L[number]> {
    return {
      check: (v, at, problems) =>
        void (
          (typeof v !== "string" || !values.includes(v)) &&
          problems.push(`${at}: 应为 ${values.join(" | ")} 之一，实为 ${preview(v)}`)
        ),
    };
  },
  nullable<T>(shape: Shape<T>): Shape<T | null> {
    return { check: (v, at, problems) => void (v !== null && shape.check(v, at, problems)) };
  },
  /** 依次试每个形状，有一个符合就算符合 */
  anyOf<const S extends readonly Shape<unknown>[]>(...shapes: S): Shape<Infer<S[number]>> {
    return {
      check(v, at, problems) {
        const tries = shapes.map((s) => {
          const p: string[] = [];
          s.check(v, at, p);
          return p;
        });
        if (tries.some((p) => p.length === 0)) return;
        problems.push(`${at}: 不符合任何一种写法（${tries.map((p) => p[0]).join("；")}）`);
      },
    };
  },
  list<T>(item: Shape<T>, opts: { min?: number; max?: number } = {}): Shape<T[]> {
    return {
      check(v, at, problems) {
        if (!Array.isArray(v)) return void problems.push(`${at}: 应为数组，实为 ${preview(v)}`);
        if (opts.min !== undefined && v.length < opts.min) problems.push(`${at}: 至少 ${opts.min} 项`);
        if (opts.max !== undefined && v.length > opts.max) problems.push(`${at}: 最多 ${opts.max} 项`);
        v.forEach((x, i) => item.check(x, `${at}[${i}]`, problems));
      },
    };
  },
  /** 以字符串为键的表；键与值各自核对 */
  dict<T>(key: Shape<string>, value: Shape<T>, opts: { max?: number } = {}): Shape<Record<string, T>> {
    return {
      check(v, at, problems) {
        if (!isPlainObject(v)) return void problems.push(`${at}: 应为对象，实为 ${preview(v)}`);
        const entries = Object.entries(v);
        if (opts.max !== undefined && entries.length > opts.max) problems.push(`${at}: 最多 ${opts.max} 项`);
        for (const [k, x] of entries) {
          key.check(k, `${at} 的键`, problems);
          value.check(x, `${at}[${JSON.stringify(k)}]`, problems);
        }
      },
    };
  },
  /** 字段固定的对象：缺必填字段、多出不认识的字段都算错 */
  obj<const F extends Fields>(fields: F): Shape<ObjectOf<F>> {
    return {
      check(v, at, problems) {
        if (!isPlainObject(v)) return void problems.push(`${at}: 应为对象，实为 ${preview(v)}`);
        checkFields(fields, v, at, problems);
        for (const name of Object.keys(v))
          if (!(name in fields)) problems.push(`${at}.${name}: 契约里没有这个字段`);
      },
    };
  },
  /** 只核对列出的字段、其余字段原样放过的对象（内容由 G-canvas 定、PRD-Lab 原样存取） */
  open<const F extends Fields>(fields: F): Shape<ObjectOf<F> & Record<string, unknown>> {
    return {
      check(v, at, problems) {
        if (!isPlainObject(v)) return void problems.push(`${at}: 应为对象，实为 ${preview(v)}`);
        checkFields(fields, v, at, problems);
        if (!isJsonValue(v)) problems.push(`${at}: 含有 JSON 表示不了的值`);
      },
    };
  },
  opt<T>(shape: Shape<T>): OptionalField<T> {
    return { optional: true, shape };
  },
  /** 任意 JSON 值（原样存取的块） */
  json(): Shape<unknown> {
    return { check: (v, at, problems) => void (!isJsonValue(v) && problems.push(`${at}: 不是 JSON 值`)) };
  },
};

/** 按形状核对一个值；返回全部不符之处，空数组 = 符合 */
export function checkShape(shape: Shape<unknown>, value: unknown, at = "$"): string[] {
  const problems: string[] = [];
  shape.check(value, at, problems);
  return problems;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 本代码写出的团队数据格式版本，随每个团队请求放在 `X-Gcanvas-Team-Format`；只在团队数据或画板格式有不兼容变化时加一 */
export const TEAM_FORMAT = 1;
export const TEAM_FORMAT_HEADER = "X-Gcanvas-Team-Format";

export const TEAM_LIMITS = {
  /** 一份文件表最多多少个文件（同 PRD-Lab `REPO_LIMITS.maxFilesPerVersion`） */
  maxFilesPerTable: 2000,
  /** 接口 17 一批最多几个版本 */
  initBatchMaxVersions: 10,
  /** 接口 17 一次 `done` 最多声明几个版本 */
  initMaxVersions: 5000,
  /** `blobs/missing` 一次最多问多少个指纹 */
  blobsMissingBatch: 1000,
  /** 合并请求标题、说明、退回原因的长度（字符） */
  mrTitleMax: 200,
  mrNoteMax: 2000,
  returnNoteMax: 200,
  /** 一份合并请求最多几项 */
  mrMaxItems: 2000,
  /** 列表分页：默认与上限 */
  pageDefault: 50,
  pageMax: 100,
  /** 进度摘要最多带几个项名 */
  progressMaxItems: 50,
  /** 编号账一次最多为一个前缀或对象领几个号 */
  ledgerMaxWant: 1000,
  /** 刷新响应里「我的请求」最多几份 */
  myMrsMax: 20,
} as const;

// ---------------------------------------------------------------------------
// 基本形状
// ---------------------------------------------------------------------------

const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const Sha256 = t.str({ re: /^[0-9a-f]{64}$/ });
/** git 对象号；团队里的版本 key 就是封版提交号，也是这个形状 */
export const GitOid = t.str({ re: /^[0-9a-f]{40}$/ });
export const VersionKey = GitOid;
/** 线：主线 `main`，补丁线 `patch:<被修版本 key>`（放进路径时整段 encodeURIComponent） */
export const LineId = t.str({ re: /^(main|patch:[0-9a-f]{40})$/ });
/** 有团队主线的线：一期只有主线 */
export const TeamLine = t.lit("main");
export const IsoTime = t.str({ re: ISO_TIME_RE });
/** PRD-Lab 的行号（项目、用户、快照、请求等） */
export const RowId = t.str({ min: 1, max: 64 });
/** 操作号：客户端为每次用户操作生成一个（如 UUID），重试沿用同一个 */
export const OpId = t.str({ re: TOKEN_RE });
/** 设备号：每台电脑的每个渠道（正式版、测试版）一个 */
export const DeviceId = t.str({ re: TOKEN_RE });
export const RepoPath = t.str({ min: 1, max: 700 });
export const GitMode = t.oneOf(["100644", "100755"]);
/** 团队主线的递增号：开启完成时为 1，每次合入或封版加一 */
export const Rev = t.int({ min: 1 });
/** 版本记录、上线标记、访客草稿每改一次加一；开启完成时为 0 */
export const StateRev = t.int({ min: 0 });
export const Count = t.int({ min: 0 });
export const PosInt = t.int({ min: 1 });
export const ElementPrefix = t.str({ re: /^[a-z]$/ });
export const ElementId = t.str({ re: /^[a-z][0-9]+$/ });
export const ObjectId = t.str({ re: /^o-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/ });
export const Role = t.oneOf(["lead", "admin", "member"]);
/** 网页上能给成员选的角色（负责人只有一位，不能转交） */
export const AssignableRole = t.oneOf(["admin", "member"]);
/** 提交原文：`git cat-file commit <key>` 的原始字节，base64 */
export const CommitRaw = t.str({ min: 4, max: 1_000_000, re: BASE64_RE });
/** 改动项类别（同 G-canvas `ChangeKind`） */
export const ItemKind = t.oneOf(["page", "frame", "loose", "discussion", "doc", "style", "asset", "other"]);

export const UserRef = t.obj({
  id: RowId,
  name: t.str({ min: 1, max: 128 }),
  /** 已被移除出这个团队 */
  removed: t.bool(),
});

// ---------------------------------------------------------------------------
// 文件表
// ---------------------------------------------------------------------------

/** 团队文件表里的一个文件：指纹、字节数、git 文件模式与对象号 */
export const TeamFileEntry = t.obj({ sha256: Sha256, size: Count, gitMode: GitMode, gitOid: GitOid });
/** 团队文件表（请求里用）：路径 → 文件；版本、团队主线、合并请求都用它 */
export const TeamFiles = t.dict(RepoPath, TeamFileEntry, { max: TEAM_LIMITS.maxFilesPerTable });
/** 访客文件表、讨论文件表（请求里用）：同现有 `sync` 的 `files` */
export const PlainFiles = t.dict(RepoPath, t.obj({ sha256: Sha256, size: Count }), {
  max: TEAM_LIMITS.maxFilesPerTable,
});
/** 接口 5 响应里的一个文件；内置方案（访客）快照的 `gitMode` `gitOid` 为 null */
export const TeamListedFile = t.obj({
  path: RepoPath,
  sha256: Sha256,
  size: Count,
  gitMode: t.nullable(GitMode),
  gitOid: t.nullable(GitOid),
});

// ---------------------------------------------------------------------------
// 编号账
// ---------------------------------------------------------------------------

/** 编号账（形状同 `meta.json` 的 `ids`）：每项的值 = 已发出去的最大号；并入一律取较大值 */
export const IdLedger = t.obj({ elements: t.dict(ElementPrefix, PosInt), states: t.dict(ObjectId, PosInt) });
/** 要领几个号（`want` 形状同 G-canvas `IdRequest`） */
const WantCount = t.int({ min: 1, max: TEAM_LIMITS.ledgerMaxWant });

// ---------------------------------------------------------------------------
// 版本
// ---------------------------------------------------------------------------

const ChangesBlock = t.open({ format: t.lit("gcanvas-changes/1") });

/** 完整版本记录：G-canvas `VersionRecord` 去掉本机字段 `local` */
export const TeamVersionRecord = t.obj({
  key: VersionKey,
  number: t.str({ min: 1, max: 64 }),
  name: t.str({ max: 255 }),
  summary: t.str({ max: 20000 }),
  line: LineId,
  parentKey: t.nullable(VersionKey),
  patchOf: t.nullable(VersionKey),
  kind: t.oneOf(["normal", "baseline"]),
  sealedAt: IsoTime,
  compareTo: t.nullable(t.anyOf(t.obj({ key: VersionKey }), t.obj({ start: t.lit(true) }))),
  changes: ChangesBlock,
  specDocs: t.list(RepoPath),
  discussionDocs: t.list(RepoPath),
  withdrawnAt: t.opt(IsoTime),
  sealedBy: t.opt(t.lit("ai")),
  truth: t.opt(t.open({ state: t.oneOf(["updated", "skipped"]) })),
});

/** 团队状态里的一个版本：完整记录 + 提交原文（下载方据此重建出同一个提交号） */
export const TeamVersion = t.obj({
  key: VersionKey,
  record: TeamVersionRecord,
  commitRaw: CommitRaw,
  /** 这一版的团队文件表（接口 5 读） */
  teamSnapshotId: RowId,
  /** 谁封的；开启团队协作时随历史上传的版本为 null */
  sealer: t.nullable(UserRef),
  pushedAt: IsoTime,
});

/** 封版时随新版本发的访客部分：访客文件表、去掉讨论的改动摘要、机器清单 */
export const GuestVersion = t.obj({
  files: PlainFiles,
  changes: t.nullable(ChangesBlock),
  /** 机器清单（`prdlab-change/1`），原样存；校验不符时服务端只丢清单 */
  manifest: t.opt(t.json()),
});

export const OnlinePeriod = t.obj({ key: VersionKey, from: IsoTime, to: t.nullable(IsoTime) });
export const Online = t.obj({ key: t.nullable(VersionKey), periods: t.list(OnlinePeriod) });

/** 访客草稿：来自团队主线的哪个 rev */
export const GuestDraft = t.obj({
  key: t.str({ re: /^draft-[0-9a-f]{40}$/ }),
  line: TeamLine,
  rev: Rev,
  basedOn: t.nullable(VersionKey),
  contentDigest: Sha256,
  pushedAt: IsoTime,
});

/** 版本记录、上线标记、访客草稿：`stateRev` 一变就整份重发 */
export const TeamRecords = t.obj({
  versions: t.list(TeamVersion),
  online: Online,
  guestDraft: t.nullable(GuestDraft),
});

/** 「开始前的样子」：主线第一版的父提交 */
export const TeamStart = t.obj({ key: VersionKey, commitRaw: CommitRaw, snapshotId: RowId });

// ---------------------------------------------------------------------------
// 团队主线、成员、请求
// ---------------------------------------------------------------------------

export const TeamLineHead = t.obj({
  line: TeamLine,
  rev: Rev,
  headSnapshotId: RowId,
  /** 这条线最新的版本 key；还没有版本为 null */
  baseVersionKey: t.nullable(VersionKey),
  updatedAt: IsoTime,
  updatedBy: UserRef,
});

export const LineHistoryEntry = t.obj({
  line: TeamLine,
  rev: Rev,
  reason: t.oneOf(["init", "merge", "seal"]),
  snapshotId: RowId,
  /** reason = merge 时是合入的请求 */
  mrId: t.nullable(RowId),
  /** reason = seal 时是封出的版本 */
  versionKey: t.nullable(VersionKey),
  by: UserRef,
  at: IsoTime,
});

export const Member = t.obj({ user: UserRef, role: Role, addedAt: IsoTime, removedAt: t.nullable(IsoTime) });

export const SealingEntry = t.obj({
  line: LineId,
  user: UserRef,
  deviceId: DeviceId,
  since: IsoTime,
  seenAt: IsoTime,
});

export const ProgressChanged = t.obj({
  /** 「我的基准 → 我的工作区」清单的项名 */
  items: t.list(t.str({ max: 255 }), { max: TEAM_LIMITS.progressMaxItems }),
  total: Count,
});
export const Progress = t.obj({
  user: UserRef,
  deviceId: DeviceId,
  line: LineId,
  /** 补丁线没有团队主线，为 null */
  baseRev: t.nullable(Rev),
  changed: ProgressChanged,
  pushedAt: IsoTime,
});

export const DiscussionAuthor = t.obj({
  author: UserRef,
  snapshotId: RowId,
  contentDigest: Sha256,
  pushedAt: IsoTime,
});

export const MrItem = t.obj({
  /** 项编号，如 `page:b12`、`doc:docs/specs/R-1.md#2` */
  itemId: t.str({ min: 1, max: 512 }),
  label: t.str({ max: 255 }),
  kind: ItemKind,
  elementIds: t.list(ElementId, { max: TEAM_LIMITS.maxFilesPerTable }),
});

/**
 * 合入方改名对照表（元素号在提交时已领过、团队里唯一，合入时只改块文件 / 便签文件名与状态号）：
 * 元素号 → 自有文件的原路径与新路径、状态号的原值与新值。套的时候元素现在的值等于原值才改。
 */
export const MergeRenames = t.obj({
  files: t.dict(ElementId, t.obj({ from: RepoPath, to: RepoPath })),
  states: t.dict(ElementId, t.obj({ from: PosInt, to: PosInt })),
});

export const MrStatus = t.oneOf(["open", "merged", "returned", "withdrawn"]);

const mrSummaryFields = {
  id: RowId,
  /** 项目内顺序号，界面写 `#n` */
  seq: PosInt,
  line: TeamLine,
  author: UserRef,
  title: t.str({ min: 1, max: TEAM_LIMITS.mrTitleMax }),
  itemCount: Count,
  status: MrStatus,
  withdrawReason: t.nullable(t.oneOf(["author", "member_removed"])),
  baseRev: Rev,
  mergedRev: t.nullable(Rev),
  createdAt: IsoTime,
  decidedAt: t.nullable(IsoTime),
  decidedBy: t.nullable(UserRef),
  returnNote: t.nullable(t.str({ max: TEAM_LIMITS.returnNoteMax })),
} as const;

export const MrSummary = t.obj(mrSummaryFields);

export const MergedMrRenumber = t.obj({
  id: RowId,
  seq: PosInt,
  mergedRev: Rev,
  renumberMap: t.nullable(MergeRenames),
});

export const MrDetail = t.obj({
  ...mrSummaryFields,
  note: t.str({ max: TEAM_LIMITS.mrNoteMax }),
  items: t.list(MrItem, { max: TEAM_LIMITS.mrMaxItems }),
  /** 请求的完整样子（接口 5 读） */
  snapshotId: RowId,
  renumberMap: t.nullable(MergeRenames),
  /** 同一作者从同一台电脑交的、在这份请求基于的 rev 之后已合入的请求（按合入先后）；这份请求没有设备号（早先交的）时为空 */
  priorSameAuthor: t.list(MergedMrRenumber),
});

/** 刷新时「我交过、在我的基准之后已合入」的请求 */
export const MyMergedMr = t.obj({
  id: RowId,
  seq: PosInt,
  baseRev: Rev,
  mergedRev: Rev,
  snapshotId: RowId,
  renumberMap: t.nullable(MergeRenames),
});

/** 接口 4 的响应：一次刷新拿到的团队状态 */
export const TeamState = t.obj({
  project: t.obj({ id: RowId, name: t.str({ min: 1, max: 128 }) }),
  me: t.obj({ user: UserRef, role: Role }),
  teamSince: IsoTime,
  teamReadyAt: IsoTime,
  /** 这个团队写入过的最高团队格式版本；本机 `TEAM_FORMAT` 低于它时停下拉取、提交、合入、封版 */
  minClientFormat: PosInt,
  stateRev: StateRev,
  lines: t.list(TeamLineHead, { min: 1 }),
  /** 请求里 `progress.line` 那条线、`progress.baseRev` 之后的每个 rev（升序）；基准为 null 时为空 */
  history: t.list(LineHistoryEntry),
  /** 请求里的 `appliedStateRev` 等于 `stateRev` 时为 null（没变，不重发） */
  records: t.nullable(TeamRecords),
  start: t.nullable(TeamStart),
  ids: IdLedger,
  sealing: t.list(SealingEntry),
  openMrs: t.list(MrSummary),
  myMrs: t.list(MrSummary, { max: TEAM_LIMITS.myMrsMax }),
  myMergedSinceBase: t.list(MyMergedMr),
  /** 含已移除的人（历史里要显示名字） */
  members: t.list(Member),
  /** 每位未移除成员最近推送的一份（取最近刷新的那台设备） */
  progress: t.list(Progress),
  discussions: t.list(DiscussionAuthor),
});

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** 错误码 → HTTP 状态（一码一状态） */
export const TEAM_ERROR_STATUS = {
  validation_error: 400,
  discussions_not_allowed: 400,
  unauthorized: 401,
  not_owner: 403,
  not_member: 403,
  forbidden_role: 403,
  not_author: 403,
  not_found: 404,
  user_not_found: 404,
  not_repo: 409,
  blobs_missing: 409,
  team_managed: 409,
  team_not_ready: 409,
  team_already_open: 409,
  already_member: 409,
  lead_fixed: 409,
  init_incomplete: 409,
  head_moved: 409,
  version_parent_moved: 409,
  state_changed: 409,
  number_duplicate: 409,
  mr_not_open: 409,
  client_too_old: 409,
  rate_limited: 429,
} as const;

export type TeamErrorCode = keyof typeof TEAM_ERROR_STATUS;
export const TEAM_ERROR_CODES = Object.keys(TEAM_ERROR_STATUS) as TeamErrorCode[];

/**
 * 每个错误码的 `details`：给了形状的必须带、且符合；`null` = 不带 `details`。
 * `validation_error` 的 `message` 是原因码（小写下划线，如 `commit_mismatch`），出错的位置与数值放 `details`（形状不固定）。
 */
export const TEAM_ERROR_DETAILS: Record<TeamErrorCode, Shape<unknown> | "any" | null> = {
  validation_error: "any",
  discussions_not_allowed: t.obj({ path: RepoPath }),
  unauthorized: null,
  not_owner: null,
  not_member: null,
  forbidden_role: t.obj({ required: Role, actual: Role }),
  not_author: null,
  not_found: null,
  user_not_found: t.obj({ name: t.str({ min: 1, max: 128 }) }),
  not_repo: null,
  blobs_missing: t.obj({ missing: t.list(Sha256, { min: 1 }) }),
  team_managed: null,
  team_not_ready: null,
  team_already_open: null,
  already_member: t.obj({ member: Member }),
  lead_fixed: null,
  init_incomplete: t.obj({
    missingVersions: t.list(VersionKey),
    extraVersions: t.list(VersionKey),
    /** 父版本（或开始前的样子）不在已收到的版本里 */
    danglingParents: t.list(VersionKey),
    missingHead: t.bool(),
    missingIds: t.bool(),
  }),
  head_moved: t.obj({ line: TeamLine, rev: Rev, headSnapshotId: RowId }),
  version_parent_moved: t.obj({
    line: LineId,
    latest: t.obj({
      key: VersionKey,
      number: t.str({ min: 1, max: 64 }),
      sealer: t.nullable(UserRef),
      sealedAt: IsoTime,
    }),
  }),
  state_changed: t.obj({ stateRev: StateRev, records: TeamRecords }),
  number_duplicate: t.obj({ number: t.str({ min: 1, max: 64 }), key: VersionKey }),
  mr_not_open: t.obj({ status: MrStatus }),
  client_too_old: t.obj({ minClientFormat: PosInt, clientFormat: Count }),
  rate_limited: t.obj({ retryAfterSeconds: PosInt }),
};

/** 错误体（同 PRD-Lab 现有 `errorResponse`） */
export const TeamErrorBody = t.obj({
  error_code: t.oneOf(TEAM_ERROR_CODES),
  message: t.str({ min: 1, max: 2000 }),
  details: t.opt(t.json()),
});

/** `validation_error` 的 `message`：原因码 */
export const VALIDATION_REASON_RE = /^[a-z][a-z0-9_]*$/;

// ---------------------------------------------------------------------------
// 请求体与响应体
// ---------------------------------------------------------------------------

const Ok = t.obj({ ok: t.lit(true) });
const IntText = (re: RegExp) => t.str({ re });

export const TeamProjectsResponse = t.obj({
  projects: t.list(
    t.obj({
      id: RowId,
      name: t.str({ min: 1, max: 128 }),
      lead: UserRef,
      role: Role,
      rev: Rev,
      teamReadyAt: IsoTime,
      /** 待审请求数（负责人、管理员的角标） */
      openMrCount: Count,
      /** 「我的请求有结果」由本机按基准 rev 现算 */
      mine: t.obj({
        lastSubmittedAt: t.nullable(IsoTime),
        recentDecided: t.list(
          t.obj({
            id: RowId,
            seq: PosInt,
            status: t.oneOf(["merged", "returned", "withdrawn"]),
            mergedRev: t.nullable(Rev),
            decidedAt: IsoTime,
          }),
          { max: 10 },
        ),
      }),
    }),
  ),
});

export const MembersResponse = t.obj({ members: t.list(Member) });
export const MemberAddRequest = t.obj({ name: t.str({ min: 1, max: 128 }), role: AssignableRole });
export const MemberResponse = t.obj({ member: Member });
export const MemberUpdateRequest = t.obj({ role: AssignableRole });
export const MemberRemoveResponse = t.obj({ member: Member, withdrawnMrIds: t.list(RowId) });

export const RefreshRequest = t.obj({
  /** 本机已应用的团队状态号；第一次（首次下载前）为 null */
  appliedStateRev: t.nullable(StateRev),
  ids: IdLedger,
  progress: t.obj({ deviceId: DeviceId, line: LineId, baseRev: t.nullable(Rev), changed: ProgressChanged }),
});
export const StateQuery = t.obj({
  line: t.opt(LineId),
  /** 取这个 rev 之后的历史；0 = 从 rev 1 起的全部历史 */
  baseRev: t.opt(IntText(/^(0|[1-9][0-9]*)$/)),
  appliedStateRev: t.opt(IntText(/^(0|[1-9][0-9]*)$/)),
});

export const SnapshotFilesResponse = t.obj({
  snapshotId: RowId,
  audience: t.oneOf(["guest", "team"]),
  /** 路径按 UTF-8 字节升序 */
  files: t.list(TeamListedFile, { max: TEAM_LIMITS.maxFilesPerTable }),
});

export const BlobsMissingRequest = t.obj({
  sha256: t.list(Sha256, { max: TEAM_LIMITS.blobsMissingBatch }),
  /** true：已存过、但还没有 git 对象号的也算缺（团队流程用，重传一次即补上对象号） */
  requireGitOid: t.opt(t.bool()),
});
export const BlobsMissingResponse = t.obj({ missing: t.list(Sha256) });
export const BlobPutResponse = t.obj({ sha256: Sha256, existed: t.bool(), sizeBytes: Count, gitOid: GitOid });

export const LedgerRequest = t.obj({
  ids: IdLedger,
  want: t.obj({
    elements: t.opt(t.dict(ElementPrefix, WantCount)),
    states: t.opt(t.dict(ObjectId, WantCount)),
  }),
});
export const LedgerResponse = t.obj({
  /** 并入并领号之后的团队编号账 */
  ids: IdLedger,
  /** 领到的号（形状同 G-canvas `IdGrant`）：前缀 → 完整元素编号、对象编号 → 状态号，各按从小到大 */
  granted: t.obj({
    elements: t.dict(ElementPrefix, t.list(ElementId, { min: 1, max: TEAM_LIMITS.ledgerMaxWant })),
    states: t.dict(ObjectId, t.list(PosInt, { min: 1, max: TEAM_LIMITS.ledgerMaxWant })),
  }),
});

export const MrSubmitRequest = t.obj({
  opId: OpId,
  line: TeamLine,
  baseRev: Rev,
  files: TeamFiles,
  items: t.list(MrItem, { min: 1, max: TEAM_LIMITS.mrMaxItems }),
  title: t.str({ min: 1, max: TEAM_LIMITS.mrTitleMax }),
  note: t.str({ max: TEAM_LIMITS.mrNoteMax }),
  /** 交请求的那台电脑（同 `team_progress` 的设备号）：合入时只把同一作者、同一台电脑交的请求当作前序 */
  deviceId: DeviceId,
});
export const MrResponse = t.obj({ mr: MrSummary });
export const MrListQuery = t.obj({
  state: t.opt(t.oneOf(["open", "all"])),
  after: t.opt(t.str({ min: 1, max: 128 })),
  limit: t.opt(IntText(/^([1-9][0-9]?|100)$/)),
});
export const MrListResponse = t.obj({
  /** 按 seq 从新到旧 */
  items: t.list(MrSummary, { max: TEAM_LIMITS.pageMax }),
  /** 下一页的 `after`；没有下一页为 null */
  next: t.nullable(t.str({ min: 1, max: 128 })),
});
export const MrDetailResponse = t.obj({ mr: MrDetail });
export const MrWithdrawRequest = t.obj({});
export const MrReturnRequest = t.obj({ note: t.str({ min: 1, max: TEAM_LIMITS.returnNoteMax }) });

export const AdvanceRequest = t.obj({
  opId: OpId,
  expectedRev: Rev,
  mrId: RowId,
  /** 合入后团队主线的完整样子 */
  files: TeamFiles,
  /** 合入方改名对照表；没有改名为 null */
  renumberMap: t.nullable(MergeRenames),
});
export const AdvanceResponse = t.obj({ line: TeamLineHead, mr: MrSummary });

export const SealingPutRequest = t.obj({ line: LineId, deviceId: DeviceId });
export const SealingPutResponse = t.obj({ sealing: SealingEntry });
export const SealingDeleteQuery = t.obj({ line: LineId, deviceId: DeviceId });

export const SealRequest = t.obj({
  opId: OpId,
  /** 主线：我的基准 rev；补丁线：null */
  expectedRev: t.nullable(Rev),
  appliedStateRev: StateRev,
  version: t.obj({
    key: VersionKey,
    commitRaw: CommitRaw,
    record: TeamVersionRecord,
    files: TeamFiles,
    guest: GuestVersion,
  }),
  /** 主线：封版写回后的团队主线；补丁线：null */
  head: t.nullable(t.obj({ files: TeamFiles })),
});
export const SealResponse = t.obj({
  version: TeamVersion,
  line: t.nullable(TeamLineHead),
  stateRev: StateRev,
});

export const OnlinePutRequest = t.obj({ appliedStateRev: StateRev, key: t.nullable(VersionKey) });
export const OnlinePutResponse = t.obj({ stateRev: StateRev, online: Online });

export const InitVersion = t.obj({
  key: VersionKey,
  commitRaw: CommitRaw,
  record: TeamVersionRecord,
  files: TeamFiles,
});
export const InitRequest = t.obj({
  /** 第一次调用不带：服务端取本项目进行中的那次开启，没有就新建 */
  initId: t.opt(RowId),
  batchSeq: Count,
  versions: t.list(InitVersion, { max: TEAM_LIMITS.initBatchMaxVersions }),
  start: t.opt(t.obj({ key: VersionKey, commitRaw: CommitRaw, files: TeamFiles })),
  /** 团队主线初值（开启那一刻的存档点，已剥掉个人讨论） */
  head: t.opt(t.obj({ files: TeamFiles, baseVersionKey: t.nullable(VersionKey) })),
  /** 团队编号账初值 */
  ids: t.opt(IdLedger),
});
export const InitResponse = t.obj({ initId: RowId, batchSeq: Count, received: t.list(VersionKey) });
export const InitStatusResponse = t.obj({
  initId: RowId,
  receivedVersionKeys: t.list(VersionKey),
  hasStart: t.bool(),
  hasHead: t.bool(),
  hasIds: t.bool(),
  ready: t.bool(),
});
export const InitDoneRequest = t.obj({
  initId: RowId,
  versionKeys: t.list(VersionKey, { max: TEAM_LIMITS.initMaxVersions }),
});
export const InitDoneResponse = t.obj({ teamReadyAt: IsoTime, line: TeamLineHead, stateRev: StateRev });

export const GuestDraftPutRequest = t.obj({
  appliedStateRev: StateRev,
  line: TeamLine,
  rev: Rev,
  files: PlainFiles,
});
export const GuestDraftPutResponse = t.obj({ stateRev: StateRev, guestDraft: GuestDraft });
export const GuestDraftDeleteQuery = t.obj({ appliedStateRev: IntText(/^(0|[1-9][0-9]*)$/) });
export const GuestDraftDeleteResponse = t.obj({ stateRev: StateRev });

export const DiscussionsPutRequest = t.obj({ files: PlainFiles });
export const DiscussionsPutResponse = t.obj({
  snapshotId: RowId,
  /** 文件表指纹与上一份相同：没有建新快照，`snapshotId` 是原来那份 */
  unchanged: t.bool(),
  accepted: t.list(RepoPath),
  rejected: t.list(
    t.obj({ path: RepoPath, reason: t.oneOf(["not_discussion_path"]) }),
  ),
});
export const DiscussionsListResponse = t.obj({ authors: t.list(DiscussionAuthor) });

// ---------------------------------------------------------------------------
// 接口表
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TeamEndpoint {
  /** 设计 §5.2 的接口号 */
  no: number;
  method: HttpMethod;
  /** `:名字` 是路径参数 */
  path: string;
  /** 请求必须带 `X-Gcanvas-Team-Format` */
  formatHeader: boolean;
  /** 客户端格式版本低于团队要求时回 `409 client_too_old` */
  formatGated: boolean;
  query?: Shape<unknown>;
  /** 请求体：JSON 形状、原始字节，或没有 */
  body: Shape<unknown> | "binary" | null;
  okStatus: 200 | 201;
  response: Shape<unknown> | "binary";
  /** 这个接口会回的错误码 */
  errors: readonly TeamErrorCode[];
  /**
   * 重试规则：`opId` = 同一操作号重试返回第一次的响应（含业务错误）；
   * `batch` = 同一 `(initId, batchSeq)` 的批次重发返回同样的结果；null = 不重放（重试前先读团队状态）
   */
  idempotency: "opId" | "batch" | null;
  /** 现有接口（团队项目里沿用）：`validation_error` 的 `message` 照现有写法，不要求是原因码 */
  existing?: true;
  /** 只在团队项目里定义错误行为的现有接口：样例只要求错误 */
  errorOnly?: true;
}

const COMMON: readonly TeamErrorCode[] = ["unauthorized", "not_found", "not_member", "validation_error"];
const READ = (...more: TeamErrorCode[]): readonly TeamErrorCode[] => [...COMMON, "team_not_ready", ...more];

function ep(
  e: Omit<TeamEndpoint, "formatHeader" | "formatGated" | "idempotency" | "okStatus"> &
    Partial<Pick<TeamEndpoint, "formatHeader" | "formatGated" | "idempotency" | "okStatus">>,
): TeamEndpoint {
  const formatGated = e.formatGated ?? false;
  return {
    formatHeader: true,
    idempotency: null,
    okStatus: 200,
    ...e,
    formatGated,
    errors: formatGated && !e.errors.includes("client_too_old") ? [...e.errors, "client_too_old"] : e.errors,
  };
}

const TEAM = "/api/v1/repos/:pid/team";

export const TEAM_ENDPOINTS = {
  "projects.list": ep({
    no: 1,
    method: "GET",
    path: "/api/v1/team/projects",
    body: null,
    response: TeamProjectsResponse,
    errors: ["unauthorized", "validation_error"],
  }),

  "members.list": ep({
    no: 2,
    method: "GET",
    path: `${TEAM}/members`,
    formatHeader: false,
    body: null,
    response: MembersResponse,
    errors: READ(),
  }),
  "members.add": ep({
    no: 2,
    method: "POST",
    path: `${TEAM}/members`,
    formatHeader: false,
    body: MemberAddRequest,
    okStatus: 201,
    response: MemberResponse,
    errors: [...COMMON, "forbidden_role", "team_not_ready", "user_not_found", "already_member"],
  }),
  "members.update": ep({
    no: 2,
    method: "PATCH",
    path: `${TEAM}/members/:uid`,
    formatHeader: false,
    body: MemberUpdateRequest,
    response: MemberResponse,
    errors: [...COMMON, "forbidden_role", "lead_fixed"],
  }),
  "members.remove": ep({
    no: 2,
    method: "DELETE",
    path: `${TEAM}/members/:uid`,
    formatHeader: false,
    body: null,
    response: MemberRemoveResponse,
    errors: [...COMMON, "forbidden_role", "lead_fixed"],
  }),

  "team.refresh": ep({
    no: 4,
    method: "POST",
    path: `${TEAM}/refresh`,
    body: RefreshRequest,
    response: TeamState,
    errors: READ(),
  }),
  "team.state": ep({
    no: 4,
    method: "GET",
    path: `${TEAM}/state`,
    query: StateQuery,
    body: null,
    response: TeamState,
    errors: READ(),
  }),

  "snapshots.files": ep({
    no: 5,
    method: "GET",
    path: `${TEAM}/snapshots/:sid/files`,
    formatGated: true,
    body: null,
    response: SnapshotFilesResponse,
    errors: READ(),
  }),
  "blobs.get": ep({
    no: 6,
    method: "GET",
    path: `${TEAM}/blobs/:sha256`,
    formatGated: true,
    body: null,
    response: "binary",
    errors: READ("rate_limited"),
  }),

  "blobs.missing": ep({
    no: 7,
    method: "POST",
    path: "/api/v1/repos/:pid/blobs/missing",
    formatHeader: false,
    existing: true,
    body: BlobsMissingRequest,
    response: BlobsMissingResponse,
    errors: ["unauthorized", "not_found", "not_owner", "not_repo", "validation_error"],
  }),
  "blobs.put": ep({
    no: 7,
    method: "PUT",
    path: "/api/v1/repos/:pid/blobs/:sha256",
    formatHeader: false,
    existing: true,
    body: "binary",
    response: BlobPutResponse,
    errors: ["unauthorized", "not_found", "not_owner", "not_repo", "validation_error"],
  }),

  "ledger.grant": ep({
    no: 9,
    method: "POST",
    path: `${TEAM}/ledger`,
    body: LedgerRequest,
    response: LedgerResponse,
    errors: READ(),
  }),

  "mrs.submit": ep({
    no: 10,
    method: "POST",
    path: `${TEAM}/mrs`,
    formatGated: true,
    idempotency: "opId",
    body: MrSubmitRequest,
    okStatus: 201,
    response: MrResponse,
    errors: READ("blobs_missing"),
  }),
  "mrs.list": ep({
    no: 10,
    method: "GET",
    path: `${TEAM}/mrs`,
    query: MrListQuery,
    body: null,
    response: MrListResponse,
    errors: READ(),
  }),
  "mrs.get": ep({
    no: 10,
    method: "GET",
    path: `${TEAM}/mrs/:id`,
    body: null,
    response: MrDetailResponse,
    errors: READ(),
  }),
  "mrs.withdraw": ep({
    no: 11,
    method: "POST",
    path: `${TEAM}/mrs/:id/withdraw`,
    body: MrWithdrawRequest,
    response: MrResponse,
    errors: READ("not_author", "mr_not_open"),
  }),
  "mrs.return": ep({
    no: 12,
    method: "POST",
    path: `${TEAM}/mrs/:id/return`,
    body: MrReturnRequest,
    response: MrResponse,
    errors: READ("forbidden_role", "mr_not_open"),
  }),

  "lines.advance": ep({
    no: 13,
    method: "POST",
    path: `${TEAM}/lines/:line/advance`,
    formatGated: true,
    idempotency: "opId",
    body: AdvanceRequest,
    response: AdvanceResponse,
    errors: READ("forbidden_role", "blobs_missing", "head_moved", "mr_not_open"),
  }),

  "sealing.put": ep({
    no: 14,
    method: "PUT",
    path: `${TEAM}/sealing`,
    body: SealingPutRequest,
    response: SealingPutResponse,
    errors: READ("forbidden_role"),
  }),
  "sealing.delete": ep({
    no: 14,
    method: "DELETE",
    path: `${TEAM}/sealing`,
    query: SealingDeleteQuery,
    body: null,
    response: Ok,
    errors: READ("forbidden_role"),
  }),

  "lines.seal": ep({
    no: 15,
    method: "POST",
    path: `${TEAM}/lines/:line/seal`,
    formatGated: true,
    idempotency: "opId",
    body: SealRequest,
    response: SealResponse,
    errors: READ(
      "forbidden_role",
      "blobs_missing",
      "head_moved",
      "version_parent_moved",
      "state_changed",
      "number_duplicate",
    ),
  }),

  "online.put": ep({
    no: 16,
    method: "PUT",
    path: `${TEAM}/online`,
    formatGated: true,
    body: OnlinePutRequest,
    response: OnlinePutResponse,
    errors: READ("forbidden_role", "state_changed"),
  }),

  "init.batch": ep({
    no: 17,
    method: "POST",
    path: `${TEAM}/init`,
    idempotency: "batch",
    body: InitRequest,
    response: InitResponse,
    errors: [
      "unauthorized",
      "not_found",
      "not_owner",
      "not_repo",
      "validation_error",
      "team_already_open",
      "blobs_missing",
      "rate_limited",
    ],
  }),
  "init.status": ep({
    no: 17,
    method: "GET",
    path: `${TEAM}/init/:initId`,
    body: null,
    response: InitStatusResponse,
    errors: ["unauthorized", "not_found", "not_owner"],
  }),
  "init.done": ep({
    no: 17,
    method: "POST",
    path: `${TEAM}/init/done`,
    body: InitDoneRequest,
    response: InitDoneResponse,
    errors: [
      "unauthorized",
      "not_found",
      "not_owner",
      "validation_error",
      "team_already_open",
      "init_incomplete",
    ],
  }),

  "sync.team": ep({
    no: 20,
    method: "POST",
    path: "/api/v1/repos/:pid/sync",
    formatHeader: false,
    body: t.json(),
    response: t.json(),
    errors: ["team_managed"],
    existing: true,
    errorOnly: true,
  }),

  "guestDraft.put": ep({
    no: 21,
    method: "PUT",
    path: `${TEAM}/guest-draft`,
    formatGated: true,
    body: GuestDraftPutRequest,
    response: GuestDraftPutResponse,
    errors: READ("forbidden_role", "blobs_missing", "state_changed", "discussions_not_allowed"),
  }),
  "guestDraft.delete": ep({
    no: 21,
    method: "DELETE",
    path: `${TEAM}/guest-draft`,
    query: GuestDraftDeleteQuery,
    body: null,
    response: GuestDraftDeleteResponse,
    errors: READ("forbidden_role", "state_changed"),
  }),

  "discussions.put": ep({
    no: 23,
    method: "PUT",
    path: `${TEAM}/discussions`,
    formatGated: true,
    body: DiscussionsPutRequest,
    response: DiscussionsPutResponse,
    errors: READ("blobs_missing"),
  }),
  "discussions.list": ep({
    no: 23,
    method: "GET",
    path: `${TEAM}/discussions`,
    body: null,
    response: DiscussionsListResponse,
    errors: READ(),
  }),
} satisfies Record<string, TeamEndpoint>;

export type TeamEndpointName = keyof typeof TEAM_ENDPOINTS;

// ---------------------------------------------------------------------------
// 推出的类型
// ---------------------------------------------------------------------------

export type TeamFileEntry = Infer<typeof TeamFileEntry>;
export type TeamFiles = Infer<typeof TeamFiles>;
export type PlainFiles = Infer<typeof PlainFiles>;
export type TeamListedFile = Infer<typeof TeamListedFile>;
export type IdLedger = Infer<typeof IdLedger>;
export type UserRef = Infer<typeof UserRef>;
export type TeamVersionRecord = Infer<typeof TeamVersionRecord>;
export type TeamVersion = Infer<typeof TeamVersion>;
export type GuestVersion = Infer<typeof GuestVersion>;
export type Online = Infer<typeof Online>;
export type GuestDraft = Infer<typeof GuestDraft>;
export type TeamRecords = Infer<typeof TeamRecords>;
export type TeamStart = Infer<typeof TeamStart>;
export type TeamLineHead = Infer<typeof TeamLineHead>;
export type LineHistoryEntry = Infer<typeof LineHistoryEntry>;
export type Member = Infer<typeof Member>;
export type SealingEntry = Infer<typeof SealingEntry>;
export type Progress = Infer<typeof Progress>;
export type DiscussionAuthor = Infer<typeof DiscussionAuthor>;
export type MrItem = Infer<typeof MrItem>;
export type MergeRenames = Infer<typeof MergeRenames>;
export type MrStatus = Infer<typeof MrStatus>;
export type MrSummary = Infer<typeof MrSummary>;
export type MrDetail = Infer<typeof MrDetail>;
export type MyMergedMr = Infer<typeof MyMergedMr>;
export type TeamState = Infer<typeof TeamState>;
export type TeamErrorBody = Infer<typeof TeamErrorBody>;
export type TeamProjectsResponse = Infer<typeof TeamProjectsResponse>;
export type MembersResponse = Infer<typeof MembersResponse>;
export type MemberAddRequest = Infer<typeof MemberAddRequest>;
export type MemberResponse = Infer<typeof MemberResponse>;
export type MemberUpdateRequest = Infer<typeof MemberUpdateRequest>;
export type MemberRemoveResponse = Infer<typeof MemberRemoveResponse>;
export type RefreshRequest = Infer<typeof RefreshRequest>;
export type StateQuery = Infer<typeof StateQuery>;
export type SnapshotFilesResponse = Infer<typeof SnapshotFilesResponse>;
export type BlobsMissingRequest = Infer<typeof BlobsMissingRequest>;
export type BlobsMissingResponse = Infer<typeof BlobsMissingResponse>;
export type BlobPutResponse = Infer<typeof BlobPutResponse>;
export type LedgerRequest = Infer<typeof LedgerRequest>;
export type LedgerResponse = Infer<typeof LedgerResponse>;
export type MrSubmitRequest = Infer<typeof MrSubmitRequest>;
export type MrResponse = Infer<typeof MrResponse>;
export type MrListQuery = Infer<typeof MrListQuery>;
export type MrListResponse = Infer<typeof MrListResponse>;
export type MrDetailResponse = Infer<typeof MrDetailResponse>;
export type MrReturnRequest = Infer<typeof MrReturnRequest>;
export type AdvanceRequest = Infer<typeof AdvanceRequest>;
export type AdvanceResponse = Infer<typeof AdvanceResponse>;
export type SealingPutRequest = Infer<typeof SealingPutRequest>;
export type SealingPutResponse = Infer<typeof SealingPutResponse>;
export type SealRequest = Infer<typeof SealRequest>;
export type SealResponse = Infer<typeof SealResponse>;
export type OnlinePutRequest = Infer<typeof OnlinePutRequest>;
export type OnlinePutResponse = Infer<typeof OnlinePutResponse>;
export type InitVersion = Infer<typeof InitVersion>;
export type InitRequest = Infer<typeof InitRequest>;
export type InitResponse = Infer<typeof InitResponse>;
export type InitStatusResponse = Infer<typeof InitStatusResponse>;
export type InitDoneRequest = Infer<typeof InitDoneRequest>;
export type InitDoneResponse = Infer<typeof InitDoneResponse>;
export type GuestDraftPutRequest = Infer<typeof GuestDraftPutRequest>;
export type GuestDraftPutResponse = Infer<typeof GuestDraftPutResponse>;
export type GuestDraftDeleteResponse = Infer<typeof GuestDraftDeleteResponse>;
export type DiscussionsPutRequest = Infer<typeof DiscussionsPutRequest>;
export type DiscussionsPutResponse = Infer<typeof DiscussionsPutResponse>;
export type DiscussionsListResponse = Infer<typeof DiscussionsListResponse>;

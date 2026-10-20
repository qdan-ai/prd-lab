/**
 * 团队协作契约测试：读 `team-contract-samples/*.json`（html_canvas 仓库 `ai/goals/多人协作（PRD-Lab-GitHub-式）/contract/`
 * 的副本，G-canvas 的契约测试读原件），核对每个样例符合 `team-contract.ts` 的接口表、形状、错误码与状态、幂等重放；
 * 契约改了样例就过不了。原件在本机时另核对副本与原件逐字节一致。
 *
 * 样例目录：环境变量 `TEAM_CONTRACT_DIR` 优先，否则读副本。原件位置：环境变量 `TEAM_CONTRACT_CANONICAL_DIR`，
 * 缺省为 html_canvas 仓库在本机的固定位置。原件更新后同步副本：
 *   cp "<html_canvas>/ai/goals/多人协作（PRD-Lab-GitHub-式）/contract/"*.json packages/core/src/repo/team-contract-samples/
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkShape,
  TEAM_ENDPOINTS,
  TEAM_ERROR_CODES,
  TEAM_ERROR_DETAILS,
  TEAM_ERROR_STATUS,
  TEAM_FORMAT_HEADER,
  TeamErrorBody,
  VALIDATION_REASON_RE,
  type TeamEndpoint,
  type TeamErrorCode,
  type TeamFileEntry,
  type TeamState,
} from "./team-contract";

const COPY_DIR = join(import.meta.dirname, "team-contract-samples");
const CANONICAL_DIR =
  process.env.TEAM_CONTRACT_CANONICAL_DIR ??
  "/Users/path/Desktop/tools/html_canvas/ai/goals/多人协作（PRD-Lab-GitHub-式）/contract";

function sampleDir(): string {
  return process.env.TEAM_CONTRACT_DIR ?? COPY_DIR;
}

interface SampleMessage {
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  bodyBase64?: string;
}
interface SampleCase {
  name: string;
  replayOf?: string;
  request: SampleMessage;
  response: SampleMessage & { status: number };
}
interface SampleFile {
  endpoint: string;
  cases: SampleCase[];
}

const ENDPOINTS: Record<string, TeamEndpoint> = TEAM_ENDPOINTS;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9]+)/g)].map((m) => m[1]!).sort();
}

function headerOf(headers: Record<string, string> | undefined, name: string): string | undefined {
  const hit = Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return hit?.[1];
}

const sha1 = (buf: Buffer) => createHash("sha1").update(buf).digest("hex");

/** 样例里每个带 `key` 与 `commitRaw` 的对象：提交原文按 git 规则算出的号必须等于 key；带 `record` 的，记录里的 key 也一样 */
function commitProblems(value: unknown, at: string, out: string[]): void {
  if (Array.isArray(value)) return value.forEach((v, i) => commitProblems(v, `${at}[${i}]`, out));
  if (!isRecord(value)) return;
  if (typeof value["key"] === "string" && typeof value["commitRaw"] === "string") {
    const raw = Buffer.from(value["commitRaw"], "base64");
    const oid = sha1(Buffer.concat([Buffer.from(`commit ${raw.length}\0`), raw]));
    if (oid !== value["key"]) out.push(`${at}: 提交原文算出 ${oid}，与 key ${value["key"]} 不符`);
    const record = value["record"];
    if (isRecord(record) && record["key"] !== value["key"]) out.push(`${at}.record.key 与 key 不同`);
  }
  for (const [k, v] of Object.entries(value)) commitProblems(v, `${at}.${k}`, out);
}

function messageBodyProblems(
  spec: TeamEndpoint["body"] | TeamEndpoint["response"],
  msg: SampleMessage,
  at: string,
  out: string[],
): void {
  if (spec === null) {
    if ("body" in msg || "bodyBase64" in msg) out.push(`${at}: 这个接口没有请求体`);
  } else if (spec === "binary") {
    if (typeof msg.bodyBase64 !== "string") out.push(`${at}: 应带原始字节 bodyBase64`);
    if ("body" in msg) out.push(`${at}: 原始字节接口不带 JSON body`);
  } else {
    if (!("body" in msg)) out.push(`${at}: 缺少 body`);
    else out.push(...checkShape(spec, msg.body, `${at}.body`));
  }
}

function errorProblems(ep: TeamEndpoint, c: SampleCase, at: string, out: string[]): void {
  const res = c.response;
  const shape = checkShape(TeamErrorBody, res.body, `${at}.body`);
  if (shape.length) return void out.push(...shape);
  const body = res.body as { error_code: TeamErrorCode; message: string; details?: unknown };
  const code = body.error_code;
  if (!ep.errors.includes(code)) out.push(`${at}: 这个接口不会回 ${code}`);
  if (TEAM_ERROR_STATUS[code] !== res.status)
    out.push(`${at}: ${code} 的状态应为 ${TEAM_ERROR_STATUS[code]}，样例是 ${res.status}`);
  const details = TEAM_ERROR_DETAILS[code];
  if (details === null && body.details !== undefined) out.push(`${at}: ${code} 不带 details`);
  if (details !== null && details !== "any") {
    if (body.details === undefined) out.push(`${at}: ${code} 必须带 details`);
    else out.push(...checkShape(details, body.details, `${at}.body.details`));
  }
  if (code === "validation_error" && !ep.existing && !VALIDATION_REASON_RE.test(body.message)) {
    out.push(`${at}: validation_error 的 message 应为原因码，样例是 ${JSON.stringify(body.message)}`);
  }
  if (code === "rate_limited") {
    const retry = headerOf(res.headers, "Retry-After");
    if (retry !== String((body.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds)) {
      out.push(`${at}: rate_limited 要带与 details.retryAfterSeconds 相同的 Retry-After 头`);
    }
  }
}

/** 一个样例文件里不符合契约的地方；空数组 = 符合 */
function sampleProblems(fileName: string, raw: unknown): string[] {
  const out: string[] = [];
  if (!isRecord(raw) || typeof raw["endpoint"] !== "string" || !Array.isArray(raw["cases"]))
    return [`${fileName}: 应为 { endpoint, cases[] }`];
  const sample = raw as unknown as SampleFile;
  const ep = ENDPOINTS[sample.endpoint];
  if (!ep) return [`${fileName}: 契约里没有接口 ${sample.endpoint}`];
  const expectedName = `${String(ep.no).padStart(2, "0")}-${sample.endpoint}.json`;
  if (fileName !== expectedName) out.push(`${fileName}: 文件名应为 ${expectedName}`);

  const byName = new Map(sample.cases.map((c) => [c.name, c]));
  sample.cases.forEach((c, i) => {
    const at = `${fileName} 第 ${i + 1} 例「${c.name}」`;
    const req = c.request;
    const res = c.response;
    const ok = res.status === ep.okStatus;
    const isValidationCase =
      !ok &&
      isRecord(res.body) &&
      (res.body["error_code"] === "validation_error" || res.body["error_code"] === "discussions_not_allowed");

    const params = Object.keys(req.params ?? {}).sort();
    if (JSON.stringify(params) !== JSON.stringify(pathParams(ep.path)))
      out.push(`${at}: 路径参数应为 ${pathParams(ep.path).join(", ") || "（无）"}`);
    if (!/^Bearer prd_[A-Za-z0-9_-]{8,}$/.test(headerOf(req.headers, "Authorization") ?? ""))
      out.push(`${at}: 缺少 Authorization: Bearer prd_…`);
    const format = headerOf(req.headers, TEAM_FORMAT_HEADER);
    if (ep.formatHeader && format === undefined) out.push(`${at}: 缺少 ${TEAM_FORMAT_HEADER}`);
    if (format !== undefined && !/^(0|[1-9][0-9]*)$/.test(format))
      out.push(`${at}: ${TEAM_FORMAT_HEADER} 应为整数`);

    if (!isValidationCase) {
      if (ep.query) out.push(...checkShape(ep.query, req.query ?? {}, `${at}.request.query`));
      else if (req.query !== undefined) out.push(`${at}: 这个接口没有查询参数`);
      messageBodyProblems(ep.body, req, `${at}.request`, out);
    }

    if (ok) {
      if (ep.errorOnly) out.push(`${at}: 这个接口的样例只写错误`);
      messageBodyProblems(ep.response, res, `${at}.response`, out);
      if (ep.response === "binary" && typeof res.bodyBase64 === "string") {
        const bytes = Buffer.from(res.bodyBase64, "base64");
        if (headerOf(res.headers, "Content-Type") !== "application/octet-stream")
          out.push(`${at}: 原始字节响应的 Content-Type 应为 application/octet-stream`);
        const sha = req.params?.["sha256"];
        if (sha && createHash("sha256").update(bytes).digest("hex") !== sha)
          out.push(`${at}: 下载到的字节与路径里的指纹不符`);
      }
    } else if (res.status >= 400) {
      errorProblems(ep, c, at, out);
    } else {
      out.push(`${at}: 成功状态应为 ${ep.okStatus}，样例是 ${res.status}`);
    }

    if (c.replayOf !== undefined) {
      const first = byName.get(c.replayOf);
      if (ep.idempotency === null) out.push(`${at}: 这个接口不重放`);
      if (!first) out.push(`${at}: replayOf 指向的「${c.replayOf}」不存在`);
      else {
        if (JSON.stringify(first.request.body) !== JSON.stringify(req.body))
          out.push(`${at}: 重放的请求体应与「${c.replayOf}」相同`);
        if (JSON.stringify(first.response) !== JSON.stringify(res))
          out.push(`${at}: 重放的响应应与「${c.replayOf}」相同`);
      }
    }
    commitProblems(req.body, `${at}.request.body`, out);
    commitProblems(res.body, `${at}.response.body`, out);
  });
  return out;
}

function loadSamples(): { dir: string; files: { name: string; data: unknown }[] } {
  const dir = sampleDir();
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort();
  return {
    dir,
    files: names.map((name) => ({
      name,
      data: JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown,
    })),
  };
}

const { dir, files } = loadSamples();
const valid = files.filter(
  (f): f is { name: string; data: SampleFile } => isRecord(f.data) && Array.isArray(f.data["cases"]),
);

describe(`团队协作契约样例（${dir}）`, () => {
  it("样例目录不是空的", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f.name} 符合契约`, () => {
      expect(sampleProblems(f.name, f.data)).toEqual([]);
    });
  }

  it("接口表里每个接口都有样例文件", () => {
    const covered = new Set(valid.map((f) => f.data.endpoint));
    expect(Object.keys(TEAM_ENDPOINTS).filter((name) => !covered.has(name))).toEqual([]);
  });

  it("每个接口至少一个成功样例（只写错误的现有接口除外）与一个错误样例", () => {
    const gaps: string[] = [];
    for (const [name, ep] of Object.entries(ENDPOINTS)) {
      const cases = valid.filter((f) => f.data.endpoint === name).flatMap((f) => f.data.cases);
      if (!ep.errorOnly && !cases.some((c) => c.response.status === ep.okStatus))
        gaps.push(`${name}: 没有成功样例`);
      if (!cases.some((c) => c.response.status >= 400)) gaps.push(`${name}: 没有错误样例`);
    }
    expect(gaps).toEqual([]);
  });

  it("能重放的接口（操作号、开启批次）都有一例重试", () => {
    const gaps = Object.entries(ENDPOINTS)
      .filter(([, ep]) => ep.idempotency !== null)
      .filter(
        ([name]) => !valid.some((f) => f.data.endpoint === name && f.data.cases.some((c) => c.replayOf)),
      )
      .map(([name]) => name);
    expect(gaps).toEqual([]);
  });

  it("每个错误码都在某个样例里出现过（details 的形状都核对过一次）", () => {
    const seen = new Set(
      valid.flatMap((f) =>
        f.data.cases.map((c) => (isRecord(c.response.body) ? c.response.body["error_code"] : undefined)),
      ),
    );
    expect(TEAM_ERROR_CODES.filter((code) => !seen.has(code))).toEqual([]);
  });

  it("格式门槛的接口都会回 client_too_old", () => {
    expect(
      Object.entries(ENDPOINTS)
        .filter(([, ep]) => ep.formatGated && !ep.errors.includes("client_too_old"))
        .map(([n]) => n),
    ).toEqual([]);
  });
});

describe("样例副本与 html_canvas 里的原件一致", () => {
  const listJson = (d: string) =>
    readdirSync(d)
      .filter((n) => n.endsWith(".json"))
      .sort();
  it.skipIf(!existsSync(CANONICAL_DIR))("文件清单与每个文件的字节都相同", () => {
    expect(listJson(COPY_DIR)).toEqual(listJson(CANONICAL_DIR));
    const differ = listJson(CANONICAL_DIR).filter(
      (n) => !readFileSync(join(COPY_DIR, n)).equals(readFileSync(join(CANONICAL_DIR, n))),
    );
    expect(differ).toEqual([]);
  });
});

describe("推出的类型", () => {
  it("类型由形状推出：字段与取值受约束", () => {
    const file: TeamFileEntry = {
      sha256: "a".repeat(64),
      size: 1,
      gitMode: "100755",
      gitOid: "b".repeat(40),
    };
    // @ts-expect-error 文件模式只有 100644 / 100755
    const badMode: TeamFileEntry = { ...file, gitMode: "120000" };
    // @ts-expect-error 团队状态的 records 没变时为 null，不能省略
    const noRecords: Pick<TeamState, "records"> = {};
    expect([file, badMode, noRecords].length).toBe(3);
  });
});

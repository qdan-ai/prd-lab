import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  issueRepoShareToken,
  issueRepoToken,
  issueShareToken,
  issueToken,
  reissueRepoToken,
  verifyRepoToken,
  verifyToken,
} from "./index";

const SECRET = "test-secret-for-repo-token";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 按 S2–S4 时期的格式手工签一枚老快照令牌：只有 snapshotId / sub / exp，没有 kind 与 origin。 */
function signLegacy(body: Record<string, unknown>): string {
  const p = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = createHmac("sha256", SECRET).update(p).digest();
  return `${p}.${b64url(sig)}`;
}

beforeAll(() => {
  process.env.HMAC_SECRET = SECRET;
});

describe("仓库级令牌", () => {
  it("签发后用同一仓库号验证通过，payload 保留 kind / sub / origin", () => {
    const t = issueRepoShareToken({ repoId: "r1", shareSessionId: "s1:3", origin: "http://app" });
    const r = verifyRepoToken(t, "r1");
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.payload).toEqual({ repoId: "r1", sub: "s1:3", exp: r.payload.exp, kind: "share", origin: "http://app" });
  });

  it("别的仓库号验证失败", () => {
    const t = issueRepoToken({ repoId: "r1", sessionUserId: "u1" });
    expect(verifyRepoToken(t, "r2")).toEqual({ valid: false, expired: false, reason: "repo_mismatch" });
  });

  it("过期令牌带出 payload 供重签", () => {
    const t = issueRepoToken({ repoId: "r1", sessionUserId: "u1", origin: "http://app" }, -10);
    const r = verifyRepoToken(t, "r1");
    expect(r.valid).toBe(false);
    expect(r.expired).toBe(true);
  });

  it("重签只刷新有效期", () => {
    const t = issueRepoShareToken({ repoId: "r1", shareSessionId: "s1:1" }, -10);
    const r = verifyRepoToken(t, "r1");
    if (!r.expired) throw new Error("expected expired");
    const again = verifyRepoToken(reissueRepoToken(r.payload, 600), "r1");
    expect(again.valid).toBe(true);
    if (again.valid) expect(again.payload.kind).toBe("share");
  });

  it("仓库令牌打不开快照：verifyToken 判为格式不符", () => {
    const t = issueRepoToken({ repoId: "r1", sessionUserId: "u1" });
    expect(verifyToken(t, "r1")).toEqual({ valid: false, expired: false, reason: "malformed" });
  });

  it("快照令牌打不开仓库：verifyRepoToken 判为格式不符", () => {
    const t = issueShareToken({ snapshotId: "r1", shareSessionId: "s1:1" });
    expect(verifyRepoToken(t, "r1")).toEqual({ valid: false, expired: false, reason: "malformed" });
  });

  it("篡改签名被拒", () => {
    const t = issueRepoToken({ repoId: "r1", sessionUserId: "u1" });
    const bad = `${t.split(".")[0]}.${b64url(Buffer.from("x".repeat(32)))}`;
    expect(verifyRepoToken(bad, "r1")).toEqual({ valid: false, expired: false, reason: "bad_signature" });
  });
});

describe("老快照令牌兼容", () => {
  it("无 kind / origin 的老令牌照旧通过 verifyToken，视为 user", () => {
    const t = signLegacy({ snapshotId: "s1", sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 });
    const r = verifyToken(t, "s1");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.payload).toEqual({ snapshotId: "s1", sub: "u1", exp: r.payload.exp, kind: "user" });
  });

  it("现行快照令牌照旧通过 verifyToken", () => {
    const t = issueToken({ snapshotId: "s1", sessionUserId: "u1", origin: "http://app" });
    const r = verifyToken(t, "s1");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.payload.origin).toBe("http://app");
  });

  it("老令牌拿去开仓库被拒", () => {
    const t = signLegacy({ snapshotId: "s1", sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 });
    expect(verifyRepoToken(t, "s1").valid).toBe(false);
  });

  it("payload 不是对象时判为格式不符而不是抛错", () => {
    const p = b64url(Buffer.from("null", "utf8"));
    const t = `${p}.${b64url(createHmac("sha256", SECRET).update(p).digest())}`;
    expect(verifyToken(t, "s1")).toEqual({ valid: false, expired: false, reason: "malformed" });
  });
});

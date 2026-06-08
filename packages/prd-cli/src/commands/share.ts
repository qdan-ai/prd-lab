import type { CAC } from "cac";
import { API } from "../lib/api-paths";
import { readClientOrExit } from "../lib/client";
import { outputError, outputResult, type OutputOptions } from "../lib/output";
import { generateSharePassword } from "../lib/share-password";
import type { ApiClient } from "../lib/api-client";

interface ActiveShare {
  shareId: string;
  createdAt: string;
  passwordVersion: number;
}

interface GetShareResponse {
  share: ActiveShare | null;
}

interface CreatedShareResponse {
  share: ActiveShare;
}

function buildShareUrl(endpoint: string, shareId: string): string {
  // 主站 endpoint 可能是 http://app.local 或 http://localhost:3000
  // 访客访问入口在 /share/{shareId}（详见 apps/main/app/share/[shareId]/page.tsx）
  return `${endpoint.replace(/\/$/, "")}/share/${shareId}`;
}

async function fetchActiveShare(client: ApiClient, sid: string): Promise<ActiveShare | null> {
  const res = await client.get<GetShareResponse>(API.snapshotShares(sid));
  if (res.status !== 200 || !res.data) return null;
  return res.data.share;
}

export function registerShareCommands(cli: CAC): void {
  cli
    .command("share create <sid>", "为某快照创建分享链接（默认 --random 生成 6 位密码）")
    .option("--password <pw>", "指定密码（6-200 字符）；不传则视为 --random")
    .option("--random", "由 CLI 用 crypto.randomInt 生成 6 位数密码")
    .option("--rotate", "若已有 active share，先 revoke 旧的再创建新的")
    .option("--json", "输出单行 JSON")
    .action(
      async (
        sid: string,
        opts: OutputOptions & { password?: string; random?: boolean; rotate?: boolean },
      ) => {
        const client = readClientOrExit();

        // 决定密码：显式 --password > --random > 默认 random
        let password: string;
        if (opts.password != null) {
          // cac 会把纯数字 flag 解析为 number，强制转字符串再校验/提交
          password = String(opts.password);
          if (password.length < 6 || password.length > 200) {
            outputError(
              { status: 400, error_code: "validation_error", message: "password 长度需 6..200" },
              opts,
            );
          }
        } else {
          password = generateSharePassword();
        }

        // --rotate：先看有没有 active，有就 revoke
        if (opts.rotate) {
          const existing = await fetchActiveShare(client, sid);
          if (existing) {
            const del = await client.delete(API.share(existing.shareId));
            if (del.status !== 204) {
              outputError({ status: del.status, ...del.error }, opts);
            }
          }
        }

        const res = await client.postJson<CreatedShareResponse>(API.snapshotShares(sid), {
          password,
        });
        if (res.status !== 201 || !res.data) {
          outputError({ status: res.status, ...res.error }, opts);
        }
        const share = res.data!.share;
        const shareUrl = buildShareUrl(client.endpoint, share.shareId);
        const payload = {
          shareId: share.shareId,
          shareUrl,
          password,
          passwordVersion: share.passwordVersion,
          createdAt: share.createdAt,
        };
        outputResult(payload, opts, (d) =>
          [
            `[prd] ✓ 已创建分享链接`,
            `      链接: ${d.shareUrl}`,
            `      密码: ${d.password}  (只显示一次，请保存)`,
          ].join("\n"),
        );
      },
    );

  cli
    .command("share list <sid>", "查询某快照的活跃分享链接（不含密码）")
    .option("--json", "输出单行 JSON")
    .action(async (sid: string, opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.get<GetShareResponse>(API.snapshotShares(sid));
      if (res.status !== 200 || !res.data) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      const share = res.data!.share;
      if (!share) {
        outputResult({ share: null }, opts, () => "(无活跃分享链接)");
        return;
      }
      const shareUrl = buildShareUrl(client.endpoint, share.shareId);
      outputResult(
        { ...share, shareUrl },
        opts,
        (d) =>
          `${d.shareId}  pv=${d.passwordVersion}  ${d.createdAt}\n  url: ${shareUrl}`,
      );
    });

  cli
    .command("share revoke <shareId>", "撤销分享链接")
    .option("--json", "输出单行 JSON")
    .action(async (shareId: string, opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.delete(API.share(shareId));
      if (res.status !== 204) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult({ revoked: true, shareId }, opts, () => `[prd] ✓ 已撤销 ${shareId}`);
    });
}

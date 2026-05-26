import type { CAC } from "cac";
import { API } from "../lib/api-paths";
import { readClientOrExit } from "../lib/client";
import { outputError, outputResult, type OutputOptions } from "../lib/output";

interface SwitcherVersion {
  id: string;
  name: string;
  seqNo: number;
  activeCount: number;
  latestSnapshotSeq: number | null;
  latestSnapshot: {
    seqNo: number;
    versionLabel: string | null;
    uploaderName: string;
    createdAt: string;
    changeNote: string;
  } | null;
}

interface SwitcherProject {
  id: string;
  name: string;
  visibility: "team" | "private";
  ownedByMe: boolean;
  versions: SwitcherVersion[];
}

interface VersionRow {
  id: string;
  projectId: string;
  name: string;
  seqNo: number;
  createdAt: string;
}

interface SnapshotRow {
  id: string;
  seqNo: number;
  versionLabel: string | null;
  changeNote: string;
  uploaderName: string;
  uploaderType: "user" | "cli" | "mcp";
  createdAt: string;
  contentSha256: string;
  entryHtmlPath: string | null;
  fileCount: number;
  totalSizeBytes: number;
}

export function registerListCommands(cli: CAC): void {
  cli
    .command("list projects", "列出我可见的项目（含每项目的方案 + 最新快照）")
    .option("--json", "输出单行 JSON")
    .action(async (opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.get<SwitcherProject[]>(API.projectsSwitcher);
      if (res.status !== 200 || !res.data) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult(res.data ?? [], opts, (rows) => {
        if (rows.length === 0) return "(无可见项目)";
        return rows
          .map((p) => {
            const vis = p.visibility === "team" ? "团队" : "私有";
            const mine = p.ownedByMe ? " · 我建" : "";
            const versions = p.versions.length
              ? `\n  ${p.versions
                  .map(
                    (v) =>
                      `${v.id}  "${v.name}"  v${v.seqNo}  active=${v.activeCount}` +
                      (v.latestSnapshotSeq != null ? ` latest=v${v.latestSnapshotSeq}` : ""),
                  )
                  .join("\n  ")}`
              : "  (无方案)";
            return `${p.id}  "${p.name}"  [${vis}${mine}]${versions}`;
          })
          .join("\n");
      });
    });

  cli
    .command("list versions <pid>", "列出某项目下的方案")
    .option("--json", "输出单行 JSON")
    .action(async (pid: string, opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.get<VersionRow[]>(API.projectVersions(pid));
      if (res.status !== 200 || !res.data) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult(res.data ?? [], opts, (rows) => {
        if (rows.length === 0) return "(无活跃方案)";
        return rows
          .map((v) => `${v.id}  "${v.name}"  seq=${v.seqNo}  created=${v.createdAt}`)
          .join("\n");
      });
    });

  cli
    .command("list snapshots <vid>", "列出某方案下的版本时间轴")
    .option("--json", "输出单行 JSON")
    .action(async (vid: string, opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.get<SnapshotRow[]>(API.versionSnapshots(vid));
      if (res.status !== 200 || !res.data) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult(res.data ?? [], opts, (rows) => {
        if (rows.length === 0) return "(无活跃版本)";
        return rows
          .map((s) => {
            const label = s.versionLabel ? `"${s.versionLabel}"` : `v${s.seqNo}`;
            return `${s.id}  ${label}  by=${s.uploaderName}(${s.uploaderType})  ${s.createdAt}  "${s.changeNote}"`;
          })
          .join("\n");
      });
    });
}

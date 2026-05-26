import type { CAC } from "cac";
import { API } from "../lib/api-paths";
import { readClientOrExit } from "../lib/client";
import { confirmDestructive } from "../lib/confirm";
import { outputError, outputResult, type OutputOptions } from "../lib/output";

interface VersionRow {
  id: string;
  projectId: string;
  name: string;
  seqNo: number;
  createdAt: string;
}

export function registerVersionCommands(cli: CAC): void {
  cli
    .command("version create <pid> <name>", "在项目下新建方案")
    .option("--json", "输出单行 JSON")
    .action(async (pid: string, name: string, opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.postJson<VersionRow>(API.projectVersions(pid), { name });
      if (res.status !== 201 || !res.data) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult(res.data!, opts, (d) => `[prd] ✓ 新建方案 "${d.name}" (${d.id})`);
    });

  cli
    .command("version rename <vid> <newName>", "重命名方案")
    .option("--json", "输出单行 JSON")
    .action(async (vid: string, newName: string, opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.patchJson<VersionRow>(API.version(vid), { name: newName });
      if (res.status !== 200 || !res.data) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult(res.data!, opts, (d) => `[prd] ✓ 方案重命名为 "${d.name}"`);
    });

  cli
    .command("version archive <vid>", "归档方案（软删，包含所有版本快照）")
    .option("--yes", "跳过二次确认")
    .option("--json", "输出单行 JSON")
    .action(async (vid: string, opts: OutputOptions & { yes: boolean }) => {
      const ok = await confirmDestructive(`确认归档方案 ${vid}？`, opts.yes);
      if (!ok) {
        if (opts.json) {
          console.log(JSON.stringify({ cancelled: true }));
        } else {
          console.log("[prd] 已取消");
        }
        return;
      }
      const client = readClientOrExit();
      const res = await client.delete(API.version(vid));
      if (res.status !== 204) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult({ archived: true, versionId: vid }, opts, () => `[prd] ✓ 已归档方案 ${vid}`);
    });
}

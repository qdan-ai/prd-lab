import type { CAC } from "cac";
import { API } from "../lib/api-paths";
import { readClientOrExit } from "../lib/client";
import { confirmDestructive } from "../lib/confirm";
import { outputError, outputResult, type OutputOptions } from "../lib/output";

interface ProjectRow {
  id: string;
  name: string;
  visibility: "team" | "private";
  ownerId: string;
  createdAt: string;
}

export function registerProjectCommands(cli: CAC): void {
  cli
    .command(
      "project create <name>",
      "新建项目（默认 visibility=private；建的是空项目，方案用 version create 另建、或首次 push 时自动建）",
    )
    .option("--visibility <v>", "可见性：private | team", { default: "private" })
    .option("--json", "输出单行 JSON")
    .action(
      async (
        name: string,
        opts: OutputOptions & { visibility: string },
      ) => {
        const client = readClientOrExit();
        const res = await client.postJson<{ project: ProjectRow }>(API.projects, {
          name,
          visibility: opts.visibility === "team" ? "team" : "private",
        });
        if (res.status !== 201 || !res.data) {
          outputError({ status: res.status, ...res.error }, opts);
        }
        outputResult(
          res.data!,
          opts,
          (d) =>
            `[prd] ✓ 新建空项目 "${d.project.name}" (${d.project.id})；推送 demo 时会自动建方案，或用 prd version create 另建`,
        );
      },
    );

  cli
    .command("project rename <pid> <newName>", "重命名项目")
    .option("--json", "输出单行 JSON")
    .action(async (pid: string, newName: string, opts: OutputOptions) => {
      const client = readClientOrExit();
      const res = await client.patchJson<ProjectRow>(API.project(pid), { name: newName });
      if (res.status !== 200 || !res.data) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult(res.data!, opts, (d) => `[prd] ✓ 项目重命名为 "${d.name}"`);
    });

  cli
    .command("project archive <pid>", "归档项目（软删，可由 owner 在 web 上恢复）")
    .option("--yes", "跳过二次确认")
    .option("--json", "输出单行 JSON")
    .action(async (pid: string, opts: OutputOptions & { yes: boolean }) => {
      const ok = await confirmDestructive(`确认归档项目 ${pid}？`, opts.yes);
      if (!ok) {
        if (opts.json) {
          console.log(JSON.stringify({ cancelled: true }));
        } else {
          console.log("[prd] 已取消");
        }
        return;
      }
      const client = readClientOrExit();
      const res = await client.delete(API.project(pid));
      if (res.status !== 204) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult({ archived: true, projectId: pid }, opts, () => `[prd] ✓ 已归档项目 ${pid}`);
    });
}

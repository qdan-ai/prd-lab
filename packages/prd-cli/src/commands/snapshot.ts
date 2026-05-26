import type { CAC } from "cac";
import { API } from "../lib/api-paths";
import { readClientOrExit } from "../lib/client";
import { confirmDestructive } from "../lib/confirm";
import { outputError, outputResult, type OutputOptions } from "../lib/output";

interface SnapshotRow {
  id: string;
  seqNo: number;
  versionLabel: string | null;
  changeNote: string;
}

export function registerSnapshotCommands(cli: CAC): void {
  cli
    .command("snapshot rename <sid>", "修改快照的 change_note 或 version_label")
    .option("--change-note <text>", "改动说明（1..2000）")
    .option("--version-label <label>", "版本标签（如 '4.0.4'，传空字符串清除）")
    .option("--json", "输出单行 JSON")
    .action(
      async (
        sid: string,
        opts: OutputOptions & { changeNote?: string; versionLabel?: string },
      ) => {
        if (opts.changeNote === undefined && opts.versionLabel === undefined) {
          outputError(
            { status: 400, error_code: "validation_error", message: "至少传一个 --change-note 或 --version-label" },
            opts,
          );
        }
        const body: { change_note?: string; version_label?: string | null } = {};
        if (opts.changeNote !== undefined) body.change_note = opts.changeNote;
        if (opts.versionLabel !== undefined) {
          body.version_label = opts.versionLabel === "" ? null : opts.versionLabel;
        }
        const client = readClientOrExit();
        const res = await client.patchJson<SnapshotRow>(API.snapshot(sid), body);
        if (res.status !== 200 || !res.data) {
          outputError({ status: res.status, ...res.error }, opts);
        }
        outputResult(
          res.data!,
          opts,
          (d) =>
            `[prd] ✓ 快照已更新 v${d.seqNo}` +
            (d.versionLabel ? ` "${d.versionLabel}"` : "") +
            ` change_note="${d.changeNote}"`,
        );
      },
    );

  cli
    .command("snapshot archive <sid>", "归档快照（软删）")
    .option("--yes", "跳过二次确认")
    .option("--json", "输出单行 JSON")
    .action(async (sid: string, opts: OutputOptions & { yes: boolean }) => {
      const ok = await confirmDestructive(`确认归档快照 ${sid}？`, opts.yes);
      if (!ok) {
        if (opts.json) {
          console.log(JSON.stringify({ cancelled: true }));
        } else {
          console.log("[prd] 已取消");
        }
        return;
      }
      const client = readClientOrExit();
      const res = await client.delete(API.snapshot(sid));
      if (res.status !== 204) {
        outputError({ status: res.status, ...res.error }, opts);
      }
      outputResult({ archived: true, snapshotId: sid }, opts, () => `[prd] ✓ 已归档快照 ${sid}`);
    });
}

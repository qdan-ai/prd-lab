import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/**
 * archive 类危险操作的二次确认。`--yes` 跳过；交互态默认 N。
 */
export async function confirmDestructive(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  const rl = createInterface({ input, output });
  const ans = (await rl.question(`${question} (y/N): `)).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes";
}

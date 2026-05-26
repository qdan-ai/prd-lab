import { ApiClient } from "./api-client";
import { readUserRc } from "./rc";

/**
 * 读 ~/.prdrc 构造 ApiClient；rc 缺失则提示登入并非零退出。
 * 之前藏在 cli.ts 内部，T1a 抽出来让 commands/ 子模块复用。
 */
export function readClientOrExit(): ApiClient {
  const rc = readUserRc();
  if (!rc) {
    console.error(`未登入。请先跑：prd login`);
    process.exit(1);
  }
  return new ApiClient({ endpoint: rc.endpoint, token: rc.token });
}

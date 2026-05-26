import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";

/**
 * 两种 rc 文件：
 *   ~/.prdrc           用户级，存 token + endpoint（mode 0600）
 *   ./.prdrc.json      工作目录级，存 projectName/versionName + 可选 endpoint
 *
 * Windows 跳过 chmod（仅警告），其他平台强制 0600。
 */

export interface UserRc {
  endpoint: string;
  token: string;
}

export interface ProjectRc {
  projectName: string;
  versionName: string;
  endpoint?: string;
}

const PROJECT_RC_FILE = ".prdrc.json";

function defaultUserRcPath(): string {
  return resolve(homedir(), ".prdrc");
}

export function getUserRcPath(): string {
  return defaultUserRcPath();
}

export function readUserRc(path = defaultUserRcPath()): UserRc | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<UserRc>;
    if (!parsed.endpoint || !parsed.token) return null;
    return { endpoint: parsed.endpoint, token: parsed.token };
  } catch {
    return null;
  }
}

export function writeUserRc(rc: UserRc, path = defaultUserRcPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rc, null, 2) + "\n", { mode: 0o600 });
  if (platform() !== "win32") {
    chmodSync(path, 0o600);
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) {
      console.warn(
        `[prd] warning: ${path} mode is ${mode.toString(8)}, expected 600 (token may be readable by others)`,
      );
    }
  }
}

export function readProjectRc(cwd: string): ProjectRc | null {
  const path = resolve(cwd, PROJECT_RC_FILE);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectRc>;
    if (!parsed.projectName || !parsed.versionName) return null;
    return {
      projectName: parsed.projectName,
      versionName: parsed.versionName,
      endpoint: parsed.endpoint,
    };
  } catch {
    return null;
  }
}

export function writeProjectRc(cwd: string, rc: ProjectRc): void {
  const path = resolve(cwd, PROJECT_RC_FILE);
  writeFileSync(path, JSON.stringify(rc, null, 2) + "\n");
}

export function projectRcPath(cwd: string): string {
  return resolve(cwd, PROJECT_RC_FILE);
}

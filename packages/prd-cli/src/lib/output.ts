/**
 * 子命令统一输出器：默认人类可读，--json 时输出单行 JSON。
 * 失败统一非零退出。
 */

export interface OutputOptions {
  json?: boolean;
}

export function outputResult<T>(
  data: T,
  opts: OutputOptions,
  textRenderer?: (d: T) => string,
): void {
  if (opts.json) {
    console.log(JSON.stringify(data));
    return;
  }
  if (textRenderer) {
    console.log(textRenderer(data));
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export interface CliErrorPayload {
  status: number;
  error_code?: string;
  message?: string;
}

export function outputError(err: CliErrorPayload, opts: OutputOptions): never {
  if (opts.json) {
    console.error(
      JSON.stringify({
        error_code: err.error_code ?? "unknown",
        message: err.message ?? "",
        status: err.status,
      }),
    );
  } else {
    const code = err.error_code ? ` ${err.error_code}` : "";
    const msg = err.message ? ` ${err.message}` : "";
    console.error(`[prd] 失败：HTTP ${err.status}${code}${msg}`);
  }
  process.exit(1);
}

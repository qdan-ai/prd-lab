import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * 起本地 localhost server 接 CLI OAuth callback。
 *
 * 端口选取：尝试 :8765..:8775 直到找到空闲；都占用则抛错。
 * 浏览器跳转到 `<endpoint>/cli/auth?cb=http://127.0.0.1:<port>/callback&state=<nonce>`。
 * 用户授权后主站 302 回 `<cb>?token=<plain>&state=<state>`，server 解出 token。
 * 30s 超时 / state 不匹配 / 缺 token 均 reject。
 */

export interface OAuthStartOptions {
  endpoint: string;
  openBrowser?: (url: string) => void | Promise<void>;
  /** 端口扫描起点；默认 8765 */
  basePort?: number;
  /** 端口扫描范围；默认 11 (8765..8775) */
  portRange?: number;
  /** ms；默认 5 分钟（用户可能去喝咖啡） */
  timeoutMs?: number;
  /** CLI 客户端主机名（os.hostname()）；server 端用作 token name "CLI on <client>" */
  clientHostname?: string;
}

export interface OAuthResult {
  token: string;
  url: string;
}

export async function startOAuthFlow(opts: OAuthStartOptions): Promise<OAuthResult> {
  const basePort = opts.basePort ?? 8765;
  const range = opts.portRange ?? 11;
  const state = randomBytes(16).toString("hex");

  const { server, port } = await listenOnFreePort(basePort, range);

  const cb = `http://127.0.0.1:${port}/callback`;
  const authUrl = new URL(`${opts.endpoint.replace(/\/$/, "")}/cli/auth`);
  authUrl.searchParams.set("cb", cb);
  authUrl.searchParams.set("state", state);
  if (opts.clientHostname) {
    authUrl.searchParams.set("client", opts.clientHostname);
  }

  return new Promise<OAuthResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error("OAuth timeout: 用户未在 5 分钟内完成授权"));
    }, opts.timeoutMs ?? 5 * 60 * 1000);

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const token = url.searchParams.get("token");
      const echoedState = url.searchParams.get("state");
      if (settled) {
        res.writeHead(200, { "content-type": "text/plain" }).end("already received");
        return;
      }
      if (!token || echoedState !== state) {
        settled = true;
        clearTimeout(timer);
        res.writeHead(400, { "content-type": "text/plain" }).end("invalid callback");
        server.close();
        reject(new Error("OAuth callback invalid: 缺 token 或 state 不匹配"));
        return;
      }
      settled = true;
      clearTimeout(timer);
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(
          "<!doctype html><meta charset=utf-8><title>PRD CLI</title>" +
            "<body style='font-family:system-ui;padding:40px;text-align:center'>" +
            "<h2>授权成功</h2><p>可以关闭此页面，回终端继续。</p></body>",
        );
      server.close();
      resolve({ token, url: authUrl.toString() });
    });

    void openBrowser(authUrl.toString(), opts.openBrowser);
  });
}

async function openBrowser(url: string, opener?: OAuthStartOptions["openBrowser"]) {
  if (opener) {
    await opener(url);
    return;
  }
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    console.log(`[prd] 请在浏览器打开：${url}`);
  }
}

async function listenOnFreePort(
  basePort: number,
  range: number,
): Promise<{ server: Server; port: number }> {
  for (let i = 0; i < range; i++) {
    const port = basePort + i;
    try {
      const server = await tryListen(port);
      return { server, port };
    } catch {
      continue;
    }
  }
  throw new Error(`OAuth: 无空闲端口 ${basePort}..${basePort + range - 1}`);
}

function tryListen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (e: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(e);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

import type { Readable } from "node:stream";
// archiver v8 类型滞后，运行时是 ZipArchive class
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as archiverMod from "archiver";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ZipArchive = (archiverMod as any).ZipArchive as new (opts?: { zlib?: { level?: number } }) => any;

/** 全站同时打包的上限；无密码链接任何人都能反复请求，单包体积上限挡不住并发。 */
export const PACK_MAX_CONCURRENT = 2;
/** 打包名额满时建议客户端等待的秒数。 */
export const PACK_RETRY_AFTER_SECONDS = 5;
/** 单次打包的最长时间：慢读端不能无限期占着全站仅有的名额。 */
export const PACK_MAX_MS = 10 * 60 * 1000;
/** 需求文件以文本为主，低档压缩已足够小，省共享服务器的 CPU。 */
export const PACK_ZLIB_LEVEL = 1;

/** 并发名额：tryAcquire 拿到的 release 可重复调用，只生效一次。 */
export class PackSlots {
  private used = 0;
  constructor(readonly max: number) {}

  get active(): number {
    return this.used;
  }

  tryAcquire(): (() => void) | null {
    if (this.used >= this.max) return null;
    this.used += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used -= 1;
    };
  }
}

// 挂在 globalThis 上：Next 可能把不同路由打成各自的模块实例，名额要全进程共用一份
const globalSlots = globalThis as unknown as { __prdAgentPackSlots?: PackSlots };
export const packSlots: PackSlots = (globalSlots.__prdAgentPackSlots ??= new PackSlots(PACK_MAX_CONCURRENT));

export type PackEntry = { path: string; s3Key: string };
export type PackExtra = { name: string; content: string };

export type ZipStreamOptions = {
  entries: PackEntry[];
  /** 放在 zip 最前面的说明文件（PRD-VERSION.md 等） */
  extras: PackExtra[];
  /** 从对象存储按流读一个对象；同一时刻最多打开一个 */
  open: (s3Key: string) => Promise<Readable>;
  /** 客户端断开时触发：停读、停压、释放名额 */
  signal?: AbortSignal;
  /** 压缩流结束（正常、出错、中止）后调用一次，用来归还并发名额；可重复调用安全 */
  release: () => void;
  level?: number;
  /** 最长占用时间（毫秒），到点按中止处理；默认 PACK_MAX_MS */
  maxMs?: number;
};

/**
 * 把一组对象存储里的文件按原路径打成 zip，以 Web 流返回。
 *
 * 逐个文件处理：前一个压完才打开下一个，且压缩流的输出没被读走时 archiver 不再从输入读，
 * 所以内存里只有当前文件的在途数据，不会把整个文件读成 Buffer。
 * 中止（signal、读端取消）与出错都会销毁当前输入流、停掉 archiver，并调用 release。
 */
export function createZipStream(opts: ZipStreamOptions): ReadableStream<Uint8Array> {
  const archive = new ZipArchive({ zlib: { level: opts.level ?? PACK_ZLIB_LEVEL } });
  let current: Readable | null = null;
  let stopped = false;
  let done = 0;
  let waiter: { target: number; resolve: () => void } | null = null;

  // 输出的 Web 流：archiver 用的是 readable-stream 包，Node 自带的 Readable.toWeb 在读端取消后
  // 仍会往已关闭的控制器里塞数据而抛未捕获异常，所以自己接管 data / end / 背压
  let web: ReadableStreamDefaultController<Uint8Array> | null = null;
  let webSettled = false;
  const settleWeb = (err?: Error) => {
    if (webSettled) return;
    webSettled = true;
    try {
      if (err) web?.error(err);
      else web?.close();
    } catch {
      /* 读端已取消 */
    }
  };

  let deadline: ReturnType<typeof setTimeout> | null = null;
  const stop = (err?: Error) => {
    if (stopped) return;
    stopped = true;
    if (deadline) clearTimeout(deadline);
    settleWeb(err ?? new Error("zip stream aborted"));
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.resolve();
    }
    current?.destroy();
    current = null;
    try {
      archive.abort();
    } catch {
      /* 已结束的 archiver 再 abort 无影响 */
    }
    if (!archive.destroyed) archive.destroy(err);
    opts.release();
  };

  archive.on("entry", () => {
    done += 1;
    if (waiter && done >= waiter.target) {
      const w = waiter;
      waiter = null;
      w.resolve();
    }
  });
  archive.on("error", (e: Error) => stop(e));
  archive.on("end", () => settleWeb());
  // close 是 Transform 的最后一个事件：正常结束、出错、读端取消都会到这里
  archive.once("close", () => stop());

  deadline = setTimeout(() => stop(new Error("pack deadline exceeded")), opts.maxMs ?? PACK_MAX_MS);
  deadline.unref?.();

  if (opts.signal) {
    if (opts.signal.aborted) stop();
    else opts.signal.addEventListener("abort", () => stop(), { once: true });
  }

  void (async () => {
    try {
      let target = 0;
      for (const x of opts.extras) {
        archive.append(Buffer.from(x.content, "utf8"), { name: x.name });
        target += 1;
      }
      for (const e of opts.entries) {
        if (stopped) return;
        const stream = await opts.open(e.s3Key);
        if (stopped) {
          stream.destroy();
          return;
        }
        current = stream;
        target += 1;
        const finished = new Promise<void>((resolve, reject) => {
          waiter = { target, resolve };
          stream.once("error", reject);
        });
        archive.append(stream, { name: e.path });
        await finished;
        current = null;
      }
      if (!stopped) await archive.finalize();
    } catch (err) {
      stop(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        web = controller;
        archive.on("data", (chunk: Buffer) => {
          if (webSettled) return;
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
          // 读端跟不上时停住 archiver，它就不再从对象存储读
          if ((controller.desiredSize ?? 0) <= 0) archive.pause();
        });
      },
      pull() {
        archive.resume();
      },
      cancel() {
        webSettled = true;
        stop();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 }),
  );
}

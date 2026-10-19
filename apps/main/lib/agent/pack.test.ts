import { randomBytes } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseAndValidateZip } from "../../../../packages/core/src/zip-utils";
import { createZipStream, PackSlots, type PackEntry } from "./pack";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** 假对象存储：记录每个对象何时被打开、是否被销毁。 */
function fakeStore(contents: Record<string, Buffer | (() => Readable)>) {
  const log = { opened: [] as string[], destroyed: [] as string[], live: 0, maxLive: 0 };
  const open = async (key: string): Promise<Readable> => {
    log.opened.push(key);
    const src = contents[key];
    if (src === undefined) throw new Error(`no object ${key}`);
    const stream = typeof src === "function" ? src() : Readable.from([src]);
    log.live += 1;
    log.maxLive = Math.max(log.maxLive, log.live);
    stream.once("close", () => {
      log.live -= 1;
      if (stream.destroyed && !stream.readableEnded) log.destroyed.push(key);
    });
    return stream;
  };
  return { log, open };
}

const entry = (path: string, s3Key = `s3/${path}`): PackEntry => ({ path, s3Key });

describe("PackSlots", () => {
  it("满了拿不到，释放后可再拿；release 重复调用只算一次", () => {
    const slots = new PackSlots(2);
    const a = slots.tryAcquire()!;
    const b = slots.tryAcquire()!;
    expect(slots.tryAcquire()).toBeNull();
    expect(slots.active).toBe(2);
    a();
    a();
    expect(slots.active).toBe(1);
    expect(slots.tryAcquire()).not.toBeNull();
    b();
  });
});

describe("createZipStream", () => {
  it("按原路径打成 zip，说明文件在内，内容与源一致（含中文路径）", async () => {
    const store = fakeStore({
      "s3/blocks/a.html": Buffer.from("<p>a</p>"),
      "s3/docs/需求.md": Buffer.from("# 需求"),
    });
    let released = 0;
    const zip = await collect(
      createZipStream({
        entries: [entry("blocks/a.html"), entry("docs/需求.md")],
        extras: [{ name: "PRD-VERSION.md", content: "# 版本" }],
        open: store.open,
        release: () => void (released += 1),
      }),
    );
    const parsed = await parseAndValidateZip(zip);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const byPath = Object.fromEntries(parsed.result.files.map((x) => [x.relPath, x.buffer.toString()]));
    expect(byPath).toEqual({ "PRD-VERSION.md": "# 版本", "blocks/a.html": "<p>a</p>", "docs/需求.md": "# 需求" });
    expect(released).toBeGreaterThanOrEqual(1);
    expect(store.log.maxLive).toBe(1);
  });

  it("逐个读取：任一时刻最多一个对象流在途", async () => {
    const contents: Record<string, Buffer> = {};
    const entries: PackEntry[] = [];
    for (let i = 0; i < 8; i++) {
      contents[`s3/f${i}`] = Buffer.alloc(50_000, i);
      entries.push(entry(`f${i}`));
    }
    const store = fakeStore(contents);
    await collect(createZipStream({ entries, extras: [], open: store.open, release: () => {} }));
    expect(store.log.opened).toHaveLength(8);
    expect(store.log.maxLive).toBe(1);
  });

  it("读端不取数据时不会把后面的对象全部打开（背压）", async () => {
    // 不可压缩的数据：输出体积才会随输入增长，背压才会生效
    const chunk = randomBytes(65_536);
    const big = () => Readable.from((function* () { for (let i = 0; i < 64; i++) yield chunk; })());
    const contents: Record<string, () => Readable> = {};
    const entries: PackEntry[] = [];
    for (let i = 0; i < 30; i++) {
      contents[`s3/f${i}`] = big;
      entries.push(entry(`f${i}`));
    }
    const store = fakeStore(contents);
    const stream = createZipStream({ entries, extras: [], open: store.open, release: () => {} });
    await tick(300);
    expect(store.log.opened.length).toBeLessThan(5);
    await stream.cancel();
  });

  it("请求中止（signal）：销毁当前对象流、不再打开后面的、释放名额", async () => {
    const ctrl = new AbortController();
    // 第一个对象永远给不完，模拟慢连接
    const hang = () => {
      const p = new PassThrough();
      p.write(Buffer.alloc(1024, 1));
      return p;
    };
    const store = fakeStore({ "s3/a": hang, "s3/b": Buffer.from("b"), "s3/c": Buffer.from("c") });
    const slots = new PackSlots(2);
    const release = slots.tryAcquire()!;
    const stream = createZipStream({
      entries: [entry("a"), entry("b"), entry("c")],
      extras: [],
      open: store.open,
      signal: ctrl.signal,
      release,
    });
    const reader = stream.getReader();
    void reader.read().catch(() => {});
    await tick(100);
    expect(store.log.opened).toEqual(["s3/a"]);
    expect(slots.active).toBe(1);
    ctrl.abort();
    await tick(100);
    expect(store.log.destroyed).toEqual(["s3/a"]);
    expect(store.log.opened).toEqual(["s3/a"]);
    expect(slots.active).toBe(0);
    await reader.cancel().catch(() => {});
  });

  it("读端取消（连接断开）：停读、释放名额", async () => {
    const hang = () => {
      const p = new PassThrough();
      p.write(Buffer.alloc(1024, 1));
      return p;
    };
    const store = fakeStore({ "s3/a": hang, "s3/b": Buffer.from("b") });
    const slots = new PackSlots(1);
    const stream = createZipStream({
      entries: [entry("a"), entry("b")],
      extras: [],
      open: store.open,
      release: slots.tryAcquire()!,
    });
    const reader = stream.getReader();
    void reader.read().catch(() => {});
    await tick(100);
    expect(slots.active).toBe(1);
    await reader.cancel();
    await tick(100);
    expect(slots.active).toBe(0);
    expect(store.log.destroyed).toEqual(["s3/a"]);
    expect(store.log.opened).toEqual(["s3/a"]);
  });

  it("超过最长占用时间：按中止处理，销毁当前对象流、释放名额（慢读端不能一直占着名额）", async () => {
    const hang = () => {
      const p = new PassThrough();
      p.write(Buffer.alloc(1024, 1));
      return p;
    };
    const store = fakeStore({ "s3/a": hang, "s3/b": Buffer.from("b") });
    const slots = new PackSlots(1);
    const stream = createZipStream({
      entries: [entry("a"), entry("b")],
      extras: [],
      open: store.open,
      release: slots.tryAcquire()!,
      maxMs: 150,
    });
    const reader = stream.getReader();
    void reader.read().catch(() => {});
    await tick(60);
    expect(slots.active).toBe(1);
    await tick(250);
    expect(slots.active).toBe(0);
    expect(store.log.destroyed).toEqual(["s3/a"]);
    expect(store.log.opened).toEqual(["s3/a"]);
    await reader.cancel().catch(() => {});
  });

  it("开始前就已中止：一个对象都不打开，名额立即归还", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const store = fakeStore({ "s3/a": Buffer.from("a") });
    const slots = new PackSlots(1);
    const stream = createZipStream({
      entries: [entry("a")],
      extras: [],
      open: store.open,
      signal: ctrl.signal,
      release: slots.tryAcquire()!,
    });
    await tick(50);
    expect(store.log.opened).toEqual([]);
    expect(slots.active).toBe(0);
    await stream.cancel().catch(() => {});
  });

  it("对象存储读失败：输出流报错、名额归还、不再继续打开后面的", async () => {
    const store = fakeStore({ "s3/b": Buffer.from("b") });
    const slots = new PackSlots(1);
    const stream = createZipStream({
      entries: [entry("a"), entry("b")],
      extras: [],
      open: store.open,
      release: slots.tryAcquire()!,
    });
    await expect(collect(stream)).rejects.toThrow();
    await tick(50);
    expect(slots.active).toBe(0);
    expect(store.log.opened).toEqual(["s3/a"]);
  });

  it("对象流中途出错：输出流报错、名额归还", async () => {
    const broken = () =>
      new Readable({
        read() {
          this.push(Buffer.from("x"));
          this.destroy(new Error("boom"));
        },
      });
    const store = fakeStore({ "s3/a": broken, "s3/b": Buffer.from("b") });
    const slots = new PackSlots(1);
    const stream = createZipStream({
      entries: [entry("a"), entry("b")],
      extras: [],
      open: store.open,
      release: slots.tryAcquire()!,
    });
    await expect(collect(stream)).rejects.toThrow();
    await tick(50);
    expect(slots.active).toBe(0);
    expect(store.log.opened).toEqual(["s3/a"]);
  });
});

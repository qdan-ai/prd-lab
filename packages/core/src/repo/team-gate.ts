import { TeamError } from "./team-errors";

/**
 * 进程内的并发名额：同时处理的数量满了就拒绝新来的，并告诉对方几秒后重试。
 * 名额按进程计，不跨进程。
 */
export class ConcurrencyGate {
  private active = 0;

  constructor(
    public limit: number,
    readonly retryAfterSeconds: number,
  ) {}

  /** 占一个名额，返回释放函数（可重复调用，只释放一次）；名额满了返回 null。 */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }

  /** 占一个名额；满了抛 `rate_limited`（带 `Retry-After`）。 */
  acquireOrThrow(): () => void {
    const release = this.tryAcquire();
    if (release) return release;
    throw new TeamError(
      "rate_limited",
      "rate_limited",
      { retryAfterSeconds: this.retryAfterSeconds },
      { "Retry-After": String(this.retryAfterSeconds) },
    );
  }

  get inFlight(): number {
    return this.active;
  }
}

/** 整站同时处理的开启批次（接口 17）、同时进行的指纹下载（接口 6）。 */
export const teamGates = {
  initBatches: new ConcurrencyGate(4, 30),
  downloads: new ConcurrencyGate(64, 5),
};

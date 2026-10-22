/**
 * 移除成员确认框的正文：一句话说清对方会被停掉什么（拉取与提交、待审的请求、本机还没进主线的改动），再说保留什么。
 * `pending` 是对方最近一次进度里本机还没进主线的项数；不知道时为 null。
 */
export function removeConfirmText(name: string, pending: number | null): string {
  const local =
    pending === null ? "，本机还没进主线的改动也进不了主线" : pending > 0 ? `，本机还没进主线的 ${pending} 项改动也进不了主线` : "";
  return `${name} 将不能再拉取和提交这个项目，待审的请求会撤回${local}；已合入的内容、提交过的请求和讨论都会保留。`;
}

/** 进度摘要里本地改动那一句（与 G-canvas 成员页签同一说法） */
export function pendingText(total: number): string {
  return total === 0 ? "本地的改动都已进主线" : `本地 ${total} 项还没进主线`;
}

/**
 * 移除成员确认框的正文：一句话说清对方会被停掉什么（拉取与提交、待审的请求、本机没提交的改动），再说保留什么。
 * `unsubmitted` 是对方最近一次进度里本机还没提交的项数；不知道时为 null。
 */
export function removeConfirmText(name: string, unsubmitted: number | null): string {
  const local =
    unsubmitted === null ? "，本机还没提交的改动也进不了团队" : unsubmitted > 0 ? `，本机还没提交的 ${unsubmitted} 项改动也进不了团队` : "";
  return `${name} 将不能再拉取和提交这个项目，待审的请求会撤回${local}；已合入的内容、提交过的请求和讨论都会保留。`;
}

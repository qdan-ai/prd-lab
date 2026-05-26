// cac@6.7.14 不支持多词命令名（"list projects" / "project create <name>" 等），
// 其 isMatched 只拿 argv[2] 一个 token 比对完整 name，导致 namespaced 子命令静默不触发。
// 解决：parse 前若前两个非 flag token 拼起来命中已注册的多词命令名，就合并成单 token。
//
// 这里只做"2 词"合并；目前所有 namespaced 命令均是 2 token（list/project/version/snapshot/share/auth）。
// 新加 3 token 命名时再扩。
export function collapseNamespacedArgs(argv: string[], commandNames: string[]): string[] {
  if (argv.length < 4) return argv;
  const a = argv[2];
  const b = argv[3];
  if (!a || !b || a.startsWith("-") || b.startsWith("-")) return argv;
  const merged = `${a} ${b}`;
  if (commandNames.includes(merged)) {
    return [...argv.slice(0, 2), merged, ...argv.slice(4)];
  }
  return argv;
}

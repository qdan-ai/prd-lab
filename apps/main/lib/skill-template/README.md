# PRD-Lab Publish Skill

让 Claude Code 帮你一句话把当前 demo 发到 PRD-Lab，并把分享链接给你（默认无密码，可选加密码）。

## 安装

### 1. 装 prd-cli（如未装）

PRD-Lab CLI 没发布到 npm，从源码构建：

```bash
cd path/to/PRD-Lab
pnpm install                                  # 首次必要
pnpm --filter @prd-lab/prd-cli build
sudo ln -sf "$(pwd)/packages/prd-cli/dist/cli.js" /usr/local/bin/prd

# 授权（浏览器跳本站点 [授权]）
prd login

# 自检
prd doctor
```

详细教程见 PRD-Lab 主站 → 用户菜单 → "接入 AI 工具" 页面。

### 2. 解压本 zip 到 Claude Code 的 skills 目录

```bash
unzip -o prd-publish-skill.zip -d ~/.claude/skills/
```

`-o` 强制覆盖（更新 Skill 时不用手动按 `A` 确认覆盖）。

解压后目录结构：

```
~/.claude/skills/prd-publish/
├── SKILL.md       # 主指令书（Claude 加载用）
├── README.md      # 本文件
├── examples.md    # 7 个对话样例
└── version.txt    # 当前 Skill 版本
```

### 3. 完全退出并重启 Claude Code

**首次新建 `~/.claude/skills/` 目录必须杀进程重启**——Claude Code 的 skill watch mode 才会启动。之后改 skill 文件无需重启，会自动 reload。

### 4. 验证装好没

重启后开一条新对话，输入：

```
/prd-publish
```

如果 skill 能被手动调起就说明装好了。

## 使用

在 Claude Code 里直接说自然语言：

| 你说 | Claude 自动跑 |
|---|---|
| "把这个 demo 推到 PRD-Lab" | 列项目让你选 → 上传 → 生成无密码分享链接（需要可加密码） |
| "上次那个项目改了什么" | 列方案的版本时间轴 + 改动说明 |
| "建一个 PRD-Lab 项目叫 X" | 直接跑 `prd project create` |
| "把试验场项目归档" | 二次确认后 archive |

更多对话样例见 `examples.md`。

## 更新

主站有新版 Skill 时，重下 zip 跑同一条 `unzip -o ...` 命令即可覆盖（**无需重启 Claude Code**，skill watch mode 会自动 reload）。版本号在 `version.txt`。

## 已知限制

- 仅支持 Claude Code（Cursor / Cline 不支持 Skill，但可以让 AI 直接用 bash 调 `prd` 命令，效果差不多）
- 分享链接默认无密码，任何拿到链接的人都能查看；需要保护时让 AI 加 `--random`（6 位数字密码）或 `--password "<自定义>"`（6-200 字符）

## 反馈

通过 PRD-Lab 主站联系管理员。

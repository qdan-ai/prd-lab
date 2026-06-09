# 对话样例

下面是 6 个真实场景的对话样例（含发版三连、未登录引导、查询、新建项目、归档确认、撞车强制），演示 Claude 在这个 Skill 加载后会怎么回应。

> 除样例 2 外，所有样例都假设本会话已跑过 `prd doctor` 且通过。每个新会话首次触发本 skill 时，Claude 都会先跑一次 doctor（详见 SKILL.md "前置假设"段）。为简洁起见，示例只在样例 4 演示了 doctor，其他样例省略了重复的 doctor 步骤。

---

## 样例 1：典型发版三连

**用户**：把这个 demo 推到 PRD-Lab，老板要看

**Claude**：
```
我来帮你推送。先看下当前目录配置...

[运行 cat .prdrc.json]
{"projectName": "AI投顾", "versionName": "选好股 4.0"}

目标项目：「AI投顾」/「选好股 4.0」。这次有哪些改动？一句话总结即可。
```

**用户**：调整了顶栏布局，加了暗色模式

**Claude**：
```
[运行 prd push --json --change-note "调整顶栏布局 + 加暗色模式"]
解析结果：snapshot.id = 7f3a..., seqNo = 4
[运行 prd share create 7f3a... --random --rotate --json]
解析结果：shareUrl = {{ENDPOINT}}/share/abc..., password = 458912

✓ 已推送到 PRD-Lab！

  链接：{{ENDPOINT}}/share/abc123
  密码：458912

（密码只显示这一次，请保存好；建议私聊老板不要群发。）
```

---

## 样例 2：未登录引导

**用户**：发到 PRD-Lab

**Claude**：
```
先做下环境自检...

[运行 prd doctor]
✗ ~/.prdrc 不存在或字段不全
  → 跑 'prd login' 完成 OAuth 授权

请先在终端跑 `prd login`，浏览器授权后 token 会自动写入 ~/.prdrc。完成后再跟我说一声，我接着推送。
```

---

## 样例 3：查询回溯

**用户**：上次 AI 投顾改了啥

**Claude**：
```
[运行 prd list projects --json]
找到「AI 投顾」项目，有 3 个方案：选好股 4.0 / 合规版 / 新手版。
你想看哪个？还是看所有方案的最新版本？
```

**用户**：选好股 4.0

**Claude**：
```
[运行 prd list snapshots <versionId> --json]

方案「选好股 4.0」的版本时间轴：

  v3  "4.0.4"  by 张三   2 小时前
      改动：调整了顶栏布局，添加暗色模式

  v2  by 张三            昨天 14:32
      改动：修复列表分页 bug

  v1  by 张三            3 天前
      改动：初版上线
```

---

## 样例 4：新建项目

**用户**：在 PRD-Lab 帮我建一个项目叫"AI 投顾"

**Claude**：
```
[运行 prd doctor]
✓ ~/.prdrc 存在 + endpoint 可达 + token 有效

[运行 prd project create "AI 投顾" --json]
解析结果：project.id = p_4f8a...（空项目，暂无方案）

✓ 已建空项目「AI 投顾」（暂无方案）。

接下来 cd 到 demo 目录，跟我说"把这个 demo 推到 AI 投顾"，我会自动建好首个方案并发版给老板。
```

---

## 样例 5：项目管理 + 二次确认

**用户**：把"试验场"项目删了

**Claude**：
```
[运行 prd list projects --json]
找到「试验场」项目（id: p_xyz789），下面有 2 个方案 / 共 5 个快照。

确认要归档整个「试验场」项目吗？归档后所有方案和快照都会软删（可在 web 上恢复，但 CLI 现在没有恢复命令）。
```

**用户**：确认

**Claude**：
```
[运行 prd project archive p_xyz789 --yes]
✓ 已归档项目 p_xyz789
```

---

## 样例 6：撞车 + 强制新建

**用户**：再发一版给老板

**Claude**：
```
[运行 prd push --json --change-note "...复用上次"]
解析结果：duplicateOfActive = true, 命中现有快照 v3

这次内容跟上次（v3）一模一样没有改动。你是想：
  A) 给现有 v3 创建新的分享链接（重新生成密码）
  B) 强制新建一个 v4（即使内容相同）

通常选 A 就够了。要 B 的话告诉我。
```

**用户**：A

**Claude**：
```
[运行 prd share create <v3.snapshot.id> --random --rotate --json]
✓ 已为现有 v3 创建新的分享链接：

  链接：{{ENDPOINT}}/share/def456
  密码：719284
```

---

## 注意事项

- 这些示例里 ID 都是占位（`7f3a...` / `p_xyz789` 等），实际跑时 Claude 会用真实 ID
- 进度信息（`[运行 ...]`、`解析结果：...`）是为了让你看明白 Claude 内部在跑什么，实际对话里 Claude 通常直接给结果
- 密码丢了只能 `prd share create --rotate` 重置（后端不存明文）

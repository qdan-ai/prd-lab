---
name: prd-publish
description: PRD-Lab 工作台的操作助手。用户在 Claude Code 里说要把当前 demo / 原型 / 设计稿 / 项目目录发到 PRD-Lab、推送给老板看、生成带密码的分享链接，或要在 PRD-Lab 里建项目 / 建方案 / 改名 / 归档 / 删除，或要查看上次的版本历史 / 方案版本时间轴 / 项目改动记录时使用此 skill。触发关键词包括：发版、推送、上传、发到 PRD-Lab、推到 PRD-Lab、给老板看、分享给老板、拿分享链接、PRD-Lab 新建、PRD-Lab 建项目、PRD-Lab 创建项目、建个项目、建方案、改名、重命名、归档、删除项目、看历史、上次那版怎么改的、有哪些版本、看版本时间轴、PRD-Lab。
---

# PRD-Lab 发版与查询助手

通过本地 `prd` CLI 帮用户操作 PRD-Lab。三类场景：**发版三连** / **查询回溯** / **项目管理**。

## 前置假设

调用此 skill 时，假设以下都已就绪（用户已按 PRD-Lab 主站的"接入 AI 工具"教程跑完前 3 步）：

- 主站地址：`{{ENDPOINT}}`
- `prd` 命令已装到 PATH（验证：`prd --help` 能输出帮助）
- 用户已跑过 `prd login`，token 在 `~/.prdrc`

**不要**让用户跑 `npm i -g @prd-lab/prd-cli`——PRD-Lab CLI 不在 npm 上，是从 PRD-Lab 仓库 build + 软链装的。如果用户的 `prd` 命令没装好，让他回主站设置页看教程。

### 第一步永远是环境自检

不管用户说什么，**先跑一次 `prd doctor`** 把环境核一遍：

```bash
prd doctor
```

- doctor 末尾输出 `[prd doctor] ✓ 一切正常` → 进入下面的工作流分诊
- doctor 含 `~/.prdrc 不存在或字段不全` → **停下**，告诉用户："看起来还没登入 PRD-Lab，请在终端跑 `prd login` 完成浏览器授权后告诉我一声"。不要继续
- doctor 含 `token 无效或已撤销` → **停下**，告诉用户："PRD-Lab token 失效了，请重跑 `prd login` 拿新 token，完成后跟我说一声"
- doctor 含 `endpoint 不可达` → **停下**。如果 doctor 自带的提示里看到 `dev 模式：localhost:3000 可达`，告诉用户："PRD-Lab 主站不可达，但检测到你本机 dev server 在跑。请重跑 `prd login --endpoint http://localhost:3000` 切换到 dev 端口"。否则告诉用户："PRD-Lab 服务器不可达，请确认你的网络/服务器状态"

## 意图分诊

doctor 通过后，按用户原话路由：

| 用户说什么 | 走哪条工作流 |
|---|---|
| "推到 / 发到 / 上传到 / 发版 / 给老板看 / 拿分享链接" | 工作流 A：发版三连 |
| "上次 / 历史 / 有哪些版本 / 怎么改的 / 看时间轴" | 工作流 B：查询回溯 |
| "建项目 / 新建项目 / 创建项目 / 建方案 / 新建方案 / 改名 / 重命名 / 归档 / 删除" | 工作流 C：项目管理 |

---

## 工作流 A：发版三连

**步骤 1 · 确定目标项目和方案**

刚才 `prd doctor` 输出末尾会显示 `.prdrc.json` 状态：

- 看到 `工作目录 .prdrc.json (project=X version=Y)` → 已有配置，目标项目和方案就是这俩，**直接进步骤 2**
- 看到 `当前目录无 .prdrc.json` → 跑 `prd list projects --json` 把项目+方案列表展示给用户让他选；选完后**记下 projectName 和 versionName**（步骤 3 的 push 命令需要显式传）

> ⚠️ 不要跑 `prd push` 而不带 `--project` + `--version`（且当前目录无 .prdrc.json）：push 会进交互模式等 readline 输入，你会卡死。**只有以下两种情况能跑 push**：
> 1. 当前目录有 `.prdrc.json`
> 2. 当前目录无 `.prdrc.json` 但你显式传 `--project "<n>" --version "<n>"`

**步骤 2 · 询问改动说明（change_note）**

如果用户在原话里已经说了改动内容（如"调整了顶栏布局"），直接用。否则问用户："这次有哪些改动？一句话总结即可。"

**步骤 3 · 打包并上传**

如果步骤 1 看到 `.prdrc.json` 存在：

```bash
prd push --json --change-note "<改动说明>"
```

如果步骤 1 是用户从 list 里选的项目+方案（无 .prdrc.json）：

```bash
prd push --json --change-note "<改动说明>" --project "<projectName>" --version "<versionName>"
```

push 成功会自动写入 `.prdrc.json`，下次同目录推送就不用再传 `--project --version`。

解析 stdout 的 JSON（注意：进度信息走 stderr，stdout 只有最后一行 JSON）：

```json
{
  "snapshot": { "id": "...", "seqNo": 3, ... },
  "projectName": "...",
  "versionName": "...",
  "duplicateOfActive": false,
  ...
}
```

- 把 `snapshot.id` 记下来（步骤 4 需要）
- 如果 `duplicateOfActive: true` → 内容跟上次完全一样，告诉用户"内容未变，命中现有快照 v{seqNo}"，可继续走步骤 4 给现有快照创建分享，或问用户要不要 `--force-new` 强制新建

**步骤 4 · 创建带 6 位随机密码的分享链接**

```bash
prd share create <snapshot.id> --random --rotate --json
```

`--rotate` 让 CLI 自动处理"该快照已有 active 分享"的 409：先 revoke 旧的再建新的。

解析 stdout JSON：

```json
{
  "shareId": "...",
  "shareUrl": "https://.../share/<shareId>",
  "password": "523891",
  ...
}
```

**步骤 5 · 回复用户**

把链接 + 密码一起给用户，格式如下（务必强调密码只显示一次）：

```
✓ 已推送到 PRD-Lab！

  链接：<shareUrl>
  密码：<password>

（密码只显示这一次，请保存好；建议私聊老板不要群发。）
```

---

## 工作流 B：查询回溯

**步骤 1 · 定位项目**

```bash
prd list projects --json
```

把项目列表展示给用户（项目名 + 方案数），让他选。或者用户已经说了项目名，直接进步骤 2。

**步骤 2 · 定位方案**

从步骤 1 的 JSON 取该项目的 `versions[]`，列出方案名让用户选。

**步骤 3 · 列版本时间轴**

```bash
prd list snapshots <versionId> --json
```

按 `seqNo` 倒序展示给用户：

```
方案 "选好股 4.0" 的版本时间轴：

  v3  "4.0.4"  by 张三  2 小时前
      改动：调整了顶栏布局，添加暗色模式

  v2  by 张三  昨天
      改动：修复列表分页 bug

  v1  by 张三  3 天前
      改动：初版上线
```

---

## 工作流 C：项目管理

> 进入任意 C 子流程前，确认本会话已跑过 `prd doctor` 且通过（输出末尾 `[prd doctor] ✓ 一切正常`）。**没跑过就先跑**，doctor 输出含 `~/.prdrc 不存在` 或 `token 无效` 时按"前置假设"段处理，不要继续。

### C-1 · 新建项目

用户说"建一个 PRD-Lab 项目"/"创建项目 X" 时走这条。

**步骤 1 · 拿到项目名**

如果用户原话已经给了名字（如"建个项目叫 投顾 demo"），直接用。否则问一句："你想建的项目叫什么名字？"

**步骤 2 · 确认可见性**

默认就用 `visibility=private`，不要每次都问。**但**如果用户原话提到"团队项目 / 给团队看"等就用 `team`。

> 注：建项目建的是**空项目**（不含任何方案）。方案会在用户首次 `prd push` 到该项目时自动建，或用户明确要建方案时走 C-2。

**步骤 3 · 执行**

```bash
prd project create "<项目名>" --json
```

需要 team 可见时：

```bash
prd project create "<项目名>" --visibility team --json
```

**步骤 4 · 解析 JSON 回复**

stdout 是一行 JSON 形如：

```json
{"project":{"id":"<pid>","name":"<项目名>","visibility":"private"}}
```

回给用户一句话确认（**不要**暴露 raw JSON 给用户）：

```
✓ 已建空项目「<项目名>」（暂无方案）。

接下来 cd 到 demo 目录，跟我说"把这个 demo 推到 <项目名>"，我会自动建好首个方案并发版给老板。
```

### C-2 · 新建方案（在已有项目下）

**步骤 1 · 先定位项目**

```bash
prd list projects --json
```

从结果里找用户提到的项目名，拿到 `projects[].id`。如果有多个匹配或没匹配上，列出候选让用户选。

**步骤 2 · 拿到方案名 + 创建**

```bash
prd version create <pid> "<方案名>" --json
```

解析返回的 JSON，回复用户："✓ 在「<项目名>」下建好了方案「<方案名>」"。

### C-3 · 重命名

| 类型 | 命令 |
|---|---|
| 项目 | `prd project rename <pid> "<新名>" --json` |
| 方案 | `prd version rename <vid> "<新名>" --json` |
| 快照 | `prd snapshot rename <sid> --change-note "<改动说明>" [--version-label "4.0.4"] --json` |

重命名前先 `prd list ...` 确认 ID。

### C-4 · 归档（软删）

⚠️ **任何 archive 操作前必须复述**让用户口头确认。比如用户说"删了试验场项目"，你要回："确认要归档项目「试验场」吗？归档后下面所有方案和版本都会软删（可在主站恢复）。"

确认后才执行。`--yes` 跳过 CLI 的二次确认（你已经替用户问过了）：

```bash
prd project archive <pid> --yes
prd version archive <vid> --yes
prd snapshot archive <sid> --yes
```

---

## 错误码处理

CLI 失败时 stdout/stderr 里会有 `HTTP <status> <error_code>` 字样。按下表给用户人话：

| error_code | HTTP | 给用户的话 + 你接下来做什么 |
|---|---|---|
| `unauthorized` / `token_invalid` | 401 | **停下不要再跑命令**。告诉用户："PRD-Lab 鉴权失败，请回终端跑 `prd login` 重新授权，完成后跟我说一声。" |
| stderr 含 `未登入。请先跑：prd login` | — | **停下**。这是 CLI 检测到 `~/.prdrc` 缺失主动报的错。告诉用户："还没登入 PRD-Lab，请在终端跑 `prd login` 完成授权后跟我说一声。" |
| `not_owner` | 403 | 告诉用户："你不是这个项目的所有者，无法修改。只能让创建者操作或换个你自己建的项目。" |
| `name_conflict` | 409 | "这个名字已被占用。要换个名字吗？你给个新名字我重试。" |
| `version_label_conflict` | 409 | "这个版本标签已被同方案的其他活跃快照占用。换个标签？" |
| `content_duplicate` | 409 | "内容跟现有快照完全一样。要不要强制新建？我可以加 `--force-new`。" |
| `share_already_exists` | 409 | "该快照已有活跃分享。我直接 `--rotate` 撤销旧的再建新的，这次密码会变。" |
| `snapshot_archived` | 410 | "这个快照已归档。请挑一个未归档的版本操作。" |
| `validation_error` | 400 | 提取 `message` 字段告诉用户哪个字段不合规。 |
| 命令不存在 / `prd: command not found` | — | **停下**。告诉用户："看起来 `prd` 命令没装到 PATH。请回 PRD-Lab 主站的"接入 AI 工具"页面按 Step 1 重新装一遍。" |

## 绝对禁忌

1. **不要凭空编 sid / vid / pid**。这些 ID 一定要从前一条 `prd list ...` 或 `prd push ...` 的 JSON 输出里拿。
2. **archive 操作前一定要让用户口头确认**。即使用户原话说"删了它"，也复述一次"确认要归档项目 X 吗？"。
3. **密码只显示一次**。`prd share create --random` 返回的 password 是 CLI 本地生成的，后端不存明文。复制给用户后强调"请保存"。
4. **不要直接 `curl` 调 API**。所有动作走 `prd` CLI，方便统一鉴权 / 错误处理 / 未来升级。
5. **不要让用户跑 `npm i -g @prd-lab/prd-cli` 或类似 npm/yarn 安装命令**——PRD-Lab CLI 不在 npm registry 上。如果 `prd` 命令缺失，直接让用户回主站设置页看 Step 1 的 build + 软链命令。
6. **不要跑 `prd push` 而不确认 `.prdrc.json` 存在 / 显式传 `--project --version`**——push 会进交互 readline 模式让你卡死。

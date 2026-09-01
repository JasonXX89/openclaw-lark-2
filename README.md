# openclaw-lark-2

**OpenClaw 2.0（2026.8.1+）专属的飞书 / Lark 渠道插件** — 基于 `@larksuite/openclaw-lark` 的独立维护分支。

> OpenClaw 2.0（2026.8.1）重构了插件 SDK（移除了裸 `openclaw/plugin-sdk` 导出、重命名了多个子路径、session 存储从 JSON 迁移到 SQLite），官方 `@larksuite/openclaw-lark` 未跟进，导致在 2.0 下无法加载、卡片 footer 指标消失。本插件针对 2.0 SDK 全面适配，开箱即用。

## 特性

- **OpenClaw 2.0 原生适配**：SDK 导入路径 / 类型 / 运行时 API 全部对齐 2026.8.1
- **飞书 / Lark 全量能力**：IM 消息（含 CardKit 流式卡片）、文档（doc/wiki/drive）、多维表格（bitable）、日历、任务、审批等
- **内置 `ask_user` 工具按钮渲染**：OpenClaw 通用 `ask_user` 问题在飞书上渲染为带选项按钮的交互卡片，点击即解析；支持"其他答案"输入框表单；群聊中所有成员均可交互（不再依赖消息发送者）
- **工具调用动态展示**：流式卡片内实时展示 agent 正在调用的工具步骤（web_search → "Search web"、exec → "Run command"、memory search 等），默认开启，可用 `channels.feishu.toolUseDisplay.enabled: false` 关闭
- **群聊流式卡片**：`channels.feishu.replyMode.group: "streaming"` 让群聊与私聊一样使用流式卡片（工具步骤 + ask_user 按钮）
- **完整 footer 指标**：状态 · 耗时 · model · **provider** · tokens · cache · context（7 项，provider 为本分支新增）
- **多账号**：一个 openclaw 实例同时接入多个飞书应用

## 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| **2026.9.1-3** | 2026-09-01 | 修复 ask_user "其他答案"提交（按钮 name 兜底，兼容 form_submit 剥离 value 的 SDK）；新增工具 dry-run 检查脚本 scripts/check-tools.js |
| **2026.9.1-2** | 2026-09-01 | 移除 `feishu_ask_user_question` 专用工具（统一用内置 `ask_user`）；ask_user 支持"其他答案"输入框、群聊全员可交互 |
| **2026.9.1-1** | 2026-09-01 | 内置 `ask_user` 工具按钮渲染（选项按钮卡片 + 回调解析）；群聊启用流式卡片 |
| **2026.9.1** | 2026-09-01 | OpenClaw 2.0 兼容修复、ClawHub 发布、正式安装流程 |
| **2026.8.1** | 2026-08-31 | 初始 2.0 适配分支 |

## 与官方版的差异

| 项 | 官方 `@larksuite/openclaw-lark` | 本插件 `@mirr0ch1/openclaw-lark-2` |
|---|---|---|
| OpenClaw 版本要求 | `>=2026.5.4` | **`>=2026.8.1`** |
| 2.0 加载 | ❌ 无法加载 | ✅ |
| footer 指标（2.0） | ❌ 读取已废弃的 `sessions.json` | ✅ 从 2.0 SQLite 读取 |
| footer provider 项 | ❌ 无 | ✅ 新增 |
| `import.meta` / CJS 构建 | ⚠️ Node 24 下加载失败 | ✅ `__dirname` 守卫 |

## 安装

### 通过 ClawHub

```bash
openclaw plugin install @mirr0ch1/openclaw-lark-2
```

### 通过 tarball（本机开发）

```bash
npm pack
openclaw plugins install openclaw-lark-2-2026.9.1-3.tgz
```

## 配置

插件注册 `feishu` 渠道，与官方版共用 `channels.feishu` 配置结构：

```json5
{
  channels: {
    feishu: {
      enabled: true,
      appId: "cli_xxx",
      appSecret: "xxx",
      // 多账号示例
      accounts: {
        plaud: { appId: "cli_yyy", appSecret: "yyy", dmPolicy: "pairing" },
      },
      // footer 七项全开（provider 为新增项）
      footer: {
        status: true,
        elapsed: true,
        model: true,
        provider: true,
        tokens: true,
        cache: true,
        context: true,
      },
    },
  },
  plugins: {
    allow: ["openclaw-lark-2"],
  },
}
```

> 提示：飞书应用需要在开放平台开通 `cardkit:card:write` 权限，流式卡片才能生效。

## 开发

```bash
pnpm install
pnpm typecheck   # 对 openclaw 2026.8.1 类型检查
pnpm lint
pnpm build       # tsdown → dist/index.mjs (ESM)
pnpm test
```

## 致谢 / 许可

基于 [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark)（MIT）二次开发。保留 MIT 许可。

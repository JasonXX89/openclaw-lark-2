# openclaw-lark-2

**OpenClaw 2.0（2026.8.1+）专属的飞书 / Lark 渠道插件** — 基于 `@larksuite/openclaw-lark` 的独立维护分支。

> OpenClaw 2.0（2026.8.1）重构了插件 SDK（移除了裸 `openclaw/plugin-sdk` 导出、重命名了多个子路径、session 存储从 JSON 迁移到 SQLite），官方 `@larksuite/openclaw-lark` 未跟进，导致在 2.0 下无法加载、卡片 footer 指标消失。本插件针对 2.0 SDK 全面适配，开箱即用。

## 特性

- **OpenClaw 2.0 原生适配**：SDK 导入路径 / 类型 / 运行时 API 全部对齐 2026.8.1
- **飞书 / Lark 全量能力**：IM 消息（含 CardKit 流式卡片）、文档（doc/wiki/drive）、多维表格（bitable）、日历、任务、审批等
- **AskUser 卡片交互**：`feishu_ask_user_question` 交互式提问
- **完整 footer 指标**：状态 · 耗时 · model · **provider** · tokens · cache · context（7 项，provider 为本分支新增）
- **多账号**：一个 openclaw 实例同时接入多个飞书应用

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
openclaw plugins install openclaw-lark-2-2026.9.1.tgz
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

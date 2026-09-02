# openclaw-lark-2

**OpenClaw 2.0（2026.8.1+）专属飞书 / Lark 渠道插件** · An OpenClaw 2.0 (2026.8.1+) Feishu / Lark channel plugin, adapted from `@larksuite/openclaw-lark`.

> **背景 / Background**
>
> OpenClaw 2.0（2026.8.1）重构了插件 SDK：移除了裸 `openclaw/plugin-sdk` 导出、重命名了多个子路径、session 存储从 JSON 迁移到 SQLite。上游 `@larksuite/openclaw-lark` 未跟进，导致在 2.0 下无法加载、卡片 footer 指标消失。本插件针对 2.0 SDK 全面适配，开箱即用。
>
> OpenClaw 2.0 (2026.8.1) reworked the plugin SDK: removed the bare `openclaw/plugin-sdk` export, renamed several subpaths, and migrated session storage from JSON to SQLite. The upstream `@larksuite/openclaw-lark` did not follow up, so it fails to load on 2.0 and loses card footer metrics. This plugin is fully adapted to the 2.0 SDK — plug and play.

---

## 特性 / Features

- **OpenClaw 2.0 原生适配**：SDK 导入路径 / 类型 / 运行时 API 全部对齐 2026.8.1 / Native 2.0 adaptation: SDK import paths, types, and runtime APIs aligned with 2026.8.1
- **飞书 / Lark 全量能力**：IM 消息（含 CardKit 流式卡片）、文档（doc/wiki/drive）、多维表格（bitable）、日历、任务、电子表格等 / Full Feishu/Lark capabilities: IM messages (incl. CardKit streaming cards), docs (doc/wiki/drive), bitable, calendar, tasks, sheets, and more
- **流式卡片体验优化**：打字机逐字打印（`streaming_config: print_frequency_ms 15 + print_strategy fast`），答案置顶、工具/思考面板收纳到底部，看回复不用往下翻 / Polished streaming cards: typewriter-style printing (`streaming_config: print_frequency_ms 15 + print_strategy fast`), answer on top with tool/reasoning panels collapsed at the bottom
- **内置 `ask_user` 工具按钮渲染**：通用 `ask_user` 问题渲染为带选项按钮的交互卡片，点击即解析；支持"其他答案"输入框表单；群聊中所有成员均可交互 / Built-in `ask_user` button rendering: generic `ask_user` questions become interactive cards with option buttons; supports an "Other answer" input form; every group member can interact
- **工具调用动态展示**：流式卡片内实时展示 agent 正在调用的工具步骤，默认开启（`channels.feishu.toolUseDisplay.enabled: false` 可关） / Live tool-activity display inside streaming cards, on by default (disable via `channels.feishu.toolUseDisplay.enabled: false`)
- **群聊流式卡片**：`channels.feishu.replyMode.group: "streaming"` 让群聊与私聊一样使用流式卡片 / Group streaming cards: `channels.feishu.replyMode.group: "streaming"` gives groups the same streaming-card experience as DMs
- **完整 footer 指标**：状态 · 耗时 · model · **provider** · tokens · cache · context（7 项）/ Full footer metrics: status · elapsed · model · **provider** · tokens · cache · context (7 items)
- **SSRF 防护**：所有出站 HTTP 请求统一走 SDK `fetchWithSsrFGuard`——DNS pinning 防 rebinding、IPv4+IPv6 私有/保留地址阻断、重定向逐跳校验、hostname 白名单 / SSRF protection: all outbound HTTP goes through the SDK `fetchWithSsrFGuard` — DNS pinning (anti-rebinding), IPv4+IPv6 private/reserved-address blocking, per-hop redirect validation, hostname allowlist
- **PIN 消息操作**：内置 message 工具新增 `pin` / `unpin` / `list-pins` / PIN message actions: `pin` / `unpin` / `list-pins` on the built-in message tool
- **测试基座**：vitest 最小测试套件（`npm test`） / Test base: a minimal vitest suite (`npm test`)
- **多账号**：一个 openclaw 实例同时接入多个飞书应用 / Multi-account: run multiple Feishu apps on a single OpenClaw instance

---

## 版本记录 / Changelog

| 版本 / Version | 日期 / Date | 说明 / Notes |
|---|---|---|
| **2026.9.4** | 2026-09-03 | 流式卡片布局重构：答案置顶、工具/推理面板收底部；打字机逐字打印 / Streaming card layout rework: answer on top, tool/reasoning panels at the bottom; typewriter printing |
| **2026.9.3** | 2026-09-02 | SSRF 防护全量落地、PIN 消息操作、vitest 测试基座（9 文件 78 用例）+ 全量安全测试通过 / Full SSRF protection, PIN message actions, vitest test base (9 files / 78 tests) + complete security testing passed |
| **2026.9.2** | 2026-09-01 | 修复 ask_user "其他答案"提交；移除 feishu_ask_user_question；群聊流式卡片；工具 dry-run 脚本 / Fix ask_user "Other" submit; remove feishu_ask_user_question; group streaming cards; tool dry-run script |
| **2026.9.1** | 2026-09-01 | OpenClaw 2.0 兼容修复、内置 ask_user 按钮渲染、工具动态展示、ClawHub 发布 / OpenClaw 2.0 compat fixes, built-in ask_user buttons, tool-activity display, ClawHub release |
| **2026.8.1** | 2026-08-31 | 初始 2.0 适配分支 / Initial 2.0 adaptation branch |

---

## 安装 / Installation

### 通过 tarball（本机开发）/ via tarball (local dev)

```bash
npm pack
openclaw plugins install openclaw-lark-2-2026.9.4.tgz
```

### 从源码 / from source

```bash
git clone https://github.com/JasonXX89/openclaw-lark.git
cd openclaw-lark
# 将整个目录同步（复制）到 OpenClaw 扩展目录，例如：
# cp -r . ~/.openclaw/extensions/openclaw-lark-2
# 然后重启 OpenClaw gateway 生效
```

---

## 配置 / Configuration

插件注册 `feishu` 渠道，沿用 `channels.feishu` 配置结构 / The plugin registers the `feishu` channel using the `channels.feishu` config shape:

```json5
{
  channels: {
    feishu: {
      enabled: true,
      appId: "cli_xxx",
      appSecret: "xxx",
      // 多账号示例 / multi-account example
      accounts: {
        plaud: { appId: "cli_yyy", appSecret: "yyy", dmPolicy: "pairing" },
      },
      // footer 七项全开 / all 7 footer metrics on
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

> 提示：飞书应用需在开放平台开通 `cardkit:card:write` 权限，流式卡片才能生效。
> Tip: the Feishu app needs the `cardkit:card:write` scope enabled in the Open Platform for streaming cards to work.

---

## 开发 / Development

```bash
npm install            # 安装依赖（含 vitest）/ install deps (incl. vitest)
npm test               # 运行 vitest 测试套件 / run the vitest test suite
npm run test:watch     # 测试监听模式 / watch mode
```

插件为 CommonJS 源码（`src/` + `index.js` 入口），无需构建步骤，改动后同步到 OpenClaw 扩展目录并重启网关即可生效。

The plugin is CommonJS source (`src/` + `index.js` entry) with no build step — sync to the OpenClaw extensions directory and restart the gateway to apply changes.

---

## 许可 — License

基于以下项目二次开发，均采用 MIT 许可：

- [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) — 飞书官方出品
- [Mirr0ch1/openclaw-lark-2](https://github.com/Mirr0ch1/openclaw-lark-2) — OpenClaw 2.0 适配版

MIT 许可及原版权声明保留。

Adapted from the following MIT-licensed projects:

- [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) — official Feishu/Lark plugin
- [Mirr0ch1/openclaw-lark-2](https://github.com/Mirr0ch1/openclaw-lark-2) — OpenClaw 2.0 adaptation

MIT licensed, original copyright notices retained.

# openclaw-lark-2

**OpenClaw 2.0（2026.8.1+）专属的飞书 / Lark 渠道插件** — 基于 `@larksuite/openclaw-lark` 的独立维护分支。

> OpenClaw 2.0（2026.8.1）重构了插件 SDK（移除了裸 `openclaw/plugin-sdk` 导出、重命名了多个子路径、session 存储从 JSON 迁移到 SQLite），官方 `@larksuite/openclaw-lark` 未跟进，导致在 2.0 下无法加载、卡片 footer 指标消失。本插件针对 2.0 SDK 全面适配，开箱即用。

## 特性

- **OpenClaw 2.0 原生适配**：SDK 导入路径 / 类型 / 运行时 API 全部对齐 2026.8.1
- **飞书 / Lark 全量能力**：IM 消息（含 CardKit 流式卡片）、文档（doc/wiki/drive）、多维表格（bitable）、日历、任务、多维表格、电子表格等
- **内置 `ask_user` 工具按钮渲染**：OpenClaw 通用 `ask_user` 问题在飞书上渲染为带选项按钮的交互卡片，点击即解析；支持"其他答案"输入框表单；群聊中所有成员均可交互（不再依赖消息发送者）
- **工具调用动态展示**：流式卡片内实时展示 agent 正在调用的工具步骤（web_search → "Search web"、exec → "Run command"、memory search 等），默认开启，可用 `channels.feishu.toolUseDisplay.enabled: false` 关闭
- **群聊流式卡片**：`channels.feishu.replyMode.group: "streaming"` 让群聊与私聊一样使用流式卡片（工具步骤 + ask_user 按钮）
- **完整 footer 指标**：状态 · 耗时 · model · **provider** · tokens · cache · context（7 项，provider 为本分支新增）
- **SSRF 防护**：所有出站 HTTP 请求（媒体/图片拉取、OAuth、MCP、裸 API 调用）统一走 OpenClaw SDK `fetchWithSsrFGuard`——DNS pinning 防 rebinding、IPv4+IPv6 私有/保留地址阻断、重定向逐跳校验、hostname 白名单门控
- **PIN 消息操作**：内置 message 工具新增 `pin` / `unpin` / `list-pins` 动作，置顶/取消置顶/列出群内置顶消息
- **测试基座**：vitest 最小测试套件（`npm test`），覆盖 config-schema、reply-mode、媒体 URL/路径安全、SSRF 防护、PIN 动作路由、ask_user 载荷安全
- **多账号**：一个 openclaw 实例同时接入多个飞书应用

## 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| **2026.9.3** | 2026-09-02 | SSRF 防护（全量出站请求走 SDK `fetchWithSsrFGuard`：DNS pinning、IPv4+IPv6 私网阻断、重定向逐跳校验、hostname 白名单）、PIN 消息操作（`pin`/`unpin`/`list-pins`）、vitest 测试基座（9 文件 78 用例，覆盖 SSRF/PIN/config/ask_user 载荷安全），并完成全量安全测试确认无攻击面 |
| **2026.9.2** | 2026-09-01 | 修复 ask_user "其他答案"提交（按钮 name 兜底，兼容 form_submit 剥离 value 的 SDK）；移除 feishu_ask_user_question；ask_user 群聊全员可交互；群聊流式卡片；工具 dry-run 脚本 |
| **2026.9.1** | 2026-09-01 | OpenClaw 2.0 兼容修复、内置 ask_user 按钮渲染、工具动态展示、ClawHub 发布 |
| **2026.8.1** | 2026-08-31 | 初始 2.0 适配分支 |

## 三方详细对比

本插件在设计上**取两家之长**：以字节 `@larksuite/openclaw-lark` 的完整工具面为基础，吸收官方 `@openclaw/feishu` 的 OpenClaw 2.0 原生架构与安全工程，再补齐两家的短板（ask_user 按钮、PIN、SSRF 全量防护、测试基座）。

| 维度 | **openclaw-lark-2（本插件）** | **@openclaw/feishu（官方 2.0）** | **@larksuite/openclaw-lark 7.16（字节）** |
|---|---|---|---|
| 版本 | **2026.9.3** | 2026.8.1 | 2026.7.16 |
| OpenClaw 兼容 | **>=2026.8.1（2.0 原生）** | >=2026.8.1（2.0 原生） | >=2026.5.4（1.x，2.0 下无法加载） |
| Plugin API | 2.0 SDK（`runtime.config.current()`） | 2.0 SDK（`createChatChannelPlugin`） | 1.x API（`loadConfig`，已废弃） |
| 契约工具数 | **38 个** | 14 个 | 39 个 |
| calendar / task / sheets | ✅ 全有 | ❌ 无 | ✅ 全有 |
| im 消息收发/搜索工具 | ✅ 6 个 | ❌（走 channel action） | ✅ 6 个 |
| 入站消息转换器 | **22 种** | 部分 | 22 种 |
| 流式回复（CardKit） | ✅（群聊/私聊均可） | ✅ | ✅（须开 `streaming:true`） |
| 群聊流式卡片 | ✅ `replyMode.group:"streaming"` | ✅ | ❌ 群聊默认 static |
| 工具动态展示 | ✅ **默认开启**（不依赖 verbose） | ⚠️ 仅 verbose/preview 开启时 | ⚠️ 依赖 verbose（默认 off） |
| 内置 `ask_user` 按钮 | ✅ **按钮卡片 + "其他答案"输入框 + 群聊全员可交互** | ❌ 无（仅文本回退 + 自定义 ocf1 按钮） | ❌ 用自家 feishu_ask_user_question 表单 |
| PIN 消息操作 | ✅ `pin` / `unpin` / `list-pins` | ✅ | ❌ |
| SSRF 防护 | ✅ **全量出站请求**走 SDK 守卫（DNS pinning + 私网阻断 + 重定向校验 + hostname 白名单） | ✅（仅 CardKit/注册请求） | ⚠️ 手写 IPv4-only 检查 |
| 输入中指示 | ✅ reaction 式 | ✅ reaction 式 | ✅ reaction 式 |
| reactions / 文档评论 | ✅ | ✅ | ✅ |
| OAuth device-flow | ✅ | ❌（仅 app 注册向导） | ✅ |
| Webhook 双通道 | ❌（同字节，仅 WebSocket） | ✅ WS + webhook | ❌ |
| 测试套件 | ✅ **vitest 基座（9 文件 / 78 用例）** | ✅ 99 文件 / 1202 用例 | ❌ 无 |
| 安全审计 | ✅ plugin-inspector 报告 | ✅ security-audit + SSRF 防护 | ⚠️ 无 |

### 取长补短的思路

1. **工具面 = 字节 7.16 全家桶**：38 个工具覆盖 im / doc / wiki / drive / bitable / calendar / task / sheets / search / oauth，这是官方 2.0 只有 14 个工具所不具备的（官方没有 calendar/task/sheets/im 消息工具）。唯一移除的是字节的自研 `feishu_ask_user_question`（已被内置 `ask_user` 按钮渲染取代）。
2. **架构 = 官方 2.0 原生适配**：完整使用 OpenClaw 2.0 SDK（`plugin-sdk/core`、`channel-message`、`runtime.config.current()`），而字节 7.16 因用 `loadConfig` 在 2.0 下直接无法加载。
3. **交互增强（两家都没有的）**：内置 `ask_user` 问题渲染成飞书按钮卡片（官方只做文本回退，字节用另一套非阻塞表单）；工具动态展示**默认开启**（两家都要手动开 verbose）；PIN 消息操作（字节没有）。
4. **安全补强（取官方）**：把官方 2.0 的 `fetchWithSsrFGuard` 应用到**全部**出站请求（媒体/OAuth/MCP/裸 API），而官方只用于 CardKit 与 app 注册，字节只有手写 IPv4 检查。
5. **工程化补强（取官方）**：建立 vitest 测试基座（官方 1202 用例的质量目标，字节零测试），并保留 plugin-inspector 安全报告。

### 已知差异（如实说明）

| 项 | 说明 |
|---|---|
| Webhook 双通道 | 本插件暂未实现（同字节），仅 WebSocket；官方支持 WS + webhook |
| pin 消息 | 本插件已支持；字节 7.16 无此能力 |
| 测试规模 | 本插件为最小基座（78 用例），远小于官方（1202 用例），但覆盖核心安全与路由路径 |
| 卡片/工具展示开关 | 本插件 `toolUseDisplay.enabled:false` 可关，默认开 |

## 安装

### 通过 ClawHub

```bash
openclaw plugin install @mirr0ch1/openclaw-lark-2
```

### 通过 tarball（本机开发）

```bash
npm pack
openclaw plugins install openclaw-lark-2-2026.9.3.tgz
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
npm install            # 安装依赖（含 vitest）
npm test               # 运行 vitest 测试套件
npm run test:watch     # 测试监听模式
```

插件为 CommonJS 源码（`src/` + `index.js` 入口），无需构建步骤，改动后直接同步到 OpenClaw 扩展目录并重启网关即可生效。

## 致谢 / 许可

基于 [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark)（MIT）二次开发。保留 MIT 许可。

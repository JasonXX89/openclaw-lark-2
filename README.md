# openclaw-lark-2
 
**OpenClaw 2.0（2026.8.1+）专属飞书 / Lark 渠道插件** · An OpenClaw 2.0 (2026.8.1+) Feishu/Lark channel plugin, adapted from `@larksuite/openclaw-lark`.
 
> 🧑‍💻 OpenClaw 2.0 适配 by [@mirr0ch1](https://github.com/mirr0ch1)（[Mirr0ch1/openclaw-lark-2](https://github.com/Mirr0ch1/openclaw-lark-2)）
> 🎨 流式卡片样式参考 [hermes-fry-cards](https://github.com/techysy/hermes-fry-cards) by [@techysy](https://github.com/techysy)
 
深度适配 OpenClaw 2.0+ SDK 与 2026.9.3+ 架构：原生 Segment 流式卡片引擎、思考流与工具折叠时间线、防爆卡预算控制、多账号与群聊流式完整支持。 / Fully adapted to OpenClaw 2.0+ SDK with native Segment-driven streaming cards, thinking & tool workflow timelines, and full multi-account support.

---

## 特性 / Features

- **流式卡片**：打字机逐字打印，`✅/❌/⏹️` 状态行永远在答案第一行；思考/工具收进单一底部折叠面板，标题一行展示运行指标，展开后按真实顺序展示工作流时间线（`💭 思考1` → 🔧 工具 → `💭 思考2` → …）。思考/工具进行中默认折叠，不打扰阅读。
- **面板常驻 + 计数常显**：`showReasoning`/`showTools` 任一开启即渲染面板，标题恒带真实计数 `💭N 🔧N`（没有为 0，展开提示"暂无思考与工具调用过程"）；双 false 则面板消失，退化为纯指标行。
- **Segment 流式引擎**：思考/回答/工具按真实到达顺序记录、增量渲染只刷变化，彻底解决答案重复多遍、长回答超飞书卡片上限（`200860 card over max size`）、打字机错乱等问题。
- **工具调用动态展示**：流式卡片实时展示工具步骤（标题为 `🛠️ 工具调用中 · N 步`，支持多步骤折叠小箭头保全）；内置 `ask_user` 交互卡片。
- **多图合并**：一次发送 ≥2 张图合并为一条富文本 post，任一张失败自动回退不丢图。
- **群聊流式**：`replyMode.group: "streaming"` 让群聊与私聊同样流式。
- **完整能力 + 多账号**：飞书 IM/文档/多维表格/日历/任务/表格；一个实例接多个飞书应用。
- **SSRF 防护 + PIN 消息操作**：出站 HTTP 全走 SDK `fetchWithSsrFGuard`；message 工具支持 `pin`/`unpin`/`list-pins`。

---

## 界面预览 / Preview

完成态卡片：`✅ 已完成` 状态行置顶，底部折叠面板常驻，展开即工作流时间线（工具步骤与思考块交错）。

![卡片整体+展开的工作流时间线](assets/screenshot-workflow.jpg)

> 桌面端飞书实测（沈阳天气：Fetch → Run → 思考 1/2/3 交错）。思考/工具进行中默认折叠，点开看全文。

---

## 版本记录 / Changelog

| 版本 / Version | 日期 / Date | 说明 / Notes |
|---|---|---|
| **2026.9.8** | 2026-09-12 | 流式卡片工具折叠标题优化为「🛠️ 工具调用中」+ 修复多工具更新时右侧折叠小箭头丢失 bug + 官方 commands.allowFrom 思考流免补丁支持与衍生模型 extra_body 透传指引 |

---

## 安装 / Installation

```bash
# 方式 A：直接安装发布包（推荐）/ Recommended
npm pack && openclaw plugins install openclaw-lark-2-2026.9.8.tgz

# 方式 B：从源码安装 / From source
git clone https://github.com/JasonXX89/openclaw-lark-2.git
cd openclaw-lark-2
cp -r . ~/.openclaw/extensions/openclaw-lark-2
openclaw gateway restart
```

---

## 配置 / Configuration

在 `~/.openclaw/openclaw.json` 中的 `channels.feishu` 配置：

```json5
{
  channels: {
    feishu: {
      enabled: true,
      appId: "cli_xxx",
      appSecret: "xxx",
      // 多账号示例 / multi-account
      accounts: {
        bot2: { appId: "cli_yyy", appSecret: "yyy" },
      },
      multiImageMode: "post", // post（默认合并）/ sequential（逐张）
      replyMode: {
        group: "static",      // 群聊：static=纯文本 / streaming=流式卡片
        direct: "streaming"   // 私聊：默认 streaming
      },
      footer: {
        status: true,
        elapsed: true,
        model: true,
        provider: true,
        tokens: true,
        cache: true,
        context: true,
        showReasoning: true, // 💭 思考计数与面板
        showTools: true,     // 🔧 工具计数与面板
      },
    },
  },
  plugins: {
    allow: ["openclaw-lark-2"],
  },
}
```

> ⚠️ **权限与回调必配**：
> 1. 飞书开放平台需开通 **`cardkit:card:write`** 权限（流式卡片必备）。
> 2. **卡片交互回调**：在开放平台 →「开发配置」→「事件与回调」→「回调配置」中，订阅方式选**长连接**，添加 **`card.action.trigger`** 并发布版本，否则卡片按钮点击无响应。

---

## 思考流（💭）原生配置与排坑指南

> 💡 **强烈建议：100% 采用官方原生配置，完全无需安装任何 Hook 补丁！**
> 自 OpenClaw 2026.9.3 起，官方已原生支持通过白名单放行普通消息的思考流，纯配置、零入侵、升级永不失效。

### 1. 开启官方原生授权（推荐）

在 `~/.openclaw/openclaw.json` 的顶层 `commands` 中配置授权白名单（推荐直接填 `["*"]` 全放行，或指定你的飞书 `ou_id`）：

```json5
"commands": {
  "native": "auto",
  "nativeSkills": "auto",
  "restart": true,
  "allowFrom": {
    "feishu": ["*"] // 推荐填 "*"，也可填 ["ou_xxxxxx"]
  }
}
```
配置后执行 `openclaw gateway restart` 重启生效，普通聊天即可原生展示 💭 思考面板。

### 2. 排坑：第三方 / 衍生模型（如 DeepSeek-v4.1）不输出思考

如果已配好上述放行，但卡片依然看不到思考流，原因通常是：**模型自身裸请求不思考**（且模型 ID 不在 OpenClaw 内置硬编码白名单内）。

**正确解法**：在 `openclaw.json` 的 `agents.defaults.models` 下通过 `extra_body` 显式透传推理参数：

```json5
"agents": {
  "defaults": {
    "models": {
      "10router/cbcn/deepseek-v4.1-flash": {
        "params": {
          "extra_body": {
            "reasoning_effort": "medium" // 强制下游模型开启思考
          }
        }
      }
    }
  }
}
```

---

## 附录：旧版 Hook 补丁说明（仅供 OpenClaw < 2026.9.3 备用）

> ⚠️ **使用范围说明**：
> - **仅适用于 OpenClaw < 2026.9.3 的老版本**。
> - **2026.9.3 及以上版本严禁安装**：新版已有上方原生免补丁方案。Hook 补丁依赖脆弱的内存代码替换，在大版本升级后极易产生匹配漂移与维护负担。若此前曾安装过，请务必执行卸载还原纯净启动。

```bash
# 仅老版本备用：在插件运行目录下安装
node scripts/install-reasoning-hook.js install && openclaw gateway restart

# 卸载补丁（推荐所有已升级至 2026.9.3+ 的用户执行）
node scripts/install-reasoning-hook.js uninstall && openclaw gateway restart
```

---

## 开发与测试 / Development

```bash
npm install        # 安装依赖
npm test           # 运行 vitest 单元测试
npm run test:watch # 监听模式
```

插件为纯 CommonJS 编写，无构建步骤，改动后同步到 `~/.openclaw/extensions/openclaw-lark-2` 并重启 gateway 即可。

---

## 许可 / License

本项目基于 MIT 协议开源，原版权声明保留：
- [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) — 飞书官方
- [Mirr0ch1/openclaw-lark-2](https://github.com/Mirr0ch1/openclaw-lark-2) — OpenClaw 2.0 适配版
- [techysy/hermes-fry-cards](https://github.com/techysy/hermes-fry-cards) — 流式卡片样式参考

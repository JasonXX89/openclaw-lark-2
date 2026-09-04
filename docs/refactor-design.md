# openclaw-lark-3 重构设计 — Segment 流式模型对齐薯条(fry-cards)

> 分支：`refactor/fry-segment-stream`（隔离，不污染小希在用的 main / 运行区）
> 基底：`main` 的 `fab7e01`（含 segments.js + cardkit batchUpdate 地基）
> 参考实现：`C:\Users\zhang\Apps\hermes-fry-cards`（样式/架构来源，Python）

---

## 1. 为什么重构

openclaw-lark-2 现有的流式卡片控制器（`streaming-card-controller.js`，~1100 行）
用**三个独立状态桶**描述回复内容：

- `text`（累积答案文本）
- `reasoning`（累积思考文本 + isReasoningPhase）
- `toolUse`（工具活动状态）

渲染时靠 `isReasoningPhase` 猜「现在该显示思考还是答案」，内容**没有顺序概念**。
这导致：

1. **无法按事件顺序渲染**——思考/答案/工具的真实先后顺序丢失，多轮思考（think→tool→think）
   时只能靠 phase 猜测布局。
2. **渲染整卡 replace**——每次 `updateCardKitCard` 把整个卡片 JSON 重发，seq 消耗大、
   长回复/多工具易撞飞书元素上限 200（230099/11310），撞上就降级成无流式的死卡。
3. **无法增量更新**——新内容不能只「插入一个新元素」，必须整卡重发。
4. **防爆困难**——没有元素预算意识，不能主动在超限前拆卡，只能被动等飞书报错。

薯条卡片（hermes-fry-cards）用 **Segment 流式模型** 解决了这些问题，本分支把它移植到
openclaw-lark-3（JS / CommonJS）。

---

## 2. 目标架构

### 2.1 核心抽象：Segment 流模型（单一事实源）

整条回复 = **扁平的 segment 列表**，按事件到达顺序排列：

```
[reasoning段, answer段, tool段, reasoning段, answer段, ...]
```

- **同类型事件追加**（`seg.text += delta`），**跨类型事件新建段**并终结前一个
  reasoning（补算耗时）。
- 每个 segment 有稳定独立的 `element_id`：
  - reasoning → `reasoning_panel_{n}` + 内部文本子元素 `reasoning_text_{n}`
  - answer → `answer_{n}`（流式内容元素）
  - tool → 共享 `tool_panel`（所有工具步骤合并到底部一个面板）
- 这是**内容顺序的唯一事实源**，不再靠 phase 猜布局。

数据模型见 `src/card/segments.js`（已移植 fry 的 `streaming/segments.py`）：
`SegmentState` + `Segment`，纯逻辑无 IO，10 个单测覆盖。

### 2.2 两层更新策略（性能本质）

移植 fry 的「结构层 + 文本层」分离：

| 层 | 用途 | CardKit API |
|---|---|---|
| **结构层** | 新建 reasoning/answer/tool 元素、收面板标题、改布局 | `card.batchUpdate`（`add_elements` / `partial_update_element`） |
| **文本层** | 已建元素的文本增量刷新 | `cardElement.content`（`streamCardContent`） |

- 结构变更（新段出现）只发生**一次**（`add_elements`），之后该段文本增量走文本层。
- 已封装：`src/card/cardkit.js` → `batchUpdateCardKit()`（结构层）+ 既有 `streamCardContent()`（文本层）。

### 2.3 初始卡片结构（增量式）

初始流式卡**只建最小骨架**，后续段动态 insert：

```
[answer 流式元素 (answer_0)]  ← 内容层流式主通道
[loading 图标]                 ← add_elements 的 insert_before 目标锚点
```

reasoning / tool 段按事件到达，用 `batchUpdate` 的 `add_elements {type:'insert_before',
target_element_id: loading_icon, elements:[...]}` 动态插入到 loading 之前。

### 2.4 防爆拆卡

- **元素预算**：`ELEMENT_THRESHOLD = 180`（飞书硬限 200 预留 20），每 segment 有成本估算
  （reasoning 面板=4、answer=1、tool 步骤=3~5/步）。
- **主动拆卡**：新段会让当前卡超预算时，**封旧卡 → 建新流式卡 → 后续内容流进新卡**，
  用户看到两张接力卡，都不爆。替代现在「撞 230099 就禁用流式等死」的降级。
- **降级兜底**：拆卡失败（如建新卡失败）时 `split_disabled=true`，继续写当前卡，不中断。
- reasoning 面板防爆：`max_reasoning_panels=3`（默认），超限文本合并进最后一段，不新建
  面板。

### 2.5 完成态 = 段重放

`buildCompleteCard` 不再用参数拼接（text + reasoningText + toolUseSteps），而是
**从 segments 列表重放**收集 reasoning_rounds + tool_steps_total + answer chunks 重建。
终态没有独立状态，永远与流式段的最终内容一致。保留：
- 短回复豁免（纯思考且 <5s → 无面板、纯文本 + footer）
- footer 常驻（fry 样式，✅ 并入 footer）

---

## 3. 与薯条的差异适配

| 维度 | fry（Python） | lark-3（JS 移植） |
|---|---|---|
| 回调语义 | 每个 delta 增量（reasoning 增量 append） | OpenClaw `onReasoningStream` 给**累计全文快照**（非增量）→ 需 `setReasoningSnapshot` 整段覆盖而非 append |
| 语言 | Python asyncio | JS CommonJS |
| SDK | `lark-oapi` Python（`card.abatch_update`） | `@larksuiteoapi/node-sdk`（`card.batchUpdate` 驼峰） |
| 路径 | 单一 CardKit 流式 | CardKit + IM patch 双路径（activityOnly 等） |

---

## 4. 推进里程碑

### 已提交（可验证、无回归）
- `fab7e01`（main，已 push）— 地基：`segments.js` 数据模型 + `cardkit.js batchUpdateCardKit`，19 单测。
- `116cacb`（refactor 分支）— **里程碑 A**：controller 并行接入 `SegmentState`，
  回调（onDeliver/onReasoningStream）记入 segments，渲染仍走旧桶派生（**行为不变**），19 测试无回归。

### 待推进（里程碑 B）
1. builder 导出/新增增量元素构建 + **CardKit action 构造模块**（纯函数，可单测）。
2. `performFlush` 改两层更新（batchUpdate 结构层 + streamCardContent 文本层）。
3. 防爆拆卡（元素预算超限封旧卡开新卡，`split_disabled` 降级）。
4. `buildCompleteCard` 段重放（保留短回复豁免 + footer 常驻）。

> 第 2~4 步依赖真实 Feishu CardKit API，无法 mock，需 gateway 重启后在 小希 实测；
> 因此每步独立提交、可在分支验证后再推进，不盲改大块。

---

## 5. 文件地图

```
src/card/
  segments.js                  ← 移植 fry streaming/segments.py：Segment + SegmentState + 预算 (已提交)
  cardkit.js                   ← + batchUpdateCardKit() 结构层封装 (已提交)
  segments-render.js           ← (待建) segment → CardKit batch actions 构造 (add_elements/partial_update)
  builder.js                   ← + 增量建段元素导出; buildCompleteCard 改段重放
  streaming-card-controller.js ← + SegmentState 并行 (A已完成); performFlush 两层更新 + 拆卡 (B待做)
tests/card/
  segments.test.ts             ← SegmentState 10 测试 (已提交)
```

---

## 6. 设计取舍记录

- **为何不改旧 controller 就地改**：~1100 行积累了 8+ 轮 edge-case（回复边界 streamingPrefix、
  NO_REPLY 缓冲、活动卡删除、IM patch 降级等），就地全量重写风险高。故在隔离 fork 分支
  (openclaw-lark-3) 演进，满意后合入。
- **里程碑 A 保留旧桶派生渲染**：先让 segments 成为并行事实源、验证无回归，再切渲染层，
  降低一次性重构的回归风险。
- **OpenClaw reasoning 快照语义**：`onReasoningStream` 的 `payload.text` 是累计全文
  （dist `emitReasoningStream`: text=trimmed 全量），故新增 `setReasoningSnapshot` 而非
  沿用 fry 的 append `onReasoningDelta`。

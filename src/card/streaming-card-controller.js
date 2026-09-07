"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Streaming card controller for the Lark/Feishu channel plugin.
 *
 * Manages the full lifecycle of a streaming CardKit card:
 * idle → creating → streaming → completed / aborted / terminated.
 *
 * Delegates throttling to FlushController and message-unavailable
 * detection to UnavailableGuard.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingCardController = void 0;
exports.prepareTerminalCardContent = prepareTerminalCardContent;
const promises_1 = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const agent_runtime_1 = require("openclaw/plugin-sdk/agent-runtime");
const reply_runtime_1 = require("openclaw/plugin-sdk/reply-runtime");
const api_error_1 = require("../core/api-error.js");
const lark_logger_1 = require("../core/lark-logger.js");
const lark_client_1 = require("../core/lark-client.js");
const shutdown_hooks_1 = require("../core/shutdown-hooks.js");
const send_1 = require("../messaging/outbound/send.js");
const builder_1 = require("./builder.js");
const card_error_1 = require("./card-error.js");
const cardkit_1 = require("./cardkit.js");
const flush_controller_1 = require("./flush-controller.js");
const image_resolver_1 = require("./image-resolver.js");
const tool_use_display_1 = require("./tool-use-display.js");
const tool_use_trace_store_1 = require("./tool-use-trace-store.js");
const reply_dispatcher_types_1 = require("./reply-dispatcher-types.js");
const unavailable_guard_1 = require("./unavailable-guard.js");
const segments_1 = require("./segments.js");
const segments_render_1 = require("./segments-render.js");
const flush_plan_1 = require("./flush-plan.js");
const complete_replay_1 = require("./complete-replay.js");
const log = (0, lark_logger_1.larkLogger)('card/streaming');
// ---------------------------------------------------------------------------
// StreamingCardController
// ---------------------------------------------------------------------------
class StreamingCardController {
    // ---- Explicit state machine ----
    phase = 'idle';
    // ---- Structured state ----
    cardKit = {
        cardKitCardId: null,
        originalCardKitCardId: null,
        cardKitSequence: 0,
        cardMessageId: null,
    };
    text = {
        accumulatedText: '',
        completedText: '',
        streamingPrefix: '',
        lastPartialText: '',
    };
    /** Segment 流式模型 — 整条回复的顺序单一事实源（reasoning/answer/tool 按事件到达）。
     *  流式渲染（结构层 batchUpdate + 文本层 streamCardContent）与终态段重放均由
     *  segments 驱动；text/reasoning 桶仅保留给 IM patch 降级分支使用。 */
    segmentState = new segments_1.SegmentState();
    reasoning = {
        accumulatedReasoningText: '',
        reasoningStartTime: null,
        reasoningElapsedMs: 0,
        isReasoningPhase: false,
        // fry-cards style anti-explosion: at most MAX_REASONING_PANELS segments;
        // overflow merges into the last one instead of creating a new panel.
        reasoningSegments: [],
    };
    toolUse = {
        startedAt: null,
        elapsedMs: 0,
        isActive: false,
    };
    // ---- Sub-controllers ----
    flush;
    guard;
    imageResolver;
    // ---- Lifecycle ----
    createEpoch = 0;
    _terminalReason = null;
    dispatchFullyComplete = false;
    cardCreationPromise = null;
    disposeShutdownHook = null;
    dispatchStartTime = Date.now();
    // ---- Injected dependencies ----
    deps;
    elapsed() {
        return Date.now() - this.dispatchStartTime;
    }
    needsFooterMetrics() {
        const footer = this.deps.resolvedFooter;
        return footer.tokens || footer.cache || footer.context || footer.model;
    }
    async getFooterSessionMetrics() {
        try {
            const runtime = lark_client_1.LarkClient.runtime;
            if (!runtime)
                return undefined;
            // OpenClaw 2.0: per-session usage metrics live in the agent
            // transcript SQLite (transcript_events.message.usage), not the
            // legacy sessions.json file that 2.0 migrated away.
            const agentId = this.deps.agentId;
            const sessionKey = this.deps.sessionKey.trim().toLowerCase();
            const dbPath = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
            const { DatabaseSync } = require('node:sqlite');
            const db = new DatabaseSync(dbPath, { readOnly: true });
            try {
                const window = db.prepare('SELECT session_id FROM session_windows WHERE lower(session_key) = ? ORDER BY updated_at DESC LIMIT 1').get(sessionKey);
                if (!window)
                    return undefined;
                const row = db.prepare("SELECT event_json FROM transcript_events WHERE session_id = ? AND event_json LIKE '%usage%' ORDER BY rowid DESC LIMIT 1").get(window.session_id);
                if (!row)
                    return undefined;
                const ev = JSON.parse(row.event_json);
                const msg = ev?.message ?? {};
                const u = msg.usage;
                if (!u)
                    return undefined;
                const metrics = {
                    inputTokens: typeof u.input === 'number' ? u.input : undefined,
                    outputTokens: typeof u.output === 'number' ? u.output : undefined,
                    cacheRead: typeof u.cacheRead === 'number' ? u.cacheRead : undefined,
                    cacheWrite: typeof u.cacheWrite === 'number' ? u.cacheWrite : undefined,
                    totalTokens: typeof u.totalTokens === 'number' ? u.totalTokens : undefined,
                    model: typeof msg.model === 'string' ? msg.model : undefined,
                    provider: typeof msg.provider === 'string' ? msg.provider : undefined,
                    agentId,
                };
                // Best-effort context window from the model catalog in cfg.
                const ctxWindow = this.resolveContextWindow(msg.provider, msg.model);
                if (ctxWindow != null)
                    metrics.contextTokens = ctxWindow;
                log.debug('footer metrics lookup: found usage from agent transcript sqlite', {
                    sessionKey: this.deps.sessionKey,
                    agentId,
                });
                return metrics;
            }
            finally {
                db.close();
            }
        }
        catch (err) {
            log.warn('footer metrics lookup failed', { error: String(err), sessionKey: this.deps.sessionKey });
            return undefined;
        }
    }
    /** Resolve a model's context window from cfg.models.providers. */
    resolveContextWindow(provider, model) {
        try {
            const providers = this.deps.cfg?.models?.providers ?? {};
            // 1) 精确匹配：同一 provider 下按 id 查
            const pcfg = providers[provider];
            if (pcfg && Array.isArray(pcfg.models)) {
                const found = pcfg.models.find((m) => m && m.id === model);
                if (typeof found?.contextWindow === 'number')
                    return found.contextWindow;
            }
            // 2) 跨 provider 回退：按裸模型名（去掉 "xxx/" 前缀）或后缀匹配任意 provider
            //    场景：网关聚合供应商（如 10router 的 oc/mimo-v2.5-free）未配 contextWindow，
            //    但直连供应商（如 opencode 的 mimo-v2.5-free）配了同一个底层模型。
            const bare = model.includes('/') ? model.split('/').pop() : model;
            for (const p of Object.values(providers)) {
                if (!p || !Array.isArray(p.models))
                    continue;
                const hit = p.models.find((m) => m && typeof m.contextWindow === 'number' && (m.id === bare || model.endsWith(`/${m.id}`)));
                if (hit)
                    return hit.contextWindow;
            }
            // 3) 兜底：如果 usage 报告了 totalTokens 但没有任何目录信息，返回 undefined（不显示上下文段）
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    constructor(deps) {
        this.deps = deps;
        this.guard = new unavailable_guard_1.UnavailableGuard({
            replyToMessageId: deps.replyToMessageId,
            getCardMessageId: () => this.cardKit.cardMessageId,
            onTerminate: () => {
                this.transition('terminated', 'UnavailableGuard', 'unavailable');
            },
        });
        this.flush = new flush_controller_1.FlushController(() => this.performFlush());
        this.imageResolver = new image_resolver_1.ImageResolver({
            cfg: deps.cfg,
            accountId: deps.accountId,
            onImageResolved: () => {
                if (!this.isTerminalPhase && this.cardKit.cardMessageId) {
                    void this.throttledCardUpdate();
                }
            },
        });
    }
    // ------------------------------------------------------------------
    // Public accessors
    // ------------------------------------------------------------------
    get cardMessageId() {
        return this.cardKit.cardMessageId;
    }
    get isTerminalPhase() {
        return reply_dispatcher_types_1.TERMINAL_PHASES.has(this.phase);
    }
    /**
     * Whether the card has been explicitly aborted (via abortCard()).
     *
     * Distinct from isTerminalPhase — creation_failed is NOT an abort;
     * it should allow fallthrough to static delivery in the factory.
     */
    get isAborted() {
        return this.phase === 'aborted';
    }
    /** Whether the reply pipeline was terminated due to an unavailable message. */
    get isTerminated() {
        return this.guard.isTerminated;
    }
    /** Check if the pipeline should skip further operations for this source. */
    shouldSkipForUnavailable(source) {
        return this.guard.shouldSkip(source);
    }
    /** Attempt to terminate the pipeline due to an unavailable message error. */
    terminateIfUnavailable(source, err) {
        return this.guard.terminate(source, err);
    }
    /** Why the controller entered a terminal phase, or null if still active. */
    get terminalReason() {
        return this._terminalReason;
    }
    /** @internal — exposed for test assertions only. */
    get currentPhase() {
        return this.phase;
    }
    get shouldDisplayToolUse() {
        // footer.showTools 门控（默认 true）：false 时全程不渲染工具面板
        if (this.deps.resolvedFooter?.showTools === false)
            return false;
        return this.deps.toolUseDisplay.showToolUse;
    }
    /** footer.showReasoning 门控（默认 true）：false 时全程不渲染思考面板/丢弃思考文本 */
    get shouldDisplayReasoning() {
        return this.deps.resolvedFooter?.showReasoning !== false;
    }
    /**
     * Activity-only mode (static/group replies): the controller drives a
     * lightweight tool-activity card only — text/reasoning streaming is
     * handled by the static deliver() path, so those callbacks are no-ops
     * and the card is removed once the final reply is delivered.
     */
    get activityOnly() {
        return this.deps.activityOnly === true;
    }
    computeToolUseDisplay() {
        if (!this.shouldDisplayToolUse)
            return null;
        const traceSteps = (0, tool_use_trace_store_1.getToolUseTraceSteps)(this.deps.sessionKey);
        return (0, tool_use_display_1.normalizeToolUseDisplay)({
            traceSteps,
            showFullPaths: this.deps.toolUseDisplay.showFullPaths,
            showResultDetails: this.deps.toolUseDisplay.showToolResultDetails,
        });
    }
    get visibleToolUseElapsedMs() {
        if (!this.shouldDisplayToolUse || !this.toolUse.startedAt) {
            return undefined;
        }
        return this.toolUse.elapsedMs || Date.now() - this.toolUse.startedAt;
    }
    computeToolUseTitleSuffix(display) {
        if (!this.shouldDisplayToolUse)
            return undefined;
        const stepCount = display?.stepCount ?? 0;
        return stepCount > 0 ? (0, tool_use_display_1.buildToolUseTitleSuffix)({ stepCount }) : undefined;
    }
    // ------------------------------------------------------------------
    // Unified callback guard
    // ------------------------------------------------------------------
    /**
     * Unified callback guard — returns true if the pipeline is active
     * and the callback should proceed.
     *
     * Combines three checks:
     * 1. guard.isTerminated — message recalled/deleted
     * 2. guard.shouldSkip(source) — eagerly detect unavailable messages
     * 3. isTerminalPhase — completed/aborted/terminated/creation_failed
     */
    shouldProceed(source) {
        if (this.guard.isTerminated || this.guard.shouldSkip(source))
            return false;
        return !this.isTerminalPhase;
    }
    // ------------------------------------------------------------------
    // State machine
    // ------------------------------------------------------------------
    isStaleCreate(epoch) {
        return epoch !== this.createEpoch;
    }
    transition(to, source, reason) {
        const from = this.phase;
        if (from === to)
            return false;
        if (!reply_dispatcher_types_1.PHASE_TRANSITIONS[from].has(to)) {
            log.warn('phase transition rejected', { from, to, source });
            return false;
        }
        this.phase = to;
        log.info('phase transition', { from, to, source, reason });
        if (reply_dispatcher_types_1.TERMINAL_PHASES.has(to)) {
            this._terminalReason = reason ?? null;
            this.onEnterTerminalPhase();
        }
        return true;
    }
    onEnterTerminalPhase() {
        this.createEpoch += 1;
        this.flush.cancelPendingFlush();
        this.flush.complete();
        this.disposeShutdownHook?.();
        this.disposeShutdownHook = null;
        if (this.phase === 'terminated' || this.phase === 'creation_failed') {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    markToolUseActivity() {
        if (!this.toolUse.startedAt) {
            this.toolUse.startedAt = Date.now();
        }
        this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
        this.toolUse.isActive = true;
    }
    captureToolUseElapsed() {
        if (!this.toolUse.startedAt)
            return;
        this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
        this.toolUse.isActive = false;
    }
    // ------------------------------------------------------------------
    // SDK callback bindings
    // ------------------------------------------------------------------
    /**
     * Handle a deliver() call in streaming card mode.
     *
     * Accumulates text from the SDK's deliver callbacks to build the
     * authoritative "completedText" for the final card, and records the
     * answer delta into the segment state (the render source for streaming).
     */
    async onDeliver(payload) {
        if (!this.shouldProceed('onDeliver'))
            return;
        if (this.activityOnly)
            return;
        const text = payload.text ?? '';
        if (!text.trim())
            return;
        await this.ensureCardCreated();
        if (!this.shouldProceed('onDeliver.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        this.captureToolUseElapsed();
        const split = (0, builder_1.splitReasoningText)(text);
        const showReasoning = this.shouldDisplayReasoning;
        if (split.reasoningText && !split.answerText) {
            if (!showReasoning) {
                // Pure reasoning payload + reasoning 隐藏 → 无内容可显示，直接返回
                return;
            }
            // Pure reasoning payload
            this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
                ? Date.now() - this.reasoning.reasoningStartTime
                : 0;
            this.reasoning.accumulatedReasoningText = split.reasoningText;
            this.reasoning.isReasoningPhase = true;
            this.segmentState.setReasoningSnapshot(split.reasoningText);
            await this.throttledCardUpdate();
            return;
        }
        // Answer payload (may also contain inline reasoning from tags)
        this.reasoning.isReasoningPhase = false;
        if (split.reasoningText && showReasoning) {
            this.reasoning.accumulatedReasoningText = split.reasoningText;
            this.segmentState.setReasoningSnapshot(split.reasoningText);
        }
        const answerText = split.answerText ?? text;
        // 累积 deliver 文本用于最终卡片
        this.text.completedText += (this.text.completedText ? '\n\n' : '') + answerText;
        // deliver 是整段交付的权威文本。answer 段只补 deliver 相对已有流式内容的
        // 增量：若 partial 只覆盖开头（工具后模型整块 deliver 完整答案——常见于
        // 工具任务），deliver 的超出部分必须补入，否则卡片答案缺失（只有开头几
        // 字）；若流式已完整覆盖（answer 段文本已含 deliver 全文），则跳过防重复。
        const currentAnswer = this.segmentState.answerText || '';
        if (answerText && !currentAnswer.includes(answerText)) {
            let toFeed = answerText;
            let common = 0;
            if (currentAnswer) {
                // 去重：deliver 通常以流式已喂内容为前缀开头（partial 覆盖了答案
                // 开头，deliver 是完整版），剥离共同前缀，只补 deliver 新内容。
                const maxC = Math.min(currentAnswer.length, answerText.length);
                while (common < maxC && answerText[common] === currentAnswer[common]) {
                    common += 1;
                }
                toFeed = common >= answerText.length ? '' : answerText.slice(common);
            }
            if (toFeed) {
                if (common > 0 || !currentAnswer) {
                    // 续写（deliver 以已显示内容开头）：无缝接续
                    this.segmentState.onAnswerDelta(toFeed);
                } else {
                    // 全新段落（无前缀重叠）：\n\n 分段
                    this.segmentState.onDeliverText(toFeed);
                }
                this.text.accumulatedText += (this.text.accumulatedText ? '\n\n' : '') + toFeed;
                this.text.streamingPrefix = this.text.accumulatedText;
                await this.throttledCardUpdate();
            }
        }
    }
    async onReasoningStream(payload) {
        if (!this.shouldProceed('onReasoningStream'))
            return;
        if (this.activityOnly)
            return;
        await this.ensureCardCreated();
        if (!this.shouldProceed('onReasoningStream.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        // footer.showReasoning=false：思考不显示，丢弃 reasoning 流（不喂段、不积累）
        if (!this.shouldDisplayReasoning)
            return;
        const rawText = payload.text ?? '';
        if (!rawText)
            return;
        if (!this.reasoning.reasoningStartTime) {
            this.reasoning.reasoningStartTime = Date.now();
        }
        this.reasoning.isReasoningPhase = true;
        const split = (0, builder_1.splitReasoningText)(rawText);
        // OpenClaw 的 onReasoningStream payload.text 是累计全文快照（dist emitReasoningStream：
        // text=trimmed 全量、delta 单独字段），直接替换即可；面板防爆炸由「单一累计面板」天然保证，
        // 多轮 thinking 不会产生多个面板（与薯条 max_reasoning_panels 语义等效）。
        this.reasoning.accumulatedReasoningText = split.reasoningText ?? rawText;
        // 记入 segments（快照语义）—— 增量渲染下推理面板文本走 segments 的 text_el_id
        this.segmentState.setReasoningSnapshot(split.reasoningText ?? rawText);
        // ⚠️ 思考帧只刷 reasoning 文本层（throttledCardUpdate → planSegmentFlush 的
        // dirty stream），不要走 throttledToolUseStatusUpdate —— 它内部会
        // recordToolActivity() → onToolEvent，在工具 steps 已存在时把刚新建的
        // reasoning 段当"上一轮已结束思考"终结封存，导致💭思考N 卡在首帧短快照
        // （实测复现：第二轮思考首帧输出 "jason" 即被终结 → 卡片出现孤立 💭思考2=jason）。
        await this.throttledCardUpdate();
    }
    async onToolStart(payload) {
        if (!this.shouldProceed('onToolStart'))
            return;
        if (!this.shouldDisplayToolUse)
            return;
        const phase = payload.phase ?? 'start';
        // 把工具生命周期写入 trace store，卡片才能渲染出"正在调用什么工具"的步骤。
        if (phase === 'start') {
            (0, tool_use_trace_store_1.recordToolUseStart)({
                sessionKey: this.deps.sessionKey,
                toolName: payload.name,
                toolParams: payload.args,
                toolCallId: payload.toolCallId,
            });
        }
        else if (phase === 'end' || phase === 'error' || phase === 'result') {
            (0, tool_use_trace_store_1.recordToolUseEnd)({
                sessionKey: this.deps.sessionKey,
                toolName: payload.name,
                toolParams: payload.args,
                toolCallId: payload.toolCallId,
                error: phase === 'error' ? 'tool failed' : undefined,
            });
        }
        else {
            return;
        }
        if (phase === 'start') {
            this.markToolUseActivity();
        }
        else {
            this.captureToolUseElapsed();
        }
        await this.ensureCardCreated();
        if (!this.shouldProceed('onToolStart.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        // 记录工具活动到 segment 模型（增量渲染源）—— 不整卡 replace
        if (this.cardKit.cardKitCardId) {
            this.recordToolActivity();
        }
        if (this.activityOnly) {
            if (this.cardKit.cardKitCardId) {
                await this.throttledToolUseStatusUpdate();
            }
            else {
                await this.throttledCardUpdate();
            }
            return;
        }
        if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
            await this.throttledToolUseStatusUpdate();
            return;
        }
        await this.throttledCardUpdate();
    }
    async onToolPayload(_payload) {
        if (!this.shouldProceed('onToolPayload'))
            return;
        if (!this.shouldDisplayToolUse)
            return;
        this.markToolUseActivity();
        await this.ensureCardCreated();
        if (!this.shouldProceed('onToolPayload.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        // 记录工具活动到 segment 模型（增量渲染源）—— 不整卡 replace
        if (this.cardKit.cardKitCardId) {
            this.recordToolActivity();
        }
        if (this.activityOnly) {
            if (this.cardKit.cardKitCardId) {
                await this.throttledToolUseStatusUpdate();
            }
            else {
                await this.throttledCardUpdate();
            }
            return;
        }
        if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
            await this.throttledToolUseStatusUpdate();
            return;
        }
        await this.throttledCardUpdate();
    }
    async onPartialReply(payload) {
        if (!this.shouldProceed('onPartialReply'))
            return;
        if (this.activityOnly)
            return;
        // Use splitReasoningText (consistent with onDeliver/onReasoningStream)
        // to extract <think> tag content before stripping it from the answer.
        // Previously only stripReasoningTags was called, silently discarding
        // any thinking content that the LLM wrapped in <think> tags.
        const rawText = payload.text ?? '';
        const split = (0, builder_1.splitReasoningText)(rawText);
        // footer.showReasoning=false：丢弃 reasoning（不喂段、不积累），答案不受影响
        if (split.reasoningText && this.shouldDisplayReasoning) {
            if (!this.reasoning.reasoningStartTime) {
                this.reasoning.reasoningStartTime = Date.now();
            }
            this.reasoning.accumulatedReasoningText = split.reasoningText;
            this.reasoning.isReasoningPhase = true;
        }
        const text = split.answerText ?? (0, builder_1.stripReasoningTags)(rawText);
        log.debug('onPartialReply', { len: text.length });
        if (!text)
            return;
        this.captureToolUseElapsed();
        if (!this.reasoning.reasoningStartTime) {
            this.reasoning.reasoningStartTime = Date.now();
        }
        if (this.reasoning.isReasoningPhase) {
            this.reasoning.isReasoningPhase = false;
            this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
                ? Date.now() - this.reasoning.reasoningStartTime
                : 0;
        }
        // 检测回复边界：文本长度缩短 → 上一段完整，基线重置（把上帧并入 prefix，
        // 下帧起是新段）。这只是基线重置信号，不代表之后每帧都是整段新回复。
        if (this.text.lastPartialText && text.length < this.text.lastPartialText.length) {
            this.text.streamingPrefix += (this.text.streamingPrefix ? '\n\n' : '') + this.text.lastPartialText;
            this.text.lastPartialText = '';
        }
        const prevPartialText = this.text.lastPartialText;
        this.text.lastPartialText = text;
        this.text.accumulatedText = this.text.streamingPrefix ? this.text.streamingPrefix + '\n\n' + text : text;
        // NO_REPLY 缓冲
        if (!this.text.streamingPrefix && reply_runtime_1.SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim())) {
            log.debug('onPartialReply: buffering NO_REPLY prefix');
            return;
        }
        // 喂 answer 增量到 segmentState（增量渲染的唯一文本来源）。
        // delta 推断：以「内容前缀增长」为准——text 是累计快照，本帧若以上帧为
        // 前缀则增量 = 超出部分（正常打字机）；若上帧基线被重置（lastPartialText
        // 刚清空）或首帧，本帧整段是新内容；绝不在 streamingPrefix 存在时整段
        // 喂入——否则每帧都整段重复叠加（prefix 一旦设置，text 仍逐字增长，
        // 每次整段喂 → answer 段平方膨胀 → 卡片"回复好几遍"）。
        let answerDelta;
        if (prevPartialText && text.startsWith(prevPartialText)) {
            answerDelta = text.slice(prevPartialText.length);
        }
        else {
            // 首帧（prev 空）、基线刚重置、或非前缀增长：整帧作为本段内容
            answerDelta = text;
        }
        if (answerDelta) {
            // 区分两种喂入：
            // ① 前缀增长算出的增量（answerDelta 是 text 超出 prev 的部分）→ 无缝接续
            // ② 整帧喂入（首帧 / 基线重置后的新段首帧 / 非前缀增长）→ 若已有答案
            //    内容则 \n\n 分段（新回复段），否则直接建段
            const isIncremental = prevPartialText && text.startsWith(prevPartialText);
            if (!isIncremental && this.segmentState.answerText) {
                // 新回复段（工具/思考后模型重新输出 / 基线重置）：分段拼接
                this.segmentState.onDeliverText(answerDelta);
            }
            else {
                // 正常流式增量或首个 answer：无缝接续 / 建段
                this.segmentState.onAnswerDelta(answerDelta);
            }
        }
        await this.ensureCardCreated();
        if (!this.shouldProceed('onPartialReply.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        await this.throttledCardUpdate();
    }
    async onError(err, info) {
        if (this.guard.terminate('onError', err))
            return;
        log.error(`${info.kind} reply failed`, { error: String(err) });
        if (this.activityOnly) {
            await this.deleteActivityCard('onError');
            return;
        }
        this.captureToolUseElapsed();
        // 终态段快照：终结未关闭 tool 段 + 补算最后一个 reasoning elapsed
        const errTotalSteps = this.finalizeSegmentState();
        this.finalizeCard('onError', 'error');
        await this.flush.waitForFlush();
        if (this.cardCreationPromise)
            await this.cardCreationPromise;
        const errorEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
        const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
        const toolUseDisplay = this.computeToolUseDisplay();
        try {
            if (this.cardKit.cardMessageId) {
                const replay = (0, complete_replay_1.replayTerminalContent)(this.segmentState);
                const segAnswer = replay.answerText || this.text.completedText || this.text.accumulatedText;
                const rawErrorText = segAnswer
                    ? `${segAnswer}\n\n---\n**Error**: An error occurred while generating the response.`
                    : '**Error**: An error occurred while generating the response.';
                const reasoningText = replay.reasoningText ?? (this.reasoning.accumulatedReasoningText || undefined);
                const terminalContent = prepareTerminalCardContent({
                    text: rawErrorText,
                    reasoningText,
                }, this.imageResolver);
                const errorCard = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: toolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(toolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs: this.elapsed(),
                    isError: true,
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    workflowTimeline: (0, complete_replay_1.buildWorkflowTimeline)(this.segmentState, toolUseDisplay?.stepCount ?? 0),
                });
                if (errorEffectiveCardId) {
                    await this.closeStreamingAndUpdate(errorEffectiveCardId, errorCard, 'onError');
                }
                else {
                    await (0, send_1.updateCardFeishu)({
                        cfg: this.deps.cfg,
                        messageId: this.cardKit.cardMessageId,
                        card: errorCard,
                        accountId: this.deps.accountId,
                    });
                }
            }
        }
        catch {
            // Ignore update failures during error handling
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    async onIdle() {
        if (this.guard.isTerminated || this.guard.shouldSkip('onIdle'))
            return;
        if (!this.dispatchFullyComplete)
            return;
        if (this.isTerminalPhase)
            return;
        this.captureToolUseElapsed();
        if (this.activityOnly) {
            // 静态模式：最终回复已通过 deliver() 单独发送，删除活动卡即可。
            await this.deleteActivityCard('onIdle');
            return;
        }
        // 终态段快照：终结未关闭 tool 段 + 补算最后一个 reasoning elapsed
        this.finalizeSegmentState();
        this.finalizeCard('onIdle', 'normal');
        await this.flush.waitForFlush();
        if (this.cardCreationPromise) {
            await this.cardCreationPromise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            await this.flush.waitForFlush();
        }
        const idleEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
        try {
            if (this.cardKit.cardMessageId) {
                if (idleEffectiveCardId) {
                    const seqBeforeClose = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.info('onIdle: closing streaming mode', {
                        seqBefore: seqBeforeClose,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.setCardStreamingMode)({
                        cfg: this.deps.cfg,
                        cardId: idleEffectiveCardId,
                        streamingMode: false,
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
                // 终态内容段重放：answer/reasoning 从 SegmentState 重建
                const replay = (0, complete_replay_1.replayTerminalContent)(this.segmentState);
                const segAnswer = replay.answerText || '';
                const isNoReplyLeak = !this.text.completedText && reply_runtime_1.SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim());
                const displayText = segAnswer || (isNoReplyLeak ? '' : this.text.accumulatedText) || reply_dispatcher_types_1.EMPTY_REPLY_FALLBACK_TEXT;
                if (!segAnswer && !this.text.accumulatedText && !this.text.completedText) {
                    log.warn('reply completed without visible text, using empty-reply fallback');
                }
                // 等待图片异步解析（最多 15s），避免终态卡片留占位符
                const resolvedDisplayText = await this.imageResolver.resolveImagesAwait(displayText, 15_000);
                const idleToolUseDisplay = this.computeToolUseDisplay();
                const reasoningText = replay.reasoningText ?? (this.reasoning.accumulatedReasoningText || undefined);
                const terminalContent = prepareTerminalCardContent({
                    text: resolvedDisplayText,
                    reasoningText,
                }, this.imageResolver);
                const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
                const completeCard = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: idleToolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(idleToolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs: this.elapsed(),
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    workflowTimeline: (0, complete_replay_1.buildWorkflowTimeline)(this.segmentState, idleToolUseDisplay?.stepCount ?? 0),
                });
                if (idleEffectiveCardId) {
                    const seqBeforeUpdate = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.info('onIdle: updating final card', {
                        seqBefore: seqBeforeUpdate,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.updateCardKitCard)({
                        cfg: this.deps.cfg,
                        cardId: idleEffectiveCardId,
                        card: (0, builder_1.toCardKit2)(completeCard),
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
                else {
                    await (0, send_1.updateCardFeishu)({
                        cfg: this.deps.cfg,
                        messageId: this.cardKit.cardMessageId,
                        card: completeCard,
                        accountId: this.deps.accountId,
                    });
                }
                log.info('reply completed, card finalized', {
                    elapsedMs: this.elapsed(),
                    isCardKit: !!idleEffectiveCardId,
                });
            }
        }
        catch (err) {
            log.warn('final card update failed', { error: String(err) });
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    // ------------------------------------------------------------------
    // External control
    // ------------------------------------------------------------------
    markFullyComplete() {
        log.debug('markFullyComplete', {
            completedTextLen: this.text.completedText.length,
            accumulatedTextLen: this.text.accumulatedText.length,
        });
        this.dispatchFullyComplete = true;
    }
    /**
     * Activity-only mode terminal: remove the tool-activity card.
     *
     * The final reply is delivered as a separate static message, so the
     * ephemeral activity card must be deleted rather than finalized into
     * the answer. Failure to delete (e.g. permission) is non-fatal.
     */
    async deleteActivityCard(source) {
        try {
            if (this.cardKit.cardMessageId) {
                await (0, send_1.deleteMessageFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    accountId: this.deps.accountId,
                });
                log.info('activity card removed', { source, messageId: this.cardKit.cardMessageId });
            }
        }
        catch (err) {
            log.warn('activity card delete failed', { source, error: String(err) });
        }
        finally {
            this.transition('completed', 'deleteActivityCard', source);
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    async abortCard() {
        try {
            if (this.activityOnly) {
                await this.deleteActivityCard('abortCard');
                return;
            }
            this.captureToolUseElapsed();
            if (!this.transition('aborted', 'abortCard', 'abort'))
                return;
            // transition() already executed onEnterTerminalPhase (cancel + complete + dispose hook)
            // Only need to wait for any in-flight flush to finish
            await this.flush.waitForFlush();
            if (this.cardCreationPromise)
                await this.cardCreationPromise;
            const effectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
            const elapsedMs = Date.now() - this.dispatchStartTime;
            // 终态段快照：终结未关闭 tool 段 + 补算最后一个 reasoning elapsed
            this.finalizeSegmentState();
            const abortToolUseDisplay = this.computeToolUseDisplay();
            const replay = (0, complete_replay_1.replayTerminalContent)(this.segmentState);
            const segAnswer = replay.answerText || this.text.accumulatedText || '';
            const reasoningText = replay.reasoningText ?? (this.reasoning.accumulatedReasoningText || undefined);
            const terminalContent = prepareTerminalCardContent({
                text: segAnswer || 'Aborted.',
                reasoningText,
            }, this.imageResolver);
            const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
            if (effectiveCardId) {
                const abortCardContent = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: abortToolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(abortToolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs,
                    isAborted: true,
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    workflowTimeline: (0, complete_replay_1.buildWorkflowTimeline)(this.segmentState, abortToolUseDisplay?.stepCount ?? 0),
                });
                await this.closeStreamingAndUpdate(effectiveCardId, abortCardContent, 'abortCard');
                log.info('abortCard completed', { effectiveCardId });
            }
            else if (this.cardKit.cardMessageId) {
                // IM fallback: 卡片不是通过 CardKit 发的，用 im.message.patch 更新
                const abortCard = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: abortToolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(abortToolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs,
                    isAborted: true,
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    workflowTimeline: (0, complete_replay_1.buildWorkflowTimeline)(this.segmentState, abortToolUseDisplay?.stepCount ?? 0),
                });
                await (0, send_1.updateCardFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    card: abortCard,
                    accountId: this.deps.accountId,
                });
                log.info('abortCard completed (IM fallback)', {
                    messageId: this.cardKit.cardMessageId,
                });
            }
        }
        catch (err) {
            log.warn('abortCard failed', { error: String(err) });
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    // ------------------------------------------------------------------
    // Internal: card creation
    // ------------------------------------------------------------------
    async ensureCardCreated() {
        if (this.guard.shouldSkip('ensureCardCreated.precheck'))
            return;
        if (this.cardKit.cardMessageId || this.phase === 'creation_failed' || this.isTerminalPhase) {
            return;
        }
        if (this.cardCreationPromise) {
            await this.cardCreationPromise;
            return;
        }
        if (!this.transition('creating', 'ensureCardCreated'))
            return;
        this.createEpoch += 1;
        const epoch = this.createEpoch;
        this.cardCreationPromise = (async () => {
            try {
                try {
                    // Step 1: Create card entity
                    // 增量渲染（segment 模型）：初始卡 = 最小骨架（仅 loading 锚点）。
                    // reasoning/answer/tool 段按事件到达再 add_elements 插入到 loading
                    // 之前（insert_before），不再预渲染工具/思考面板，也不预建空 answer 占位。
                    const cId = await (0, cardkit_1.createCardEntity)({
                        cfg: this.deps.cfg,
                        card: (0, builder_1.buildSegmentSkeletonCard)(),
                        accountId: this.deps.accountId,
                    });
                    if (this.isStaleCreate(epoch)) {
                        log.info('ensureCardCreated: stale epoch after createCardEntity, bailing out', {
                            epoch,
                            phase: this.phase,
                        });
                        return;
                    }
                    if (cId) {
                        this.cardKit.cardKitCardId = cId;
                        this.cardKit.originalCardKitCardId = cId;
                        this.cardKit.cardKitSequence = 1;
                        this.disposeShutdownHook = (0, shutdown_hooks_1.registerShutdownHook)(`streaming-card:${cId}`, () => this.abortCard());
                        log.info('created CardKit entity', {
                            cardId: cId,
                            initialSequence: this.cardKit.cardKitSequence,
                        });
                        // Step 2: Send IM message referencing card_id
                        const result = await (0, cardkit_1.sendCardByCardId)({
                            cfg: this.deps.cfg,
                            to: this.deps.chatId,
                            cardId: cId,
                            replyToMessageId: this.deps.replyToMessageId,
                            replyInThread: this.deps.replyInThread,
                            accountId: this.deps.accountId,
                        });
                        if (this.isStaleCreate(epoch)) {
                            log.info('ensureCardCreated: stale epoch after sendCardByCardId, bailing out', {
                                epoch,
                                phase: this.phase,
                            });
                            this.disposeShutdownHook?.();
                            this.disposeShutdownHook = null;
                            return;
                        }
                        this.cardKit.cardMessageId = result.messageId;
                        this.flush.setCardMessageReady(true);
                        if (!this.transition('streaming', 'ensureCardCreated.cardkit')) {
                            this.disposeShutdownHook?.();
                            this.disposeShutdownHook = null;
                            return;
                        }
                        log.info('sent CardKit card', { messageId: result.messageId });
                    }
                    else {
                        throw new Error('card.create returned empty card_id');
                    }
                }
                catch (cardKitErr) {
                    if (this.isStaleCreate(epoch))
                        return;
                    if (this.guard.terminate('ensureCardCreated.cardkitFlow', cardKitErr)) {
                        return;
                    }
                    // CardKit flow failed — fall back to regular IM card
                    const apiDetail = extractApiDetail(cardKitErr);
                    log.warn('CardKit flow failed, falling back to IM', { apiDetail });
                    this.cardKit.cardKitCardId = null;
                    this.cardKit.originalCardKitCardId = null;
                    const fallbackCard = (0, builder_1.buildCardContent)('streaming', {
                        showToolUse: this.deps.toolUseDisplay.showToolUse,
                    });
                    const result = await (0, send_1.sendCardFeishu)({
                        cfg: this.deps.cfg,
                        to: this.deps.chatId,
                        card: fallbackCard,
                        replyToMessageId: this.deps.replyToMessageId,
                        replyInThread: this.deps.replyInThread,
                        accountId: this.deps.accountId,
                    });
                    if (this.isStaleCreate(epoch)) {
                        log.info('ensureCardCreated: stale epoch after IM fallback send, bailing out', {
                            epoch,
                            phase: this.phase,
                        });
                        return;
                    }
                    this.cardKit.cardMessageId = result.messageId;
                    this.flush.setCardMessageReady(true);
                    if (!this.transition('streaming', 'ensureCardCreated.imFallback')) {
                        return;
                    }
                    log.info('sent fallback IM card', { messageId: result.messageId });
                }
            }
            catch (err) {
                if (this.isStaleCreate(epoch))
                    return;
                if (this.guard.terminate('ensureCardCreated.outer', err)) {
                    return;
                }
                log.warn('thinking card failed, falling back to static', {
                    error: String(err),
                });
                this.transition('creation_failed', 'ensureCardCreated.outer', 'creation_failed');
            }
        })();
        await this.cardCreationPromise;
    }
    // ------------------------------------------------------------------
    // Internal: flush
    // ------------------------------------------------------------------
    /**
     * The single flush path for CardKit streaming — a two-layer update:
     *
     *  1. structural layer: new reasoning/answer/tool segments are inserted via
     *     batchUpdateCardKit (planSegmentFlush → batch actions), including the
     *     reasoning-panel finalize (Thinking… → Thought for Xs) partial update.
     *  2. text layer: dirty reasoning/answer text is streamed to its segment's
     *     element via streamCardContent (planSegmentFlush → streams).
     *
     * reasoning is delivered as a full snapshot (setReasoningSnapshot), so it is
     * always streamed wholesale to its text_el_id whenever the segment is dirty.
     *
     * The old full-card replace (updateCardKitCard with buildDisplayText) has been
     * removed; IM-patch fallback (no cardKitCardId) still builds a 'streaming' card.
     */
    async performFlush() {
        if (!this.cardKit.cardMessageId || this.isTerminalPhase)
            return;
        // v2 CardKit 卡片不能走 IM patch，如果流式 CardKit 已禁用但 originalCardKitCardId
        // 仍在，说明卡片是通过 CardKit 发的——跳过中间态更新，等终态用 originalCardKitCardId 收尾
        if (!this.cardKit.cardKitCardId && this.cardKit.originalCardKitCardId) {
            log.debug('performFlush: skipping (CardKit streaming disabled, awaiting final update)');
            return;
        }
        log.debug('flushCardUpdate: enter', {
            seq: this.cardKit.cardKitSequence,
            isCardKit: !!this.cardKit.cardKitCardId,
        });
        try {
            if (this.cardKit.cardKitCardId) {
                const display = this.computeToolUseDisplay();
                const toolSteps = Array.isArray(display?.steps) ? display.steps : [];
                // Snapshot which segments were already created BEFORE this flush so a
                // freshly-created (already-finalized) reasoning segment does not also
                // receive a redundant finalize partial_update in the same flush.
                const preCreated = new Set();
                for (const seg of this.segmentState.segments) {
                    if (seg.created)
                        preCreated.add(seg);
                }
                const plan = (0, flush_plan_1.planSegmentFlush)({
                    state: this.segmentState,
                    toolSteps,
                    consumeCreated: true,
                });
                // reasoning 段终结润色（结构层 partial_update）：思考结束（elapsed_ms 已补算）
                // 且段已创建 → 面板标题从 Thinking… 更新为 Thought for Xs 并折叠。
                for (const seg of this.segmentState.segments) {
                    if (seg.type === segments_1.SegmentType.REASONING
                        && seg.created && seg.elapsed_ms > 0 && !seg.reasoning_finalized) {
                        seg.reasoning_finalized = true;
                        if (preCreated.has(seg)) {
                            plan.actions.push((0, segments_render_1.buildReasoningFinalizedAction)(seg));
                        }
                    }
                }
                if (!plan.actions.length && !plan.streams.length) {
                    log.debug('flushCardUpdate: no segment changes, skipping');
                    return;
                }
                // 结构层：新建 reasoning/answer/tool 段 + reasoning finalize
                if (plan.actions.length) {
                    this.cardKit.cardKitSequence += 1;
                    await (0, cardkit_1.batchUpdateCardKit)({
                        cfg: this.deps.cfg,
                        cardId: this.cardKit.cardKitCardId,
                        actions: plan.actions,
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
                // 文本层：dirty answer / reasoning 增量刷到各自元素
                for (const stream of plan.streams) {
                    this.cardKit.cardKitSequence += 1;
                    await (0, cardkit_1.streamCardContent)({
                        cfg: this.deps.cfg,
                        cardId: this.cardKit.cardKitCardId,
                        elementId: stream.elementId,
                        content: stream.content,
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
            }
            else {
                log.debug('flushCardUpdate: IM patch fallback');
                const resolvedText = this.imageResolver.resolveImages(this.text.accumulatedText);
                const flushDisplay = this.computeToolUseDisplay();
                const card = (0, builder_1.buildCardContent)('streaming', {
                    text: this.reasoning.isReasoningPhase ? '' : resolvedText,
                    reasoningText: this.reasoning.isReasoningPhase ? this.reasoning.accumulatedReasoningText : undefined,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: flushDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(flushDisplay),
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                });
                await (0, send_1.updateCardFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    card,
                    accountId: this.deps.accountId,
                });
            }
        }
        catch (err) {
            if (this.guard.terminate('flushCardUpdate', err))
                return;
            const apiCode = (0, api_error_1.extractLarkApiCode)(err);
            // 速率限制（230020）— 跳过此帧，不降级
            if ((0, card_error_1.isCardRateLimitError)(err)) {
                log.info('flushCardUpdate: rate limited (230020), skipping', {
                    seq: this.cardKit.cardKitSequence,
                });
                return;
            }
            // 卡片表格数超出飞书限制（230099/11310）— 禁用 CardKit 流式，
            // 保留 originalCardKitCardId 供 onIdle 做最终 CardKit 更新
            if ((0, card_error_1.isCardTableLimitError)(err)) {
                log.warn('flushCardUpdate: card table limit exceeded (230099/11310), disabling CardKit streaming', {
                    seq: this.cardKit.cardKitSequence,
                });
                this.cardKit.cardKitCardId = null;
                return;
            }
            const apiDetail = extractApiDetail(err);
            log.error('card stream update failed', {
                apiCode,
                seq: this.cardKit.cardKitSequence,
                apiDetail,
            });
            if (this.cardKit.cardKitCardId) {
                log.warn('disabling CardKit streaming, falling back to im.message.patch');
                this.cardKit.cardKitCardId = null;
            }
        }
    }
    /**
     * Record the current tool activity (full step list from the trace store)
     * into the segment state so the tool panel can be built/updated incrementally.
     * No-op when there are no tool steps yet.
     */
    recordToolActivity() {
        const display = this.computeToolUseDisplay();
        const steps = Array.isArray(display?.steps) ? display.steps : [];
        if (steps.length > 0) {
            this.segmentState.onToolEvent(steps.length);
        }
    }
    /**
     * Terminal-time segment finalization: close any open tool segment and
     * back-fill the last open reasoning segment's elapsed. Returns the total
     * tool step count used (for the terminal complete-card rendering).
     */
    finalizeSegmentState() {
        const display = this.computeToolUseDisplay();
        const totalToolSteps = Array.isArray(display?.steps) ? display.steps.length : 0;
        this.segmentState.finalizeSegments(totalToolSteps);
        return totalToolSteps;
    }
    async throttledCardUpdate() {
        if (this.guard.shouldSkip('throttledCardUpdate'))
            return;
        const throttleMs = this.cardKit.cardKitCardId ? reply_dispatcher_types_1.THROTTLE_CONSTANTS.CARDKIT_MS : reply_dispatcher_types_1.THROTTLE_CONSTANTS.PATCH_MS;
        await this.flush.throttledUpdate(throttleMs);
    }
    // ---- Reasoning / tool-use status streaming (low-frequency) ----
    // 旧 updateToolUseStatus() 整卡 replace 已删除；改为把工具活动记录进 segmentState，
    // 触发节流 flush（performFlush 的 batchUpdate + streamCardContent 增量渲染）。
    lastToolUseStatusUpdateTime = 0;
    async throttledToolUseStatusUpdate() {
        if (!this.cardKit.cardKitCardId)
            return;
        const now = Date.now();
        if (now - this.lastToolUseStatusUpdateTime < reply_dispatcher_types_1.THROTTLE_CONSTANTS.REASONING_STATUS_MS)
            return;
        this.lastToolUseStatusUpdateTime = now;
        // (a) 记录工具活动到 segment 模型（推理阶段 onReasoningStream 已 setReasoningSnapshot）
        this.recordToolActivity();
        // (b) 触发节流增量 flush（不再整卡 replace）
        await this.throttledCardUpdate();
    }
    // ------------------------------------------------------------------
    // Internal: lifecycle helpers
    // ------------------------------------------------------------------
    finalizeCard(source, reason) {
        this.transition('completed', source, reason);
    }
    /**
     * Close streaming mode then update card content (shared by onError and abortCard).
     */
    async closeStreamingAndUpdate(cardId, card, label) {
        const seqBeforeClose = this.cardKit.cardKitSequence;
        this.cardKit.cardKitSequence += 1;
        log.info(`${label}: closing streaming mode`, {
            seqBefore: seqBeforeClose,
            seqAfter: this.cardKit.cardKitSequence,
        });
        await (0, cardkit_1.setCardStreamingMode)({
            cfg: this.deps.cfg,
            cardId,
            streamingMode: false,
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
        });
        const seqBeforeUpdate = this.cardKit.cardKitSequence;
        this.cardKit.cardKitSequence += 1;
        log.info(`${label}: updating card`, {
            seqBefore: seqBeforeUpdate,
            seqAfter: this.cardKit.cardKitSequence,
        });
        await (0, cardkit_1.updateCardKitCard)({
            cfg: this.deps.cfg,
            cardId,
            card: (0, builder_1.toCardKit2)(card),
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
        });
    }
}
exports.StreamingCardController = StreamingCardController;
// ---------------------------------------------------------------------------
// Error detail extraction helpers (replacing `any` casts)
// ---------------------------------------------------------------------------
/**
 * 终态卡片的正文和 reasoning 都会被飞书按 markdown 渲染，
 * 因此两者都要先做图片替换与表格降级，避免再次撞到 230099/11310。
 */
function prepareTerminalCardContent(content, imageResolver, tableLimit = card_error_1.FEISHU_CARD_TABLE_LIMIT) {
    const resolvedReasoningText = content.reasoningText ? imageResolver.resolveImages(content.reasoningText) : undefined;
    const resolvedText = imageResolver.resolveImages(content.text);
    const sanitizedSegments = (0, card_error_1.sanitizeTextSegmentsForCard)(resolvedReasoningText ? [resolvedReasoningText, resolvedText] : [resolvedText], tableLimit);
    if (resolvedReasoningText) {
        return {
            reasoningText: sanitizedSegments[0],
            text: sanitizedSegments[1],
        };
    }
    return { text: sanitizedSegments[0] };
}
function extractApiDetail(err) {
    if (!err || typeof err !== 'object')
        return String(err);
    const e = err;
    return e.response?.data ? JSON.stringify(e.response.data) : String(err);
}

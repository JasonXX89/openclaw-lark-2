"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pure functions for resolving the Feishu reply mode.
 *
 * Extracted from reply-dispatcher.ts to enable independent testing
 * and eliminate `as any` casts on FeishuConfig.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReplyMode = resolveReplyMode;
exports.expandAutoMode = expandAutoMode;
exports.shouldUseCard = shouldUseCard;
exports.isStreamingEnabled = isStreamingEnabled;
const card_error_1 = require("./card-error.js");
// ---------------------------------------------------------------------------
// resolveReplyMode
// ---------------------------------------------------------------------------
/**
 * Resolve the effective reply mode based on configuration and chat type.
 *
 * Priority: replyMode.{scene} > replyMode.default > replyMode (string) > "auto"
 */
function resolveReplyMode(params) {
    const { feishuCfg, chatType } = params;
    // streaming 总开关：仅"开启"时允许流式，未设置/关闭一律 static。
    // ⚠️ 兼容两种形式（2026-09-10 OpenClaw 2026.9.3 起会把它规范化成对象，
    // 官方归一化：boolean true ⇔ {mode:"partial"}，false ⇔ {mode:"off"}）：
    //   - 布尔：true / false（旧格式，手写配置）
    //   - 对象：{ mode: "off"|"partial"|"block"|"progress" }（新版官方格式）
    if (!isStreamingEnabled(feishuCfg?.streaming))
        return 'static';
    const replyMode = feishuCfg?.replyMode;
    if (!replyMode)
        return 'auto';
    if (typeof replyMode === 'string')
        return replyMode;
    // Object form: pick scene-specific value
    const sceneMode = chatType === 'group' ? replyMode.group : chatType === 'p2p' ? replyMode.direct : undefined;
    return sceneMode ?? replyMode.default ?? 'auto';
}
/**
 * 判断 streaming 配置是否"开启"。
 *
 * OpenClaw 2026.9.3 起官方把渠道的 streaming 统一规范化成对象形式
 * (`{mode: "off"|"partial"|"block"|"progress"}`)，并在配置迁移时把布尔值
 * 改写过去（官方归一化逻辑：`boolean ? "partial" : "off"`）。插件必须两种都认，
 * 否则升级后 streaming 恒判 false → 全部回退 static → 卡片不再出现。
 *
 * @param {unknown} streaming channels.feishu.streaming 原始配置值
 * @returns {boolean}
 */
function isStreamingEnabled(streaming) {
    // 旧格式：布尔
    if (streaming === true)
        return true;
    if (streaming === false || streaming == null)
        return false;
    // 新格式：对象或字符串（"off" 表示关闭，其余 mode 视为开启）
    if (typeof streaming === 'string')
        return streaming !== 'off';
    if (typeof streaming === 'object') {
        const mode = streaming.mode;
        if (mode == null)
            return true; // 对象但没写 mode：按开启处理（与官方 default 一致）
        return mode !== 'off';
    }
    return false;
}
// ---------------------------------------------------------------------------
// expandAutoMode
// ---------------------------------------------------------------------------
/**
 * Expand "auto" mode to a concrete mode based on streaming flag and chat type.
 *
 * When streaming 开启: group → static, direct → streaming (legacy behavior).
 * When streaming 未设置/关闭: always static (new default).
 * ⚠️ streaming 兼容布尔与对象两种形式，见 isStreamingEnabled。
 */
function expandAutoMode(params) {
    const { mode, streaming, chatType } = params;
    if (mode !== 'auto')
        return mode;
    return isStreamingEnabled(streaming) ? (chatType === 'group' ? 'static' : 'streaming') : 'static';
}
// ---------------------------------------------------------------------------
// shouldUseCard
// ---------------------------------------------------------------------------
/**
 * scope A: rich text now renders natively as post(`tag:md`); we never force a
 * card for code blocks OR tables anymore. Native rendering also keeps bot-at-bot
 * @ delivery working — wrapping a reply in a card breaks it (cards have limited
 * @ support). The only remaining card-path guard is the table-count hard limit,
 * retained for the runtime fallback in reply-dispatcher (card rejected by
 * Feishu → plain text).
 */
function shouldUseCard(text) {
    const tableMatches = (0, card_error_1.findMarkdownTablesOutsideCodeBlocks)(text);
    if (tableMatches.length > card_error_1.FEISHU_CARD_TABLE_LIMIT) {
        return false;
    }
    return false;
}

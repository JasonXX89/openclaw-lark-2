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
    // streaming 布尔总开关：仅 true 时允许流式，未设置或 false 一律 static
    if (feishuCfg?.streaming !== true)
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
// ---------------------------------------------------------------------------
// expandAutoMode
// ---------------------------------------------------------------------------
/**
 * Expand "auto" mode to a concrete mode based on streaming flag and chat type.
 *
 * When streaming === true: group → static, direct → streaming (legacy behavior).
 * When streaming is unset: always static (new default).
 */
function expandAutoMode(params) {
    const { mode, streaming, chatType } = params;
    if (mode !== 'auto')
        return mode;
    return streaming === true ? (chatType === 'group' ? 'static' : 'streaming') : 'static';
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

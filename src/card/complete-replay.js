"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 终态段重放（纯函数）—— 里程碑 B4 (b)：从 SegmentState 重放出 buildCompleteCard
 * 所需的 answerText / reasoningText，证明 segments 能产出与 controller 旧桶
 * (completedText / accumulatedReasoningText) 一致的终态内容。
 *
 * 不接 controller、不改 builder.js —— 先建立「segments → 终态文本」的等价层，
 * 供单测验证，也为将来 controller 4 个终态调用点切段重放提供可靠数据源。
 *
 * 语义对齐现有 buildCompleteCard 渲染：
 *   - answer = 所有 ANSWER 段按出现顺序 join('\n\n')
 *   - reasoning = 所有 REASONING 段的文本合成一个块（当前 UI 单 💭 面板语义），
 *     用 '\n\n' 分隔多轮思考
 *   - tool 步骤 / footer / metrics / elapsed 不由 segments 承载，仍由 controller
 *     终态从 trace store + 外部传入
 */

const { SegmentType } = require('./segments.js');

/**
 * 从 SegmentState 重放终态 answer / reasoning 文本。
 *
 * @param {import('./segments.js').SegmentState} state - SegmentState 实例
 * @returns {{ answerText: string, reasoningText: string | undefined, hasReasoning: boolean, hasAnswer: boolean }}
 *   - answerText    : 所有 answer 段拼接（可为空字符串）
 *   - reasoningText : 所有 reasoning 段拼接（无 reasoning 段时为 undefined）
 *   - hasReasoning  : 是否存在 reasoning 内容
 *   - hasAnswer     : 是否存在 answer 内容
 */
function replayTerminalContent(state) {
    const answerChunks = [];
    const reasoningChunks = [];
    for (const seg of state?.segments ?? []) {
        if (seg.type === SegmentType.REASONING && seg.text) {
            reasoningChunks.push(seg.text);
        }
        else if (seg.type === SegmentType.ANSWER && seg.text) {
            answerChunks.push(seg.text);
        }
    }
    const answerText = answerChunks.join('\n\n');
    const reasoningText = reasoningChunks.length > 0 ? reasoningChunks.join('\n\n') : undefined;
    return {
        answerText,
        reasoningText,
        hasReasoning: Boolean(reasoningText?.trim()),
        hasAnswer: Boolean(answerText.trim()),
    };
}

module.exports = {
    replayTerminalContent,
};

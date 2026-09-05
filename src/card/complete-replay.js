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

/**
 * 从 SegmentState 构建「工作流时间线」（纯函数）—— 供终态折叠面板展开后
 * 按真实发生顺序交错展示 思考块 / 工具步骤（💭 思考1 3s → 🔧 工具1 →
 * 💭 思考2 5s → 🔧 工具2 …）。
 *
 * 段模型天然保序：遍历 segments 时
 *   - REASONING 段 → { kind: 'reasoning', index, elapsedMs, text }
 *   - TOOL 段     → { kind: 'tools', index, from, to }（覆盖 [tool_offset,
 *     tool_end_offset) 区间，即该工具轮次实际包含的第 from+1..to 个工具步骤；
 *     未终结段用 totalToolSteps 收尾）
 *   - ANSWER 段   → 跳过（它是正文，不属于过程时间线）
 *
 * @param {import('./segments.js').SegmentState} state
 * @param {number} [totalToolSteps=0] 累计工具步骤数（收尾未终结 tool 段用）
 * @returns {Array<{kind:'reasoning'|'tools', index:number, elapsedMs?:number,
 *    text?:string, from?:number, to?:number}>} 有序时间线条目
 */
function buildWorkflowTimeline(state, totalToolSteps = 0) {
    const timeline = [];
    let reasoningSeq = 0;
    let toolGroupSeq = 0;
    for (const seg of state?.segments ?? []) {
        if (seg.type === SegmentType.REASONING) {
            reasoningSeq += 1;
            timeline.push({
                kind: 'reasoning',
                index: reasoningSeq,
                elapsedMs: typeof seg.elapsed_ms === 'number' && seg.elapsed_ms > 0 ? seg.elapsed_ms : undefined,
                text: seg.text || '',
            });
        }
        else if (seg.type === SegmentType.TOOL) {
            toolGroupSeq += 1;
            const from = typeof seg.tool_offset === 'number' ? seg.tool_offset : 0;
            const end = typeof seg.tool_end_offset === 'number' && seg.tool_end_offset > 0
                ? seg.tool_end_offset
                : totalToolSteps;
            timeline.push({
                kind: 'tools',
                index: toolGroupSeq,
                from,
                to: Math.max(from, end),
            });
        }
        // ANSWER 段跳过
    }
    return timeline;
}

module.exports = {
    replayTerminalContent,
    buildWorkflowTimeline,
};

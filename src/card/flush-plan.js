"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Flush 决策器（纯函数）—— 两层更新的"大脑"。
 *
 * 对应 hermes-fry-cards streaming/controller.py 的 flush 主循环（build & apply
 * batches + stream 目标的收集）。职责：给定当前 SegmentState 与元素预算状态，
 * 计算本次 flush 应该发送哪些 batchUpdateCardKit action、哪些 streamCardContent
 * 文本刷新（排除已有元素的重复 add）。不执行任何 IO。
 *
 * 输入约定（由调用方维护，见 src/card/segments.js）：
 *   seg.created  — 该段元素是否已在飞书卡上 add 过（决策器会更新为 true）
 *   seg.dirty    — 该段文本/内容有增量待刷（决策器会清 false）
 *
 * 返回：
 *   {
 *     actions: [CardKit action...],      // 传给 batchUpdateCardKit 的批量操作
 *     streams: [{ elementId, content }], // 传给 streamCardContent 的文本刷新
 *   }
 */

const { SegmentType } = require('./segments.js');
const {
    buildAddReasoningAction,
    buildAddAnswerAction,
    buildAddToolAction,
    buildReasoningFinalizedAction,
    buildToolUpdateAction,
} = require('./segments-render.js');

// ---------------------------------------------------------------------------
// Core decision
// ---------------------------------------------------------------------------

/**
 * 计算一次 flush 应发的 batch actions 与 stream 目标。
 *
 * @param {object} opts
 * @param {import('./segments.js').SegmentState} opts.state  - SegmentState 实例
 * @param {Array}  [opts.toolSteps=[]] - 全量工具步骤（tool 段渲染切片用）
 * @param {object} [opts.budget] - 元素预算（预留，本步为 { limit, toolMode } 接口，
 *   后续拆卡接入时使用；当前不动，由 controller 决定是否调用本函数）
 * @param {boolean} [opts.consumeCreated=true] - 是否把 created/dirty 标志推进
 *   （默认 true；false 用于只读规划/单测断言）
 * @returns {{ actions: Array, streams: Array }}
 */
function planSegmentFlush({ state, toolSteps = [], consumeCreated = true } = {}) {
    const actions = [];
    const streams = [];
    const toolStepMap = {};
    // toolSteps 可能是全量步骤或已切片；这里仅在需要 tool 切片渲染时用
    const stepsArr = Array.isArray(toolSteps) ? toolSteps : [];

    // 收集所有 tool 段，确定每个段渲染哪些步骤：已终结(tool_end_offset>0)取
    // [tool_offset, tool_end_offset)，未终结(tool_end_offset==0)取剩余全部。
    // tool 段共享面板时, 第一个未终结 tool 段把剩余步骤都渲染。为保证不重复
    // 渲染, 这里按"每个 tool 段覆盖的区间"推进游标。
    // (简化：同一时刻通常只有一个活跃 tool 段；多段时各自区间不重叠。)

    // 第一步：reasoning finalized —— 若 reasoning 段已创建且刚终结(有 elapsed
    // 且尚未发过 finalized action)，用一个 partial_update 收折叠面板标题。
    // 由 controller 在终结点调用 emitReasoningFinalized；此处不做。

    for (const seg of state.segments) {
        // ---- reasoning ----
        if (seg.type === SegmentType.REASONING) {
            if (!seg.created) {
                actions.push(buildAddReasoningAction(seg, seg.elapsed_ms || undefined));
                if (consumeCreated) seg.created = true;
            }
            if (seg.dirty) {
                // reasoning 文本走文本层（整段覆盖，快照语义）
                if (seg.text_el_id) {
                    streams.push({ elementId: seg.text_el_id, content: seg.text });
                }
                if (consumeCreated) seg.dirty = false;
            }
            continue;
        }

        // ---- answer ----
        if (seg.type === SegmentType.ANSWER) {
            if (!seg.created) {
                actions.push(buildAddAnswerAction(seg));
                if (consumeCreated) seg.created = true;
            }
            if (seg.dirty) {
                streams.push({ elementId: seg.el_id, content: seg.text });
                if (consumeCreated) seg.dirty = false;
            }
            continue;
        }

        // ---- tool ----
        if (seg.type === SegmentType.TOOL) {
            // tool_panel 是累计视图：内容 = 当前全部工具步骤（stepsArr 由调用方
            // 传入实时全量列表）。tool_panel 是共享单例——只允许 add 一次，之后
            // 所有更新走 partial_update（否则 Duplicate ID 300301）。
            if (!state.tool_panel_created) {
                actions.push(buildAddToolAction(seg, stepsArr, 0));
                if (consumeCreated) {
                    state.tool_panel_created = true;
                    seg.created = true;
                    seg.dirty = false;
                }
            }
            else if (seg.dirty || !seg.created) {
                // 面板已存在：整面板内容更新（partial_update 会替换 elements）。
                // 覆盖：① 已建 tool 段有新步骤（dirty）；② 多轮工具调用的新
                // tool 段（共享 tool_panel，不再 add，直接刷全量步骤）。
                actions.push(buildToolUpdateAction(seg.el_id, stepsArr, 0));
                if (consumeCreated) {
                    seg.created = true;
                    seg.dirty = false;
                }
            }
            continue;
        }
    }

    return { actions, streams };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    planSegmentFlush,
};

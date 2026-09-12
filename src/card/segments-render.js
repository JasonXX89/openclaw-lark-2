"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Segment → CardKit batch actions 构造模块（纯函数，无 IO）。
 *
 * 对应 hermes-fry-cards 的 segment_helper.py：
 *   build_add_segment_action / build_reasoning_finalized_action / build_tool_update_action
 *
 * 每个函数返回一个 action 对象，由调用方收集后传给 batchUpdateCardKit()。
 * 所有新建元素统一用 insert_before LOADING_ELEMENT_ID 定位。
 */

const { SegmentType } = require('./segments.js');
const { optimizeMarkdownStyle } = require('./markdown-style.js');
const { formatElapsed } = require('./builder.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** loading 图标 element_id（初始卡的锚点，新段 insert_before 定位目标） */
const LOADING_ELEMENT_ID = 'loading_icon';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 标准折叠面板图标（grey down arrow） */
function _standardGreyIcon() {
    return {
        tag: 'standard_icon',
        token: 'down-small-ccm_outlined',
        color: 'grey',
        size: '16px 16px',
    };
}

/** reasoning 面板标题（思考中 / 思考了 Xs） */
function _reasoningPanelTitle(elapsedMs) {
    const elapsedKnown = typeof elapsedMs === 'number' && elapsedMs > 0;
    const zh = elapsedKnown ? `💭 思考了 ${formatElapsed(elapsedMs)}` : '💭 思考中...';
    const en = elapsedKnown ? `💭 Thought for ${formatElapsed(elapsedMs)}` : '💭 Thinking...';
    return { tag: 'plain_text', content: en, i18n_content: { zh_cn: zh, en_us: en }, text_color: 'grey', text_size: 'notation' };
}

/** tool 面板标题 */
function _toolPanelTitle(stepCount, elapsedMs) {
    const enParts = ['Tool use'];
    const zhParts = ['工具调用中'];
    if (stepCount > 0) {
        enParts.push(`${stepCount} step${stepCount === 1 ? '' : 's'}`);
        zhParts.push(`${stepCount} 步`);
    }
    if (elapsedMs != null && elapsedMs > 0) {
        const d = formatElapsed(elapsedMs);
        enParts.push(`(${d})`);
        zhParts.push(`(${d})`);
    }
    return { tag: 'plain_text', content: `🛠️ ${enParts.join(' · ')}`, i18n_content: { zh_cn: `🛠️ ${zhParts.join(' · ')}`, en_us: `🛠️ ${enParts.join(' · ')}` }, text_color: 'grey', text_size: 'notation' };
}

// ---------------------------------------------------------------------------
// Builder functions (pure — return action objects for batchUpdateCardKit)
// ---------------------------------------------------------------------------

/**
 * 构造「新增 reasoning 段」的 batchUpdate action。
 *
 * reasoning 段 = collapsible_panel（expanded=false，思考中默认折叠，Jason 定稿
 * ——用户不被打断，想看时点开；不再思考中自动展开），
 * 内部有独立 text_el_id 供后续 streamCardContent 刷文本。
 *
 * @param {import('./segments.js').Segment} seg - reasoning 段（el_id + text_el_id 已分配）
 * @param {number} [elapsedMs] - 已知耗时（思考结束时传入，显示「思考了 Xs」）
 * @returns {{ action: string, params: object }}
 */
function buildAddReasoningAction(seg, elapsedMs) {
    return {
        action: 'add_elements',
        params: {
            type: 'insert_before',
            target_element_id: LOADING_ELEMENT_ID,
            elements: [{
                tag: 'collapsible_panel',
                expanded: false,
                header: {
                    title: _reasoningPanelTitle(elapsedMs),
                    vertical_align: 'center',
                    icon: _standardGreyIcon(),
                    icon_position: 'right',
                    icon_expanded_angle: -180,
                },
                border: { color: 'grey', corner_radius: '5px' },
                vertical_spacing: '4px',
                padding: '8px 8px 8px 8px',
                element_id: seg.el_id,
                elements: [{
                    tag: 'markdown',
                    content: optimizeMarkdownStyle(seg.text || ' '),
                    text_size: 'notation',
                    element_id: seg.text_el_id,
                }],
            }],
        },
    };
}

/**
 * 构造「新增 answer 段」的 batchUpdate action。
 *
 * answer = 单个 markdown 元素（流式文本主通道），后续 streamCardContent 刷内容。
 *
 * @param {import('./segments.js').Segment} seg - answer 段（el_id 已分配）
 * @returns {{ action: string, params: object }}
 */
function buildAddAnswerAction(seg) {
    return {
        action: 'add_elements',
        params: {
            type: 'insert_before',
            target_element_id: LOADING_ELEMENT_ID,
            elements: [{
                tag: 'markdown',
                content: optimizeMarkdownStyle(seg.text || ''),
                text_size: 'normal_v2',
                element_id: seg.el_id,
            }],
        },
    };
}

/**
 * 构造「新增 tool 段」的 batchUpdate action。
 *
 * tool 段共享一个 tool_panel（el_id = 'tool_panel'），
 * 内含所有工具步骤的折叠面板 + 结构化步骤明细。
 *
 * @param {import('./segments.js').Segment} seg - tool 段（el_id = 'tool_panel'）
 * @param {Array} steps - 当前 tool 段覆盖范围的步骤列表 [tool_offset, tool_end_offset)
 * @param {number} [elapsedMs] - 工具执行总耗时
 * @returns {{ action: string, params: object }}
 */
function buildAddToolAction(seg, steps, elapsedMs) {
    return {
        action: 'add_elements',
        params: {
            type: 'insert_before',
            target_element_id: LOADING_ELEMENT_ID,
            elements: [{
                tag: 'collapsible_panel',
                expanded: true,
                header: {
                    title: _toolPanelTitle(steps.length, elapsedMs),
                    vertical_align: 'center',
                    icon: _standardGreyIcon(),
                    icon_position: 'right',
                    icon_expanded_angle: -180,
                },
                border: { color: 'grey', corner_radius: '5px' },
                vertical_spacing: '4px',
                padding: '8px 8px 8px 8px',
                element_id: seg.el_id,
                elements: steps.flatMap((step) => buildToolStepElements(step)),
            }],
        },
    };
}

/**
 * 构造「reasoning 已终结」的 partial_update_element action。
 *
 * 思考结束后：panel 标题从「💭 思考中...」更新为「💭 Thought for Xs」，
 * 同时 panel 折叠（expanded=false）。
 *
 * @param {import('./segments.js').Segment} seg - 已终结的 reasoning 段
 * @returns {{ action: string, params: object }}
 */
function buildReasoningFinalizedAction(seg) {
    return {
        action: 'partial_update_element',
        params: {
            element_id: seg.el_id,
            partial_element: {
                expanded: false,
                header: {
                    title: _reasoningPanelTitle(seg.elapsed_ms),
                    // ⚠️ partial_update_element 的 header 是整块替换语义——只写 title
                    // 会把 add 时的 icon（右侧箭头）冲掉，思考终结后面板失去展开/收起
                    // 提示（2026-09-08 Jason 实测）。必须带全 header 其余字段。
                    vertical_align: 'center',
                    icon: _standardGreyIcon(),
                    icon_position: 'right',
                    icon_expanded_angle: -180,
                },
            },
        },
    };
}

/**
 * 构造「tool panel 内容更新」的 partial_update_element action。
 *
 * 新工具步骤到达时，更新 panel 内的子元素列表（不重建 panel）。
 *
 * @param {string} elementId - tool panel 的 element_id
 * @param {Array} steps - 更新后的完整步骤列表
 * @param {number} [elapsedMs] - 工具执行总耗时
 * @returns {{ action: string, params: object }}
 */
function buildToolUpdateAction(elementId, steps, elapsedMs) {
    return {
        action: 'partial_update_element',
        params: {
            element_id: elementId,
            partial_element: {
                header: {
                    title: _toolPanelTitle(steps.length, elapsedMs),
                    // ⚠️ partial_update_element 的 header 是整块替换语义——只写 title
                    // 会把 add 时的 icon（右侧箭头）冲掉，工具更新后面板失去展开/收起
                    // 提示（2026-09-11 Jason 实测）。必须带全 header 其余字段。
                    vertical_align: 'center',
                    icon: _standardGreyIcon(),
                    icon_position: 'right',
                    icon_expanded_angle: -180,
                },
                elements: steps.flatMap((step) => buildToolStepElements(step)),
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Tool step element builders (internal, extracted from builder.js pattern)
// ---------------------------------------------------------------------------

function buildToolStepElements(step) {
    const elements = [buildToolStepTitleElement(step)];
    const detailEl = buildToolStepDetailElement(step);
    if (detailEl) elements.push(detailEl);
    const outputEl = buildToolStepOutputElement(step);
    if (outputEl) elements.push(outputEl);
    return elements;
}

function buildToolStepTitleElement(step) {
    const iconToken = step.status === 'completed'
        ? 'circle-ok-2_outlined'
        : step.status === 'failed'
            ? 'close-circle-2_outlined'
            : 'time_outlined';
    const statusColor = step.status === 'completed'
        ? 'green'
        : step.status === 'failed'
            ? 'red'
            : 'grey';
    return {
        tag: 'div',
        text: {
            tag: 'lark_md',
            content: `**${step.name ?? 'Tool'}** · <font color='${statusColor}'>${step.statusText ?? step.status ?? 'pending'}</font>`,
        },
    };
}

function buildToolStepDetailElement(step) {
    if (!step.detail) return null;
    return {
        tag: 'div',
        text: {
            tag: 'plain_text',
            content: step.detail,
            text_size: 'notation',
            text_color: 'grey',
        },
        margin: '0px 0px 0px 22px',
    };
}

function buildToolStepOutputElement(step) {
    const output = step.output || step.error;
    if (!output) return null;
    return {
        tag: 'div',
        text: {
            tag: 'lark_md',
            content: step.error ? `<font color='red'>${output}</font>` : output,
        },
        margin: '0px 0px 0px 22px',
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    LOADING_ELEMENT_ID,
    buildAddReasoningAction,
    buildAddAnswerAction,
    buildAddToolAction,
    buildReasoningFinalizedAction,
    buildToolUpdateAction,
    // Exported for testing
    _buildToolStepElements: buildToolStepElements,
};

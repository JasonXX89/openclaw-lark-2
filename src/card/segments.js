"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Segment 流式模型 — 移植 hermes-fry-cards 的 streaming/segments.py 到 JS。
 *
 * 整条回复 = 扁平 segment 列表（reasoning / answer / tool），按事件到达顺序排列，
 * 是卡片内容与顺序的单一事实源。控制器不再维护三个独立状态桶(text/reasoning/toolUse)
 * 靠 phase 猜布局，而是所有回调把 delta 喂进这里，渲染层按顺序增量建卡。
 *
 * 纯数据逻辑，无 IO，可独立单测。
 */

// 元素类型
const SegmentType = {
    REASONING: 'reasoning',
    ANSWER: 'answer',
    TOOL: 'tool',
};

// 元素预算阈值（对齐飞书硬上限 200，预留 20；薯条 ELEMENT_THRESHOLD=180）
const ELEMENT_THRESHOLD = 180;
const FOOTER_RESERVE = 2;
// 单段元素估算（对齐薯条 estimate_segment_elements）
const ESTIMATES = {
    REASONING_PANEL: 4, // collapsible_panel + plain_text + standard_icon + markdown
    ANSWER: 1,
    TOOL_STEP_BASE: 3, // panel/header + title(div+icon+lark_md)... 用 toolUseSteps 累计代替
};

/**
 * 单个内容段 — reasoning / answer / tool。
 */
class Segment {
    constructor(segType, elId) {
        this.type = SegmentType[segType] || segType;
        // 容器 element id（collapsible_panel / answer markdown el）
        this.el_id = elId;
        this.created = false; // 已在飞书卡上创建（batch_update）？
        this.dirty = true; // 文本有增量待刷（streamCardContent）？
        this.text = '';
        // reasoning 段的文本子元素 id（面板内部 markdown，供 streamCardContent 刷）
        this.text_el_id = '';
        // tool 段：该段覆盖的工具步骤区间 [tool_offset, tool_end_offset)
        this.tool_offset = 0;
        this.tool_end_offset = 0; // 0 = 未终结；>=1 表示已终结
        this.start_time = 0;
        this.elapsed_ms = 0;
        this.reasoning_finalized = false;
        this.element_estimate = 0;
    }
}

/**
 * 管理单张流式卡片的扁平内容段列表。
 * 纯数据类，不含 IO。按事件到达顺序 append；同类型合并，跨类型新建。
 */
class SegmentState {
    constructor(maxReasoningPanels = 3) {
        this._counter = 0;
        this.segments = [];
        // reasoning 独立面板上限，超出合并进最后一个（防 thinking/tool 交替爆炸）
        this.max_reasoning_panels = maxReasoningPanels;
    }

    _nextElId(prefix) {
        const c = this._counter;
        this._counter += 1;
        return `${prefix}_${c}`;
    }

    _finalizePrevReasoning(now) {
        // 终结最后一个未计耗时的 reasoning segment
        for (let i = this.segments.length - 1; i >= 0; i--) {
            const seg = this.segments[i];
            if (seg.type === SegmentType.REASONING && seg.start_time && !seg.elapsed_ms) {
                seg.elapsed_ms = (now - seg.start_time) * 1000;
                break;
            }
        }
    }

    _newReasoning(text) {
        const seg = new Segment(SegmentType.REASONING, this._nextElId('reasoning_panel'));
        seg.text_el_id = this._nextElId('reasoning_text');
        seg.text = text;
        seg.start_time = Date.now();
        this.segments.push(seg);
        return seg;
    }

    _newAnswer(text) {
        const seg = new Segment(SegmentType.ANSWER, this._nextElId('answer'));
        seg.text = text;
        seg.start_time = Date.now();
        this._finalizePrevReasoning(seg.start_time);
        this.segments.push(seg);
        return seg;
    }

    _newTool(toolOffset) {
        const seg = new Segment(SegmentType.TOOL, 'tool_panel'); // 所有 tool 段共享底部面板
        seg.tool_offset = toolOffset;
        seg.start_time = Date.now();
        this._finalizePrevReasoning(seg.start_time);
        this.segments.push(seg);
        return seg;
    }

    /** reasoning delta：末段同型则追加，否则按上限合并或新建。 */
    onReasoningDelta(text) {
        if (!text) return;
        const last = this.segments[this.segments.length - 1];
        if (last && last.type === SegmentType.REASONING) {
            last.text += text;
            last.dirty = true;
            return;
        }
        // 已达面板上限：合并进最后一个 reasoning 段，不新建
        let reasoningCount = 0;
        for (const s of this.segments) {
            if (s.type === SegmentType.REASONING) reasoningCount += 1;
        }
        if (reasoningCount >= this.max_reasoning_panels) {
            for (let i = this.segments.length - 1; i >= 0; i--) {
                const s = this.segments[i];
                if (s.type === SegmentType.REASONING) {
                    s.text += text;
                    s.dirty = true;
                    return;
                }
            }
        }
        this._newReasoning(text);
    }

    /** answer delta：同型追加否则新建。 */
    onAnswerDelta(text) {
        if (!text) return;
        const last = this.segments[this.segments.length - 1];
        if (last && last.type === SegmentType.ANSWER) {
            last.text += text;
            last.dirty = true;
        } else {
            this._newAnswer(text);
        }
    }

    /** 工具轮次事件：新 tool 段（或终结前序 tool 段）。toolStepCount = 累计步骤数。 */
    onToolEvent(toolStepCount) {
        if (!toolStepCount || toolStepCount <= 0) return;
        const last = this.segments[this.segments.length - 1];
        if (last && last.type === SegmentType.TOOL) {
            last.dirty = true;
            return;
        }
        // 终结上一个未终结 tool 段（它在 [tool_offset, toolStepCount-1) 区间）
        for (let i = this.segments.length - 1; i >= 0; i--) {
            const s = this.segments[i];
            if (s.type === SegmentType.TOOL && s.tool_end_offset === 0) {
                s.tool_end_offset = toolStepCount - 1;
                s.dirty = true;
                break;
            }
        }
        this._newTool(toolStepCount - 1);
    }

    splitToolSegment(index, splitToolOffset) {
        const seg = this.segments[index];
        const newSeg = new Segment(SegmentType.TOOL, `tool_panel_${this._nextElId('split')}`);
        newSeg.tool_offset = splitToolOffset;
        newSeg.tool_end_offset = seg.tool_end_offset;
        newSeg.start_time = seg.start_time;
        seg.tool_end_offset = splitToolOffset;
        seg.dirty = true;
        this.segments.splice(index + 1, 0, newSeg);
        return newSeg;
    }

    /** 完成态：终结最后一个 tool 段 + 补算最后一个 reasoning elapsed。 */
    finalizeSegments(totalToolCount) {
        const now = Date.now();
        for (let i = this.segments.length - 1; i >= 0; i--) {
            const s = this.segments[i];
            if (s.type === SegmentType.TOOL && s.tool_end_offset === 0) {
                s.tool_end_offset = totalToolCount;
                break;
            }
        }
        for (let i = this.segments.length - 1; i >= 0; i--) {
            const s = this.segments[i];
            if (s.type === SegmentType.REASONING && s.start_time && !s.elapsed_ms) {
                s.elapsed_ms = (now - s.start_time) * 1000;
                break;
            }
        }
    }

    hasDirty() {
        return this.segments.some((s) => s.dirty);
    }

    get answerText() {
        return this.segments
            .filter((s) => s.type === SegmentType.ANSWER)
            .map((s) => s.text)
            .join('\n\n');
    }

    /** 完整可见文本（reasoning + answer），供摘要/纯文本回退用。 */
    get allText() {
        return this.segments
            .map((s) => s.text)
            .filter(Boolean)
            .join('\n\n');
    }
}

// 预算估算（对齐薯条 segment_helper）
function estimateSegmentElements(seg) {
    if (seg.type === SegmentType.REASONING) return ESTIMATES.REASONING_PANEL;
    if (seg.type === SegmentType.ANSWER) return ESTIMATES.ANSWER;
    // tool 段元素数由步骤决定，调用方用 estimateToolElements 算
    return 0;
}

/**
 * 估算 tool 段在 [start,end) 步骤区间的元素数。
 * 每步：title(div+icon+lark_md) 结构近似 3，detail/output 另加。
 * 简化：用一个基础面板 + 每步固定开销（对齐薯条但降精度换取简单）。
 */
function estimateToolElements(start, end, steps) {
    let count = 3; // panel/header 基础元素
    const segSteps = steps.slice(start, end);
    for (const step of segSteps) {
        count += 3; // title div+icon+markdown
        if (step && step.detail) count += 1;
        if (step && (step.output || step.error)) count += 1;
    }
    return count;
}

module.exports = {
    SegmentType,
    Segment,
    SegmentState,
    ELEMENT_THRESHOLD,
    FOOTER_RESERVE,
    estimateSegmentElements,
    estimateToolElements,
};

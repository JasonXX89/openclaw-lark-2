import { describe, it, expect } from 'vitest';
import { planSegmentFlush } from '../../src/card/flush-plan.js';
import { SegmentState, SegmentType } from '../../src/card/segments.js';

const LOADING = 'loading_icon';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Create a state and simulate reasoning streamed over multiple flushes
function makeReasoningState() {
    const s = new SegmentState();
    s.onReasoningDelta('思考中');
    return s;
}

// ---------------------------------------------------------------------------
// reasoning: create then stream text
// ---------------------------------------------------------------------------

describe('planSegmentFlush — reasoning 段', () => {
    it('首次 flush：发出 add action（reasoning 面板），无 stream（文本在建卡时内联）', () => {
        const s = makeReasoningState();
        const { actions, streams } = planSegmentFlush({ state: s });
        expect(actions).toHaveLength(1);
        expect(actions[0].action).toBe('add_elements');
        expect(actions[0].params.type).toBe('insert_before');
        expect(actions[0].params.target_element_id).toBe(LOADING);
        expect(actions[0].params.elements[0].tag).toBe('collapsible_panel');
        // created 推进
        expect(s.segments[0].created).toBe(true);
        expect(s.segments[0].dirty).toBe(false);
    });

    it('再次 flush：面板已建，无 add；文本增量走 stream 目标', () => {
        const s = makeReasoningState();
        planSegmentFlush({ state: s }); // 第一次：add
        s.onReasoningDelta('更多思考'); // 新 delta
        const { actions, streams } = planSegmentFlush({ state: s });
        expect(actions).toHaveLength(0);
        expect(streams).toHaveLength(1);
        expect(streams[0].elementId).toBe(s.segments[0].text_el_id);
        expect(streams[0].content).toContain('思考中更多思考');
        expect(s.segments[0].dirty).toBe(false);
    });

    it('无 dirty 无新增段时返回空', () => {
        const s = makeReasoningState();
        planSegmentFlush({ state: s });
        const { actions, streams } = planSegmentFlush({ state: s });
        expect(actions).toHaveLength(0);
        expect(streams).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// answer: appended segment ordering
// ---------------------------------------------------------------------------

describe('planSegmentFlush — answer 段 + reasoning/answer 交错', () => {
    it('reasoning 段创建后出现 answer 段：第二次 flush 只 add answer', () => {
        const s = makeReasoningState();
        planSegmentFlush({ state: s }); // reasoning add
        s.onAnswerDelta('回答文本'); // 终结 reasoning → 新 answer 段
        const { actions } = planSegmentFlush({ state: s });
        // answer 段未 created → 1 个 add（answer）
        expect(actions).toHaveLength(1);
        expect(actions[0].params.elements[0].tag).toBe('markdown');
        const answerSeg = s.segments.find((x) => x.type === SegmentType.ANSWER);
        expect(actions[0].params.elements[0].element_id).toBe(answerSeg.el_id);
    });

    it('answer 增量走 stream（element_id = answer 段 el_id）', () => {
        const s = new SegmentState();
        s.onAnswerDelta('开始');
        const answerSeg = s.segments[0];
        planSegmentFlush({ state: s });
        s.onAnswerDelta('继续'); // 追加到同一 answer 段
        const { streams } = planSegmentFlush({ state: s });
        expect(streams).toHaveLength(1);
        expect(streams[0].elementId).toBe(answerSeg.el_id);
        expect(streams[0].content).toBe('开始继续');
    });

    it('同一 flush 内未消费标志（consumeCreated=false）时不推进', () => {
        const s = new SegmentState();
        s.onAnswerDelta('x');
        const before = {
            created: s.segments[0].created,
            dirty: s.segments[0].dirty,
        };
        planSegmentFlush({ state: s, consumeCreated: false });
        expect(s.segments[0].created).toBe(before.created);
        expect(s.segments[0].dirty).toBe(before.dirty);
    });
});

// ---------------------------------------------------------------------------
// tool: slice rendering
// ---------------------------------------------------------------------------

describe('planSegmentFlush — tool 段', () => {
    const steps = [
        { name: 'search', status: 'completed', statusText: 'Done' },
        { name: 'read', status: 'completed', statusText: 'Done' },
        { name: 'write', status: 'running' },
    ];

    it('首次 tool 段创建：add 面板（tool_panel_created=true），内容为全部步骤', () => {
        const s = new SegmentState();
        s.onToolEvent(1); // 第一个工具步骤，tool_offset=0
        s.segments.forEach((seg) => {
            if (seg.type === SegmentType.TOOL) {
                seg.tool_end_offset = 0; // 未终结
            }
        });
        const { actions } = planSegmentFlush({ state: s, toolSteps: steps });
        const toolAct = actions.find((a) => a.action === 'add_elements');
        expect(toolAct).toBeTruthy();
        expect(s.tool_panel_created).toBe(true);
        const panel = toolAct.params.elements[0];
        expect(panel.tag).toBe('collapsible_panel');
        // 内容 = 全部 3 步骤
        expect(panel.elements.length).toBeGreaterThanOrEqual(3);
    });

    it('面板已创建后新 tool 段出现：不再 add（防 Duplicate ID），改 partial_update', () => {
        const s = new SegmentState();
        s.onToolEvent(1); // 第一轮工具
        planSegmentFlush({ state: s, toolSteps: steps.slice(0, 1) });
        expect(s.tool_panel_created).toBe(true);
        // 第二轮工具：跨型（先 reasoning 或 answer 再 tool）产生新 TOOL 段
        s.onAnswerDelta('中间回答'); // 终结第一轮 tool
        s.onToolEvent(3); // 第二轮：tool_offset=2
        const toolSegs = s.segments.filter((x) => x.type === SegmentType.TOOL);
        expect(toolSegs).toHaveLength(2); // 两个 TOOL 段，共享 tool_panel
        const { actions } = planSegmentFlush({ state: s, toolSteps: steps });
        // 没有 add_elements tool_panel（避免 Duplicate ID）
        const addActs = actions.filter((a) => a.action === 'add_elements'
            && a.params?.elements?.[0]?.element_id === 'tool_panel');
        expect(addActs).toHaveLength(0);
        // 有 partial_update 更新面板
        const updActs = actions.filter((a) => a.action === 'partial_update_element'
            && a.params?.element_id === 'tool_panel');
        expect(updActs.length).toBeGreaterThanOrEqual(1);
    });

    it('已终结 tool 段首建：add 面板含全部步骤（累计视图，非仅区间）', () => {
        const s = new SegmentState();
        s.onToolEvent(1); // tool segment tool_offset=0, end 未设
        const toolSeg = s.segments.find((x) => x.type === SegmentType.TOOL);
        toolSeg.tool_end_offset = 2; // 终结（但面板未建，仍整体 add）
        const { actions } = planSegmentFlush({ state: s, toolSteps: steps });
        const panel = actions[0].params.elements[0];
        // 累计视图：全部 3 步骤 → title 3 steps
        expect(panel.header.title.content).toContain('3 steps');
    });
});

// ---------------------------------------------------------------------------
// mixed full flow
// ---------------------------------------------------------------------------

describe('planSegmentFlush — 全流程（reasoning→answer→tool→answer）', () => {
    it('每段首次出现只 add 一次，后续走 stream/局部更新', () => {
        const s = new SegmentState();
        const toolSteps = [
            { name: 't1', status: 'completed', statusText: 'Done' },
        ];

        // reasoning
        s.onReasoningDelta('R');
        expect(planSegmentFlush({ state: s }).actions).toHaveLength(1);

        // reasoning continue → stream
        s.onReasoningDelta('R2');
        expect(planSegmentFlush({ state: s }).actions).toHaveLength(0);
        expect(planSegmentFlush({ state: s }).streams).toHaveLength(0); // 已消费

        // answer appears
        s.onAnswerDelta('A');
        const a = planSegmentFlush({ state: s });
        expect(a.actions.filter((x) => x.action === 'add_elements')).toHaveLength(1);

        // answer continue → stream
        s.onAnswerDelta('A2');
        const a2 = planSegmentFlush({ state: s });
        expect(a2.actions).toHaveLength(0);
        expect(a2.streams).toHaveLength(1);

        // tool appears → add tool panel
        s.onToolEvent(1);
        const t = planSegmentFlush({ state: s, toolSteps });
        expect(t.actions.filter((x) => x.action === 'add_elements')).toHaveLength(1);
        // 此时还残留一个 dirty 的 answer？onToolEvent 不改 answer；answer 上轮已消费
        expect(t.actions.filter((x) => x.params?.elements?.[0]?.tag === 'markdown')).toHaveLength(0);
    });
});

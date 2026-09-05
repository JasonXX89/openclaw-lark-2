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

    it('未终结 tool 段创建：渲染 tool_offset 到剩余全部', () => {
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
        const panel = toolAct.params.elements[0];
        expect(panel.tag).toBe('collapsible_panel');
        // slice = [0, 3)
        expect(panel.elements.length).toBeGreaterThanOrEqual(3);
    });

    it('已终结 tool 段创建：只渲染其区间 [tool_offset, tool_end_offset)', () => {
        const s = new SegmentState();
        s.onToolEvent(1); // tool segment tool_offset=0, end 未设
        const toolSeg = s.segments.find((x) => x.type === SegmentType.TOOL);
        toolSeg.tool_end_offset = 2; // 终结：只含 step[0..2)
        const { actions } = planSegmentFlush({ state: s, toolSteps: steps });
        const panel = actions[0].params.elements[0];
        // 只有 2 个步骤 → title 2 steps
        expect(panel.header.title.content).toContain('2 steps');
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

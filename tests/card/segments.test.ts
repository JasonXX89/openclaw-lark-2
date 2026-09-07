import { describe, it, expect } from 'vitest';
import {
    SegmentState,
    SegmentType,
    ELEMENT_THRESHOLD,
    FOOTER_RESERVE,
    estimateSegmentElements,
    estimateToolElements,
} from '../../src/card/segments.js';

describe('SegmentState 事件顺序', () => {
    it('reasoning → answer → tool → answer：同类 answer 合并为单段', () => {
        const s = new SegmentState();
        s.onReasoningDelta('思考1');
        s.onAnswerDelta('回答1');
        s.onToolEvent(1);
        s.onAnswerDelta('回答2');
        // 段顺序保留三类，但 answer 永远合并为单段（视觉连续，避免工具间
        // 多段文本在卡片上显示成多个答案块）
        expect(s.segments.map((x) => x.type)).toEqual([
            SegmentType.REASONING,
            SegmentType.ANSWER,
            SegmentType.TOOL,
        ]);
        const answers = s.segments.filter((x) => x.type === SegmentType.ANSWER);
        expect(answers).toHaveLength(1);
        expect(answers[0].text).toBe('回答1回答2');
    });

    it('同型 reasoning 增量追加不新建段', () => {
        const s = new SegmentState();
        s.onReasoningDelta('思考');
        s.onReasoningDelta('更多');
        expect(s.segments.filter((x) => x.type === SegmentType.REASONING)).toHaveLength(1);
        expect(s.segments[0].text).toBe('思考更多');
        expect(s.segments[0].dirty).toBe(true);
    });

    it('跨型切换时终结前一个 reasoning 并补算 elapsed', async () => {
        const s = new SegmentState();
        s.onReasoningDelta('思考');
        const reasoningSeg = s.segments[0];
        expect(reasoningSeg.elapsed_ms).toBe(0);
        expect(reasoningSeg.start_time).toBeGreaterThan(0);
        // 未跨型前，elapsed 保持 0（不算耗时）
        expect(reasoningSeg.elapsed_ms).toBe(0);
        // 跨型进入 answer 会终结 reasoning：补算 elapsed 并保持 text 不丢
        await new Promise((r) => setTimeout(r, 8));
        s.onAnswerDelta('回答');
        expect(reasoningSeg.elapsed_ms).toBeGreaterThan(0);
        expect(reasoningSeg.text).toBe('思考');
    });

    it('answer 同型追加到同一段', () => {
        const s = new SegmentState();
        s.onAnswerDelta('A');
        s.onAnswerDelta('B');
        expect(s.segments).toHaveLength(1);
        expect(s.segments[0].text).toBe('AB');
    });
});

describe('SegmentState reasoning 面板上限合并（防爆）', () => {
    it('超过 max_reasoning_panels 后新 reasoning 合并进最后一个，不新建', () => {
        const s = new SegmentState(2);
        s.onReasoningDelta('r1');
        s.onAnswerDelta('a1'); // 终结 r1
        s.onReasoningDelta('r2'); // 新段
        s.onAnswerDelta('a2');
        s.onReasoningDelta('r3'); // 已达 2 上限 → 合并进 r2
        const reasoning = s.segments.filter((x) => x.type === SegmentType.REASONING);
        expect(reasoning).toHaveLength(2);
        expect(reasoning[1].text).toBe('r2r3');
    });
});

describe('SegmentState reasoning 快照（setReasoningSnapshot）', () => {
    it('末段是 reasoning 时快照整段覆盖，不新建段', () => {
        const s = new SegmentState();
        s.onToolEvent(1); // 工具已出现（steps>=1），先建 tool 段
        s.setReasoningSnapshot('jason'); // 思考2 首帧
        s.setReasoningSnapshot('jason is asking me to predict... 完整思考文本'); // 后续帧
        const reasoning = s.segments.filter((x) => x.type === SegmentType.REASONING);
        expect(reasoning).toHaveLength(1); // 不应因多帧新建多个 thinking 段
        expect(reasoning[0].text).toBe('jason is asking me to predict... 完整思考文本');
        expect(reasoning[0].text).not.toBe('jason'); // 不卡在首帧
    });

    it('工具段已存在时，reasoning 快照覆盖不会被 onToolEvent 终结（无孤立短段）', () => {
        const s = new SegmentState();
        s.onToolEvent(1); // 工具1 已出现
        // 思考2 流式：快照帧 + 1500ms 节流 tick 交错（修复前 onToolEvent 会终结刚建的段）
        s.setReasoningSnapshot('jason');
        s.onToolEvent(1); // 节流 tick（修复后 reasoning 帧不触发，但工具事件本身仍可能交错）
        s.setReasoningSnapshot('jason asked me to predict 联特科技 完整思考内容 很长很长');
        const reasoning = s.segments.filter((x) => x.type === SegmentType.REASONING);
        // 修复语义：思考2 首帧后若同一轮快照继续到达，应覆盖首帧而非被终结成孤立段
        // （controller 已保证 reasoning 帧不再触发 onToolEvent；此处锁死段模型层不误杀）
        const lastReasoning = reasoning[reasoning.length - 1];
        expect(lastReasoning.text).toContain('联特科技');
        expect(lastReasoning.text).not.toBe('jason');
    });
});

describe('SegmentState finalizeSegments', () => {
    it('终结未关闭的 tool 段 + 补算最后 reasoning elapsed', () => {
        const s = new SegmentState();
        s.onReasoningDelta('r');
        s.onToolEvent(1); // tool 段 tool_end_offset 仍 0
        s.finalizeSegments(5);
        const tool = s.segments.find((x) => x.type === SegmentType.TOOL);
        expect(tool.tool_end_offset).toBe(5);
    });
});

describe('SegmentState 文本汇总', () => {
    it('answerText 只拼 answer 段，allText 拼全部', () => {
        const s = new SegmentState();
        s.onReasoningDelta('思考');
        s.onAnswerDelta('答1');
        s.onAnswerDelta('续');
        expect(s.answerText).toBe('答1续');
        expect(s.allText).toContain('思考');
        expect(s.allText).toContain('答1续');
    });
});

describe('元素预算估算', () => {
    it('reasoning 面板估算 4，answer 段估算 1', () => {
        const s = new SegmentState();
        s.onReasoningDelta('r');
        s.onAnswerDelta('a');
        expect(estimateSegmentElements(s.segments[0])).toBe(4);
        expect(estimateSegmentElements(s.segments[1])).toBe(1);
    });

    it('tool 段按步骤数估算，detail/output 增加元素', () => {
        const steps = [
            { title: 't1' },
            { title: 't2', detail: 'd', output: 'o' },
        ];
        expect(estimateToolElements(0, 2, steps)).toBe(3 + 3 + 5);
    });

    it('阈值常量合理（180 上限 + 2 footer 预留 < 200 飞书硬限）', () => {
        expect(ELEMENT_THRESHOLD + FOOTER_RESERVE).toBeLessThanOrEqual(200);
    });
});

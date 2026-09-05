import { describe, it, expect } from 'vitest';
import { replayTerminalContent } from '../../src/card/complete-replay.js';
import { SegmentState, SegmentType } from '../../src/card/segments.js';

// ---------------------------------------------------------------------------
// helpers — 模拟 controller 实际喂给 segmentState 的事件序列
// ---------------------------------------------------------------------------

// 纯 thinking → answer（最常见：推理题单轮思考后回答）
function feedThinkThenAnswer(s) {
    s.setReasoningSnapshot('让我想想……');
    s.onAnswerDelta('答案是 42。');
    return s;
}

// 纯 answer（无思考，简单题/纯文本回复）
function feedPureAnswer(s) {
    s.onAnswerDelta('你好！');
    s.onAnswerDelta('这是追加的第二句。');
    return s;
}

// 多轮 answer 段（回复边界导致的新 answer 段）
function feedMultiAnswer(s) {
    s.onAnswerDelta('第一段回复。');
    // 模拟跨型：reasoning 夹在中间再回到 answer → 产生第二个 answer 段
    s.setReasoningSnapshot('中间又想了想');
    s.onAnswerDelta('第二段回复。');
    return s;
}

// 纯 thinking（短回复豁免场景：只思考没回答）
function feedPureThinking(s) {
    s.setReasoningSnapshot('只有思考，没有答案。');
    s.setReasoningSnapshot('思考更新了。');
    return s;
}

// ---------------------------------------------------------------------------
// replayTerminalContent
// ---------------------------------------------------------------------------

describe('replayTerminalContent — answer 重放', () => {
    it('think→answer：answer 文本完整重放', () => {
        const s = feedThinkThenAnswer(new SegmentState());
        const { answerText } = replayTerminalContent(s);
        expect(answerText).toBe('答案是 42。');
    });

    it('纯 answer 多段同型追加：合并成一段', () => {
        const s = feedPureAnswer(new SegmentState());
        const { answerText, hasAnswer } = replayTerminalContent(s);
        expect(answerText).toBe('你好！这是追加的第二句。');
        expect(hasAnswer).toBe(true);
    });

    it('跨型产生的多 answer 段：按出现顺序 join(\\n\\n)', () => {
        const s = feedMultiAnswer(new SegmentState());
        const answerSegs = s.segments.filter((x) => x.type === SegmentType.ANSWER);
        expect(answerSegs).toHaveLength(2); // 确认确实产生了两个 answer 段
        const { answerText } = replayTerminalContent(s);
        expect(answerText).toBe('第一段回复。\n\n第二段回复。');
    });
});

describe('replayTerminalContent — reasoning 重放', () => {
    it('think→answer：reasoning 文本重放（不含 answer）', () => {
        const s = feedThinkThenAnswer(new SegmentState());
        const { reasoningText, hasReasoning, answerText } = replayTerminalContent(s);
        expect(reasoningText).toBe('让我想想……');
        expect(hasReasoning).toBe(true);
        expect(answerText).toBe('答案是 42。');
    });

    it('纯 answer 无 reasoning：reasoningText 为 undefined', () => {
        const s = feedPureAnswer(new SegmentState());
        const { reasoningText, hasReasoning } = replayTerminalContent(s);
        expect(reasoningText).toBeUndefined();
        expect(hasReasoning).toBe(false);
    });

    it('纯 thinking（快照更新到最后一个 reasoning 段）', () => {
        const s = feedPureThinking(new SegmentState());
        // setReasoningSnapshot 同型会覆盖文本，所以只有一个 reasoning 段
        const reasoningSegs = s.segments.filter((x) => x.type === SegmentType.REASONING);
        expect(reasoningSegs).toHaveLength(1);
        const { reasoningText, hasReasoning, hasAnswer } = replayTerminalContent(s);
        expect(reasoningText).toBe('思考更新了。');
        expect(hasReasoning).toBe(true);
        expect(hasAnswer).toBe(false);
    });

    it('多轮 reasoning（think→answer→think→answer）按出现顺序拼接', () => {
        const s = new SegmentState();
        s.setReasoningSnapshot('第一轮思考');
        s.onAnswerDelta('第一轮回答');
        s.setReasoningSnapshot('第二轮思考');
        s.onAnswerDelta('第二轮回答');
        const reasoningSegs = s.segments.filter((x) => x.type === SegmentType.REASONING);
        expect(reasoningSegs).toHaveLength(2);
        const { reasoningText, answerText } = replayTerminalContent(s);
        // 当前 UI 单 💭 面板语义：多轮 reasoning 合成一个块
        expect(reasoningText).toContain('第一轮思考');
        expect(reasoningText).toContain('第二轮思考');
        expect(answerText).toBe('第一轮回答\n\n第二轮回答');
    });
});

describe('replayTerminalContent — 空/边界', () => {
    it('空 segments 返回空 answer + undefined reasoning', () => {
        const { answerText, reasoningText, hasReasoning, hasAnswer } = replayTerminalContent(new SegmentState());
        expect(answerText).toBe('');
        expect(reasoningText).toBeUndefined();
        expect(hasReasoning).toBe(false);
        expect(hasAnswer).toBe(false);
    });

    it('null/undefined state 不抛错', () => {
        expect(() => replayTerminalContent(null)).not.toThrow();
        const r = replayTerminalContent(undefined);
        expect(r.answerText).toBe('');
        expect(r.reasoningText).toBeUndefined();
    });
});

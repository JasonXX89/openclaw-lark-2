import { describe, it, expect } from 'vitest';
import { buildCardContent } from '../../src/card/builder.js';
import { isCardElementLimitError } from '../../src/card/card-error.js';

// 2026-09-08 小薇 9 分钟长任务实测：终态卡把全部工具步骤平铺进工作流时间线，
// 元素总数冲破飞书 200 硬限 → card.update 被拒（code=300305 element exceeds
// the limit）→ 终态卡没发出去，卡片冻结在流式末帧、无法折叠。
// 修复 = builder 终态预算（30 步 / 2000 字）+ controller 300305 降级重试。

function mkSteps(n: number) {
    return Array.from({ length: n }, (_, i) => ({ title: `tool${i}`, status: 'done' }));
}

function completeWith(overrides: Record<string, unknown> = {}) {
    return buildCardContent('complete', {
        text: '答案',
        elapsedMs: 60000,
        footer: { status: true, elapsed: true, model: true, showReasoning: true, showTools: true },
        footerMetrics: { model: 'test/model' },
        ...overrides,
    } as never);
}

describe('终态卡元素预算（防 300305 爆卡）', () => {
    it('工具步骤 ≤30：全量渲染，无省略提示', () => {
        const card = completeWith({
            toolUseSteps: mkSteps(30),
            workflowTimeline: [{ kind: 'tools', index: 1, from: 0, to: 30 }],
        });
        const s = JSON.stringify(card);
        expect(s).not.toContain('个工具步骤已省略');
    });

    it('工具步骤 >30：只渲染最近 30 步 + 恰好一条省略提示', () => {
        const timeline = [];
        for (let i = 0; i < 8; i++) {
            timeline.push({ kind: 'reasoning', index: i + 1, text: `思考${i}` });
            timeline.push({ kind: 'tools', index: i + 1, from: i * 5, to: (i + 1) * 5 });
        }
        const card = completeWith({ toolUseSteps: mkSteps(40), workflowTimeline: timeline });
        const panel = (card.elements as Array<Record<string, never>>).find((e) => e.tag === 'collapsible_panel');
        const children = (panel!.elements ?? []) as Array<Record<string, string>>;
        const hints = children.filter((e) => (e.content || '').includes('个工具步骤已省略'));
        expect(hints).toHaveLength(1);
        expect(hints[0].content).toContain('10');
        // tool0..tool9 省略，tool10..tool39 保留
        const s = JSON.stringify(card);
        expect(s).not.toContain('"tool0"');
        expect(s).toContain('tool39');
    });

    it('省略提示在跨边界组也出现（首组 from<omitted<to）', () => {
        const card = completeWith({
            toolUseSteps: mkSteps(40),
            workflowTimeline: [
                { kind: 'reasoning', index: 1, text: '思考1' },
                { kind: 'tools', index: 1, from: 0, to: 20 },
                { kind: 'tools', index: 2, from: 20, to: 40 },
            ],
        });
        expect(JSON.stringify(card)).toContain('个工具步骤已省略');
    });

    it('单轮思考超 2000 字：截断并加提示', () => {
        const card = completeWith({
            toolUseSteps: mkSteps(2),
            workflowTimeline: [
                { kind: 'reasoning', index: 1, text: 'x'.repeat(5000) },
                { kind: 'tools', index: 1, from: 0, to: 2 },
            ],
        });
        const s = JSON.stringify(card);
        expect(s).toContain('思考过长已截断');
        // 截断后思考文本不应超过 2000 + 提示尾巴
        expect(s.length).toBeLessThan(5000 + 2000);
    });

    it('无 timeline 的自主回复路径同样受预算约束', () => {
        const card = completeWith({
            toolUseSteps: mkSteps(40),
            reasoningText: 'y'.repeat(5000),
        });
        const s = JSON.stringify(card);
        expect(s).toContain('个工具步骤已省略');
        expect(s).toContain('思考过长已截断');
    });
});

describe('isCardElementLimitError 谓词', () => {
    it('匹配 card.update 300305 element exceeds the limit', () => {
        const err = new Error('cardkit card.update FAILED: code=300305, msg=ErrMsg: element exceeds the limit; , seq=600');
        (err as never as { code: number }).code = 300305;
        expect(isCardElementLimitError(err)).toBe(true);
    });

    it('匹配 230099 + 11310 + element exceeds the limit', () => {
        const err = new Error('code=230099, msg=Failed to create card content, ext=ErrCode: 11310; ErrMsg: element exceeds the limit');
        (err as never as { code: number }).code = 230099;
        expect(isCardElementLimitError(err)).toBe(true);
    });

    it('不误判表格超限（table number over limit）与限流（230020）', () => {
        const tableErr = new Error('code=230099, msg=Failed to create card content, ext=ErrCode: 11310; ErrMsg: card table number over limit');
        (tableErr as never as { code: number }).code = 230099;
        expect(isCardElementLimitError(tableErr)).toBe(false);
        const rateErr = new Error('code=230020');
        (rateErr as never as { code: number }).code = 230020;
        expect(isCardElementLimitError(rateErr)).toBe(false);
    });
});

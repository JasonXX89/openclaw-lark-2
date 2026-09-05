import { describe, it, expect } from 'vitest';
import {
    LOADING_ELEMENT_ID,
    buildAddReasoningAction,
    buildAddAnswerAction,
    buildAddToolAction,
    buildReasoningFinalizedAction,
    buildToolUpdateAction,
    _buildToolStepElements,
} from '../../src/card/segments-render.js';
import { Segment, SegmentType } from '../../src/card/segments.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeSegment(type, overrides = {}) {
    const elId =
        type === SegmentType.REASONING ? 'reasoning_panel_0' :
        type === SegmentType.ANSWER ? 'answer_1' :
        'tool_panel';
    const seg = new Segment(type, elId);
    if (type === SegmentType.REASONING) {
        seg.text_el_id = 'reasoning_text_0';
    }
    Object.assign(seg, overrides);
    return seg;
}

// ---------------------------------------------------------------------------
// buildAddReasoningAction
// ---------------------------------------------------------------------------

describe('buildAddReasoningAction', () => {
    it('returns add_elements action targeting insert_before loading_icon', () => {
        const seg = makeSegment(SegmentType.REASONING, { text: '思考中...' });
        const action = buildAddReasoningAction(seg);
        expect(action.action).toBe('add_elements');
        expect(action.params.type).toBe('insert_before');
        expect(action.params.target_element_id).toBe(LOADING_ELEMENT_ID);
    });

    it('element is collapsible_panel with element_id from segment', () => {
        const seg = makeSegment(SegmentType.REASONING, { text: 'hello' });
        const action = buildAddReasoningAction(seg);
        const el = action.params.elements[0];
        expect(el.tag).toBe('collapsible_panel');
        expect(el.element_id).toBe('reasoning_panel_0');
        expect(el.expanded).toBe(true); // 思考中展开
    });

    it('panel contains text sub-element with text_el_id', () => {
        const seg = makeSegment(SegmentType.REASONING, { text: 'reasoning text' });
        const action = buildAddReasoningAction(seg);
        const textEl = action.params.elements[0].elements[0];
        expect(textEl.tag).toBe('markdown');
        expect(textEl.element_id).toBe('reasoning_text_0');
        expect(textEl.text_size).toBe('notation');
    });

    it('header title shows "思考中..." when no elapsedMs', () => {
        const seg = makeSegment(SegmentType.REASONING);
        const action = buildAddReasoningAction(seg);
        const title = action.params.elements[0].header.title;
        expect(title.content).toContain('Thinking');
        expect(title.i18n_content.zh_cn).toContain('思考中');
    });

    it('header title shows elapsed time when elapsedMs provided', () => {
        const seg = makeSegment(SegmentType.REASONING);
        const action = buildAddReasoningAction(seg, 3200);
        const title = action.params.elements[0].header.title;
        expect(title.content).toContain('Thought for');
        expect(title.i18n_content.zh_cn).toContain('思考了');
        expect(title.content).toContain('3.2s');
    });
});

// ---------------------------------------------------------------------------
// buildAddAnswerAction
// ---------------------------------------------------------------------------

describe('buildAddAnswerAction', () => {
    it('returns add_elements with markdown element', () => {
        const seg = makeSegment(SegmentType.ANSWER, { text: 'Hello world' });
        const action = buildAddAnswerAction(seg);
        expect(action.action).toBe('add_elements');
        expect(action.params.type).toBe('insert_before');
        expect(action.params.target_element_id).toBe(LOADING_ELEMENT_ID);
    });

    it('element is markdown with element_id from segment', () => {
        const seg = makeSegment(SegmentType.ANSWER, { text: 'test' });
        const action = buildAddAnswerAction(seg);
        const el = action.params.elements[0];
        expect(el.tag).toBe('markdown');
        expect(el.element_id).toBe('answer_1');
        expect(el.text_size).toBe('normal_v2');
    });
});

// ---------------------------------------------------------------------------
// buildAddToolAction
// ---------------------------------------------------------------------------

describe('buildAddToolAction', () => {
    it('returns add_elements with collapsible_panel for tool steps', () => {
        const seg = makeSegment(SegmentType.TOOL);
        const steps = [{ name: 'search', status: 'completed', statusText: 'Done' }];
        const action = buildAddToolAction(seg, steps);
        expect(action.action).toBe('add_elements');
        const el = action.params.elements[0];
        expect(el.tag).toBe('collapsible_panel');
        expect(el.element_id).toBe('tool_panel');
        expect(el.expanded).toBe(true);
    });

    it('panel header shows step count', () => {
        const seg = makeSegment(SegmentType.TOOL);
        const steps = [
            { name: 'search', status: 'completed' },
            { name: 'read', status: 'completed' },
        ];
        const action = buildAddToolAction(seg, steps);
        const title = action.params.elements[0].header.title;
        expect(title.content).toContain('2 steps');
        expect(title.i18n_content.zh_cn).toContain('2 步');
    });

    it('panel children are tool step elements', () => {
        const seg = makeSegment(SegmentType.TOOL);
        const steps = [{ name: 'test', status: 'completed', statusText: 'OK' }];
        const action = buildAddToolAction(seg, steps);
        const children = action.params.elements[0].elements;
        expect(children.length).toBeGreaterThanOrEqual(1);
        expect(children[0].tag).toBe('div');
    });
});

// ---------------------------------------------------------------------------
// buildReasoningFinalizedAction
// ---------------------------------------------------------------------------

describe('buildReasoningFinalizedAction', () => {
    it('returns partial_update_element with collapsed panel', () => {
        const seg = makeSegment(SegmentType.REASONING, { elapsed_ms: 5200 });
        const action = buildReasoningFinalizedAction(seg);
        expect(action.action).toBe('partial_update_element');
        expect(action.params.element_id).toBe('reasoning_panel_0');
        expect(action.params.partial_element.expanded).toBe(false);
    });

    it('header title shows elapsed time', () => {
        const seg = makeSegment(SegmentType.REASONING, { elapsed_ms: 12300 });
        const action = buildReasoningFinalizedAction(seg);
        const title = action.params.partial_element.header.title;
        expect(title.content).toContain('12.3s');
        expect(title.i18n_content.zh_cn).toContain('思考了');
    });
});

// ---------------------------------------------------------------------------
// buildToolUpdateAction
// ---------------------------------------------------------------------------

describe('buildToolUpdateAction', () => {
    it('returns partial_update_element with updated header and children', () => {
        const steps = [
            { name: 'search', status: 'completed' },
            { name: 'read', status: 'running' },
        ];
        const action = buildToolUpdateAction('tool_panel', steps, 2100);
        expect(action.action).toBe('partial_update_element');
        expect(action.params.element_id).toBe('tool_panel');
        // header shows 2 steps
        expect(action.params.partial_element.header.title.content).toContain('2 steps');
        // children = step elements
        expect(action.params.partial_element.elements.length).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// _buildToolStepElements (internal)
// ---------------------------------------------------------------------------

describe('_buildToolStepElements', () => {
    it('builds title + detail + output for a complete step', () => {
        const step = {
            name: 'web_search',
            status: 'completed',
            statusText: 'Done',
            detail: 'query: test',
            output: '3 results',
        };
        const els = _buildToolStepElements(step);
        expect(els).toHaveLength(3);
        expect(els[0].tag).toBe('div'); // title
        expect(els[1].tag).toBe('div'); // detail
        expect(els[2].tag).toBe('div'); // output
    });

    it('builds title only when no detail/output', () => {
        const step = { name: 'tool', status: 'pending' };
        const els = _buildToolStepElements(step);
        expect(els).toHaveLength(1);
    });

    it('renders error in red', () => {
        const step = { name: 'tool', status: 'failed', error: 'timeout' };
        const els = _buildToolStepElements(step);
        expect(els.length).toBeGreaterThanOrEqual(2); // title + output
        const outputEl = els[els.length - 1];
        expect(outputEl.text.content).toContain("color='red'");
        expect(outputEl.text.content).toContain('timeout');
    });
});

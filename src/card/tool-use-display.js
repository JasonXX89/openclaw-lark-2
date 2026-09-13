"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Structured tool-use display for Lark/Feishu cards.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_TOOL_USE_PLACEHOLDER = void 0;
exports.normalizeToolUseDisplay = normalizeToolUseDisplay;
exports.buildToolUseTitleSuffix = buildToolUseTitleSuffix;
const reasoning_utils_1 = require("./reasoning-utils.js");
exports.EMPTY_TOOL_USE_PLACEHOLDER = 'No tool steps available';
const DEFAULT_SUMMARY_PREFERENCE = ['matched', 'code', 'quoted', 'url', 'line'];
/**
 * 工具步骤 detail 的**显示层**长度上限。
 *
 * 与 trace-store 的采集上限（COMMAND_STRING_LIMIT=4096 等）是两回事：采集层
 * 保存完整值供排查，显示层只给卡片一行。lark-2 的 detail 取自工具参数原文
 * （薯条 fry 取的是宿主下发的工具摘要，天然短），不截断时 exec 一步能把整条
 * 几千字符命令铺到卡片上——这是「工具流太详细」的根因。
 * 对齐薯条卡片风格：单行紧凑展示（80 字符）。
 */
const TOOL_DETAIL_DISPLAY_LIMIT = 80;
const TOOL_DESCRIPTORS = [
    {
        aliases: ['skill'],
        iconToken: 'app-default_outlined',
        title: 'Load skill',
        sanitizer: 'skill',
        paramKeys: ['skill', 'name'],
        summaryPatterns: [/^(?:load|use)\s+skill\s+(.+)$/i],
    },
    {
        aliases: ['read', 'open'],
        iconToken: 'file-link-text_outlined',
        title: 'Read',
        sanitizer: 'path',
        noResult: true,
        paramKeys: ['file_path', 'path', 'file'],
        summaryPatterns: [/^(?:read|open)\s+(?:file\s+)?(.+)$/i],
        summaryPreference: ['code', 'quoted', 'matched', 'line'],
    },
    {
        aliases: ['write', 'edit'],
        iconToken: 'edit_outlined',
        title: 'Edit',
        sanitizer: 'path',
        noResult: true,
        paramKeys: ['file_path', 'path', 'file'],
        summaryPatterns: [/^(?:edit|write)\s+(?:file\s+)?(.+)$/i],
        summaryPreference: ['code', 'quoted', 'matched', 'line'],
    },
    {
        aliases: ['web_search', 'web-search', 'search'],
        iconToken: 'search_outlined',
        title: 'Search web',
        sanitizer: 'search',
        paramKeys: ['query', 'q'],
        summaryPatterns: [/^(?:search\s+(?:web\s+)?(?:for|about)|query)\s+(.+)$/i],
        summaryPreference: ['quoted', 'matched', 'line'],
    },
    {
        aliases: ['web_fetch', 'web-fetch', 'fetch'],
        iconToken: 'language_outlined',
        title: 'Fetch web page',
        sanitizer: 'url',
        noResult: true,
        paramKeys: ['url'],
        summaryPatterns: [/^(?:fetch|open)\s+(?:web\s+page\s+)?(?:from\s+)?(.+)$/i],
        summaryPreference: ['url', 'matched', 'quoted', 'line'],
    },
    {
        aliases: ['grep'],
        iconToken: 'doc-search_outlined',
        title: 'Search text',
        sanitizer: 'generic',
        detailFromParams: (params) => buildPatternDetail(params, { includeTarget: true }),
        summaryPatterns: [/^(?:search\s+text(?:\s+by\s+pattern)?|grep)\s+(.+)$/i],
    },
    {
        aliases: ['glob'],
        iconToken: 'folder_outlined',
        title: 'Search files',
        sanitizer: 'generic',
        paramKeys: ['pattern'],
        summaryPatterns: [/^(?:search\s+files(?:\s+by\s+pattern)?|glob)\s+(.+)$/i],
    },
    {
        aliases: ['exec', 'bash', 'command', 'run'],
        iconToken: 'setting_outlined',
        title: 'Run command',
        sanitizer: 'command',
        paramKeys: ['description', 'command', 'script'],
        summaryPatterns: [/^(?:run|execute)\s+(?:command|script)?\s*(.+)$/i],
        summaryPreference: ['code', 'quoted', 'matched', 'line'],
    },
    {
        aliases: ['browser', 'playwright', 'navigate'],
        iconToken: 'browser-mac_outlined',
        title: 'Browser',
        sanitizer: 'url',
        noResult: true,
        paramKeys: ['url'],
        summaryPatterns: [/^(?:open|browse|visit|navigate\s+to)\s+(.+)$/i],
        summaryPreference: ['url', 'quoted', 'matched', 'line'],
    },
    {
        aliases: ['agent', 'task', 'spawn'],
        iconToken: 'robot_outlined',
        title: 'Run sub-agent',
        sanitizer: 'generic',
        paramKeys: ['task', 'description', 'prompt'],
        summaryPatterns: [/^(?:run\s+sub-?agent|spawn\s+agent)\s+(.+)$/i],
    },
    {
        aliases: ['check', 'determine', 'verify'],
        iconToken: 'list-check_outlined',
        title: 'Check',
        sanitizer: 'generic',
        paramKeys: ['target', 'subject', 'description'],
    },
    {
        aliases: ['summarize', 'analyze', 'prepare'],
        iconToken: 'report_outlined',
        title: 'Analyze',
        sanitizer: 'generic',
        paramKeys: ['target', 'subject', 'description'],
    },
    // 对齐 hermes-fry-cards 的 _TOOL_DESCRIPTORS：skill / clarify 均标记 no_result
    // —— 它们的结果对人类无阅读价值（skill 是提示词正文、clarify 是选项列表），
    // 铺到卡片上只会让工具流变成一堵墙。
    {
        aliases: ['clarify', 'ask'],
        iconToken: 'chat_outlined',
        title: 'Clarify',
        sanitizer: 'generic',
        noResult: true,
        paramKeys: ['question', 'prompt'],
    },
];
function normalizeToolUseDisplay(params) {
    const traceSteps = params.traceSteps ?? [];
    const showFullPaths = params.showFullPaths === true;
    const showResultDetails = params.showResultDetails === true;
    const sources = traceSteps.map(toTraceSource);
    const rawSteps = sources
        .map((source) => formatToolStep(source, { showFullPaths, showResultDetails }))
        .filter((step) => !!step);
    // 展示层相邻去重兜底：若连续两条步骤标题和入参完全相同，只保留一条
    const steps = [];
    for (const step of rawSteps) {
        const prev = steps[steps.length - 1];
        if (prev && prev.title === step.title && prev.detail === step.detail && prev.status === step.status) {
            continue;
        }
        steps.push(step);
    }
    return {
        content: steps.map((step) => (step.detail ? `- ${step.title}: ${step.detail}` : `- ${step.title}`)).join('\n'),
        stepCount: steps.length,
        steps,
    };
}
function buildToolUseTitleSuffix(params) {
    const { stepCount } = params;
    return {
        zh: `查看 ${stepCount} 个步骤`,
        en: `Show ${stepCount} step${stepCount === 1 ? '' : 's'}`,
    };
}
function toTraceSource(step) {
    return {
        toolName: step.toolName,
        params: step.params,
        result: step.result,
        error: step.error,
        durationMs: step.durationMs,
        status: step.status,
    };
}
function formatToolStep(source, options) {
    const descriptor = resolveToolDescriptor(source.toolName);
    const rawDetail = (descriptor ? extractDetailFromParams(source.params, descriptor) : undefined) ??
        (descriptor ? extractDetailFromSummary(source.summaryText, descriptor) : cleanupLine(source.summaryText ?? '')) ??
        undefined;
    const detail = rawDetail
        ? limitDetailForDisplay(sanitizeToolDetail(descriptor?.sanitizer ?? 'generic', rawDetail, options))
        : undefined;
    const title = buildToolTitle(source, descriptor, rawDetail);
    const status = resolveStepStatus(source);
    const errorBlock = source.error ? buildErrorBlock(source.error, descriptor) : undefined;
    const resultBlock = !errorBlock && options.showResultDetails ? buildResultBlock(source, descriptor) : undefined;
    return {
        title,
        detail,
        iconToken: descriptor?.iconToken ?? 'setting-inter_outlined',
        status,
        resultBlock,
        errorBlock,
    };
}
function buildToolTitle(source, descriptor, rawDetail) {
    const baseTitle = descriptor?.title === 'Read' && rawDetail && isSkillPathValue(rawDetail)
        ? 'Skill Read'
        : (descriptor?.title ?? humanizeToolName(source.toolName ?? 'tool'));
    const durationLabel = source.durationMs != null ? formatDurationLabel(source.durationMs) : undefined;
    return durationLabel ? `${baseTitle} (${durationLabel})` : baseTitle;
}
/**
 * 把 detail 压到卡片一行的体量。
 *
 * 优先在词/路径边界断开（空格、`/`、`\`），避免把 `flutter build` 切成
 * `flutter buil…` 这种半截词；实在找不到边界才硬切。
 */
function limitDetailForDisplay(value) {
    if (!value || value.length <= TOOL_DETAIL_DISPLAY_LIMIT)
        return value;
    const keep = TOOL_DETAIL_DISPLAY_LIMIT - 1;
    const head = value.slice(0, keep);
    const boundary = Math.max(head.lastIndexOf(' '), head.lastIndexOf('/'), head.lastIndexOf('\\'));
    // 边界太靠前（说明是个超长无分隔符 token）就硬切，否则丢的信息比省的多
    const cut = boundary >= keep * 0.6 ? boundary : keep;
    return `${value.slice(0, cut).trimEnd()}…`;
}
function resolveToolDescriptor(toolName) {
    const normalizedName = (0, reasoning_utils_1.normalizeToolName)(toolName);
    return TOOL_DESCRIPTORS.find((descriptor) => descriptor.aliases.some((alias) => normalizedName === alias || normalizedName.startsWith(`${alias}_`) || normalizedName.startsWith(`${alias}-`)));
}
function extractDetailFromParams(params, descriptor) {
    if (!params)
        return undefined;
    if (descriptor.detailFromParams)
        return descriptor.detailFromParams(params);
    for (const key of descriptor.paramKeys ?? []) {
        const value = params[key];
        const text = extractScalarText(value);
        if (text)
            return text;
    }
    return undefined;
}
function extractDetailFromSummary(summaryText, descriptor) {
    if (!summaryText)
        return undefined;
    const lines = summaryText
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => cleanupLine(stripMarkdown(line)))
        .filter((line) => line && !isNoiseLine(line));
    for (const line of lines) {
        const signals = buildSummarySignals(line, descriptor.summaryPatterns ?? []);
        const detail = pickSummaryDetail(signals, descriptor.summaryPreference ?? DEFAULT_SUMMARY_PREFERENCE);
        if (detail)
            return detail;
    }
    return undefined;
}
function buildSummarySignals(line, patterns) {
    const matched = patterns
        .map((pattern) => line.match(pattern)?.[1]?.trim())
        .find((value) => Boolean(value));
    return {
        line,
        matched,
        code: extractFirstCodeSpan(line),
        quoted: extractFirstQuotedText(line),
        url: extractFirstUrl(line),
    };
}
function pickSummaryDetail(signals, preference) {
    for (const key of preference) {
        const value = signals[key];
        if (value)
            return value;
    }
    return undefined;
}
function buildResultBlock(source, descriptor) {
    if (source.result == null)
        return undefined;
    // 声明式判定：descriptor.noResult 取代早先硬编码的 title 列表
    // （`['Read','Edit','Fetch web page','Browser'].includes(...)`），
    // 与 hermes-fry-cards 的 no_result 语义对齐，新增工具不必再改这里。
    if (descriptor?.noResult)
        return undefined;
    return buildDisplayBlock(sanitizeDisplayBlockValue(source.result, descriptor));
}
function buildErrorBlock(error, descriptor) {
    return buildDisplayBlock(sanitizeDisplayBlockValue(error, descriptor), 'text');
}
function sanitizeDisplayBlockValue(value, descriptor) {
    if (descriptor?.sanitizer === 'command' && typeof value === 'string') {
        return (0, reasoning_utils_1.redactInlineSecrets)(value);
    }
    return value;
}
function buildPatternDetail(params, options) {
    const pattern = extractScalarText(params.pattern);
    const target = extractScalarText(params.glob ?? params.path ?? params.file_path);
    if (pattern && target && options.includeTarget) {
        return `${pattern} in ${target}`;
    }
    return pattern ?? target ?? undefined;
}
function extractScalarText(value) {
    if (typeof value === 'string')
        return value.trim() || undefined;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return undefined;
}
function sanitizeToolDetail(kind, value, options) {
    if (kind === 'command') {
        const cleaned = normalizeInlineDisplayText(value);
        if (!cleaned)
            return undefined;
        return sanitizeCommandLike(cleaned, options);
    }
    const cleaned = sanitizeGenericText(value);
    if (!cleaned)
        return undefined;
    switch (kind) {
        case 'skill':
            return (cleaned
                .replace(/^skill\s+/i, '')
                .replace(/[-_]+/g, ' ')
                .trim() || 'skill');
        case 'path':
            return sanitizePathLike(cleaned, options);
        case 'search':
            return stripQuotes(cleaned);
        case 'url':
            return stripQuotes(cleaned).replace(/^from\s+/i, '');
        case 'generic':
        default:
            return cleaned;
    }
}
function normalizeInlineDisplayText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function sanitizePathLike(value, options) {
    const cleaned = sanitizeGenericText(value)
        .replace(/^(?:from|file|path)\s+/i, '')
        .trim();
    if (options.showFullPaths)
        return cleaned;
    const skillMatch = cleaned.match(/(?:^|\/)skills\/([^/]+)\//i);
    if (skillMatch?.[1]) {
        return skillMatch[1].replace(/[-_]+/g, ' ').trim() || cleaned;
    }
    const segments = cleaned.split(/[\\/]/).filter(Boolean);
    return segments.at(-1) ?? cleaned;
}
function sanitizeCommandLike(value, options) {
    let cleaned = stripQuotes(value)
        .replace(/^(?:command|script|description)\s+/i, '')
        .replace(/^.*?\s+->\s+/i, '')
        .trim();
    if (!cleaned)
        return 'command';
    // 过滤常见的前置冗余赋值（如 PowerShell $UA="..."; 或 bash export FOO=...;），优先露核心指令
    cleaned = cleaned.replace(/^(?:\$[A-Za-z0-9_]+\s*=\s*(?:"[^"]*"|'[^']*'|[^;]+);\s*)+/i, '');
    cleaned = cleaned.replace(/^(?:export\s+[A-Za-z0-9_]+\s*=\s*(?:"[^"]*"|'[^']*'|[^;]+);\s*)+/i, '');
    // 针对 curl 命令清洗掉冗长的 header/UserAgent 旗标参数，优先呈现目标 URL
    if (/^curl(?:\.exe)?\s+/i.test(cleaned)) {
        cleaned = cleaned
            .replace(/-[A-Za-z]*(?:A|H)\s+(?:"[^"]*"|'[^']*'|\S+)/g, '')
            .replace(/--(?:compressed|silent|show-error|insecure|location)\b/g, '')
            .replace(/\s+-[a-zA-Z]+\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    const redacted = (0, reasoning_utils_1.redactInlineSecrets)(cleaned);
    return options.showFullPaths ? redacted : redactCommandPaths(redacted);
}
function resolveStepStatus(source) {
    if (source.error)
        return 'error';
    if (source.status)
        return source.status;
    return 'success';
}
function buildDisplayBlock(value, fallbackLanguage = 'json') {
    if (value == null)
        return undefined;
    if (typeof value === 'string') {
        const normalized = value.replace(/\r\n/g, '\n').trim();
        if (!normalized)
            return undefined;
        const parsed = tryParseJson(normalized);
        if (parsed && typeof parsed === 'object') {
            const prettyJson = stringifyJson(parsed);
            if (prettyJson) {
                return { language: 'json', content: prettyJson };
            }
        }
        return { language: fallbackLanguage === 'json' ? 'text' : fallbackLanguage, content: normalized };
    }
    if (typeof value === 'object') {
        const prettyJson = stringifyJson(value);
        if (prettyJson) {
            return { language: 'json', content: prettyJson };
        }
    }
    const normalized = String(value).trim();
    return normalized ? { language: 'text', content: normalized } : undefined;
}
function stringifyJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return undefined;
    }
}
function tryParseJson(value) {
    const trimmed = value.trim();
    if (!trimmed || !/^(?:\{|\[)/.test(trimmed)) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return undefined;
    }
}
function redactCommandPaths(command) {
    return command
        .split(/(\s+)/)
        .map((segment) => {
        if (!segment || /^\s+$/.test(segment))
            return segment;
        return redactCommandToken(segment);
    })
        .join('');
}
function redactCommandToken(token) {
    const match = token.match(/^([("'`]*)(.*?)([)"'`,;:]*)$/);
    if (!match)
        return token;
    const [, prefix, rawCore, suffix] = match;
    const core = redactPathAssignment(rawCore);
    return `${prefix}${core}${suffix}`;
}
function redactPathAssignment(value) {
    const equalsIndex = value.indexOf('=');
    if (equalsIndex > 0) {
        const left = value.slice(0, equalsIndex + 1);
        const right = value.slice(equalsIndex + 1);
        return `${left}${redactStandalonePath(right)}`;
    }
    return redactStandalonePath(value);
}
function redactStandalonePath(value) {
    if (/^https?:\/\//i.test(value))
        return sanitizeUrlForDisplay(value);
    if (!looksLikePathToken(value))
        return value;
    return basenameFromPath(value);
}
function sanitizeUrlForDisplay(url) {
    try {
        const parsed = new URL(url);
        parsed.username = '';
        parsed.password = '';
        for (const key of [...parsed.searchParams.keys()]) {
            if (/(secret|token|password|key|credential|bearer|auth)/i.test(key)) {
                parsed.searchParams.set(key, '[redacted]');
            }
        }
        return parsed.toString();
    }
    catch {
        return url;
    }
}
function looksLikePathToken(value) {
    return (value.startsWith('~/') ||
        value.startsWith('./') ||
        value.startsWith('../') ||
        value.startsWith('/') ||
        value.includes('/'));
}
function basenameFromPath(value) {
    const cleaned = value.replace(/\\/g, '/').replace(/\/+$/, '');
    const segments = cleaned.split('/').filter(Boolean);
    return segments.at(-1) ?? value;
}
function isSkillPathValue(value) {
    return /(?:^|\/)skills\/[^/]+\//i.test(value);
}
function sanitizeGenericText(value) {
    return value
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function cleanupLine(line) {
    return line
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[.)]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function stripMarkdown(line) {
    return line
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^>\s*/, '')
        .trim();
}
function isNoiseLine(line) {
    return /^(?:completed|complete|done|success|succeeded|running|started|finished|ok)$/i.test(line);
}
function humanizeToolName(name) {
    const cleaned = name.replace(/[-_]+/g, ' ').trim();
    if (!cleaned)
        return 'Tool';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
function formatDurationLabel(durationMs) {
    return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}
function stripQuotes(value) {
    return value.replace(/^[`'"]+|[`'"]+$/g, '').trim();
}
function extractFirstCodeSpan(value) {
    const match = value.match(/`([^`]+)`/);
    return match?.[1]?.trim() || undefined;
}
function extractFirstQuotedText(value) {
    const match = value.match(/["']([^"']+)["']/);
    return match?.[1]?.trim() || undefined;
}
function extractFirstUrl(value) {
    const match = value.match(/\bhttps?:\/\/[^\s"'`]+/i);
    return match?.[0]?.trim() || undefined;
}

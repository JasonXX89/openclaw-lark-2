"use strict";
/**
 * OpenClaw reasoning gate 运行时 hook — 内存级注入（ESM loader hook 版）。
 *
 * 原理：OpenClaw dist 是 ESM（package.json type=module），不能用 CJS 的
 * Module._compile 拦截。用 Node 22.15+/23+ 的 module.registerHooks() 同步
 * loader hook，在 ESM 模块 load 阶段改写源码后再编译——磁盘文件永不动。
 *
 * 触发：gateway 启动时 NODE_OPTIONS=--import <本文件>（或 gateway.cmd 显式
 * --import）。OpenClaw 升级/重装不影响本 hook（它活在 gateway 启动命令里）。
 *
 * 注入内容（与静态补丁等价）：
 *   if (reasoningUsesConfiguredDefault && !canUseReasoningState) resolvedReasoningLevel = "off";
 *   → 删除该 gate，让 reasoningDefault 配置对普通消息生效（卡片显示 💭 思考面板）。
 */

const path = require('path');
const { registerHooks } = require('module');

const NEEDLE = 'reasoningUsesConfiguredDefault && !canUseReasoningState) resolvedReasoningLevel = "off";';
const REPLACEMENT = '/* reasoning-gate-hook: reasoningDefault 对普通消息生效 */';
const MARKER = 'reasoning-gate-hook';

function maybePatchSource(source, url) {
    // Node 21+ registerHooks 的 source 可能是 Uint8Array/ArrayBuffer，统一转 string
    if (typeof source !== 'string') {
        if (source instanceof Uint8Array) {
            source = Buffer.from(source).toString('utf-8');
        } else if (source instanceof ArrayBuffer) {
            source = Buffer.from(source).toString('utf-8');
        } else {
            return source;
        }
    }
    // ⚠️ 匹配失败必须可见：needle 是对 minified dist 的脆弱匹配，OpenClaw 升级
    // 改格式（如 2026.9.3 压掉 "if (" 换行）就会静默失配、💭 面板消失。报警。
    const GATE_HINT = 'resolvedReasoningLevel = "off"';
    if (source.includes(GATE_HINT) && !source.includes(NEEDLE)) {
        process.stderr.write(`[reasoning-hook] NEEDLE MISS in ${path.basename(url)}: gate 代码存在但格式变了，需更新 NEEDLE（对照 dist 源码）\n`);
    }
    if (source.includes(NEEDLE)) {
        const patched = source.replace(NEEDLE, REPLACEMENT);
        if (patched.includes(MARKER)) {
            process.stderr.write(`[reasoning-hook] patched ${path.basename(url)} (in-memory)\n`);
            return patched;
        }
    }
    return source;
}

try {
    registerHooks({
        load(url, context, nextLoad) {
            const result = nextLoad(url, context);
            // ⚠️ 只碰 get-reply 模块，且只在源码是 string 时才改写。
            // 2026-09-10 踩坑：把 Buffer/Uint8Array 源码转成 string 返回会改变
            // 返回类型，破坏下游加载器（插件/Sidecar 报 SyntaxError: Unexpected
            // token 'const'），导致 gateway 启动即退出。绝不改非目标模块。
            if (!result || result.source == null) return result;
            if (!url.includes('/dist/get-reply-')) return result;
            if (typeof result.source !== 'string') return result;
            result.source = maybePatchSource(result.source, url);
            return result;
        },
    });
    process.stderr.write('[reasoning-hook] registered (ESM loader)\n');
} catch (err) {
    process.stderr.write(`[reasoning-hook] register failed: ${err}\n`);
}

module.exports = {};

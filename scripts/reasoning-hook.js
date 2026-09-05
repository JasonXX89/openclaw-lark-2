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

const NEEDLE = 'if (reasoningUsesConfiguredDefault && !canUseReasoningState) resolvedReasoningLevel = "off";';
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
            if (result && result.source && url.includes('/dist/get-reply-')) {
                result.source = maybePatchSource(result.source, url);
            }
            return result;
        },
    });
    process.stderr.write('[reasoning-hook] registered (ESM loader)\n');
} catch (err) {
    process.stderr.write(`[reasoning-hook] register failed: ${err}\n`);
}

module.exports = {};

"use strict";
/**
 * OpenClaw reasoning gate 运行时 hook — 内存级注入（ESM loader hook 版）。
 *
 * 原理：OpenClaw dist 是 ESM（package.json type=module），不能用 CJS 的
 * Module._compile 拦截。用 Node 22.15+/23+ 的 module.registerHooks() 同步
 * loader hook，在 ESM 模块 load 阶段改写源码后再编译——磁盘文件永不动。
 *
 * 触发：gateway 启动时 --import <本文件>（gateway.cmd 里安装）。
 *
 * 要改两处 gate（2026-09-11 实测：只改一处不够，💭 仍不出现）：
 *   ① 主线程 dist/get-reply-*.mjs：
 *      `if (reasoningUsesConfiguredDefault && !canUseReasoningState) resolvedReasoningLevel = "off";`
 *   ② worker 线程 dist/worker/worker.mjs（43MB 打包副本，**agent 实际在这里跑**）：
 *      minified 形态 `fo&&!Za&&(ho=`off`)` —— 变量名随打包变化，用通用正则匹配
 *      形态 `<a>&&!<b>&&(<c>=`off`)`，其中 <a> 是 reasoningUsesConfiguredDefault。
 * 两处都删掉 gate，reasoningDefault 才对普通消息生效（卡片显示 💭）。
 *
 * ⚠️ worker 线程不继承主线程的 registerHooks（load 钩子不跨线程），但 `--import`
 * 会在每个 worker 里各自执行一次 —— 所以 worker 里也能挂上钩子（日志里会出现
 * 第二个 pid 的 registered）。前提是 worker 走的是 ESM 加载路径。
 */

const path = require('path');
const fs = require('fs');
const { registerHooks } = require('module');

// 诊断日志：stderr 在服务（schtasks）启动时看不到，写文件才能确证 hook 是否真跑。
const LOG_FILE = 'C:/Users/zhang/AppData/Local/Temp/reasoning-hook.log';
function log(msg) {
    const line = `[${new Date().toISOString()}] pid=${process.pid} ${msg}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (e) { /* ignore */ }
    try { process.stderr.write(`[reasoning-hook] ${msg}\n`); } catch (e) { /* ignore */ }
}

const MARKER = 'reasoning-gate-hook';

// ① 主线程 get-reply 的 gate（可读形态）
const NEEDLE = 'reasoningUsesConfiguredDefault && !canUseReasoningState) resolvedReasoningLevel = "off";';
const REPLACEMENT = '/* reasoning-gate-hook: reasoningDefault 对普通消息生效 */';

// ② worker.mjs 的 gate（minified 形态，变量名不定）
//    例：`fo&&!Za&&(ho=`off`)`  →  `/* reasoning-gate-hook */`
const WORKER_NEEDLE_RE = /[A-Za-z_$][\w$]*&&![A-Za-z_$][\w$]*&&\([A-Za-z_$][\w$]*=`off`\)/g;

/**
 * 尝试 patch 源码。返回「与入参同类型」的改写结果；未命中返回 null（调用方保持原样）。
 *
 * ⚠️ Node 的 load 钩子里 `result.source` 实际是 **Buffer**（2026-09-11 实测：
 * sourceType=Buffer format=module），必须处理后**原类型返回**：
 *   - 无条件转 string 返回（旧版）→ 破坏下游加载器（插件/sidecar 报
 *     SyntaxError: Unexpected token 'const'）→ gateway 启动即退出
 *   - 要求必须 string 才处理 → Buffer 永不匹配 → patch 永不生效，💭 静默消失
 *   - 命中后返回 string（上一版）→ 实测仍崩插件：**返回类型变化本身**就破坏加载器
 * 正解 = 命中后改写文本，再按原类型（Buffer）返回。
 */
function tryPatchSource(source, url) {
    const wasBuffer = Buffer.isBuffer(source) || source instanceof Uint8Array;
    let text;
    if (typeof source === 'string') {
        text = source;
    } else if (wasBuffer) {
        text = Buffer.from(source).toString('utf-8');
    } else if (source instanceof ArrayBuffer) {
        text = Buffer.from(source).toString('utf-8');
    } else {
        return null;
    }

    const base = path.basename(url);
    let patched = text;
    let did = false;

    // ---- ① 主线程 get-reply：可读 gate ----
    if (text.includes(NEEDLE)) {
        patched = patched.replace(NEEDLE, REPLACEMENT);
        did = patched.includes(MARKER);
        if (!did) log(`WARN: ${base} NEEDLE 命中但替换后无 marker`);
    } else if (text.includes('resolvedReasoningLevel = "off"')) {
        // 打不中但 gate 还在 = dist 格式又变了，必须喊出来（否则静默失效）
        log(`NEEDLE MISS in ${base}: gate 代码存在但格式变了，需更新 NEEDLE（对照 dist 源码）`);
    }

    // ---- ② worker.mjs：minified gate ----
    if (base === 'worker.mjs' || url.includes('/dist/worker/')) {
        WORKER_NEEDLE_RE.lastIndex = 0;
        const ms = [...patched.matchAll(WORKER_NEEDLE_RE)];
        if (ms.length > 0) {
            // 逐个核验：真 gate 的上下文含 reasoningDefault 相关的 `off` 兜底
            let hits = 0;
            patched = patched.replace(WORKER_NEEDLE_RE, (m, ...args) => {
                const off = args[args.length - 2]; // offset
                const ctx = patched.slice(Math.max(0, off - 260), off + 60);
                if (ctx.includes('reasoningLevel') || ctx.includes('reasoningDefault')) {
                    hits++;
                    return `/* ${MARKER}: worker gate removed */`;
                }
                return m; // 不是目标，别动
            });
            if (hits > 0) did = true;
            log(`worker gate: 匹配 ${ms.length} 处，确认替换 ${hits} 处`);
        } else if (text.includes('reasoningDefault')) {
            log(`NEEDLE MISS in ${base}: 含 reasoningDefault 但 gate 正则未命中，需更新 WORKER_NEEDLE_RE`);
        }
    }

    if (!did) return null;
    log(`patched ${base} (in-memory)`);
    // 按原类型返回：source 是 Buffer 就回 Buffer，绝不换类型
    return wasBuffer ? Buffer.from(patched, 'utf-8') : patched;
}

try {
    registerHooks({
        load(url, context, nextLoad) {
            const result = nextLoad(url, context);
            // ⚠️ 只碰目标模块（get-reply / worker）；其余 source 一律原样透传、
            // 绝不转换类型，否则破坏下游加载器 → 插件/Sidecar SyntaxError。
            if (!result || result.source == null) return result;
            if (!url.includes('/dist/get-reply-') && !url.includes('/dist/worker/')) return result;
            const patched = tryPatchSource(result.source, url);
            if (typeof patched === 'string' || Buffer.isBuffer(patched) || patched instanceof Uint8Array) {
                result.source = patched;
            }
            return result;
        },
    });
    log('registered (ESM loader) — hooks armed, waiting for get-reply/worker load');
} catch (err) {
    log(`register failed: ${err}`);
}

module.exports = {};

"use strict";
/**
 * openclaw-lark reasoning hook 独立补丁 — 安装/卸载/状态
 *
 * 解决的问题：OpenClaw 默认普通消息（不带 `/reasoning stream`）不把思考流推给
 * channel 插件 → 飞书卡片没有 💭 思考面板。本补丁用 ESM loader hook
 * （module.registerHooks，Node 22.15+/23+）在内存里移除 dist 的 reasoning gate，
 * 让 `reasoningDefault: "stream"` 对普通消息生效。
 *
 * 优势 vs 直接改 dist：
 *   - 磁盘文件永远原版干净，`npm update -g openclaw` 不会冲掉
 *   - 回滚 = uninstall（删 gateway.cmd 里的 --import）
 *
 * 用法（在插件根目录执行）：
 *   node scripts/install-reasoning-hook.js status
 *   node scripts/install-reasoning-hook.js install
 *   node scripts/install-reasoning-hook.js uninstall
 *
 * 前置：需要配置 openclaw.json agents.entries.<agent>.reasoningDefault = "stream"
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_DIR = __dirname;
const HOOK_SRC = path.join(SCRIPT_DIR, 'reasoning-hook.js');
// Hook 本体复制到用户目录下稳定位置（gateway.cmd 引用绝对路径，不依赖仓库位置）
const HOOK_INSTALL_DIR = path.join(os.homedir(), '.openclaw', 'extensions', 'openclaw-lark-2', 'scripts');
const HOOK_INSTALL_PATH = path.join(HOOK_INSTALL_DIR, 'reasoning-hook.js');
const GATEWAY_CMD = path.join(os.homedir(), '.openclaw', 'gateway.cmd');
// 检测已安装的 --import（兼容旧路径 openclaw-reasoning-hook.js 与仓库 reasoning-hook.js）
const IMPORT_RE = /--import\s+"file:\/\/\/[^"]*reasoning-hook\.js"/;
const HOOK_MARKER = 'reasoning-hook.js';

function log(...args) { console.log(...args); }

function findGatewayCmd() {
    // 候选：~/.openclaw/gateway.cmd (Windows 计划任务) / 其他常见位置
    const candidates = [
        GATEWAY_CMD,
        path.join(os.homedir(), '.openclaw', 'gateway.cmd'),
    ];
    return candidates.find((p) => fs.existsSync(p));
}

function status() {
    const hookInstalled = fs.existsSync(HOOK_INSTALL_PATH);
    const gw = findGatewayCmd();
    let cmdHasImport = false;
    let cmdText = '';
    if (gw) {
        cmdText = fs.readFileSync(gw, 'utf8');
        cmdHasImport = IMPORT_RE.test(cmdText);
    }
    log('=== reasoning hook 状态 ===');
    log(`  hook 文件: ${hookInstalled ? '已安装 → ' + HOOK_INSTALL_PATH : '未安装'}`);
    log(`  gateway.cmd: ${gw ? gw : '未找到'}`);
    log(`  gateway.cmd 含 --import hook: ${cmdHasImport ? '是 (生效)' : '否'}`);
    if (gw && !cmdHasImport && cmdText.includes('index.js gateway')) {
        log('  → 未启用。执行 install 启用。');
    }
    return { hookInstalled, cmdHasImport };
}

async function install() {
    // 1. hook 本体 → 用户 openclaw 扩展目录（稳定绝对路径）
    if (!fs.existsSync(HOOK_SRC)) {
        log(`ERROR: hook 源文件不存在: ${HOOK_SRC}`);
        process.exit(1);
    }
    fs.mkdirSync(HOOK_INSTALL_DIR, { recursive: true });
    fs.copyFileSync(HOOK_SRC, HOOK_INSTALL_PATH);
    log(`hook 已复制 → ${HOOK_INSTALL_PATH}`);

    // 2. gateway.cmd 加 --import
    const gw = findGatewayCmd();
    if (!gw) {
        log('ERROR: 未找到 gateway.cmd。请确认 OpenClaw 已安装（Windows 计划任务模式）。');
        process.exit(1);
    }
    let cmd = fs.readFileSync(gw, 'utf8');
    if (IMPORT_RE.test(cmd)) {
        log('gateway.cmd 已含 --import hook，跳过修改');
    }
    else {
        // 在 node 启动行插入 --import（只改含 "index.js gateway" 的那行）
        const fileUrl = `file:///${HOOK_INSTALL_PATH.replace(/\\/g, '/')}`;
        const importArg = `--import "${fileUrl}"`;
        const lineRe = /^("[^"]*node\.exe")(\s+)(.*index\.js gateway.*)$/m;
        if (!lineRe.test(cmd)) {
            log('ERROR: gateway.cmd 找不到 node 启动行（格式不识别），请手动加 --import');
            process.exit(1);
        }
        cmd = cmd.replace(lineRe, (_m, node, sp, rest) => `${node}${sp}${importArg}${sp}${rest}`);
        fs.writeFileSync(gw, cmd);
        log(`gateway.cmd 已加 --import → ${fileUrl}`);
    }

    log('\n✅ 安装完成。执行 `openclaw gateway restart` 生效。');
    log('   验证：日志应出现 [reasoning-hook] registered');
    log('   配置：确认 openclaw.json 里 agents.entries.<agent>.reasoningDefault = "stream"');
}

async function uninstall() {
    // 1. gateway.cmd 移除 --import
    const gw = findGatewayCmd();
    if (gw) {
        let cmd = fs.readFileSync(gw, 'utf8');
        if (IMPORT_RE.test(cmd)) {
            // 移除 importArg（保留 node 行其余部分）
            cmd = cmd.replace(/\s*--import "file:\/\/\/[^"]*reasoning-hook\.js"/, '');
            fs.writeFileSync(gw, cmd);
            log('gateway.cmd 已移除 --import');
        }
        else {
            log('gateway.cmd 不含 --import hook，无需修改');
        }
    }
    // 2. 删除 hook 文件（保留源文件在仓库）
    if (fs.existsSync(HOOK_INSTALL_PATH)) {
        fs.unlinkSync(HOOK_INSTALL_PATH);
        log('hook 文件已删除');
    }
    log('\n✅ 卸载完成。执行 `openclaw gateway restart` 生效。');
}

const cmd = process.argv[2] || 'status';
if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else if (cmd === 'status') status();
else {
    log('用法: node scripts/install-reasoning-hook.js <status|install|uninstall>');
    process.exit(1);
}

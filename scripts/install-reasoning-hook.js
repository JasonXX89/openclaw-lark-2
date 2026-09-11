"use strict";
/**
 * openclaw-lark reasoning hook 独立补丁 — 安装/卸载/状态
 *
 * ⚠️ 提示（2026-09-11 验证）：
 * OpenClaw 2026.9.3+ 已提供官方原生授权支持！
 * 只需在 openclaw.json 的 commands 段配置:
 *   "allowFrom": { "feishu": ["ou_..."] }
 * 即可让思考流原生生效，完全无需安装本补丁！本脚本仅供旧版 OpenClaw 备用。
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
const GATEWAY_CMD = path.join(os.homedir(), '.openclaw', 'gateway.cmd');
// 检测已安装的 --import（兼容旧路径 openclaw-reasoning-hook.js 与仓库 reasoning-hook.js）
const IMPORT_RE = /--import\s+"file:\/\/\/[^"]*reasoning-hook\.js"/;

function log(...args) { console.log(...args); }

/**
 * 自动定位插件运行目录（gateway 实际加载、hook 需复制到的位置）。
 * 检测顺序：
 *   1. 本脚本已在运行区内（__dirname 含 .openclaw/extensions）→ 直接用脚本父目录
 *   2. 扫 ~/.openclaw/extensions/ 下含本插件 package.json name 的目录
 *   3. 都找不到 → null（提示用户）
 */
function findPluginInstallDir() {
    const pkgName = readPkgName();
    // 情形 1：脚本就在扩展目录里跑（git 仓库 = 运行区，或用户 cd 进运行区执行）
    if (SCRIPT_DIR.includes(path.join('.openclaw', 'extensions')) || SCRIPT_DIR.includes(path.sep + '.openclaw' + path.sep + 'extensions' + path.sep)) {
        return path.dirname(SCRIPT_DIR); // <插件根>/scripts → 插件根
    }
    // 情形 2：扫 extensions 目录
    const extRoot = path.join(os.homedir(), '.openclaw', 'extensions');
    if (fs.existsSync(extRoot)) {
        for (const entry of fs.readdirSync(extRoot)) {
            if (entry.startsWith('.')) continue;
            const pkgPath = path.join(extRoot, entry, 'package.json');
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    if (pkg.name === pkgName) return path.join(extRoot, entry);
                } catch { /* skip */ }
            }
        }
    }
    return null;
}

/** 读取本插件 package.json 的 name（用于匹配运行区目录）。 */
function readPkgName() {
    const pkgPath = path.join(SCRIPT_DIR, '..', 'package.json');
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.name;
    } catch {
        return null;
    }
}

/** 计算 hook 实际安装路径（插件运行目录 + scripts/reasoning-hook.js）。 */
function resolveHookInstallPath() {
    const pluginDir = findPluginInstallDir();
    if (!pluginDir) return null;
    return path.join(pluginDir, 'scripts', 'reasoning-hook.js');
}

function findGatewayCmd() {
    // 候选：~/.openclaw/gateway.cmd (Windows 计划任务) / 其他常见位置
    const candidates = [
        GATEWAY_CMD,
        path.join(os.homedir(), '.openclaw', 'gateway.cmd'),
    ];
    return candidates.find((p) => fs.existsSync(p));
}

function status() {
    const hookPath = resolveHookInstallPath();
    const hookInstalled = hookPath && fs.existsSync(hookPath);
    const gw = findGatewayCmd();
    let cmdHasImport = false;
    let cmdText = '';
    if (gw) {
        cmdText = fs.readFileSync(gw, 'utf8');
        cmdHasImport = IMPORT_RE.test(cmdText);
    }
    log('=== reasoning hook 状态 ===');
    log('💡 提示: OpenClaw 2026.9.3+ 推荐直接在 openclaw.json 配置 commands.allowFrom.feishu，无需本补丁！');
    log(`  插件运行目录: ${hookPath ? path.dirname(path.dirname(hookPath)) : '未找到(请确认插件已安装到 ~/.openclaw/extensions/)'}`);
    log(`  hook 文件: ${hookInstalled ? '已安装 → ' + hookPath : (hookPath ? '未安装' : '未找到目标位置')}`);
    log(`  gateway.cmd: ${gw ? gw : '未找到'}`);
    log(`  gateway.cmd 含 --import hook: ${cmdHasImport ? '是 (生效)' : '否'}`);
    if (gw && !cmdHasImport && cmdText.includes('index.js gateway')) {
        log('  → 未启用。执行 install 启用。');
    }
    return { hookInstalled, cmdHasImport };
}

async function install() {
    // 1. 定位插件运行目录 + hook 目标路径
    if (!fs.existsSync(HOOK_SRC)) {
        log(`ERROR: hook 源文件不存在: ${HOOK_SRC}`);
        process.exit(1);
    }
    const HOOK_INSTALL_PATH = resolveHookInstallPath();
    if (!HOOK_INSTALL_PATH) {
        log('ERROR: 未找到插件运行目录。请确认本插件已安装到 ~/.openclaw/extensions/ 下，');
        log('      或把脚本放到运行区插件的 scripts/ 目录里执行。');
        process.exit(1);
    }
    const HOOK_INSTALL_DIR = path.dirname(HOOK_INSTALL_PATH);
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
    log('   配置①：确认 openclaw.json 里 agents.entries.<agent>.reasoningDefault = "stream"（主程序层：模型是否产生思考流）');
    log('   配置②：确认 channels.feishu.footer.showReasoning = true（插件显示层：默认 true；被设 false 会丢弃思考流，💭 面板仍不出现）');
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
    const hookPath = resolveHookInstallPath();
    if (hookPath && fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
        log(`hook 文件已删除 → ${hookPath}`);
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

"use strict";
/**
 * SSRF 防护统一入口。
 *
 * 从 OpenClaw 官方插件移植（streaming-card.ts 使用的 fetchWithSsrFGuard）：
 * - DNS 固定（pinning）：解析一次并复用该地址，防止 DNS rebinding 绕过
 * - 私有/保留 IP 阻断：IPv4 + IPv6（含 link-local、ULA、loopback、metadata 等）
 * - 重定向逐跳校验：每一跳都重新解析并按策略校验
 * - hostname allowlist：仅允许指定的飞书域名
 *
 * 默认（不传 policy）即阻断私有网络——这是对任意远程 URL（如模型生成的
 * markdown 图片地址）最安全的选择。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardedFeishuFetch = guardedFeishuFetch;
exports.guardedRemoteFetch = guardedRemoteFetch;
exports.fetchWithSsrFGuard = void 0;

// 与官方插件同源的 SDK 守卫实现。
const { fetchWithSsrFGuard } = require("openclaw/plugin-sdk/ssrf-runtime");

exports.fetchWithSsrFGuard = fetchWithSsrFGuard;

// ---------------------------------------------------------------------------
// 域名解析辅助（与官方 resolveAllowedHostnames / resolveApiBase 对应）
// ---------------------------------------------------------------------------

const FEISHU_DOMAIN_HOSTS = ["open.feishu.cn", "open.larksuite.com"];

/**
 * 从 brand/domain 解析允许的 hostname 列表。
 *
 * 标准品牌返回其下所有可能被访问的子域（open.* 为 Open API，
 * accounts.* 为 OAuth device-flow），避免误伤合法调用。
 * @param {string|undefined} brandOrDomain 'feishu' | 'lark' | 自定义 https URL | 裸 hostname
 */
function resolveAllowedHostnames(brandOrDomain) {
    if (brandOrDomain === "lark") {
        return ["open.larksuite.com", "accounts.larksuite.com"];
    }
    if (typeof brandOrDomain === "string" && brandOrDomain !== "feishu") {
        // 自定义 https URL，或裸 hostname（如 "my.feishu.com"）。
        const withScheme = /^https?:\/\//.test(brandOrDomain)
            ? brandOrDomain
            : `https://${brandOrDomain}`;
        try {
            return [new URL(withScheme).hostname];
        } catch {
            return [];
        }
    }
    return ["open.feishu.cn", "accounts.feishu.cn"];
}

/**
 * 守卫飞书 Open API 调用。
 *
 * 用于 rawLarkRequest / device-flow / uat-client 等所有向飞书 API 发出的
 * 裸 fetch——即使配置里的 domain 被改成任意 https URL，也会被限制在
 * 该 hostname 上（白名单内），不会成为任意目标代理。
 *
 * 使用 `hostnameAllowlist`（严格白名单门控）而非 `allowedHostnames`
 * （信任名单，会跳过私有 IP 检查）：前者同时保留私有 IP 阻断。
 *
 * @param {string} url 飞书 API 完整 URL
 * @param {RequestInit} [init]
 * @param {{ domain?: string, timeoutMs?: number, auditContext?: string }} [opts]
 */
async function guardedFeishuFetch(url, init, opts = {}) {
    const { response, release } = await fetchWithSsrFGuard({
        url,
        init,
        policy: { hostnameAllowlist: resolveAllowedHostnames(opts.domain) },
        auditContext: opts.auditContext ?? "feishu.api",
        timeoutMs: opts.timeoutMs,
    });
    return { response, release };
}

/**
 * 守卫任意远程 URL（媒体/图片等用户可控 URL）。
 *
 * 不传 policy → 默认阻断私有/保留 IP（含内网、link-local、cloud metadata
 * 169.254.169.254 等），同时做 DNS pinning 与重定向逐跳校验。
 *
 * @param {string} url 远程资源 URL（http/https）
 * @param {RequestInit} [init]
 * @param {{ timeoutMs?: number, auditContext?: string }} [opts]
 */
async function guardedRemoteFetch(url, init, opts = {}) {
    const { response, release } = await fetchWithSsrFGuard({
        url,
        init,
        auditContext: opts.auditContext ?? "feishu.remote",
        timeoutMs: opts.timeoutMs,
    });
    return { response, release };
}

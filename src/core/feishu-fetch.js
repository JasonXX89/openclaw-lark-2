"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Header-aware fetch for Feishu API calls.
 *
 * Drop-in replacement for `fetch()` that automatically injects
 * the User-Agent header.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feishuFetch = feishuFetch;
const version_1 = require("./version.js");
const ssrf_1 = require("./ssrf.js");

/**
 * Drop-in replacement for `fetch()` that automatically injects
 * the User-Agent header and routes through the SSRF fetch guard
 * (DNS-pinned, private-IP blocked, redirect-validated).
 *
 * Used by `device-flow.ts`, `uat-client.ts` and `raw-request.ts` so the
 * custom User-Agent and SSRF protection apply transparently without
 * changing every call-site's signature.
 *
 * @param {string} url Feishu API URL (open.feishu.cn / open.larksuite.com / custom)
 * @param {RequestInit} [init]
 * @param {string|undefined} [domain] brand/domain used to derive the hostname
 *   allowlist ('feishu' | 'lark' | custom https URL). Redirects are validated
 *   against this allowlist. When omitted, only the request URL's own hostname
 *   is allowlisted (still blocks private IPs + DNS pinning).
 */
function feishuFetch(url, init, domain) {
    const headers = {
        ...init?.headers,
        'User-Agent': (0, version_1.getUserAgent)(),
    };
    return guardedFeishuFetchResult(url, { ...init, headers }, domain);
}

/**
 * Wraps the SDK guard and returns a plain `Response`-shaped promise so
 * existing callers that `await` the response directly keep working.
 *
 * The guard returns `{ response, release }`; we resolve to `response` and
 * release the pinned dispatcher after the body has been consumed. Callers
 * that do not consume the body (e.g. only read status) still work because
 * `release()` is invoked in a `finally` on body read completion via the
 * returned promise chain below.
 */
async function guardedFeishuFetchResult(url, init, domain) {
    const { response, release } = await (0, ssrf_1.guardedFeishuFetch)(url, init, {
        auditContext: 'feishu-fetch',
        domain,
    });
    // Ensure the pinned dispatcher is released once the body is read
    // (or the response is dropped). This mirrors the official plugin's
    // `release()` contract.
    const originalArrayBuffer = response.arrayBuffer.bind(response);
    const originalJson = response.json.bind(response);
    const originalText = response.text.bind(response);
    const originalBlob = response.blob.bind(response);
    let released = false;
    const releaseOnce = async () => {
        if (released)
            return;
        released = true;
        await release();
    };
    response.arrayBuffer = async () => {
        try {
            return await originalArrayBuffer();
        }
        finally {
            await releaseOnce();
        }
    };
    response.json = async () => {
        try {
            return await originalJson();
        }
        finally {
            await releaseOnce();
        }
    };
    response.text = async () => {
        try {
            return await originalText();
        }
        finally {
            await releaseOnce();
        }
    };
    response.blob = async () => {
        try {
            return await originalBlob();
        }
        finally {
            await releaseOnce();
        }
    };
    return response;
}

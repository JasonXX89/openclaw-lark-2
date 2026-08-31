"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * AsyncLocalStorage-backed channel for telling the outbound adapter that
 * the current dispatch is replying to a bot peer in a group chat.
 *
 * Why ALS instead of an extra adapter parameter: the outbound adapter is
 * channel-agnostic (Slack / Telegram / Feishu share the same shape) and
 * the SDK owns the call site between dispatch and our outbound. Adding a
 * Feishu-specific "peer-is-bot" parameter would pollute that interface.
 * ALS lets the dispatch layer attach context once and have it flow through
 * the SDK's async chain to the outbound adapter without any other layer
 * needing to know.
 *
 * Lifetime: scoped to a single `runWithBotPeerContext(...)` call. When that
 * promise settles, the store is gone. No manual cleanup required.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWithBotPeerContext = runWithBotPeerContext;
exports.currentBotPeerContext = currentBotPeerContext;
const node_async_hooks_1 = require("node:async_hooks");
const storage = new node_async_hooks_1.AsyncLocalStorage();
/**
 * Run `fn` with the given bot-peer context attached to the async chain.
 * The outbound adapter's `currentBotPeerContext()` inside `fn` (and any
 * promises it spawns) will see this store.
 */
function runWithBotPeerContext(ctx, fn) {
    return storage.run(ctx, fn);
}
/**
 * Read the active bot-peer context, or `undefined` if none is set.
 * Outbound code uses this to decide whether to wrap the reply text with
 * `ensureMention` so the peer bot actually receives a Feishu notification.
 */
function currentBotPeerContext() {
    return storage.getStore();
}

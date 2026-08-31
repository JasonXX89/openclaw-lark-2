/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Shared registry for the inbound message handler.
 *
 * Synthetic message helpers depend on this registry instead of importing
 * `handler.ts` directly, which keeps the static import graph acyclic.
 */
import type { ClawdbotConfig, RuntimeEnv } from 'openclaw/plugin-sdk';
import type { FeishuMessageEvent } from '../types';
export interface InboundHandlerParams {
    cfg: ClawdbotConfig;
    event: FeishuMessageEvent;
    botOpenId?: string;
    runtime?: RuntimeEnv;
    accountId?: string;
    replyToMessageId?: string;
    forceMention?: boolean;
    /** Run the real access-control gate but treat the mention requirement as
     *  satisfied (card-action synthetic messages). Takes precedence over
     *  forceMention. See handleFeishuMessage. */
    cardActionGate?: boolean;
    skipTyping?: boolean;
}
type InboundHandler = (params: InboundHandlerParams) => Promise<void>;
export declare function injectInboundHandler(handler: InboundHandler): void;
export declare function getInboundHandler(): InboundHandler;
export {};

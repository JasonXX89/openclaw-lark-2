/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pin management for the Lark/Feishu channel plugin.
 *
 * Provides functions to pin, unpin, and list pinned messages using the
 * IM Pin API. Ported from the official @openclaw/feishu plugin (pins.ts).
 */
import type { OpenClawConfig } from 'openclaw/plugin-sdk';

/**
 * A single pin on a Feishu message.
 */
export interface FeishuPin {
    /** The pinned message ID. */
    messageId: string;
    /** Chat the pin lives in. */
    chatId?: string;
    /** Open ID of the operator who pinned it. */
    operatorId?: string;
    /** Operator ID type ("open_id" etc.). */
    operatorIdType?: string;
    /** ISO timestamp when the pin was created. */
    createTime?: string;
}

/**
 * Pin a message to the top of its chat.
 *
 * @param params.cfg       - Plugin configuration with Feishu credentials.
 * @param params.messageId - The message to pin.
 * @param params.accountId - Optional account identifier for multi-account setups.
 * @returns The normalized pin, or null if the API returned none.
 */
export declare function createPinFeishu(params: {
    cfg: OpenClawConfig;
    messageId: string;
    accountId?: string;
}): Promise<FeishuPin | null>;

/**
 * Unpin a message.
 *
 * @param params.cfg       - Plugin configuration with Feishu credentials.
 * @param params.messageId - The message to unpin.
 * @param params.accountId - Optional account identifier for multi-account setups.
 */
export declare function removePinFeishu(params: {
    cfg: OpenClawConfig;
    messageId: string;
    accountId?: string;
}): Promise<void>;

/**
 * List pinned messages in a chat.
 *
 * @param params.cfg        - Plugin configuration with Feishu credentials.
 * @param params.chatId     - The chat whose pins to list.
 * @param params.startTime  - Optional ISO timestamp filter.
 * @param params.endTime    - Optional ISO timestamp filter.
 * @param params.pageSize   - Optional page size (1..100).
 * @param params.pageToken  - Optional pagination token.
 * @param params.accountId  - Optional account identifier for multi-account setups.
 * @returns The pins page plus pagination info.
 */
export declare function listPinsFeishu(params: {
    cfg: OpenClawConfig;
    chatId: string;
    startTime?: string;
    endTime?: string;
    pageSize?: number;
    pageToken?: string;
    accountId?: string;
}): Promise<{
    chatId: string;
    pins: FeishuPin[];
    hasMore: boolean;
    pageToken?: string;
}>;

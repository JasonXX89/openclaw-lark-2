"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pin management for the Lark/Feishu channel plugin.
 *
 * Provides functions to pin, unpin, and list pinned messages using the
 * IM Pin API. Ported from the official @openclaw/feishu plugin (pins.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPinFeishu = createPinFeishu;
exports.removePinFeishu = removePinFeishu;
exports.listPinsFeishu = listPinsFeishu;
const lark_client_1 = require("../../core/lark-client.js");

/**
 * Assert that a Lark SDK response has code === 0 (or no code field).
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
function assertLarkOk(res, context) {
    const code = res?.code;
    if (code !== undefined && code !== 0) {
        const msg = res?.msg ?? 'unknown error';
        throw new Error(`[feishu-pins] ${context}: code=${code}, msg=${msg}`);
    }
}

/** Normalize a raw Feishu pin object into a camelCase shape. */
function normalizePin(pin) {
    if (!pin)
        return null;
    return {
        messageId: pin.message_id,
        chatId: pin.chat_id,
        operatorId: pin.operator_id,
        operatorIdType: pin.operator_id_type,
        createTime: pin.create_time,
    };
}

/**
 * Pin a message to the top of its chat.
 *
 * @param {object} params
 * @param {object} params.cfg  plugin config
 * @param {string} params.messageId  message_id to pin
 * @param {string} [params.accountId]
 * @returns {Promise<object|null>} normalized pin, or null if the API returned none
 */
async function createPinFeishu({ cfg, messageId, accountId }) {
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const response = await client.im.pin.create({
        data: { message_id: messageId },
    });
    assertLarkOk(response, `pin message ${messageId}`);
    return normalizePin(response.data?.pin);
}

/**
 * Unpin a message.
 *
 * @param {object} params
 * @param {object} params.cfg
 * @param {string} params.messageId
 * @param {string} [params.accountId]
 */
async function removePinFeishu({ cfg, messageId, accountId }) {
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const response = await client.im.pin.delete({
        path: { message_id: messageId },
    });
    assertLarkOk(response, `unpin message ${messageId}`);
}

/**
 * List pinned messages in a chat.
 *
 * @param {object} params
 * @param {object} params.cfg
 * @param {string} params.chatId  chat_id to list pins for
 * @param {string} [params.startTime] ISO timestamp filter
 * @param {string} [params.endTime] ISO timestamp filter
 * @param {number} [params.pageSize] 1..100
 * @param {string} [params.pageToken]
 * @param {string} [params.accountId]
 * @returns {Promise<{ chatId: string, pins: object[], hasMore: boolean, pageToken?: string }>}
 */
async function listPinsFeishu({ cfg, chatId, startTime, endTime, pageSize, pageToken, accountId }) {
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const response = await client.im.pin.list({
        params: {
            chat_id: chatId,
            ...(startTime ? { start_time: startTime } : {}),
            ...(endTime ? { end_time: endTime } : {}),
            ...(typeof pageSize === 'number'
                ? { page_size: Math.max(1, Math.min(100, Math.floor(pageSize))) }
                : {}),
            ...(pageToken ? { page_token: pageToken } : {}),
        },
    });
    assertLarkOk(response, `list pins for chat ${chatId}`);

    return {
        chatId,
        pins: (response.data?.items ?? []).map(normalizePin),
        hasMore: response.data?.has_more === true,
        pageToken: response.data?.page_token,
    };
}

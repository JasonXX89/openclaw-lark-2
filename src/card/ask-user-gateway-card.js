"use strict";
/**
 * Copyright (c) 2026 Mirr0ch1
 * SPDX-License-Identifier: MIT
 *
 * Gateway-backed ask_user question rendering for the Lark/Feishu channel.
 *
 * OpenClaw's built-in `ask_user` tool blocks the agent run waiting for an
 * answer. Channels are expected to render the question's option buttons and
 * resolve the user's choice through the gateway question runtime
 * (`questionGatewayRuntime.resolveOption`). Previously the Feishu plugin
 * only delivered the question *text*, so the run blocked forever with no
 * way to answer.
 *
 * This module:
 *  1. Detects ask_user block payloads (channelData.askUser) in deliver()
 *     and renders a Feishu interactive card with one button per option.
 *  2. Handles `card.action.trigger` for those buttons: validates the
 *     operator/chat/expiry envelope, then resolves the choice.
 *  3. Supports the "Other…" (custom-input) option by directing the user to
 *     reply with plain text — the gateway claims plain-text answers for the
 *     pending question automatically.
 *
 * The gateway text-answer claim path is session-keyed and channel-agnostic,
 * so replying with an option label/number also works without touching this
 * module.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAskUserPayload = isAskUserPayload;
exports.deliverAskUserQuestion = deliverAskUserQuestion;
exports.handleAskUserQuestionAction = handleAskUserQuestionAction;
const question_gateway_runtime_1 = require("openclaw/plugin-sdk/question-gateway-runtime");
const lark_logger_1 = require("../core/lark-logger.js");
const card_action_operator_1 = require("../core/card-action-operator.js");
const send_1 = require("../messaging/outbound/send.js");
const log = (0, lark_logger_1.larkLogger)('card/ask-user-gateway');
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CARD_SCHEMA = '2.0';
const ENVELOPE_VERSION = 1;
const ACTION_KIND = 'ask_user';
const CUSTOM_SUBMIT = '__custom_submit__';
const CUSTOM_INPUT_FIELD = 'custom_answer';
const QUESTION_TTL_MS = 15 * 60 * 1000;
const V2_CONFIG = { wide_screen_mode: true, update_multi: true, locales: ['zh_cn', 'en_us'] };
// ---------------------------------------------------------------------------
// Payload detection / extraction
// ---------------------------------------------------------------------------
/**
 * Detect a gateway-backed ask_user block payload (the signal the core uses
 * for native ask_user questions).
 */
function isAskUserPayload(payload) {
    return Boolean(payload?.channelData?.askUser?.questionId);
}
function readAskUserQuestionId(payload) {
    const qid = payload?.channelData?.askUser?.questionId;
    if (typeof qid === 'string' && qid)
        return qid;
    return question_gateway_runtime_1.questionGatewayRuntime.readAskUserQuestionId(payload) || undefined;
}
/** Extract tappable options (excluding the custom-input "Other…" button). */
function extractOptions(payload) {
    const blocks = payload?.presentation?.blocks;
    if (!Array.isArray(blocks))
        return [];
    for (const block of blocks) {
        if (block?.type !== 'buttons' || !Array.isArray(block.buttons))
            continue;
        return block.buttons
            .filter((b) => b?.action?.type === 'question' && b.action.intent !== 'custom-input' && typeof b.action.optionValue === 'string' && b.action.optionValue)
            .map((b) => ({ label: b.label, value: b.action.optionValue }));
    }
    return [];
}
function hasCustomInputOption(payload) {
    const blocks = payload?.presentation?.blocks;
    return (Array.isArray(blocks) &&
        blocks.some((b) => b?.type === 'buttons' && b.buttons?.some((btn) => btn?.action?.type === 'question' && btn.action.intent === 'custom-input')));
}
// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------
function buildEnvelope(questionId, optionValue, ctx) {
    const envelope = {
        v: ENVELOPE_VERSION,
        k: ACTION_KIND,
        q: questionId,
        o: optionValue,
        e: Date.now() + QUESTION_TTL_MS,
    };
    // Best-effort operator binding: only the asked user may answer.
    if (ctx?.senderOpenId)
        envelope.u = ctx.senderOpenId;
    if (ctx?.chatId)
        envelope.h = ctx.chatId;
    return envelope;
}
function decodeEnvelope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    if (value.v !== ENVELOPE_VERSION || value.k !== ACTION_KIND)
        return undefined;
    if (typeof value.q !== 'string' || !value.q)
        return undefined;
    return {
        questionId: value.q,
        optionValue: value.o,
        expectedUser: typeof value.u === 'string' ? value.u : undefined,
        expectedChat: typeof value.h === 'string' ? value.h : undefined,
        expiresAt: typeof value.e === 'number' ? value.e : undefined,
    };
}
// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------
function buildQuestionCard(questionText, options, customAllowed, questionId, ctx) {
    const elements = [];
    elements.push({ tag: 'markdown', content: questionText || '请回答以下问题' });
    if (options.length > 0) {
        elements.push({ tag: 'hr' });
        // Two buttons per row for a compact layout.
        for (let i = 0; i < options.length; i += 2) {
            const row = options.slice(i, i + 2).map((opt) => ({
                tag: 'column',
                width: 'weighted',
                weight: 1,
                vertical_align: 'center',
                elements: [
                    {
                        tag: 'button',
                        text: { tag: 'plain_text', content: opt.label },
                        type: 'primary',
                        value: buildEnvelope(questionId, opt.value, ctx),
                    },
                ],
            }));
            elements.push({ tag: 'column_set', flex_mode: 'stretch', columns: row });
        }
    }
    if (customAllowed) {
        elements.push({ tag: 'hr' });
        elements.push({
            tag: 'markdown',
            content: '**其他答案**',
            text_size: 'notation',
        });
        elements.push({
            tag: 'form',
            name: 'ask_user_custom_form',
            elements: [
                {
                    tag: 'input',
                    name: CUSTOM_INPUT_FIELD,
                    placeholder: {
                        tag: 'plain_text',
                        content: '输入你自己的答案…',
                        i18n_content: { zh_cn: '输入你自己的答案…', en_us: 'Type your own answer…' },
                    },
                },
                {
                    tag: 'button',
                    name: `ask_user_custom_submit_${questionId}`,
                    text: {
                        tag: 'plain_text',
                        content: '📮 提交其他答案',
                        i18n_content: { zh_cn: '📮 提交其他答案', en_us: '📮 Submit answer' },
                    },
                    type: 'default',
                    value: buildEnvelope(questionId, CUSTOM_SUBMIT, ctx),
                    form_action_type: 'submit',
                },
            ],
        });
    }
    return {
        schema: CARD_SCHEMA,
        config: V2_CONFIG,
        header: {
            title: { tag: 'plain_text', content: '需要你的回答', i18n_content: { zh_cn: '需要你的回答', en_us: 'Your Input Needed' } },
            template: 'blue',
        },
        body: { elements },
    };
}
function buildAnsweredCard(optionLabel) {
    return {
        schema: CARD_SCHEMA,
        config: V2_CONFIG,
        header: {
            title: { tag: 'plain_text', content: '已收到回答', i18n_content: { zh_cn: '已收到回答', en_us: 'Response Received' } },
            template: 'green',
        },
        body: {
            elements: [
                { tag: 'markdown', content: optionLabel ? `✅ 你的回答：**${optionLabel}**` : '✅ 已收到你的回答' },
            ],
        },
    };
}
// ---------------------------------------------------------------------------
// Delivery (called from the reply dispatcher's deliver() when askUser seen)
// ---------------------------------------------------------------------------
/**
 * Render a gateway ask_user question as an interactive Feishu button card.
 * Returns true when the payload was consumed as a question card.
 */
async function deliverAskUserQuestion(params) {
    const { cfg, chatId, replyToMessageId, replyInThread, accountId, payload } = params;
    const questionId = readAskUserQuestionId(payload);
    if (!questionId)
        return false;
    // Best-effort operator binding: the asking turn's sender open_id.
    const senderOpenId = params.senderOpenId;
    const card = buildQuestionCard(payload.text, extractOptions(payload), hasCustomInputOption(payload), questionId, { senderOpenId, chatId });
    try {
        await (0, send_1.sendCardFeishu)({
            cfg,
            to: chatId,
            card,
            replyToMessageId,
            replyInThread,
            accountId,
        });
        log.info(`ask-user question card sent id=${questionId} chat=${chatId} options=${extractOptions(payload).length}`);
        return true;
    }
    catch (err) {
        log.warn(`ask-user question card send failed id=${questionId}: ${String(err)}`);
        // Fall through to normal text delivery so the question is at least visible.
        return false;
    }
}
// ---------------------------------------------------------------------------
// Card action resolution (called from handleCardActionEvent)
// ---------------------------------------------------------------------------
/**
 * Handle a card.action.trigger for a gateway ask_user button.
 * Returns a Feishu callback receipt (toast/card), or undefined when the
 * action does not belong to this module.
 */
async function handleAskUserQuestionAction(data, cfg, accountId) {
    const event = data;
    const action = event?.action;
    // Primary signal: the button `value` envelope.
    let envelope = decodeEnvelope(action?.value);
    // Feishu form_submit events may strip the button `value` (only the name is
    // kept). Fall back to the submit button name which encodes the questionId.
    const customSubmitPrefix = 'ask_user_custom_submit_';
    const actionName = typeof action?.name === 'string' ? action.name : '';
    if (!envelope && actionName.startsWith(customSubmitPrefix)) {
        envelope = {
            questionId: actionName.slice(customSubmitPrefix.length),
            optionValue: CUSTOM_SUBMIT,
            expectedChat: undefined,
            expiresAt: undefined,
        };
    }
    if (!envelope)
        return undefined;
    const senderOpenId = (0, card_action_operator_1.resolveCardCallbackOperatorId)(event.operator);
    const chatId = event.open_chat_id ?? event.context?.open_chat_id;
    const messageId = event.open_message_id ?? event.context?.open_message_id;
    log.info(`ask-user action received: q=${envelope.questionId}, custom=${envelope.optionValue === CUSTOM_SUBMIT}, chat=${chatId}, sender=${senderOpenId}`);
    // ---- Validate envelope context ----
    // 注意：不做 expectedUser 强校验——群聊里 agent 可能把问题发给消息发送者之外的成员
    // （例如米罗提问、agent 却 @ 陈宣羽），绑定消息发送者会错误地拒绝其他群成员。
    if (envelope.expectedChat && chatId && envelope.expectedChat !== chatId) {
        return { toast: { type: 'warning', content: '该卡片不属于当前会话' } };
    }
    if (envelope.expiresAt != null && envelope.expiresAt < Date.now()) {
        return { toast: { type: 'info', content: '该问题已过期' } };
    }
    // ---- Custom answer submitted via the card's input form ----
    if (envelope.optionValue === CUSTOM_SUBMIT) {
        const formValue = action?.form_value;
        let typed = formValue && typeof formValue === 'object' ? formValue[CUSTOM_INPUT_FIELD] : undefined;
        if (typeof typed !== 'string' || !typed.trim()) {
            // Some SDK versions place form data directly on the action.
            typed = action?.[CUSTOM_INPUT_FIELD];
        }
        if (typeof typed !== 'string' || !typed.trim()) {
            return { toast: { type: 'warning', content: '请先在输入框填写你的答案' } };
        }
        const answer = typed.trim();
        setImmediate(async () => {
            try {
                const result = await question_gateway_runtime_1.questionGatewayRuntime.resolveOption({
                    cfg,
                    questionId: envelope.questionId,
                    optionValue: answer,
                    senderId: senderOpenId,
                    clientDisplayName: 'Feishu question',
                });
                log.info(`ask-user custom answer resolved q=${envelope.questionId} status=${result.status}`);
                if (result.status === 'answered' && messageId) {
                    try {
                        await (0, send_1.updateCardFeishu)({
                            cfg,
                            messageId,
                            card: buildAnsweredCard(answer),
                            accountId,
                        });
                    }
                    catch (updateErr) {
                        log.warn(`ask-user card answered update failed: ${String(updateErr)}`);
                    }
                }
            }
            catch (err) {
                log.warn(`ask-user custom resolve failed q=${envelope.questionId}: ${String(err)}`);
            }
        });
        return { toast: { type: 'success', content: '已收到你的回答，正在继续处理…' } };
    }
    // ---- Option button clicked ----
    setImmediate(async () => {
        try {
            const result = await question_gateway_runtime_1.questionGatewayRuntime.resolveOption({
                cfg,
                questionId: envelope.questionId,
                optionValue: envelope.optionValue,
                senderId: senderOpenId,
                clientDisplayName: 'Feishu question',
            });
            log.info(`ask-user resolved q=${envelope.questionId} status=${result.status} option=${envelope.optionValue}`);
            if (result.status === 'answered' && messageId) {
                const optionLabel = result.optionValue ?? envelope.optionValue;
                try {
                    await (0, send_1.updateCardFeishu)({
                        cfg,
                        messageId,
                        card: buildAnsweredCard(optionLabel),
                        accountId,
                    });
                }
                catch (updateErr) {
                    log.warn(`ask-user card answered update failed: ${String(updateErr)}`);
                }
            }
        }
        catch (err) {
            log.warn(`ask-user resolve failed q=${envelope.questionId}: ${String(err)}`);
        }
    });
    return { toast: { type: 'success', content: '已收到你的回答，正在继续处理…' } };
}

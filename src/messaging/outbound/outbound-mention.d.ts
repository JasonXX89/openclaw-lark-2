/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Outbound mention normalization + bot-peer @-mention enforcement.
 *
 * Why this exists: in Feishu groups, a bot only receives a message when
 * something explicitly @-mentions its open_id with a structured `<at>`
 * element. LLM outputs come in many "natural" @-shapes (markdown, angle
 * brackets, template syntax) but none of them satisfy the delivery rule —
 * only `<at user_id="ou_xxx">Name</at>` does. This module:
 *
 *   1. `normalizeOutboundMentions` — rewrites the six common LLM shapes
 *      into the standard `<at>` element when the name resolves via the
 *      per-chat mention-registry. Unknown names are left as plain text
 *      (a recipient who's never spoken in this chat can't be @-mentioned).
 *
 *   2. `ensureMention` — in bot→bot group scenarios, the agent reply must
 *      include an explicit @ of the peer bot or the peer never receives
 *      it. When the LLM forgets to add one, prepend it as a safety net.
 *
 * Both are idempotent: existing standard `<at>` elements are preserved,
 * and `ensureMention` is a no-op when the peer is already mentioned.
 */
/**
 * Rewrite LLM-emitted mention shapes into the standard `<at user_id="…">`
 * element used by Feishu for guaranteed delivery. Unknown names — those
 * whose display name isn't in the per-chat registry — are left intact as
 * plain text so the agent's wording survives even when delivery cannot
 * fire.
 */
export declare function normalizeOutboundMentions(text: string, chatId: string): string;
/**
 * Ensure the reply explicitly @-mentions the given peer.
 *
 * Designed for bot↔bot group flows: when the peer is another bot, Feishu
 * won't deliver the message unless an `<at user_id="ou_peer">` element is
 * present somewhere in the text. If the LLM already mentioned the peer,
 * no-op; otherwise, prepend a standard `<at>` so the peer wakes up.
 */
export declare function ensureMention(text: string, peerOpenId: string, peerName: string): string;

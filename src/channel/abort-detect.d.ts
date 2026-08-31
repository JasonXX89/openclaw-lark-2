/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Abort trigger detection for the Lark/Feishu channel plugin.
 *
 * Provides a fast-path check to determine whether an inbound message is
 * an abort/stop command *before* it enters the per-chat serial queue.
 *
 * The trigger word list and normalisation logic are copied from the
 * OpenClaw core (`src/auto-reply/reply/abort.ts`) so the plugin can
 * make a lightweight decision without importing the full reply pipeline.
 * The message still flows through `tryFastAbortFromMessage()` for
 * authoritative handling.
 */
import type { FeishuMessageEvent } from '../messaging/types';
/** Exact trigger-word match (same logic as OpenClaw core `isAbortTrigger`). */
export declare function isAbortTrigger(text: string): boolean;
/**
 * Extended abort detection: matches both bare trigger words and the
 * `/stop` command form.  Used by the monitor fast-path.
 */
export declare function isLikelyAbortText(text: string): boolean;
/**
 * Whether an inbound message expresses intent to stop / interrupt the ongoing
 * (bot-to-bot) exchange. Superset of {@link isLikelyAbortText} plus the
 * conversational phrases above.
 *
 * Two consumers: (1) suppress the deterministic peer-@ backstop so a stop
 * acknowledgement doesn't re-wake the peer bot; (2) mute an active bot loop so
 * the in-flight ping-pong drains instead of being re-armed. Substring match —
 * keep the list distinctive (no bare "停"/"stop") to limit false positives;
 * the worst case is a missed forced-@ or a self-healing mute (any normal
 * message lifts it).
 */
export declare function isConversationStopIntent(text: string): boolean;
/**
 * Extract the raw text payload from a Feishu message event.
 *
 * Only handles `text` type messages.  The `message.content` field is a
 * JSON string like `{"text":"hello"}`.  Returns `undefined` for
 * non-text messages or parse failures.
 *
 * In group chats, bot mention placeholders (`@_user_N`) are stripped so
 * a message like `@Bot stop` is detected as `stop`.
 */
export declare function extractRawTextFromEvent(event: FeishuMessageEvent): string | undefined;

/**
 * Copyright (c) 2026 Mirr0ch1
 * SPDX-License-Identifier: MIT
 */
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
export declare function isAskUserPayload(payload: unknown): boolean;
export declare function deliverAskUserQuestion(params: {
    cfg: ClawdbotConfig;
    chatId: string;
    replyToMessageId?: string;
    replyInThread?: boolean;
    accountId?: string;
    payload: unknown;
    senderOpenId?: string;
}): Promise<boolean>;
export declare function handleAskUserQuestionAction(data: unknown, cfg: ClawdbotConfig, accountId?: string): Promise<{
    toast: {
        type: string;
        content: string;
    };
} | undefined>;

"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu channel secret-contract registration. Declares which fields are
 * SecretRef-shaped so OpenClaw's runtime resolves them at startup.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.secretTargetRegistryEntries = void 0;
exports.collectRuntimeConfigAssignments = collectRuntimeConfigAssignments;
const channel_secret_basic_runtime_1 = require("openclaw/plugin-sdk/channel-secret-basic-runtime");
const SECRET_FIELDS = ['appSecret', 'encryptKey', 'verificationToken'];
/** Fields the Lark SDK only consumes when an account is in webhook mode. */
const WEBHOOK_ONLY_FIELDS = ['encryptKey', 'verificationToken'];
exports.secretTargetRegistryEntries = SECRET_FIELDS.flatMap((field) => {
    const acctPath = `channels.feishu.accounts.*.${field}`;
    const topPath = `channels.feishu.${field}`;
    return [
        {
            id: acctPath,
            targetType: acctPath,
            configFile: 'openclaw.json',
            pathPattern: acctPath,
            secretShape: 'secret_input',
            expectedResolvedValue: 'string',
            includeInPlan: true,
            includeInConfigure: true,
            includeInAudit: true,
        },
        {
            id: topPath,
            targetType: topPath,
            configFile: 'openclaw.json',
            pathPattern: topPath,
            secretShape: 'secret_input',
            expectedResolvedValue: 'string',
            includeInPlan: true,
            includeInConfigure: true,
            includeInAudit: true,
        },
    ];
});
function collectRuntimeConfigAssignments(params) {
    const resolved = (0, channel_secret_basic_runtime_1.getChannelSurface)(params.config, 'feishu');
    if (!resolved)
        return;
    const { channel, surface } = resolved;
    (0, channel_secret_basic_runtime_1.collectSimpleChannelFieldAssignments)({
        channelKey: 'feishu',
        field: 'appSecret',
        channel,
        surface,
        defaults: params.defaults,
        context: params.context,
        topInactiveReason: 'no enabled Feishu account inherits this top-level appSecret.',
        accountInactiveReason: 'Feishu account is disabled.',
    });
    const baseConnectionMode = (0, channel_secret_basic_runtime_1.normalizeSecretStringValue)(channel.connectionMode) === 'webhook' ? 'webhook' : 'websocket';
    const resolveAccountMode = (account) => (0, channel_secret_basic_runtime_1.hasOwnProperty)(account, 'connectionMode')
        ? (0, channel_secret_basic_runtime_1.normalizeSecretStringValue)(account.connectionMode)
        : baseConnectionMode;
    for (const field of WEBHOOK_ONLY_FIELDS) {
        (0, channel_secret_basic_runtime_1.collectConditionalChannelFieldAssignments)({
            channelKey: 'feishu',
            field,
            channel,
            surface,
            defaults: params.defaults,
            context: params.context,
            topLevelActiveWithoutAccounts: baseConnectionMode === 'webhook',
            topLevelInheritedAccountActive: ({ account, enabled }) => enabled && !(0, channel_secret_basic_runtime_1.hasOwnProperty)(account, field) && resolveAccountMode(account) === 'webhook',
            accountActive: ({ account, enabled }) => enabled && resolveAccountMode(account) === 'webhook',
            topInactiveReason: `no enabled Feishu webhook-mode surface inherits this top-level ${field}.`,
            accountInactiveReason: 'Feishu account is disabled or not running in webhook mode.',
        });
    }
}

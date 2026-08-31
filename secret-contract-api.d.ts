/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu channel secret-contract registration. Declares which fields are
 * SecretRef-shaped so OpenClaw's runtime resolves them at startup.
 */
import type { ResolverContext, SecretDefaults, SecretTargetRegistryEntry } from 'openclaw/plugin-sdk/channel-secret-basic-runtime';
import type { OpenClawConfig } from 'openclaw/plugin-sdk';
export declare const secretTargetRegistryEntries: readonly SecretTargetRegistryEntry[];
export declare function collectRuntimeConfigAssignments(params: {
    config: OpenClawConfig;
    defaults: SecretDefaults | undefined;
    context: ResolverContext;
}): void;

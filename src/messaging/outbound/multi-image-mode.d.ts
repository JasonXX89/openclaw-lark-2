/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pure functions for resolving the Feishu multi-image send mode.
 */
import type { FeishuConfig } from '../core/types';
type MultiImageMode = 'post' | 'sequential';
/**
 * Resolve the effective multi-image send mode from the merged Feishu config.
 *
 * `channels.feishu.multiImageMode` accepts:
 *   - `"post"`       → merge N images into one rich-text post (default)
 *   - `"sequential"` → keep sending N separate image messages
 *
 * Any unrecognised value (including `undefined`) falls back to `"post"`.
 */
export declare function resolveMultiImageMode(feishuCfg?: FeishuConfig | undefined): MultiImageMode;
export {};

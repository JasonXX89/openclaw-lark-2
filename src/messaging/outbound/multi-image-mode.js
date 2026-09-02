"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pure functions for resolving the Feishu multi-image send mode.
 *
 * When the model produces several image URLs in one payload, the plugin can
 * either merge them into a single Feishu rich-text post (`post`, default —
 * Feishu renders one `img` paragraph per image inside a single message) or
 * fall back to the legacy behaviour of sending one `image` message per URL
 * (`sequential`).
 *
 * Extracted as a pure module so routing decisions are independently testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMultiImageMode = resolveMultiImageMode;
// ---------------------------------------------------------------------------
// resolveMultiImageMode
// ---------------------------------------------------------------------------
/**
 * Resolve the effective multi-image send mode from the merged Feishu config.
 *
 * `channels.feishu.multiImageMode` accepts:
 *   - `"post"`       → merge N images into one rich-text post (default)
 *   - `"sequential"` → keep sending N separate image messages
 *
 * Any unrecognised value (including `undefined`) falls back to `"post"`, so
 * upgrading the plugin never changes existing default behaviour unexpectedly
 * beyond the intended merge.
 */
function resolveMultiImageMode(feishuCfg) {
    if (feishuCfg?.multiImageMode === 'sequential') {
        return 'sequential';
    }
    return 'post';
}

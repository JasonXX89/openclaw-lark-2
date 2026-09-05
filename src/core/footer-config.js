"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Default values and resolution logic for the Feishu card footer configuration.
 *
 * Each boolean flag controls whether a particular metadata item is displayed
 * in the card footer (e.g. elapsed time, model name).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FOOTER_CONFIG = void 0;
exports.resolveFooterConfig = resolveFooterConfig;
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
/**
 * The default footer configuration.
 *
 * By default all metadata items are hidden — neither status text
 * ("已完成" / "出错" / "已停止") nor elapsed time are shown.
 */
exports.DEFAULT_FOOTER_CONFIG = {
    status: false,
    elapsed: false,
    tokens: false,
    cache: false,
    context: false,
    model: false,
    provider: false,
    // 内容面板开关（非 footer 指标，但随 footer 配置一起管理）：
    // showReasoning=false → 全程不渲染 💭 思考面板（流式 + 终态）
    // showTools=false     → 全程不渲染 🔧 工具面板/步骤（流式 + 终态）
    // 默认 true = 现状行为（有面板）
    showReasoning: true,
    showTools: true,
};
// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------
/**
 * Merge a partial footer configuration with `DEFAULT_FOOTER_CONFIG`.
 *
 * Fields present in the input take precedence; anything absent falls back
 * to the default value.
 */
function resolveFooterConfig(cfg) {
    if (!cfg)
        return { ...exports.DEFAULT_FOOTER_CONFIG };
    return {
        status: cfg.status ?? exports.DEFAULT_FOOTER_CONFIG.status,
        elapsed: cfg.elapsed ?? exports.DEFAULT_FOOTER_CONFIG.elapsed,
        tokens: cfg.tokens ?? exports.DEFAULT_FOOTER_CONFIG.tokens,
        cache: cfg.cache ?? exports.DEFAULT_FOOTER_CONFIG.cache,
        context: cfg.context ?? exports.DEFAULT_FOOTER_CONFIG.context,
        model: cfg.model ?? exports.DEFAULT_FOOTER_CONFIG.model,
        provider: cfg.provider ?? exports.DEFAULT_FOOTER_CONFIG.provider,
        showReasoning: cfg.showReasoning ?? exports.DEFAULT_FOOTER_CONFIG.showReasoning,
        showTools: cfg.showTools ?? exports.DEFAULT_FOOTER_CONFIG.showTools,
    };
}

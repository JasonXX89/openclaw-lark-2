import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveReplyMode,
  expandAutoMode,
  shouldUseCard,
  isStreamingEnabled,
} = require("../../src/card/reply-mode.js");

describe("reply-mode", () => {
  describe("resolveReplyMode", () => {
    it("returns static when streaming is not enabled", () => {
      expect(resolveReplyMode({ feishuCfg: {}, chatType: "p2p" })).toBe("static");
      expect(resolveReplyMode({ feishuCfg: { streaming: false }, chatType: "p2p" })).toBe("static");
      expect(resolveReplyMode({ feishuCfg: undefined, chatType: "group" })).toBe("static");
    });

    it("returns auto when streaming enabled but no replyMode set", () => {
      expect(resolveReplyMode({ feishuCfg: { streaming: true }, chatType: "p2p" })).toBe("auto");
    });

    it("returns string replyMode directly", () => {
      expect(resolveReplyMode({ feishuCfg: { streaming: true, replyMode: "streaming" }, chatType: "group" })).toBe("streaming");
    });

    it("prefers scene override over default over string", () => {
      const cfg = { streaming: true, replyMode: { default: "static", group: "streaming", direct: "streaming" } };
      expect(resolveReplyMode({ feishuCfg: cfg, chatType: "group" })).toBe("streaming");
      expect(resolveReplyMode({ feishuCfg: cfg, chatType: "p2p" })).toBe("streaming");
      expect(resolveReplyMode({ feishuCfg: cfg, chatType: "other" })).toBe("static");
    });

    it("falls back to default when scene missing", () => {
      const cfg = { streaming: true, replyMode: { default: "static" } };
      expect(resolveReplyMode({ feishuCfg: cfg, chatType: "group" })).toBe("static");
    });
  });

  describe("expandAutoMode", () => {
    it("passes through non-auto modes", () => {
      expect(expandAutoMode({ mode: "streaming", streaming: true, chatType: "group" })).toBe("streaming");
      expect(expandAutoMode({ mode: "static", streaming: true, chatType: "p2p" })).toBe("static");
    });

    it("expands auto: group→static, p2p→streaming when streaming enabled", () => {
      expect(expandAutoMode({ mode: "auto", streaming: true, chatType: "group" })).toBe("static");
      expect(expandAutoMode({ mode: "auto", streaming: true, chatType: "p2p" })).toBe("streaming");
    });

    it("expands auto to static when streaming not enabled", () => {
      expect(expandAutoMode({ mode: "auto", streaming: false, chatType: "p2p" })).toBe("static");
      expect(expandAutoMode({ mode: "auto", streaming: undefined, chatType: "group" })).toBe("static");
    });
  });

  describe("shouldUseCard", () => {
    it("always returns false (native post rendering preserves bot-at-bot @)", () => {
      expect(shouldUseCard("hello")).toBe(false);
      expect(shouldUseCard("```code\nblock```")).toBe(false);
      expect(shouldUseCard("| a | b |")).toBe(false);
      expect(shouldUseCard("")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2026-09-10 回归：OpenClaw 2026.9.3 起把渠道 streaming 规范化成对象形式
  // （官方归一化 boolean true ⇔ {mode:"partial"}，false ⇔ {mode:"off"}）。
  // 插件旧的 `streaming !== true` 严格判断让私聊全部回退 static → 卡片消失，
  // 日志表现：reply mode resolved (effectiveReplyMode=static, chatType=p2p)。
  // -------------------------------------------------------------------------
  describe("isStreamingEnabled — 兼容布尔与对象两种形式", () => {
    it("布尔：true 开启 / false 关闭 / undefined·null 关闭", () => {
      expect(isStreamingEnabled(true)).toBe(true);
      expect(isStreamingEnabled(false)).toBe(false);
      expect(isStreamingEnabled(undefined)).toBe(false);
      expect(isStreamingEnabled(null)).toBe(false);
    });

    it("对象：partial/block/progress 开启，off 关闭（官方 mode 枚举）", () => {
      expect(isStreamingEnabled({ mode: "partial" })).toBe(true);
      expect(isStreamingEnabled({ mode: "block" })).toBe(true);
      expect(isStreamingEnabled({ mode: "progress" })).toBe(true);
      expect(isStreamingEnabled({ mode: "off" })).toBe(false);
    });

    it("对象无 mode 字段：按开启处理（与官方 default 一致）", () => {
      expect(isStreamingEnabled({})).toBe(true);
    });

    it("字符串形式：off 关闭，其余开启", () => {
      expect(isStreamingEnabled("off")).toBe(false);
      expect(isStreamingEnabled("partial")).toBe(true);
    });
  });

  describe("对象形式 streaming 不再被误判 static", () => {
    it("私聊 + {mode:'partial'} → auto，展开后为 streaming", () => {
      const streaming = { mode: "partial" };
      const mode = resolveReplyMode({ feishuCfg: { streaming }, chatType: "p2p" });
      expect(mode).toBe("auto");
      expect(expandAutoMode({ mode, streaming, chatType: "p2p" })).toBe("streaming");
    });

    it("私聊 + {mode:'off'} → static（显式关闭仍然生效）", () => {
      expect(resolveReplyMode({ feishuCfg: { streaming: { mode: "off" } }, chatType: "p2p" })).toBe("static");
    });

    it("群聊 + {mode:'partial'} → static（群聊默认不出卡，保持原设计）", () => {
      const streaming = { mode: "partial" };
      const mode = resolveReplyMode({ feishuCfg: { streaming }, chatType: "group" });
      expect(expandAutoMode({ mode, streaming, chatType: "group" })).toBe("static");
    });
  });
});

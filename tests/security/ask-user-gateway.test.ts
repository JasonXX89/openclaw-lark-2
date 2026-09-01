import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleAskUserQuestionAction, isAskUserPayload } = require("../../src/card/ask-user-gateway-card.js");

describe("ask-user gateway — payload security", () => {
  describe("isAskUserPayload", () => {
    it("accepts a payload with channelData.askUser.questionId", () => {
      expect(isAskUserPayload({ channelData: { askUser: { questionId: "q1" } } })).toBe(true);
    });

    it("rejects null/undefined/non-object payloads", () => {
      expect(isAskUserPayload(null)).toBe(false);
      expect(isAskUserPayload(undefined)).toBe(false);
      expect(isAskUserPayload("text")).toBe(false);
      expect(isAskUserPayload({})).toBe(false);
    });

    it("rejects payloads missing the askUser marker", () => {
      expect(isAskUserPayload({ channelData: { foo: 1 } })).toBe(false);
    });
  });

  describe("readAskUserQuestionId (via isAskUserPayload)", () => {
    it("recognizes a question payload with questionId", () => {
      expect(isAskUserPayload({ channelData: { askUser: { questionId: "abc" } } })).toBe(true);
    });

    it("returns false for payloads without a questionId", () => {
      expect(isAskUserPayload({ channelData: { askUser: {} } })).toBe(false);
    });
  });

  describe("handleAskUserQuestionAction — malformed input", () => {
    it("does not crash on null data", async () => {
      // handler must return undefined (not throw) for unparseable input so the
      // channel can fall through to other action handling.
      const result = await handleAskUserQuestionAction(null, {}, "default");
      expect(result).toBeUndefined();
    });

    it("does not crash on non-object action payload", async () => {
      const result = await handleAskUserQuestionAction(
        { action: { value: "not-json" }, operator: {} },
        {},
        "default",
      );
      // Unparseable envelope → falls through (undefined), no crash.
      expect(result).toBeUndefined();
    });

    it("rejects envelope with wrong version/kind", async () => {
      const result = await handleAskUserQuestionAction(
        {
          action: { value: JSON.stringify({ v: 99, k: "other", q: "q1" }) },
          operator: { open_id: "ou_1" },
        },
        { channels: { feishu: { appId: "a", appSecret: "b" } } },
        "default",
      );
      expect(result).toBeUndefined();
    });

    it("rejects envelope with non-string questionId (prototype-safe fields)", async () => {
      // Craft a payload that tries to smuggle non-string fields.
      const evil = JSON.stringify({ v: 1, k: "ask_user", q: { toString: "x" }, o: "opt", u: "ou_1", h: "oc_1", e: "NaN" });
      const result = await handleAskUserQuestionAction(
        {
          action: { value: evil },
          operator: { open_id: "ou_1" },
        },
        {},
        "default",
      );
      // q must be a string — it isn't → envelope rejected → undefined.
      expect(result).toBeUndefined();
    });
  });
});

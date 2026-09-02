import { describe, it, expect } from "vitest";
// CJS source modules load directly under vitest.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FeishuConfigSchema, FEISHU_CONFIG_JSON_SCHEMA } = require("../../src/core/config-schema.js");

describe("config-schema", () => {
  describe("FeishuConfigSchema", () => {
    it("accepts a minimal empty config", () => {
      const result = FeishuConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid appId/appSecret/domain", () => {
      const result = FeishuConfigSchema.safeParse({
        appId: "cli_abc123",
        appSecret: "secret",
        domain: "feishu",
      });
      expect(result.success).toBe(true);
    });

    it("accepts lark domain", () => {
      const result = FeishuConfigSchema.safeParse({ domain: "lark" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid connectionMode", () => {
      const result = FeishuConfigSchema.safeParse({ connectionMode: "carrier-pigeon" });
      expect(result.success).toBe(false);
    });

    it("accepts object-form replyMode with scene overrides", () => {
      const result = FeishuConfigSchema.safeParse({
        streaming: true,
        replyMode: { default: "static", group: "streaming", direct: "streaming" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts per-account entries under accounts", () => {
      const result = FeishuConfigSchema.safeParse({
        appId: "cli_main",
        accounts: {
          bot2: { appId: "cli_bot2", enabled: true, domain: "lark" },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts multiImageMode post/sequential at top level and per account", () => {
      expect(FeishuConfigSchema.safeParse({ multiImageMode: "post" }).success).toBe(true);
      expect(FeishuConfigSchema.safeParse({ multiImageMode: "sequential" }).success).toBe(true);
      expect(
        FeishuConfigSchema.safeParse({
          accounts: { bot2: { multiImageMode: "sequential" } },
        }).success,
      ).toBe(true);
    });

    it("rejects an unknown multiImageMode value", () => {
      expect(FeishuConfigSchema.safeParse({ multiImageMode: "album" }).success).toBe(false);
    });

    it("rejects invalid group policy value", () => {
      const result = FeishuConfigSchema.safeParse({ groupPolicy: "everyone-and-dog" });
      expect(result.success).toBe(false);
    });
  });

  describe("FEISHU_CONFIG_JSON_SCHEMA", () => {
    it("is a JSON schema object", () => {
      expect(FEISHU_CONFIG_JSON_SCHEMA).toBeTypeOf("object");
      expect(FEISHU_CONFIG_JSON_SCHEMA).toHaveProperty("type");
    });

    it("describes appId as a string property", () => {
      const props = FEISHU_CONFIG_JSON_SCHEMA.properties ?? {};
      expect(props.appId?.type).toBe("string");
    });
  });
});

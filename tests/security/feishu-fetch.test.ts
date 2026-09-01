import { describe, it, expect, vi, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuFetch } = require("../../src/core/feishu-fetch.js");

describe("feishuFetch SSRF wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  it("blocks non-allowlisted hosts when domain is feishu", async () => {
    await expect(
      feishuFetch("https://example.com/open-apis/authen/v1/user_info", {}, "feishu"),
    ).rejects.toThrow(/blocked|not in allowlist/i);
  });

  it("allows open.feishu.cn with domain=feishu (SSRF gate passes)", async () => {
    // Response 400 (missing creds) is fine — what matters is that the SSRF
    // guard does NOT reject the request itself.
    const resp = await feishuFetch(
      "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "x=1",
      },
      "feishu",
    );
    expect([200, 400, 401, 403]).toContain(resp.status);
    await resp.text().catch(() => undefined);
  });

  it("allows accounts.feishu.cn (device-flow endpoint) with domain=feishu", async () => {
    const resp = await feishuFetch(
      "https://accounts.feishu.cn/oauth/v1/device_authorization",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "x=1" },
      "feishu",
    );
    expect([200, 400, 401, 403]).toContain(resp.status);
    await resp.text().catch(() => undefined);
  });

  it("allows lark domains with domain=lark", async () => {
    const resp = await feishuFetch(
      "https://open.larksuite.com/open-apis/authen/v2/oauth/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "x=1" },
      "lark",
    );
    expect([200, 400, 401, 403]).toContain(resp.status);
    await resp.text().catch(() => undefined);
  });
});

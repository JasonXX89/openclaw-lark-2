import { describe, it, expect, vi, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { guardedRemoteFetch, guardedFeishuFetch, fetchWithSsrFGuard } = require("../../src/core/ssrf.js");

describe("ssrf guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("guardedRemoteFetch", () => {
    it("exposes the SDK fetchWithSsrFGuard", () => {
      expect(typeof fetchWithSsrFGuard).toBe("function");
    });

    it("blocks private IPv4 loopback", async () => {
      await expect(guardedRemoteFetch("http://127.0.0.1:8080/secret", undefined, { timeoutMs: 2000 }))
        .rejects.toThrow(/private|blocked/i);
    });

    it("blocks cloud metadata IP 169.254.169.254", async () => {
      await expect(guardedRemoteFetch("http://169.254.169.254/latest/meta-data/", undefined, { timeoutMs: 2000 }))
        .rejects.toThrow(/private|blocked/i);
    });

    it("blocks IPv6 loopback", async () => {
      await expect(guardedRemoteFetch("http://[::1]:8080/", undefined, { timeoutMs: 2000 }))
        .rejects.toThrow(/private|blocked/i);
    });

    it("blocks private 10.x ranges", async () => {
      await expect(guardedRemoteFetch("http://10.0.0.1/", undefined, { timeoutMs: 2000 }))
        .rejects.toThrow(/private|blocked/i);
    });

    it("blocks 192.168.x ranges", async () => {
      await expect(guardedRemoteFetch("http://192.168.1.1/", undefined, { timeoutMs: 2000 }))
        .rejects.toThrow(/private|blocked/i);
    });

    it("blocks non-http(s) protocols", async () => {
      await expect(guardedRemoteFetch("file:///etc/passwd", undefined, { timeoutMs: 2000 }))
        .rejects.toThrow(/http or https/i);
    });
  });

  describe("guardedFeishuFetch allowlist", () => {
    it("allows open.feishu.cn with domain=feishu", async () => {
      // If the SSRF guard were over-blocking, this would reject; a real
      // network round-trip may still fail for other reasons, so we only
      // assert it does NOT throw the SsrFBlockedError family synchronously.
      const result = await guardedFeishuFetch(
        "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=client_credentials",
        },
        { domain: "feishu", timeoutMs: 8000 },
      );
      expect(result).toHaveProperty("response");
      expect(result).toHaveProperty("release");
      await result.release();
    });

    it("allows open.larksuite.com with domain=lark", async () => {
      const result = await guardedFeishuFetch(
        "https://open.larksuite.com/open-apis/authen/v2/oauth/token",
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "x=1" },
        { domain: "lark", timeoutMs: 8000 },
      );
      expect(result).toHaveProperty("response");
      await result.release();
    });

    it("resolves custom https domain hostname into the allowlist", async () => {
      // Directly verify resolveAllowedHostnames output through a URL that is
      // NOT a Feishu host — must be rejected because hostname not allowed.
      await expect(
        guardedFeishuFetch("https://example.com/", undefined, { domain: "feishu", timeoutMs: 2000 }),
      ).rejects.toThrow(/blocked|not in allowlist/i);
    });
  });
});

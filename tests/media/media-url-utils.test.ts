import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  normalizeMediaUrlInput,
  isLocalMediaPath,
  safeFileUrlToPath,
  validateLocalMediaRoots,
  resolveFileNameFromMediaUrl,
  isWindowsAbsolutePath,
} = require("../../src/messaging/outbound/media-url-utils.js");

describe("media-url-utils", () => {
  describe("normalizeMediaUrlInput", () => {
    it("trims whitespace and surrounding quotes", () => {
      expect(normalizeMediaUrlInput("  https://a.com/x.png  ")).toBe("https://a.com/x.png");
      expect(normalizeMediaUrlInput('"https://a.com/x.png"')).toBe("https://a.com/x.png");
      expect(normalizeMediaUrlInput("`https://a.com/x.png`")).toBe("https://a.com/x.png");
    });

    it("leaves bare values unchanged", () => {
      expect(normalizeMediaUrlInput("https://a.com/x.png")).toBe("https://a.com/x.png");
    });
  });

  describe("isLocalMediaPath", () => {
    it("detects file:// URLs", () => {
      expect(isLocalMediaPath("file:///tmp/x.png")).toBe(true);
    });

    it("detects absolute paths", () => {
      expect(isLocalMediaPath("/tmp/x.png")).toBe(true);
    });

    it("detects Windows absolute paths", () => {
      expect(isLocalMediaPath("C:\\tmp\\x.png")).toBe(true);
      expect(isWindowsAbsolutePath("C:\\tmp\\x.png")).toBe(true);
    });

    it("treats http(s) URLs as remote", () => {
      expect(isLocalMediaPath("https://a.com/x.png")).toBe(false);
      expect(isLocalMediaPath("http://a.com/x.png")).toBe(false);
    });
  });

  describe("safeFileUrlToPath", () => {
    it("converts file URL to path", () => {
      const p = safeFileUrlToPath("file:///tmp/x.png");
      // fileURLToPath returns the host-independent path
      expect(p.endsWith("tmp/x.png") || p.endsWith("tmp\\x.png")).toBe(true);
    });
  });

  describe("validateLocalMediaRoots", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "media-roots-"));
    const allowed = path.join(tmp, "allowed");
    fs.mkdirSync(allowed, { recursive: true });

    it("is a no-op when localRoots is undefined", () => {
      expect(() => validateLocalMediaRoots("/etc/passwd", undefined)).not.toThrow();
    });

    it("blocks everything when localRoots is empty array", () => {
      expect(() => validateLocalMediaRoots("/tmp/anything", [])).toThrow(/denied/);
    });

    it("allows paths inside an allowed root", () => {
      const inside = path.join(allowed, "sub", "a.png");
      expect(() => validateLocalMediaRoots(inside, [allowed])).not.toThrow();
    });

    it("blocks paths outside allowed roots (path traversal)", () => {
      expect(() => validateLocalMediaRoots("/etc/passwd", [allowed])).toThrow(/denied/);
      const sibling = path.join(tmp, "other", "b.png");
      fs.mkdirSync(path.dirname(sibling), { recursive: true });
      expect(() => validateLocalMediaRoots(sibling, [allowed])).toThrow(/denied/);
    });

    it("resolves symlinks so traversal via symlink is blocked", () => {
      const link = path.join(tmp, "link.png");
      try {
        fs.symlinkSync("/etc/passwd", link);
      } catch {
        return; // symlink unsupported on this fs — skip
      }
      expect(() => validateLocalMediaRoots(link, [allowed])).toThrow(/denied/);
    });
  });

  describe("resolveFileNameFromMediaUrl", () => {
    it("extracts basename from URL", () => {
      const name = resolveFileNameFromMediaUrl("https://a.com/dir/photo.png");
      expect(name).toContain("photo.png");
    });

    it("handles query strings", () => {
      const name = resolveFileNameFromMediaUrl("https://a.com/dir/photo.png?token=abc");
      expect(name).toContain("photo.png");
    });

    it("falls back for pathless URLs", () => {
      const name = resolveFileNameFromMediaUrl("https://a.com");
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    });
  });
});

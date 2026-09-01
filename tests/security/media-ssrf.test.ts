import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchRemoteImageBuffer } = require("../../src/messaging/outbound/media.js");

describe("media fetch SSRF protection", () => {
  it("blocks private IPv4 loopback targets", async () => {
    await expect(fetchRemoteImageBuffer("http://127.0.0.1:8080/x.png")).rejects.toThrow(/private|blocked/i);
  });

  it("blocks cloud metadata IP", async () => {
    await expect(fetchRemoteImageBuffer("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/private|blocked/i);
  });

  it("blocks IPv6 loopback", async () => {
    await expect(fetchRemoteImageBuffer("http://[::1]:8080/x.png")).rejects.toThrow(/private|blocked/i);
  });

  it("blocks 10.x private ranges", async () => {
    await expect(fetchRemoteImageBuffer("http://10.0.0.1/x.png")).rejects.toThrow(/private|blocked/i);
  });

  it("blocks 192.168.x private ranges", async () => {
    await expect(fetchRemoteImageBuffer("http://192.168.1.1/x.png")).rejects.toThrow(/private|blocked/i);
  });

  it("blocks file:// protocol", async () => {
    await expect(fetchRemoteImageBuffer("file:///etc/passwd")).rejects.toThrow(/denied|local|protocol/i);
  });

  it("denies local file paths without mediaLocalRoots configured", async () => {
    // fetchRemoteImageBuffer passes localRoots=undefined → local access denied.
    const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "media-")), "a.png");
    fs.writeFileSync(tmpFile, "x");
    await expect(fetchRemoteImageBuffer(tmpFile)).rejects.toThrow(/denied|mediaLocalRoots/i);
  });
});

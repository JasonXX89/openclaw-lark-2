import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// CJS source modules load directly under vitest (same pattern as actions-pin).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LarkClient } = require("../../src/core/lark-client.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multiImageModeModule = require("../../src/messaging/outbound/multi-image-mode.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mediaModule = require("../../src/messaging/outbound/media.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deliverModule = require("../../src/messaging/outbound/deliver.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuOutbound } = require("../../src/messaging/outbound/outbound.js");

const baseCfg = { channels: { feishu: { appId: "cli_test", appSecret: "sec" } } };

beforeEach(() => {
  vi.spyOn(LarkClient, "fromCfg").mockReturnValue({ sdk: { im: {} } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("resolveMultiImageMode", () => {
  it("defaults to 'post' when multiImageMode is unset", () => {
    expect(multiImageModeModule.resolveMultiImageMode(undefined)).toBe("post");
    expect(multiImageModeModule.resolveMultiImageMode({})).toBe("post");
    expect(multiImageModeModule.resolveMultiImageMode(undefined)).toBe("post");
  });

  it("honours 'post' and 'sequential'", () => {
    expect(multiImageModeModule.resolveMultiImageMode({ multiImageMode: "post" })).toBe("post");
    expect(multiImageModeModule.resolveMultiImageMode({ multiImageMode: "sequential" })).toBe("sequential");
  });

  it("falls back to 'post' for unrecognised values", () => {
    expect(multiImageModeModule.resolveMultiImageMode({ multiImageMode: "album" } as never)).toBe("post");
  });
});

describe("isImageMediaUrl", () => {
  it("detects image URLs by extension", () => {
    expect(mediaModule.isImageMediaUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(mediaModule.isImageMediaUrl("https://cdn.example.com/a.PNG")).toBe(true);
    expect(mediaModule.isImageMediaUrl("https://cdn.example.com/photo.jpg?size=big&x=1")).toBe(true);
    expect(mediaModule.isImageMediaUrl("https://cdn.example.com/anim.webp")).toBe(true);
  });

  it("rejects non-image and extension-less URLs", () => {
    expect(mediaModule.isImageMediaUrl("https://cdn.example.com/report.pdf")).toBe(false);
    expect(mediaModule.isImageMediaUrl("https://cdn.example.com/video.mp4")).toBe(false);
    expect(mediaModule.isImageMediaUrl("https://cdn.example.com/signed-url/abc123")).toBe(false);
    expect(mediaModule.isImageMediaUrl("")).toBe(false);
  });

  it("detects image local paths", () => {
    expect(mediaModule.isImageMediaUrl("/tmp/photo.webp")).toBe(true);
    expect(mediaModule.isImageMediaUrl("C:\\pics\\a.jpeg")).toBe(true);
    expect(mediaModule.isImageMediaUrl("/tmp/notes.txt")).toBe(false);
  });
});

describe("deliver.sendImageGroupPostLark", () => {
  it("sends one post whose content carries one img paragraph per image", async () => {
    const create = vi.fn().mockResolvedValue({ data: { message_id: "om_group", chat_id: "oc_1" } });
    (LarkClient.fromCfg as ReturnType<typeof vi.spyOn>).mockReturnValue({
      sdk: { im: { message: { create } } },
    } as never);

    const result = await deliverModule.sendImageGroupPostLark({
      cfg: baseCfg,
      to: "oc_1",
      imageKeys: ["img_v2_aaa", "img_v2_bbb"],
    });

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.params).toMatchObject({ receive_id_type: "chat_id" });
    expect(call.data.receive_id).toBe("oc_1");
    expect(call.data.msg_type).toBe("post");
    const content = JSON.parse(call.data.content);
    expect(content.zh_cn.content).toEqual([
      [{ tag: "img", image_key: "img_v2_aaa" }],
      [{ tag: "img", image_key: "img_v2_bbb" }],
    ]);
    expect(result).toMatchObject({ messageId: "om_group", chatId: "oc_1" });
  });

  it("routes through the reply path when replyToMessageId is set", async () => {
    const reply = vi.fn().mockResolvedValue({ data: { message_id: "om_reply", chat_id: "oc_1" } });
    (LarkClient.fromCfg as ReturnType<typeof vi.spyOn>).mockReturnValue({
      sdk: { im: { message: { reply } } },
    } as never);

    await deliverModule.sendImageGroupPostLark({
      cfg: baseCfg,
      to: "oc_1",
      imageKeys: ["img_v2_aaa"],
      replyToMessageId: "om_orig",
      replyInThread: false,
    });

    const call = reply.mock.calls[0][0];
    expect(call.path).toEqual({ message_id: "om_orig" });
    expect(call.data.msg_type).toBe("post");
    expect(call.data.reply_in_thread).toBe(false);
  });
});

describe("media.uploadImageFromUrlLark", () => {
  it("fetches a local image and uploads it, returning the image_key", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-img-"));
    const filePath = path.join(tmpRoot, "pixel.png");
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const create = vi.fn().mockResolvedValue({ data: { image_key: "img_v2_uploaded" } });
      (LarkClient.fromCfg as ReturnType<typeof vi.spyOn>).mockReturnValue({
        sdk: { im: { image: { create } } },
      } as never);

      const result = await mediaModule.uploadImageFromUrlLark({
        cfg: baseCfg,
        mediaUrl: filePath,
        mediaLocalRoots: [tmpRoot],
      });

      expect(result).toEqual({ imageKey: "img_v2_uploaded" });
      expect(create).toHaveBeenCalledTimes(1);
      const call = create.mock.calls[0][0];
      expect(call.data.image_type).toBe("message");
      expect(call.data.image).toBeDefined();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("propagates local-root violations so callers can fall back", async () => {
    await expect(
      mediaModule.uploadImageFromUrlLark({
        cfg: baseCfg,
        mediaUrl: "/etc/hostname",
        mediaLocalRoots: ["/tmp"],
      }),
    ).rejects.toThrow(/mediaLocalRoots/i);
  });
});

describe("feishuOutbound.sendPayload — multi-image routing", () => {
  const payload = (mediaUrls: string[], text = "caption") => ({ text, mediaUrls });

  function stubDeliver(overrides?: {
    sendTextLark?: (p: unknown) => Promise<unknown>;
    sendImageGroupPostLark?: (p: unknown) => Promise<unknown>;
    sendMediaLark?: (p: unknown) => Promise<unknown>;
  }) {
    vi.spyOn(deliverModule, "sendTextLark").mockResolvedValue({
      messageId: "om_text",
      chatId: "oc_1",
    });
    vi.spyOn(deliverModule, "sendImageGroupPostLark").mockResolvedValue({
      messageId: "om_group",
      chatId: "oc_1",
    });
    vi.spyOn(deliverModule, "sendMediaLark").mockResolvedValue({
      messageId: "om_seq",
      chatId: "oc_1",
    });
    if (overrides?.sendTextLark) {
      vi.mocked(deliverModule.sendTextLark).mockImplementation(overrides.sendTextLark as never);
    }
    if (overrides?.sendImageGroupPostLark) {
      vi.mocked(deliverModule.sendImageGroupPostLark).mockImplementation(overrides.sendImageGroupPostLark as never);
    }
    if (overrides?.sendMediaLark) {
      vi.mocked(deliverModule.sendMediaLark).mockImplementation(overrides.sendMediaLark as never);
    }
    vi.spyOn(mediaModule, "uploadImageFromUrlLark").mockImplementation(async ({ mediaUrl }: { mediaUrl: string }) => ({
      imageKey: `img_${mediaUrl.split("/").pop()}`,
    }));
  }

  it("merges 2+ images into one post by default, caption still sent separately", async () => {
    stubDeliver();
    const urls = ["https://cdn.example.com/a.png", "https://cdn.example.com/b.jpg"];

    const result = await feishuOutbound.sendPayload({
      cfg: baseCfg,
      to: "oc_1",
      payload: payload(urls, "look at these"),
    });

    // Caption first, as its own message.
    expect(deliverModule.sendTextLark).toHaveBeenCalledTimes(1);
    expect(deliverModule.sendTextLark).toHaveBeenCalledWith(
      expect.objectContaining({ to: "oc_1", text: "look at these" }),
    );
    // Every URL uploaded once, then a single combined post.
    expect(mediaModule.uploadImageFromUrlLark).toHaveBeenCalledTimes(2);
    expect(deliverModule.sendImageGroupPostLark).toHaveBeenCalledWith(
      expect.objectContaining({ to: "oc_1", imageKeys: ["img_a.png", "img_b.jpg"] }),
    );
    // No sequential image sends happened.
    expect(deliverModule.sendMediaLark).not.toHaveBeenCalled();
    expect(result).toMatchObject({ messageId: "om_group", chatId: "oc_1" });
  });

  it("sends media without a separate caption when text is empty", async () => {
    stubDeliver();
    await feishuOutbound.sendPayload({
      cfg: baseCfg,
      to: "oc_1",
      payload: payload(["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"], ""),
    });
    expect(deliverModule.sendTextLark).not.toHaveBeenCalled();
    expect(deliverModule.sendImageGroupPostLark).toHaveBeenCalledTimes(1);
  });

  it("keeps sequential per-image sends when multiImageMode is 'sequential'", async () => {
    stubDeliver();
    const urls = ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"];
    const cfg = {
      channels: { feishu: { appId: "cli_test", appSecret: "sec", multiImageMode: "sequential" } },
    };

    const result = await feishuOutbound.sendPayload({
      cfg,
      to: "oc_1",
      payload: payload(urls),
    });

    expect(deliverModule.sendImageGroupPostLark).not.toHaveBeenCalled();
    expect(mediaModule.uploadImageFromUrlLark).not.toHaveBeenCalled();
    expect(deliverModule.sendMediaLark).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ messageId: "om_seq", chatId: "oc_1" });
  });

  it("falls back to sequential sends when the merged post fails", async () => {
    stubDeliver({
      sendImageGroupPostLark: vi.fn().mockRejectedValue(new Error("post rejected by Feishu")),
    });
    const urls = ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"];

    const result = await feishuOutbound.sendPayload({
      cfg: baseCfg,
      to: "oc_1",
      payload: payload(urls),
    });

    expect(deliverModule.sendImageGroupPostLark).toHaveBeenCalledTimes(1);
    expect(deliverModule.sendMediaLark).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ messageId: "om_seq", chatId: "oc_1" });
  });

  it("falls back to sequential sends when an upload fails mid-group", async () => {
    stubDeliver();
    vi.mocked(mediaModule.uploadImageFromUrlLark)
      .mockResolvedValueOnce({ imageKey: "img_ok" })
      .mockRejectedValueOnce(new Error("download timeout"));

    const urls = ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"];
    const result = await feishuOutbound.sendPayload({
      cfg: baseCfg,
      to: "oc_1",
      payload: payload(urls),
    });

    expect(deliverModule.sendImageGroupPostLark).not.toHaveBeenCalled();
    expect(deliverModule.sendMediaLark).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ messageId: "om_seq", chatId: "oc_1" });
  });

  it("never merges mixed media (image + non-image)", async () => {
    stubDeliver();
    const urls = ["https://cdn.example.com/a.png", "https://cdn.example.com/deck.pdf"];

    await feishuOutbound.sendPayload({ cfg: baseCfg, to: "oc_1", payload: payload(urls) });

    expect(deliverModule.sendImageGroupPostLark).not.toHaveBeenCalled();
    expect(deliverModule.sendMediaLark).toHaveBeenCalledTimes(2);
  });

  it("never merges a single image", async () => {
    stubDeliver();
    await feishuOutbound.sendPayload({
      cfg: baseCfg,
      to: "oc_1",
      payload: payload(["https://cdn.example.com/a.png"]),
    });

    expect(deliverModule.sendImageGroupPostLark).not.toHaveBeenCalled();
    expect(deliverModule.sendMediaLark).toHaveBeenCalledTimes(1);
  });
});

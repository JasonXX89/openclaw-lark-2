import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LarkClient } = require("../../src/core/lark-client.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pinsModule = require("../../src/messaging/outbound/pins.js");

const sdkMock = {
  im: {
    pin: {
      create: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    },
  },
};

beforeEach(() => {
  vi.spyOn(LarkClient, "fromCfg").mockReturnValue({ sdk: sdkMock });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("pins module", () => {
  it("createPinFeishu calls im.pin.create with message_id", async () => {
    sdkMock.im.pin.create.mockResolvedValue({
      code: 0,
      data: { pin: { message_id: "om_1", chat_id: "oc_1" } },
    });
    const result = await pinsModule.createPinFeishu({ cfg: {}, messageId: "om_1" });
    expect(sdkMock.im.pin.create).toHaveBeenCalledWith({ data: { message_id: "om_1" } });
    expect(result).toEqual({
      messageId: "om_1",
      chatId: "oc_1",
      operatorId: undefined,
      operatorIdType: undefined,
      createTime: undefined,
    });
  });

  it("createPinFeishu propagates non-zero API code as error", async () => {
    sdkMock.im.pin.create.mockResolvedValue({ code: 99993, msg: "permission denied" });
    await expect(pinsModule.createPinFeishu({ cfg: {}, messageId: "om_1" })).rejects.toThrow(/99993/);
  });

  it("removePinFeishu calls im.pin.delete with message_id path", async () => {
    sdkMock.im.pin.delete.mockResolvedValue({ code: 0 });
    await pinsModule.removePinFeishu({ cfg: {}, messageId: "om_2" });
    expect(sdkMock.im.pin.delete).toHaveBeenCalledWith({ path: { message_id: "om_2" } });
  });

  it("listPinsFeishu passes chat_id and pagination params", async () => {
    sdkMock.im.pin.list.mockResolvedValue({
      code: 0,
      data: { items: [], has_more: false },
    });
    const result = await pinsModule.listPinsFeishu({
      cfg: {},
      chatId: "oc_9",
      pageSize: 50,
    });
    expect(sdkMock.im.pin.list).toHaveBeenCalledWith({
      params: expect.objectContaining({
        chat_id: "oc_9",
        page_size: 50,
      }),
    });
    expect(result).toMatchObject({ chatId: "oc_9", pins: [], hasMore: false });
  });

  it("listPinsFeishu clamps page_size to 1..100", async () => {
    sdkMock.im.pin.list.mockResolvedValue({ code: 0, data: { items: [], has_more: false } });
    await pinsModule.listPinsFeishu({ cfg: {}, chatId: "oc_9", pageSize: 500 });
    expect(sdkMock.im.pin.list).toHaveBeenCalledWith({
      params: expect.objectContaining({ page_size: 100 }),
    });
    await pinsModule.listPinsFeishu({ cfg: {}, chatId: "oc_9", pageSize: 0 });
    expect(sdkMock.im.pin.list).toHaveBeenCalledWith({
      params: expect.objectContaining({ page_size: 1 }),
    });
  });

  it("listPinsFeishu normalizes snake_case items to camelCase", async () => {
    sdkMock.im.pin.list.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { message_id: "om_a", chat_id: "oc_a", operator_id: "ou_x", create_time: "2026-09-01T00:00:00Z" },
        ],
        has_more: true,
        page_token: "next",
      },
    });
    const result = await pinsModule.listPinsFeishu({ cfg: {}, chatId: "oc_a" });
    expect(result.pins[0]).toEqual({
      messageId: "om_a",
      chatId: "oc_a",
      operatorId: "ou_x",
      operatorIdType: undefined,
      createTime: "2026-09-01T00:00:00Z",
    });
    expect(result.hasMore).toBe(true);
    expect(result.pageToken).toBe("next");
  });
});

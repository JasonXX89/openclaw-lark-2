import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock the synthetic-message pipeline so the test observes the dispatch call
// without actually re-entering the inbound agent pipeline.
vi.mock('../src/messaging/inbound/synthetic-message', () => ({
  dispatchSyntheticTextMessage: vi.fn().mockResolvedValue('queued'),
}));

// Mock the other card handlers so the "falls through" case is observable and
// has no side effects.
vi.mock('../src/tools/ask-user-question', () => ({
  handleAskUserAction: vi.fn().mockReturnValue(undefined),
}));
vi.mock('../src/tools/auto-auth', () => ({
  handleCardAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/channel/interactive-dispatch', () => ({
  dispatchFeishuPluginInteractiveHandler: vi.fn().mockResolvedValue(undefined),
}));

import { handleCardActionEvent } from '../src/channel/event-handlers';
import { dispatchSyntheticTextMessage } from '../src/messaging/inbound/synthetic-message';
import { dispatchFeishuPluginInteractiveHandler } from '../src/channel/interactive-dispatch';

// Minimal MonitorContext stub — only the fields the inject_prompt path reads.
function makeCtx() {
  return {
    cfg: {} as any,
    accountId: 'account-a',
    runtime: { log: vi.fn(), error: vi.fn() },
  } as any;
}

// Flush the setImmediate the handler uses to dispatch asynchronously.
const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleCardActionEvent — inject_prompt', () => {
  it('returns a toast receipt and dispatches the prompt as a synthetic message', async () => {
    const response = await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_chat',
      open_message_id: 'om_card',
      action: {
        value: { action: 'inject_prompt', prompt: '帮我总结群' },
      },
    });

    expect(response).toEqual({ toast: { type: 'info', content: '收到，正在为你处理…' } });

    await flush();

    expect(dispatchSyntheticTextMessage).toHaveBeenCalledTimes(1);
    expect(dispatchSyntheticTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-a',
        chatId: 'oc_chat',
        senderOpenId: 'ou_sender',
        text: '帮我总结群',
        replyToMessageId: 'om_card',
        syntheticMessageId: 'om_card:inject',
      }),
    );
    // inject_prompt is handled before the plugin dispatch pipeline.
    expect(dispatchFeishuPluginInteractiveHandler).not.toHaveBeenCalled();
  });

  it('reads chat/message ids from the context envelope when not at top level', async () => {
    await handleCardActionEvent(makeCtx(), {
      operator: { user_id: 'on_sender' }, // Schema 2: only user_id
      context: { open_chat_id: 'oc_ctx', open_message_id: 'om_ctx' },
      action: { value: { action: 'inject_prompt', prompt: 'hi' } },
    });

    await flush();

    expect(dispatchSyntheticTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'oc_ctx',
        senderOpenId: 'on_sender',
        replyToMessageId: 'om_ctx',
      }),
    );
  });

  it('does not intercept non-inject_prompt card actions (falls through)', async () => {
    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_chat',
      open_message_id: 'om_card',
      action: { value: { action: 'example_action.submit' } },
    });

    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    // Falls through to the standard plugin interactive dispatch pipeline.
    expect(dispatchFeishuPluginInteractiveHandler).toHaveBeenCalledTimes(1);
  });

  it('ignores inject_prompt with a blank prompt (falls through)', async () => {
    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_chat',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: '   ' } },
    });

    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    expect(dispatchFeishuPluginInteractiveHandler).toHaveBeenCalledTimes(1);
  });

  it('ignores inject_prompt with a non-string prompt (falls through)', async () => {
    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_chat',
      open_message_id: 'om_card',
      // A malformed card where prompt is not a string must not dispatch.
      action: { value: { action: 'inject_prompt', prompt: 123 } },
    });

    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    expect(dispatchFeishuPluginInteractiveHandler).toHaveBeenCalledTimes(1);
  });

  it('returns an error toast and does not dispatch when the operator id is missing', async () => {
    const response = await handleCardActionEvent(makeCtx(), {
      operator: {}, // neither open_id nor user_id
      open_chat_id: 'oc_chat',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: '帮我总结群' } },
    });

    expect(response).toEqual({ toast: { type: 'error', content: '无法处理该操作' } });
    await flush();
    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    // It intercepts (returns the error toast) rather than falling through.
    expect(dispatchFeishuPluginInteractiveHandler).not.toHaveBeenCalled();
  });

  it('returns an error toast and does not dispatch when the chat id is missing', async () => {
    const response = await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      // no open_chat_id and no context.open_chat_id
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: '帮我总结群' } },
    });

    expect(response).toEqual({ toast: { type: 'error', content: '无法处理该操作' } });
    await flush();
    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    expect(dispatchFeishuPluginInteractiveHandler).not.toHaveBeenCalled();
  });

  it('falls back to a synthetic id and empty replyTo when the card message id is missing', async () => {
    const response = await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_chat',
      // no open_message_id and no context.open_message_id
      action: { value: { action: 'inject_prompt', prompt: 'hi' } },
    });

    expect(response).toEqual({ toast: { type: 'info', content: '收到，正在为你处理…' } });
    await flush();
    // syntheticMessageId falls back to `card:inject:${senderOpenId}:${chatId}`,
    // and replyToMessageId is '' so the downstream sends a normal message
    // instead of a threaded reply.
    expect(dispatchSyntheticTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'oc_chat',
        senderOpenId: 'ou_sender',
        text: 'hi',
        syntheticMessageId: 'card:inject:ou_sender:oc_chat',
        replyToMessageId: '',
      }),
    );
  });

  it('swallows a synthetic-dispatch rejection and still returns the toast', async () => {
    vi.mocked(dispatchSyntheticTextMessage).mockRejectedValueOnce(new Error('boom'));

    const response = await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_chat',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: '帮我总结群' } },
    });

    // The toast is returned synchronously regardless of the async dispatch outcome.
    expect(response).toEqual({ toast: { type: 'info', content: '收到，正在为你处理…' } });
    // The rejection is caught (.catch) — awaiting the flush must not throw.
    await expect(flush()).resolves.toBeUndefined();
    expect(dispatchSyntheticTextMessage).toHaveBeenCalledTimes(1);
  });
});

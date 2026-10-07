import { ApiError } from './api-client.js';
import type { ClientErrorCode } from './api-client.js';
import type { MessageResponse, UiMessage } from '../types/messages.js';

/**
 * Sends a message to the background worker and unwraps its response. If the worker was asleep
 * or restarting and nothing answered, the message is sent once more.
 */
export async function sendToBackground<T>(message: UiMessage): Promise<T> {
  let res = await trySend<T>(message);
  if (!res) {
    await new Promise((r) => setTimeout(r, 500));
    res = await trySend<T>(message);
  }
  if (!res)
    throw new ApiError(
      'INTERNAL',
      'The extension background is not responding. Try reopening the popup.',
      0,
      true,
    );
  if (!res.ok) throw new ApiError(res.error.code as ClientErrorCode, res.error.message, 0, false);
  return res.data;
}

async function trySend<T>(message: UiMessage): Promise<MessageResponse<T> | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as MessageResponse<T> | undefined;
  } catch {
    // "Receiving end does not exist": the worker was not ready to listen yet.
    return undefined;
  }
}

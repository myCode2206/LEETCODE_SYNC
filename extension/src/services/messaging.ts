import { ApiError } from './api-client.js';
import type { ClientErrorCode } from './api-client.js';
import type { MessageResponse, UiMessage } from '../types/messages.js';

/** Sends a message to the background worker and unwraps its response. */
export async function sendToBackground<T>(message: UiMessage): Promise<T> {
  const res = (await chrome.runtime.sendMessage(message)) as MessageResponse<T> | undefined;
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

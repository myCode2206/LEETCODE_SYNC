import { ApiError } from '../services/api-client.js';

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

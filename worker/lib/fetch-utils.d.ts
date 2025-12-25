// Type declarations for fetch-utils.js

export interface FetchWithRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryableStatuses?: number[];
}

export interface FetchWithRetryResult {
  response: Response;
  retries: number;
  duration: number;
}

export class FetchError extends Error {
  readonly url: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly retries: number;
  readonly duration: number;
}

export class TimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
}

export function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: FetchWithRetryOptions
): Promise<Response>;

export function delay(ms: number): Promise<void>;

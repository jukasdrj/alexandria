// =================================================================================
// Fetch Utilities - Timeout, Retry, and Error Handling for External API Calls
// =================================================================================

/**
 * Default timeout for external API calls (10 seconds)
 */
export const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay for backoff in ms (default: 100) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 5000) */
  maxDelayMs?: number;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** HTTP status codes that should be retried */
  retryableStatuses?: number[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retryableStatuses: [408, 429, 500, 502, 503, 504]
};

/**
 * Custom timeout error
 */
export class TimeoutError extends Error {
  name = 'TimeoutError';
  url: string;
  timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms: ${url}`);
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Custom HTTP error
 */
export class HTTPError extends Error {
  name = 'HTTPError';
  status: number;
  statusText: string;
  url: string;

  constructor(url: string, status: number, statusText: string) {
    super(`HTTP ${status}: ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

/**
 * Custom JSON parse error
 */
export class JSONParseError extends Error {
  name = 'JSONParseError';
  url: string;

  constructor(url: string, originalError: Error) {
    super(`JSON parse error: ${originalError.message}`);
    this.url = url;
  }
}

/**
 * Fetch with timeout - wraps native fetch with AbortController timeout
 *
 * Supports external AbortSignal for request cancellation (e.g., orchestrator timeouts).
 * If external signal is provided, abort triggers when EITHER timeout OR external signal fires.
 *
 * @param url - URL to fetch
 * @param options - Fetch options (may include signal)
 * @param timeoutMs - Timeout in milliseconds (default 10s)
 * @returns Promise resolving to Response
 * @throws {TimeoutError} On timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Listen to external signal if provided
  const externalSignal = options.signal;
  if (externalSignal) {
    // If external signal is already aborted, abort immediately
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error('Request aborted by caller');
    }

    // Listen for external abort
    externalSignal.addEventListener('abort', () => {
      controller.abort();
    });
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // Check if external signal caused the abort
      if (externalSignal?.aborted) {
        throw new Error('Request cancelled by caller');
      }
      throw new TimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calculate delay with exponential backoff and jitter
 *
 * @param attempt - Current attempt (0-indexed)
 * @param baseDelayMs - Base delay
 * @param maxDelayMs - Maximum delay cap
 * @returns Delay in milliseconds
 */
function calculateBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Check if an error/response is retryable
 *
 * @param errorOrResponse - Error or Response object
 * @param retryableStatuses - HTTP statuses that should be retried
 * @returns True if retryable
 */
function isRetryable(errorOrResponse: Error | Response, retryableStatuses: number[]): boolean {
  // Network errors are retryable
  if (errorOrResponse instanceof Error) {
    const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'TimeoutError'];
    return retryableErrors.some(e =>
      errorOrResponse.name === e ||
      errorOrResponse.message?.includes(e) ||
      (errorOrResponse as any).code === e
    );
  }

  // Check HTTP status codes
  if (errorOrResponse instanceof Response) {
    return retryableStatuses.includes(errorOrResponse.status);
  }

  return false;
}

/**
 * Fetch with retry - wraps fetch with exponential backoff retry logic
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param config - Retry configuration
 * @returns Promise resolving to Response
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = {}
): Promise<Response> {
  const {
    maxRetries = DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelayMs = DEFAULT_RETRY_CONFIG.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_CONFIG.maxDelayMs,
    timeoutMs = DEFAULT_RETRY_CONFIG.timeoutMs,
    retryableStatuses = DEFAULT_RETRY_CONFIG.retryableStatuses
  } = config;

  let lastError: Error | undefined;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);

      // If response is successful or not retryable, return it
      if (response.ok || !isRetryable(response, retryableStatuses)) {
        return response;
      }

      // Response is retryable - save it and continue
      lastResponse = response;

    } catch (error) {
      if (error instanceof Error) {
        lastError = error;

        // If error is not retryable, throw immediately
        if (!isRetryable(error, retryableStatuses)) {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Don't delay after the last attempt
    if (attempt < maxRetries) {
      const delay = calculateBackoff(attempt, baseDelayMs, maxDelayMs);
      console.log(`Retry ${attempt + 1}/${maxRetries} for ${url} after ${Math.round(delay)}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  if (lastError) {
    lastError.message = `Failed after ${maxRetries + 1} attempts: ${lastError.message}`;
    throw lastError;
  }

  // Return the last response (will be a retryable status code)
  if (!lastResponse) {
    throw new Error('Unexpected state: no response or error after retries');
  }

  return lastResponse;
}

/**
 * Result of JSON fetch operation
 */
export interface JSONFetchResult<T = any> {
  /** Parsed JSON data */
  data: T;
  /** HTTP Response object */
  response: Response;
}

/**
 * Resilient JSON fetch - fetch with timeout, retry, and JSON parsing
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param config - Retry configuration
 * @returns Promise resolving to parsed JSON data and response
 * @throws {HTTPError} On HTTP error status
 * @throws {JSONParseError} On JSON parse error
 * @throws {TimeoutError} On timeout
 */
export async function fetchJSON<T = any>(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = {}
): Promise<JSONFetchResult<T>> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...options.headers
    }
  }, config);

  if (!response.ok) {
    throw new HTTPError(url, response.status, response.statusText);
  }

  try {
    const data = await response.json() as T;
    return { data, response };
  } catch (parseError) {
    throw new JSONParseError(url, parseError as Error);
  }
}

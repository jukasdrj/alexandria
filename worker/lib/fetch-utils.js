// =================================================================================
// Fetch Utilities - Timeout, Retry, and Error Handling for External API Calls
// =================================================================================

/**
 * Default timeout for external API calls (10 seconds)
 */
export const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  retryableStatuses: [408, 429, 500, 502, 503, 504]
};

/**
 * Fetch with timeout - wraps native fetch with AbortController timeout
 *
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds (default 10s)
 * @returns {Promise<Response>}
 * @throws {Error} With name 'TimeoutError' on timeout
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      timeoutError.name = 'TimeoutError';
      timeoutError.url = url;
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calculate delay with exponential backoff and jitter
 *
 * @param {number} attempt - Current attempt (0-indexed)
 * @param {number} baseDelayMs - Base delay
 * @param {number} maxDelayMs - Maximum delay cap
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt, baseDelayMs, maxDelayMs) {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Check if an error/response is retryable
 *
 * @param {Error|Response} errorOrResponse - Error or Response object
 * @param {number[]} retryableStatuses - HTTP statuses that should be retried
 * @returns {boolean}
 */
function isRetryable(errorOrResponse, retryableStatuses) {
  // Network errors are retryable
  if (errorOrResponse instanceof Error) {
    const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'TimeoutError'];
    return retryableErrors.some(e =>
      errorOrResponse.name === e ||
      errorOrResponse.message?.includes(e) ||
      errorOrResponse.code === e
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
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {Object} config - Retry configuration
 * @param {number} config.maxRetries - Maximum retry attempts (default 3)
 * @param {number} config.baseDelayMs - Base delay for backoff (default 100ms)
 * @param {number} config.maxDelayMs - Max delay cap (default 5000ms)
 * @param {number} config.timeoutMs - Request timeout (default 10000ms)
 * @param {number[]} config.retryableStatuses - HTTP statuses to retry
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, config = {}) {
  const {
    maxRetries = DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelayMs = DEFAULT_RETRY_CONFIG.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_CONFIG.maxDelayMs,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryableStatuses = DEFAULT_RETRY_CONFIG.retryableStatuses
  } = config;

  let lastError;
  let lastResponse;

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
      lastError = error;

      // If error is not retryable, throw immediately
      if (!isRetryable(error, retryableStatuses)) {
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
  return lastResponse;
}

/**
 * Resilient JSON fetch - fetch with timeout, retry, and JSON parsing
 *
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {Object} config - Retry configuration (see fetchWithRetry)
 * @returns {Promise<{data: any, response: Response}>}
 * @throws {Error} On network error, timeout, or JSON parse error
 */
export async function fetchJSON(url, options = {}, config = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...options.headers
    }
  }, config);

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    error.name = 'HTTPError';
    error.status = response.status;
    error.statusText = response.statusText;
    error.url = url;
    throw error;
  }

  try {
    const data = await response.json();
    return { data, response };
  } catch (parseError) {
    const error = new Error(`JSON parse error: ${parseError.message}`);
    error.name = 'JSONParseError';
    error.url = url;
    throw error;
  }
}

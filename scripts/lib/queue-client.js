/**
 * Queue Client for Alexandria HTTP API
 * Handles POST requests to queue endpoints
 */

/**
 * HTTP client for queueing enrichment and cover processing jobs
 */
export class QueueClient {
  /**
   * @param {string} baseURL - Base URL for Alexandria API (e.g., https://alexandria.ooheynerds.com)
   */
  constructor(baseURL) {
    this.baseURL = baseURL;
  }

  /**
   * POST data to an endpoint
   * @param {string} endpoint - API endpoint path (e.g., /api/enrich/queue)
   * @param {object} payload - JSON payload to send
   * @returns {Promise<object>} - Response JSON
   */
  async post(endpoint, payload) {
    const url = `${this.baseURL}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    return response.json();
  }
}

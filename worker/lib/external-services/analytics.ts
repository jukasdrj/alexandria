/**
 * Analytics tracking utilities for External Service Provider Framework
 *
 * Provides non-blocking analytics instrumentation for:
 * - Individual provider HTTP requests (latency, success rate, cache hits)
 * - Orchestrator fallback chains (provider priority, attempts)
 * - Provider cost tracking (API calls, estimated costs)
 *
 * All analytics use ctx.waitUntil() pattern for zero user-facing latency impact.
 *
 * @module external-services/analytics
 */

/**
 * Individual provider request event
 * Tracks single HTTP request to external provider
 */
export interface ProviderRequestEvent {
	/** Provider name (isbndb, google-books, open-library, etc.) */
	provider: string;
	/** Capability being invoked (ISBN_RESOLUTION, METADATA_ENRICHMENT, etc.) */
	capability?: string;
	/** Specific operation (resolveISBN, fetchMetadata, fetchCover) */
	operation: string;
	/** Request outcome (success, error, timeout, cache_hit) */
	status: 'success' | 'error' | 'timeout' | 'cache_hit';
	/** Error type if status is error (HTTP status code or error class) */
	errorType?: string;
	/** Request latency in milliseconds */
	latencyMs: number;
	/** Whether response came from cache (1=cached, 0=fresh) */
	cacheHit: 0 | 1;
	/** Quota consumed (1 for paid providers, 0 for free) */
	quotaConsumed?: number;
}

/**
 * Orchestrator fallback chain event
 * Tracks multi-provider orchestration with fallback logic
 */
export interface OrchestratorFallbackEvent {
	/** Orchestrator name (isbn_resolution, cover_fetch, metadata_enrichment, book_generation) */
	orchestrator: string;
	/** Fallback chain attempted (e.g., 'isbndb→google-books→open-library') */
	providerChain: string;
	/** Provider that successfully returned data */
	successfulProvider: string | null;
	/** Operation description (e.g., 'resolveISBN("The Hobbit", "Tolkien")') */
	operation: string;
	/** Number of providers attempted before success/failure */
	attemptsCount: number;
	/** Total latency including all fallback attempts */
	totalLatencyMs: number;
	/** Whether orchestrator succeeded (1=success, 0=failure) */
	success: 0 | 1;
}

/**
 * Provider cost tracking event
 * Tracks API usage and estimated costs per provider
 */
export interface ProviderCostEvent {
	/** Provider name */
	provider: string;
	/** Provider tier (free, paid) */
	tier: 'free' | 'paid';
	/** Number of API calls made */
	apiCallsCount: number;
	/** Estimated cost in USD (for paid providers) */
	estimatedCostUsd: number;
}

/**
 * Track individual provider HTTP request
 *
 * Emits non-blocking analytics event for provider request monitoring.
 * Tracks latency, success rate, cache hit rate, and quota consumption.
 *
 * @param event - Provider request event details
 * @param env - Worker environment bindings
 * @param ctx - Execution context for waitUntil
 *
 * @example
 * ```typescript
 * trackProviderRequest({
 *   provider: 'isbndb',
 *   capability: 'ISBN_RESOLUTION',
 *   operation: 'resolveISBN',
 *   status: 'success',
 *   latencyMs: 245,
 *   cacheHit: 0,
 *   quotaConsumed: 1
 * }, env, ctx);
 * ```
 */
export function trackProviderRequest(
	event: ProviderRequestEvent,
	env: { ANALYTICS?: AnalyticsEngineDataset },
	ctx?: ExecutionContext
): void {
	// Gracefully handle missing ANALYTICS binding
	if (!env.ANALYTICS) {
		return;
	}

	// Non-blocking analytics write
	const analyticsPromise = Promise.resolve(
		env.ANALYTICS.writeDataPoint({
			indexes: ['provider_request'],
			blobs: [
				event.provider,
				event.capability || '',
				event.operation,
				event.status,
				event.errorType || '',
			],
			doubles: [
				event.latencyMs,
				event.cacheHit,
				event.quotaConsumed || 0,
			],
		})
	);

	// Use waitUntil if available, otherwise fire-and-forget
	if (ctx) {
		ctx.waitUntil(analyticsPromise);
	}
}

/**
 * Track orchestrator fallback chain execution
 *
 * Emits non-blocking analytics event for multi-provider orchestration.
 * Tracks which providers were attempted, success rate, and total latency.
 *
 * @param event - Orchestrator fallback event details
 * @param env - Worker environment bindings
 * @param ctx - Execution context for waitUntil
 *
 * @example
 * ```typescript
 * trackOrchestratorFallback({
 *   orchestrator: 'isbn_resolution',
 *   providerChain: 'isbndb→google-books→open-library',
 *   successfulProvider: 'open-library',
 *   operation: 'resolveISBN("The Hobbit", "Tolkien")',
 *   attemptsCount: 3,
 *   totalLatencyMs: 1250,
 *   success: 1
 * }, env, ctx);
 * ```
 */
export function trackOrchestratorFallback(
	event: OrchestratorFallbackEvent,
	env: { ANALYTICS?: AnalyticsEngineDataset },
	ctx?: ExecutionContext
): void {
	// Gracefully handle missing ANALYTICS binding
	if (!env.ANALYTICS) {
		return;
	}

	// Non-blocking analytics write
	const analyticsPromise = Promise.resolve(
		env.ANALYTICS.writeDataPoint({
			indexes: ['orchestrator_fallback'],
			blobs: [
				event.orchestrator,
				event.providerChain,
				event.successfulProvider || 'none',
				event.operation,
			],
			doubles: [
				event.attemptsCount,
				event.totalLatencyMs,
				event.success,
			],
		})
	);

	// Use waitUntil if available, otherwise fire-and-forget
	if (ctx) {
		ctx.waitUntil(analyticsPromise);
	}
}

/**
 * Track provider cost and API usage
 *
 * Emits non-blocking analytics event for cost monitoring.
 * Tracks API calls and estimated costs for paid providers.
 *
 * @param event - Provider cost event details
 * @param env - Worker environment bindings
 * @param ctx - Execution context for waitUntil
 *
 * @example
 * ```typescript
 * trackProviderCost({
 *   provider: 'isbndb',
 *   tier: 'paid',
 *   apiCallsCount: 1,
 *   estimatedCostUsd: 0.0023 // $29.95/13000 calls
 * }, env, ctx);
 * ```
 */
export function trackProviderCost(
	event: ProviderCostEvent,
	env: { ANALYTICS?: AnalyticsEngineDataset },
	ctx?: ExecutionContext
): void {
	// Gracefully handle missing ANALYTICS binding
	if (!env.ANALYTICS) {
		return;
	}

	// Non-blocking analytics write
	const analyticsPromise = Promise.resolve(
		env.ANALYTICS.writeDataPoint({
			indexes: ['provider_cost'],
			blobs: [
				event.provider,
				event.tier,
			],
			doubles: [
				event.apiCallsCount,
				event.estimatedCostUsd,
			],
		})
	);

	// Use waitUntil if available, otherwise fire-and-forget
	if (ctx) {
		ctx.waitUntil(analyticsPromise);
	}
}

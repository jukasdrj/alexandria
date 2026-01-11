/**
 * Service Provider Framework - Main Entry Point
 *
 * Export all core components for external service integration.
 */

// Core interfaces and types
export {
  ServiceCapability,
  type IServiceProvider,
  type IISBNResolver,
  type IMetadataProvider,
  type ICoverProvider,
  type IAuthorBiographyProvider,
  type ISubjectProvider,
  type IBookGenerator,
  type ISBNResolutionResult,
  type BookMetadata,
  type CoverResult,
  type AuthorBiography,
  type GeneratedBook,
} from './capabilities.js';

// Service context
export {
  type ServiceContext,
  type CacheStrategy,
  type RateLimitStrategy,
  createServiceContext,
} from './service-context.js';

// Provider registry
export {
  ServiceProviderRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from './provider-registry.js';

// HTTP client
export {
  ServiceHttpClient,
  type HttpClientConfig,
  type RequestMetrics,
} from './http-client.js';

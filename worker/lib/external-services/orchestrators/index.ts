/**
 * Service Orchestrators
 *
 * Export all orchestrators for workflow coordination.
 * Orchestrators use the Service Provider Registry for dynamic provider discovery.
 *
 * @module lib/external-services/orchestrators
 */

// =================================================================================
// Orchestrator Exports
// =================================================================================

export { ISBNResolutionOrchestrator } from './isbn-resolution-orchestrator.js';
export type { ISBNResolutionConfig } from './isbn-resolution-orchestrator.js';

export { CoverFetchOrchestrator } from './cover-fetch-orchestrator.js';
export type { CoverFetchConfig } from './cover-fetch-orchestrator.js';

export { MetadataEnrichmentOrchestrator } from './metadata-enrichment-orchestrator.js';
export type {
  MetadataEnrichmentConfig,
  EnrichmentResult,
} from './metadata-enrichment-orchestrator.js';

export { BookGenerationOrchestrator } from './book-generation-orchestrator.js';
export type { BookGenerationConfig } from './book-generation-orchestrator.js';

export { PublicDomainOrchestrator } from './public-domain-orchestrator.js';
export type { PublicDomainConfig } from './public-domain-orchestrator.js';

export { ExternalIdOrchestrator } from './external-id-orchestrator.js';
export type { ExternalIdOrchestratorConfig } from './external-id-orchestrator.js';

export { RatingsOrchestrator } from './ratings-orchestrator.js';
export type { RatingsOrchestratorConfig } from './ratings-orchestrator.js';

export { EditionVariantOrchestrator } from './edition-variant-orchestrator.js';
export type { EditionVariantOrchestratorConfig } from './edition-variant-orchestrator.js';

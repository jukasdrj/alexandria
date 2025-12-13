// =================================================================================
// Enrichment Route Handlers
// =================================================================================

import type { Context } from 'hono';
import type { AppBindings } from '../env.js';
import {
  enrichEdition,
  enrichWork,
  enrichAuthor,
  queueEnrichment,
  getEnrichmentStatus,
} from './enrichment-service.js';
import { validateEnrichmentRequest, validateISBN } from './utils.js';
import type {
  EnrichEditionRequest,
  EnrichWorkRequest,
  EnrichAuthorRequest,
  QueueEnrichmentRequest,
} from './types.js';

/**
 * POST /api/enrich/edition
 * Store or update edition metadata
 */
export async function handleEnrichEdition(c: Context<AppBindings>): Promise<Response> {
  try {
    const body = (await c.req.json()) as EnrichEditionRequest;

    // Validate request
    const validation = validateEnrichmentRequest(
      body as unknown as Record<string, unknown>,
      'edition'
    );
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.errors,
        },
        400
      );
    }

    // Normalize ISBN
    const isbnValidation = validateISBN(body.isbn);
    if (!isbnValidation.valid) {
      return c.json(
        {
          success: false,
          error: isbnValidation.error,
        },
        400
      );
    }

    // Update body with normalized ISBN
    body.isbn = isbnValidation.normalized;

    // Get SQL connection from context
    const sql = c.get('sql');

    // Enrich edition
    const result = await enrichEdition(sql, body, c.env);

    // Log successful enrichment
    console.log(
      `Enriched edition ${result.isbn} (${result.action}, quality +${result.quality_improvement})`
    );

    return c.json(
      {
        success: true,
        data: result,
      },
      result.action === 'created' ? 201 : 200
    );
  } catch (error) {
    console.error('handleEnrichEdition error:', error);
    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * POST /api/enrich/work
 * Store or update work metadata
 */
export async function handleEnrichWork(c: Context<AppBindings>): Promise<Response> {
  try {
    const body = (await c.req.json()) as EnrichWorkRequest;

    // Validate request
    const validation = validateEnrichmentRequest(
      body as unknown as Record<string, unknown>,
      'work'
    );
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.errors,
        },
        400
      );
    }

    // Get SQL connection from context
    const sql = c.get('sql');

    // Enrich work
    const result = await enrichWork(sql, body);

    return c.json(
      {
        success: true,
        data: result,
      },
      result.action === 'created' ? 201 : 200
    );
  } catch (error) {
    console.error('handleEnrichWork error:', error);
    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * POST /api/enrich/author
 * Store or update author biographical data
 */
export async function handleEnrichAuthor(c: Context<AppBindings>): Promise<Response> {
  try {
    const body = (await c.req.json()) as EnrichAuthorRequest;

    // Validate request
    const validation = validateEnrichmentRequest(
      body as unknown as Record<string, unknown>,
      'author'
    );
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.errors,
        },
        400
      );
    }

    // Get SQL connection from context
    const sql = c.get('sql');

    // Enrich author
    const result = await enrichAuthor(sql, body);

    return c.json(
      {
        success: true,
        data: result,
      },
      result.action === 'created' ? 201 : 200
    );
  } catch (error) {
    console.error('handleEnrichAuthor error:', error);
    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * POST /api/enrich/queue
 * Queue background enrichment job
 */
export async function handleQueueEnrichment(c: Context<AppBindings>): Promise<Response> {
  try {
    const body = (await c.req.json()) as QueueEnrichmentRequest;

    // Validate request
    if (!body.entity_type || !body.entity_key || !body.providers_to_try) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          details: ['entity_type, entity_key, and providers_to_try are required'],
        },
        400
      );
    }

    if (!['work', 'edition', 'author'].includes(body.entity_type)) {
      return c.json(
        {
          success: false,
          error: 'Invalid entity_type',
          details: ['entity_type must be one of: work, edition, author'],
        },
        400
      );
    }

    if (!Array.isArray(body.providers_to_try) || body.providers_to_try.length === 0) {
      return c.json(
        {
          success: false,
          error: 'Invalid providers_to_try',
          details: ['providers_to_try must be a non-empty array'],
        },
        400
      );
    }

    // Validate priority if provided
    if (body.priority !== undefined) {
      const validStrings = ['urgent', 'high', 'medium', 'normal', 'low', 'background'];
      const isValidString =
        typeof body.priority === 'string' &&
        validStrings.includes(body.priority.toLowerCase());
      const isValidNumber =
        typeof body.priority === 'number' && body.priority >= 1 && body.priority <= 10;

      if (!isValidString && !isValidNumber) {
        return c.json(
          {
            success: false,
            error: 'Invalid priority',
            details: [
              'priority must be a number (1-10) or string (urgent, high, medium, normal, low, background)',
            ],
          },
          400
        );
      }
    }

    // Get SQL connection from context
    const sql = c.get('sql');

    // Queue enrichment
    const result = await queueEnrichment(sql, body);

    console.log(
      `Queued ${body.entity_type} enrichment for ${body.entity_key} (queue_id: ${result.queue_id})`
    );

    return c.json(
      {
        success: true,
        data: result,
      },
      201
    );
  } catch (error) {
    console.error('handleQueueEnrichment error:', error);
    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * GET /api/enrich/status/:id
 * Check enrichment job status
 */
export async function handleGetEnrichmentStatus(c: Context<AppBindings>): Promise<Response> {
  try {
    const jobId = c.req.param('id');

    if (!jobId) {
      return c.json(
        {
          success: false,
          error: 'Job ID is required',
        },
        400
      );
    }

    // Get SQL connection from context
    const sql = c.get('sql');

    // Get job status
    const status = await getEnrichmentStatus(sql, jobId);

    return c.json(
      {
        success: true,
        data: status,
      },
      200
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Job not found') {
      return c.json(
        {
          success: false,
          error: 'Job not found',
        },
        404
      );
    }

    console.error('handleGetEnrichmentStatus error:', error);
    return c.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

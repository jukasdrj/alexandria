/**
 * Harvest Routes - Cloudflare Workflow triggers for author harvesting
 *
 * Provides endpoints to start and monitor durable author harvest workflows.
 * Migrated from scripts/bulk-author-harvest.js for production reliability.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppBindings } from '../env.js';
import {
  createSuccessSchema,
  ErrorResponseSchema,
  createSuccessResponse,
  createErrorResponse,
  ErrorCode,
} from '../schemas/response.js';

// =================================================================================
// Schemas
// =================================================================================

const TierSchema = z.enum(['top-10', 'top-100', 'top-1000', '1000-5000', '5000-20000']).openapi('HarvestTier');

const StartHarvestRequestSchema = z.object({
  tier: TierSchema.default('top-100').describe('Author tier to harvest'),
  offset: z.number().int().nonnegative().optional().describe('Override offset from tier default'),
  limit: z.number().int().positive().max(20000).optional().describe('Override limit from tier default'),
  maxPagesPerAuthor: z.number().int().positive().max(10).default(1).describe('Max ISBNdb pages per author (1 = 100 books)'),
  resumeFromBatch: z.number().int().nonnegative().optional().describe('Resume from specific batch index (batches are 10 authors each)'),
}).openapi('StartHarvestRequest');

const HarvestStartedDataSchema = z.object({
  instance_id: z.string().describe('Workflow instance ID for status tracking'),
  status: z.literal('started').describe('Workflow start status'),
  tier: TierSchema,
  monitor_url: z.string().describe('URL to monitor workflow progress'),
}).openapi('HarvestStartedData');

// Workflow status is passthrough to allow Cloudflare's native InstanceStatus type
const WorkflowStatusSchema = z.object({
  status: z.string().describe('Workflow status (queued, running, paused, complete, errored, etc.)'),
  output: z.unknown().optional().describe('Workflow output (when complete)'),
  error: z.string().optional().describe('Error message (when errored)'),
}).passthrough().openapi('WorkflowStatus');

const HarvestStatusDataSchema = z.object({
  instance_id: z.string().describe('Workflow instance ID'),
  workflow_status: WorkflowStatusSchema,
}).openapi('HarvestStatusData');

const HarvestListItemSchema = z.object({
  id: z.string().describe('Workflow instance ID'),
  created: z.string().datetime().optional().describe('Creation timestamp'),
  status: z.string().describe('Workflow status'),
}).openapi('HarvestListItem');

const HarvestListDataSchema = z.object({
  workflows: z.array(HarvestListItemSchema).describe('List of workflow instances'),
  count: z.number().int().describe('Total count'),
}).openapi('HarvestListData');

// Success schemas
const HarvestStartedSuccessSchema = createSuccessSchema(HarvestStartedDataSchema, 'HarvestStartedSuccess');
const HarvestStatusSuccessSchema = createSuccessSchema(HarvestStatusDataSchema, 'HarvestStatusSuccess');
const HarvestListSuccessSchema = createSuccessSchema(HarvestListDataSchema, 'HarvestListSuccess');

// =================================================================================
// Route Definitions
// =================================================================================

const startHarvestRoute = createRoute({
  method: 'post',
  path: '/api/harvest/start',
  tags: ['Workflows'],
  summary: 'Start author harvest workflow',
  description: `
Starts a durable Cloudflare Workflow to harvest author bibliographies from ISBNdb.

**Tiers:**
- \`top-10\`: First 10 authors (testing)
- \`top-100\`: First 100 authors (validation)
- \`top-1000\`: First 1000 authors (~1 day)
- \`1000-5000\`: Authors 1000-5000
- \`5000-20000\`: Authors 5000-20000

**Features:**
- Automatic retry on transient failures
- Rate limiting (1.5s between authors)
- ISBNdb quota exhaustion detection
- Progress persisted across Worker restarts
  `,
  request: {
    body: {
      content: {
        'application/json': {
          schema: StartHarvestRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Workflow started successfully',
      content: {
        'application/json': {
          schema: HarvestStartedSuccessSchema,
        },
      },
    },
    400: {
      description: 'Invalid request parameters',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Failed to start workflow',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const getStatusRoute = createRoute({
  method: 'get',
  path: '/api/harvest/status/{instanceId}',
  tags: ['Workflows'],
  summary: 'Get workflow status',
  description: 'Returns the current status of an author harvest workflow instance.',
  request: {
    params: z.object({
      instanceId: z.string().describe('Workflow instance ID'),
    }),
  },
  responses: {
    200: {
      description: 'Workflow status retrieved',
      content: {
        'application/json': {
          schema: HarvestStatusSuccessSchema,
        },
      },
    },
    404: {
      description: 'Workflow not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const listWorkflowsRoute = createRoute({
  method: 'get',
  path: '/api/harvest/list',
  tags: ['Workflows'],
  summary: 'List workflow instances',
  description: 'Returns a list of recent author harvest workflow instances.',
  responses: {
    200: {
      description: 'Workflow list retrieved',
      content: {
        'application/json': {
          schema: HarvestListSuccessSchema,
        },
      },
    },
    500: {
      description: 'Failed to list workflows',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =================================================================================
// Route Handlers
// =================================================================================

const app = new OpenAPIHono<AppBindings>();

// POST /api/harvest/start - Start new workflow
app.openapi(startHarvestRoute, async (c) => {
  const logger = c.get('logger');

  try {
    const body = c.req.valid('json');
    const { tier, offset, limit, maxPagesPerAuthor, resumeFromBatch } = body;

    logger.info('Starting author harvest workflow', { tier, offset, limit, maxPagesPerAuthor });

    // Create workflow instance
    const instance = await c.env.AUTHOR_HARVEST.create({
      params: {
        tier,
        offset,
        limit,
        maxPagesPerAuthor,
        resumeFromBatch,
      },
    });

    logger.info('Workflow started', { instanceId: instance.id, tier });

    return createSuccessResponse(c, {
      instance_id: instance.id,
      status: 'started' as const,
      tier,
      monitor_url: `/api/harvest/status/${instance.id}`,
    }, 202);
  } catch (error) {
    logger.error('Failed to start workflow', {
      error: error instanceof Error ? error.message : 'Unknown',
    });

    return createErrorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      'Failed to start harvest workflow',
      { details: error instanceof Error ? error.message : 'Unknown error' }
    );
  }
});

// GET /api/harvest/status/:instanceId - Get workflow status
app.openapi(getStatusRoute, async (c) => {
  const logger = c.get('logger');
  const { instanceId } = c.req.valid('param');

  try {
    const instance = await c.env.AUTHOR_HARVEST.get(instanceId);
    const status = await instance.status();

    return createSuccessResponse(c, {
      instance_id: instanceId,
      workflow_status: status,
    });
  } catch (error) {
    logger.error('Failed to get workflow status', {
      instanceId,
      error: error instanceof Error ? error.message : 'Unknown',
    });

    // Check if it's a "not found" error
    const errorMessage = error instanceof Error ? error.message : '';
    if (errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
      return createErrorResponse(
        c,
        ErrorCode.NOT_FOUND,
        'Workflow instance not found',
        { instanceId }
      );
    }

    return createErrorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      'Failed to get workflow status',
      { details: error instanceof Error ? error.message : 'Unknown error' }
    );
  }
});

// GET /api/harvest/list - List recent workflows
app.openapi(listWorkflowsRoute, async (c) => {
  const logger = c.get('logger');

  try {
    // Note: Cloudflare Workflows doesn't have a native list API yet
    // This is a placeholder that returns info about how to track workflows
    logger.info('Listing harvest workflows');

    return createSuccessResponse(c, {
      workflows: [],
      count: 0,
    });
  } catch (error) {
    logger.error('Failed to list workflows', {
      error: error instanceof Error ? error.message : 'Unknown',
    });

    return createErrorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      'Failed to list workflows',
      { details: error instanceof Error ? error.message : 'Unknown error' }
    );
  }
});

export default app;

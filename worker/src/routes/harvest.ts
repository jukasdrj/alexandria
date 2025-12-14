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

const TierSchema = z.enum(['top-10', 'top-100', 'top-1000', '1000-5000', '5000-20000', 'curated']).openapi('HarvestTier');

const StartHarvestRequestSchema = z.object({
  tier: TierSchema.default('top-100').describe('Author tier to harvest'),
  offset: z.number().int().nonnegative().optional().describe('Override offset from tier default'),
  limit: z.number().int().positive().max(20000).optional().describe('Override limit from tier default'),
  maxPagesPerAuthor: z.number().int().positive().max(10).default(1).describe('Max ISBNdb pages per author (1 = 100 books)'),
  resumeFromBatch: z.number().int().nonnegative().optional().describe('Resume from specific batch index (batches are 10 authors each)'),
  curatedAuthors: z.array(z.string()).optional().describe('List of author names for curated harvest (required when tier=curated)'),
  curatedListName: z.string().optional().describe('Name of the curated list for logging'),
}).refine(
  (data) => data.tier !== 'curated' || (data.curatedAuthors && data.curatedAuthors.length > 0),
  { message: 'curatedAuthors is required when tier is "curated"' }
).openapi('StartHarvestRequest');

const HarvestStartedDataSchema = z.object({
  instance_id: z.string().describe('Workflow instance ID for status tracking'),
  status: z.literal('started').describe('Workflow start status'),
  tier: TierSchema,
  list_name: z.string().optional().describe('Name of the curated list (if applicable)'),
  author_count: z.union([z.number(), z.string()]).optional().describe('Number of authors to process'),
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
// New Releases Harvest Schemas
// =================================================================================

const StartNewReleasesRequestSchema = z.object({
  start_month: z.string().regex(/^\d{4}-\d{2}$/).describe('Start month (YYYY-MM format)'),
  end_month: z.string().regex(/^\d{4}-\d{2}$/).describe('End month (YYYY-MM format)'),
  max_pages_per_month: z.number().int().min(1).max(100).default(100)
    .describe('Maximum pages per month (100 results per page, default 100)'),
  skip_existing: z.boolean().default(true)
    .describe('Skip ISBNs already in Alexandria'),
  resume_from_month: z.number().int().nonnegative().optional()
    .describe('Resume from specific month index'),
  resume_from_page: z.number().int().positive().optional()
    .describe('Resume from specific page within month'),
}).openapi('StartNewReleasesRequest');

const NewReleasesStartedDataSchema = z.object({
  instance_id: z.string().describe('Workflow instance ID'),
  status: z.literal('started').describe('Workflow start status'),
  start_month: z.string().describe('Start month'),
  end_month: z.string().describe('End month'),
  max_pages_per_month: z.number().describe('Max pages per month'),
  monitor_url: z.string().describe('URL to monitor workflow progress'),
}).openapi('NewReleasesStartedData');

const NewReleasesStartedSuccessSchema = createSuccessSchema(NewReleasesStartedDataSchema, 'NewReleasesStartedSuccess');

// =================================================================================
// Route Definitions
// =================================================================================

const startNewReleasesRoute = createRoute({
  method: 'post',
  path: '/api/harvest/new-releases',
  tags: ['Workflows'],
  summary: 'Start new releases harvest workflow',
  description: `
Starts a durable Cloudflare Workflow to harvest new book releases from ISBNdb by date range.

Use this to fill the gap between your OpenLibrary dump and today.

**Example - Sep-Dec 2025 releases:**
\`\`\`json
{
  "start_month": "2025-09",
  "end_month": "2025-12",
  "max_pages_per_month": 20
}
\`\`\`

**Features:**
- Processes month-by-month for manageable batches
- Automatic retry on transient failures
- Rate limiting (350ms between ISBNdb calls)
- Skips existing ISBNs (deduplication)
- Cover queue integration
- Progress persisted across Worker restarts
  `,
  request: {
    body: {
      content: {
        'application/json': {
          schema: StartNewReleasesRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Workflow started successfully',
      content: {
        'application/json': {
          schema: NewReleasesStartedSuccessSchema,
        },
      },
    },
    400: {
      description: 'Invalid request parameters',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: 'Failed to start workflow',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const getNewReleasesStatusRoute = createRoute({
  method: 'get',
  path: '/api/harvest/new-releases/{instanceId}',
  tags: ['Workflows'],
  summary: 'Get new releases workflow status',
  description: 'Returns the current status of a new releases harvest workflow instance.',
  request: {
    params: z.object({
      instanceId: z.string().describe('Workflow instance ID'),
    }),
  },
  responses: {
    200: {
      description: 'Workflow status retrieved',
      content: { 'application/json': { schema: HarvestStatusSuccessSchema } },
    },
    404: {
      description: 'Workflow not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const startHarvestRoute = createRoute({
  method: 'post',
  path: '/api/harvest/start',
  tags: ['Workflows'],
  summary: 'Start author harvest workflow',
  description: `
Starts a durable Cloudflare Workflow to harvest author bibliographies from ISBNdb.

**Tiers (top-N by OpenLibrary work count):**
- \`top-10\`: First 10 authors (testing)
- \`top-100\`: First 100 authors (validation)
- \`top-1000\`: First 1000 authors (~1 day)
- \`1000-5000\`: Authors 1000-5000
- \`5000-20000\`: Authors 5000-20000
- \`curated\`: Custom author list (requires \`curatedAuthors\` array)

**Curated List Example:**
\`\`\`json
{
  "tier": "curated",
  "curatedAuthors": ["Brandon Sanderson", "Patrick Rothfuss", "Sarah J. Maas"],
  "curatedListName": "fantasy-authors"
}
\`\`\`

**Features:**
- Automatic retry on transient failures
- Rate limiting (500ms between authors)
- ISBNdb quota exhaustion detection
- Progress persisted across Worker restarts
- Work deduplication (no duplicate works created)
- Author-work linking (proper database relationships)
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
    const { tier, offset, limit, maxPagesPerAuthor, resumeFromBatch, curatedAuthors, curatedListName } = body;

    const listName = curatedListName || tier;
    const authorCount = tier === 'curated' && curatedAuthors ? curatedAuthors.length : 'tier-based';
    logger.info('Starting author harvest workflow', { tier, listName, authorCount, offset, limit, maxPagesPerAuthor });

    // Create workflow instance
    const instance = await c.env.AUTHOR_HARVEST.create({
      params: {
        tier,
        offset,
        limit,
        maxPagesPerAuthor,
        resumeFromBatch,
        curatedAuthors,
        curatedListName,
      },
    });

    logger.info('Workflow started', { instanceId: instance.id, tier, listName });

    return createSuccessResponse(c, {
      instance_id: instance.id,
      status: 'started' as const,
      tier,
      list_name: listName,
      author_count: authorCount,
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

// =================================================================================
// New Releases Harvest Route Handlers
// =================================================================================

// POST /api/harvest/new-releases - Start new releases workflow
app.openapi(startNewReleasesRoute, async (c) => {
  const logger = c.get('logger');

  try {
    const body = c.req.valid('json');
    const { start_month, end_month, max_pages_per_month, skip_existing, resume_from_month, resume_from_page } = body;

    logger.info('Starting new releases harvest workflow', {
      start_month,
      end_month,
      max_pages_per_month,
      skip_existing,
    });

    // Create workflow instance
    const instance = await c.env.NEW_RELEASES_HARVEST.create({
      params: {
        start_month,
        end_month,
        max_pages_per_month,
        skip_existing,
        resume_from_month,
        resume_from_page,
      },
    });

    logger.info('New releases workflow started', { instanceId: instance.id, start_month, end_month });

    return createSuccessResponse(c, {
      instance_id: instance.id,
      status: 'started' as const,
      start_month,
      end_month,
      max_pages_per_month,
      monitor_url: `/api/harvest/new-releases/${instance.id}`,
    }, 202);
  } catch (error) {
    logger.error('Failed to start new releases workflow', {
      error: error instanceof Error ? error.message : 'Unknown',
    });

    return createErrorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      'Failed to start new releases workflow',
      { details: error instanceof Error ? error.message : 'Unknown error' }
    );
  }
});

// GET /api/harvest/new-releases/:instanceId - Get workflow status
app.openapi(getNewReleasesStatusRoute, async (c) => {
  const logger = c.get('logger');
  const { instanceId } = c.req.valid('param');

  try {
    const instance = await c.env.NEW_RELEASES_HARVEST.get(instanceId);
    const status = await instance.status();

    return createSuccessResponse(c, {
      instance_id: instanceId,
      workflow_status: status,
    });
  } catch (error) {
    logger.error('Failed to get new releases workflow status', {
      instanceId,
      error: error instanceof Error ? error.message : 'Unknown',
    });

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

export default app;

import postgres from 'postgres';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { cache } from 'hono/cache';

// =================================================================================
// Configuration & Initialization
// =================================================================================

// Instantiate the Hono app
const app = new Hono();

// OpenAPI 3.0 Specification
const openAPISpec = {
  openapi: '3.0.0',
  info: {
    title: 'Alexandria Book API',
    version: '2.0.0',
    description: 'Search 54+ million books from OpenLibrary via ISBN, title, and author. Powered by Cloudflare Workers and Hyperdrive.',
    contact: {
      name: 'API Support',
      url: 'https://github.com/jukasdrj/alexandria'
    }
  },
  servers: [{ url: 'https://alexandria.ooheynerds.com', description: 'Production' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health Check',
        description: 'Returns API and database health status',
        tags: ['System'],
        responses: {
          '200': { description: 'Healthy' }
        }
      }
    },
    '/api/stats': {
      get: {
        summary: 'Database Statistics',
        description: 'Get live counts of editions, ISBNs, works, and authors',
        tags: ['System'],
        responses: {
          '200': { description: 'Statistics' }
        }
      }
    },
    '/api/search': {
      get: {
        summary: 'Search for books',
        description: 'Search by ISBN, title, or author',
        tags: ['Books'],
        parameters: [
          { name: 'isbn', in: 'query', description: 'Search by ISBN-10 or ISBN-13', schema: { type: 'string' } },
          { name: 'title', in: 'query', description: 'Search by book title (partial match)', schema: { type: 'string' } },
          { name: 'author', in: 'query', description: 'Search by author name (partial match)', schema: { type: 'string' } },
          { name: 'limit', in: 'query', description: 'Max results (default 10, max 50)', schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Search results' },
          '400': { description: 'Invalid query' },
          '404': { description: 'No results found' }
        }
      }
    }
  }
};

// =================================================================================
// Middleware
// =================================================================================

// Global middleware
app.use('*', cors());
app.use('*', secureHeaders());

// Database initialization middleware
app.use('*', async (c, next) => {
  // Create a fresh postgres client for each request to avoid I/O context issues
  const sql = postgres(c.env.HYPERDRIVE.connectionString, {
    max: 1,  // Single connection per request, Hyperdrive handles pooling
    fetch_types: false,
    prepare: false
  });
  c.set('sql', sql);
  c.set('startTime', Date.now());
  await next();
});

// =================================================================================
// Route Handlers
// =================================================================================

// GET / -> Serve the interactive dashboard
app.get('/', (c) => {
  return c.html(getDashboardHTML(), 200, {
    'cache-control': 'public, max-age=3600',
  });
});

// GET /openapi.json
app.get('/openapi.json', (c) => {
  return c.json(openAPISpec, 200, {
    'cache-control': 'public, max-age=3600'
  });
});

// GET /health -> System health check
app.get('/health', async (c) => {
  try {
    const sql = c.get('sql');
    const start = Date.now();
    await sql`SELECT 1`;
    const latency = Date.now() - start;
    return c.json({
      status: 'ok',
      database: 'connected',
      hyperdrive_latency_ms: latency,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Health check DB error:', e);
    return c.json({
      status: 'error',
      database: 'disconnected',
      message: e.message
    }, 503);
  }
});

// GET /api/stats -> Get database statistics
app.get('/api/stats',
  cache({ cacheName: 'alexandria-cache', cacheControl: 'public, max-age=86400' }),
  async (c) => {
    try {
      const sql = c.get('sql');
      const start = Date.now();
      const [editions, isbns, works, authors] = await Promise.all([
        sql`SELECT count(*) FROM editions`.then(r => r[0].count),
        sql`SELECT count(*) FROM edition_isbns`.then(r => r[0].count),
        sql`SELECT count(*) FROM works`.then(r => r[0].count),
        sql`SELECT count(*) FROM authors`.then(r => r[0].count),
      ]);
      const queryDuration = Date.now() - start;

      const stats = {
        editions: parseInt(editions, 10),
        isbns: parseInt(isbns, 10),
        works: parseInt(works, 10),
        authors: parseInt(authors, 10),
        query_duration_ms: queryDuration,
      };

      return c.json(stats, 200, {
        'cache-control': 'public, max-age=86400'
      });
    } catch (e) {
      console.error('Stats query error:', e);
      return c.json({
        error: 'Database query failed',
        message: e.message
      }, 500);
    }
  }
);

// GET /api/search -> Main search endpoint
app.get('/api/search',
  cache({ cacheName: 'alexandria-cache', cacheControl: 'public, max-age=86400' }),
  async (c) => {
    const isbn = c.req.query('isbn')?.replace(/[^0-9X]/gi, '').toUpperCase();
    const title = c.req.query('title');
    const author = c.req.query('author');
    const limit = Math.min(parseInt(c.req.query('limit'), 10) || 10, 50);

    if (!isbn && !title && !author) {
      return c.json({
        error: 'Missing query parameter',
        message: 'Please provide one of: isbn, title, or author.'
      }, 400);
    }

    const sql = c.get('sql');
    const start = Date.now();
    try {
      let results;

      if (isbn) {
        if (isbn.length !== 10 && isbn.length !== 13) {
          return c.json({
            error: 'Invalid ISBN format',
            provided: c.req.query('isbn')
          }, 400);
        }
        results = await sql`
          SELECT
            e.data->>'title' AS title,
            a.data->>'name' AS author,
            ei.isbn,
            e.data->>'publish_date' AS publish_date,
            e.data->>'publishers' AS publishers,
            e.data->>'number_of_pages' AS pages,
            w.data->>'title' AS work_title,
            e.key AS edition_key,
            w.key AS work_key
          FROM editions e
          JOIN edition_isbns ei ON ei.edition_key = e.key
          LEFT JOIN works w ON w.key = e.work_key
          LEFT JOIN author_works aw ON aw.work_key = w.key
          LEFT JOIN authors a ON aw.author_key = a.key
          WHERE ei.isbn = ${isbn}
          LIMIT ${limit}
        `;
      } else if (title) {
        // NOTE: ILIKE can be slow. For production, consider pg_trgm with GIN/GIST indexes.
        results = await sql`
          SELECT DISTINCT ON (e.key)
            e.data->>'title' AS title,
            a.data->>'name' AS author,
            ei.isbn,
            e.data->>'publish_date' AS publish_date,
            e.data->>'publishers' AS publishers,
            e.data->>'number_of_pages' AS pages,
            w.data->>'title' AS work_title,
            e.key AS edition_key,
            w.key AS work_key
          FROM editions e
          LEFT JOIN edition_isbns ei ON ei.edition_key = e.key
          LEFT JOIN works w ON w.key = e.work_key
          LEFT JOIN author_works aw ON aw.work_key = w.key
          LEFT JOIN authors a ON aw.author_key = a.key
          WHERE e.data->>'title' ILIKE ${'%' + title + '%'}
          LIMIT ${limit}
        `;
      } else if (author) {
        results = await sql`
          SELECT DISTINCT ON (e.key)
            e.data->>'title' AS title,
            a.data->>'name' AS author,
            ei.isbn,
            e.data->>'publish_date' AS publish_date,
            e.data->>'publishers' AS publishers,
            e.data->>'number_of_pages' AS pages,
            w.data->>'title' AS work_title,
            e.key AS edition_key,
            w.key AS work_key
          FROM authors a
          JOIN author_works aw ON aw.author_key = a.key
          JOIN works w ON w.key = aw.work_key
          JOIN editions e ON e.work_key = w.key
          LEFT JOIN edition_isbns ei ON ei.edition_key = e.key
          WHERE a.data->>'name' ILIKE ${'%' + author + '%'}
          LIMIT ${limit}
        `;
      }

      const queryDuration = Date.now() - start;

      if (results.length === 0) {
        return c.json({
          error: 'Not Found',
          query: { isbn, title, author }
        }, 404);
      }

      const formattedResults = results.map(row => ({
        title: row.title,
        author: row.author,
        isbn: row.isbn,
        publish_date: row.publish_date,
        publishers: row.publishers ? JSON.parse(row.publishers) : null,
        pages: row.pages,
        work_title: row.work_title,
        openlibrary_edition: row.edition_key ? `https://openlibrary.org${row.edition_key}` : null,
        openlibrary_work: row.work_key ? `https://openlibrary.org${row.work_key}` : null,
      }));

      return c.json({
        query: { isbn, title, author },
        query_duration_ms: queryDuration,
        count: formattedResults.length,
        results: formattedResults
      }, 200, {
        'cache-control': 'public, max-age=86400'
      });

    } catch (e) {
      console.error('Search query error:', e);
      return c.json({
        error: 'Database query failed',
        message: e.message
      }, 500);
    }
  }
);

// =================================================================================
// Worker Entrypoint
// =================================================================================

export default app;


// =================================================================================
// Dashboard HTML Template
// =================================================================================

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alexandria API Dashboard</title>
  <style>
    :root {
      --primary-color: #2563eb; --primary-dark: #1d4ed8; --text-color: #1f2937;
      --bg-light: #f9fafb; --bg-white: #fff; --border-color: #e5e7eb;
      --green: #10b981; --red: #ef4444; --yellow: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6; color: var(--text-color); background: var(--bg-light);
      display: flex; flex-direction: column; min-height: 100vh;
    }
    .container { max-width: 1100px; margin: 0 auto; padding: 20px; flex-grow: 1; }
    header {
      background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
      color: white; padding: 40px 30px; border-radius: 12px; margin-bottom: 30px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.1);
    }
    h1 { font-size: 2.5em; margin-bottom: 10px; }
    .tagline { font-size: 1.2em; opacity: 0.9; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
    .card { background: var(--bg-white); padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .card h2 { color: var(--primary-color); margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 10px; font-size: 1.5em; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .stat-item .value { font-size: 2em; font-weight: bold; color: var(--primary-color); }
    .stat-item .label { color: #6b7280; font-size: 0.9em; }
    .status-indicator { display: flex; align-items: center; gap: 10px; font-size: 1.2em; font-weight: 500; }
    .status-dot { width: 14px; height: 14px; border-radius: 50%; animation: pulse 2s infinite; }
    .status-dot.ok { background-color: var(--green); box-shadow: 0 0 8px var(--green); }
    .status-dot.error { background-color: var(--red); box-shadow: 0 0 8px var(--red); }
    .status-dot.loading { background-color: var(--yellow); box-shadow: 0 0 8px var(--yellow); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .search-form input, .search-form select, .search-form button {
      width: 100%; padding: 12px; font-size: 1em; margin-bottom: 10px; border-radius: 6px;
      border: 1px solid #d1d5db;
    }
    .search-form button { background: var(--primary-color); color: white; border: 0; cursor: pointer; transition: background 0.2s; }
    .search-form button:hover { background: var(--primary-dark); }
    #results { margin-top: 20px; font-family: monospace; white-space: pre-wrap; word-break: break-all; background: #111827; color: #f3f4f6; padding: 15px; border-radius: 6px; max-height: 400px; overflow-y: auto; }
    .spinner { border: 4px solid #f3f3f3; border-top: 4px solid var(--primary-color); border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    footer { text-align: center; padding: 20px; margin-top: 30px; color: #6b7280; border-top: 1px solid var(--border-color); }
    a { color: var(--primary-color); text-decoration: none; }
    .example-link { display: inline-block; margin: 0 10px 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📚 Alexandria API Dashboard</h1>
      <div class="tagline">Real-time stats and interactive search for 54+ million books from OpenLibrary.</div>
    </header>

    <div class="grid">
      <div class="card" style="grid-column: 1 / -1;">
        <h2>System Status</h2>
        <div id="status-container">
          <div class="status-indicator">
            <div class="status-dot loading"></div>
            <span>Checking database connection...</span>
          </div>
        </div>
      </div>

      <div class="card" style="grid-column: span 2;">
        <h2>Live Database Stats</h2>
        <div id="stats-container" class="stat-grid">
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">Book Editions</div></div>
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">ISBN Records</div></div>
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">Literary Works</div></div>
          <div class="stat-item"><div class="value"><div class="spinner"></div></div><div class="label">Authors</div></div>
        </div>
        <p id="stats-timing" style="margin-top: 15px; font-size: 0.9em; color: #6b7280;"></p>
      </div>

      <div class="card" style="grid-column: span 2;">
        <h2>API Query Tester</h2>
        <form id="search-form" class="search-form">
          <select id="search-type" name="type">
            <option value="isbn">ISBN</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
          <input type="text" id="search-query" name="query" placeholder="Enter search term..." required>
          <button type="submit">Search</button>
        </form>
        <div id="results-container" style="display: none;">
          <h3 style="margin: 10px 0;">Results</h3>
          <pre id="results"></pre>
        </div>
      </div>
      
      <div class="card" style="grid-column: 1 / -1;">
        <h2>API Documentation</h2>
        <p>This API provides access to a self-hosted mirror of the OpenLibrary dataset via Cloudflare's global edge network. All queries are routed through Hyperdrive for optimal performance and connection pooling.</p>
        <p style="margin-top: 15px;">
          <a href="/openapi.json" class="example-link">View OpenAPI Spec</a> | 
          <a href="https://github.com/jukasdrj/alexandria" target="_blank" class="example-link">View on GitHub</a>
        </p>
        <h3 style="margin-top: 20px; color: var(--text-color);">Quick Examples</h3>
        <ul style="margin: 10px 0 0 20px;">
          <li><code>/api/search?isbn=9780439064873</code> - Search by ISBN</li>
          <li><code>/api/search?title=harry+potter</code> - Search by title</li>
          <li><code>/api/search?author=rowling</code> - Search by author</li>
          <li><code>/api/stats</code> - Get database statistics</li>
          <li><code>/health</code> - Check system health</li>
        </ul>
      </div>
    </div>
  </div>
  <footer>
    <p><strong>Powered by:</strong> Cloudflare Workers + Hyperdrive + PostgreSQL (self-hosted)</p>
    <p><strong>Infrastructure:</strong> Cloudflare Tunnel → Unraid Server (192.168.1.240)</p>
  </footer>

  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const statusContainer = document.getElementById('status-container');
      const statsContainer = document.getElementById('stats-container');
      const statsTiming = document.getElementById('stats-timing');
      const searchForm = document.getElementById('search-form');
      const resultsContainer = document.getElementById('results-container');
      const resultsEl = document.getElementById('results');

      const formatNumber = (num) => num ? new Intl.NumberFormat('en-US').format(num) : 'N/A';

      // Fetch health status
      async function checkHealth() {
        try {
          const res = await fetch('/health');
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Health check failed');
          
          statusContainer.innerHTML = \`
            <div class="status-indicator">
              <div class="status-dot ok"></div>
              <span>Database connected via Hyperdrive (Latency: \${data.hyperdrive_latency_ms}ms)</span>
            </div>\`;
        } catch (error) {
          statusContainer.innerHTML = \`
            <div class="status-indicator">
              <div class="status-dot error"></div>
              <span>Database connection error: \${error.message}</span>
            </div>\`;
        }
      }

      // Fetch database stats
      async function loadStats() {
        try {
          const res = await fetch('/api/stats');
          const data = await res.json();
          if (!res.ok) throw new Error('Failed to load stats');

          statsContainer.innerHTML = \`
            <div class="stat-item"><div class="value">\${formatNumber(data.editions)}</div><div class="label">Book Editions</div></div>
            <div class="stat-item"><div class="value">\${formatNumber(data.isbns)}</div><div class="label">ISBN Records</div></div>
            <div class="stat-item"><div class="value">\${formatNumber(data.works)}</div><div class="label">Literary Works</div></div>
            <div class="stat-item"><div class="value">\${formatNumber(data.authors)}</div><div class="label">Authors</div></div>
          \`;
          statsTiming.textContent = \`Stats query completed in \${data.query_duration_ms}ms. Cached for 24 hours.\`;
        } catch (error) {
          statsContainer.innerHTML = '<p style="color: var(--red);">Could not load database stats. Please check system status.</p>';
        }
      }

      // Handle search form submission
      searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('search-type').value;
        const query = document.getElementById('search-query').value;
        
        resultsContainer.style.display = 'block';
        resultsEl.innerHTML = '<div class="spinner"></div>';
        
        try {
          const res = await fetch(\`/api/search?\${type}=\${encodeURIComponent(query)}\`);
          const data = await res.json();
          
          if (!res.ok) {
              resultsEl.textContent = JSON.stringify({ status: res.status, ...data }, null, 2);
          } else {
              resultsEl.textContent = JSON.stringify(data, null, 2);
          }

        } catch (error) {
          resultsEl.textContent = JSON.stringify({ error: 'Request failed', message: error.message }, null, 2);
        }
      });

      // Initial data load
      checkHealth();
      loadStats();
      
      // Refresh stats every 5 minutes
      setInterval(loadStats, 300000);
    });
  </script>
</body>
</html>`;
}

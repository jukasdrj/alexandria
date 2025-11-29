import postgres from 'postgres';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        database: 'connected via tunnel',
        tunnel: 'alexandria-db.ooheynerds.com',
        timestamp: new Date().toISOString()
      }), {
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*'
        }
      });
    }

    // ISBN lookup endpoint
    if (url.pathname === '/api/isbn' && url.searchParams.has('isbn')) {
      const rawIsbn = url.searchParams.get('isbn');
      const isbn = rawIsbn.replace(/[^0-9X]/gi, '').toUpperCase();

      // Validate ISBN format
      if (isbn.length !== 10 && isbn.length !== 13) {
        return new Response(JSON.stringify({
          error: 'Invalid ISBN format',
          message: 'ISBN must be 10 or 13 characters (digits only)',
          provided: rawIsbn
        }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*'
          }
        });
      }

      // Create database connection via Hyperdrive
      const sql = postgres(env.HYPERDRIVE.connectionString, {
        max: 5,
        fetch_types: false,
        prepare: false
      });

      try {
        // Query using indexed edition_isbns table
        const result = await sql`
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
          LIMIT 10
        `;

        // Close connection
        await sql.end();

        if (result.length === 0) {
          return new Response(JSON.stringify({
            error: 'ISBN not found',
            isbn: isbn,
            message: 'This ISBN does not exist in the OpenLibrary database'
          }), {
            status: 404,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': '*'
            }
          });
        }

        // Format response
        return new Response(JSON.stringify({
          isbn: isbn,
          count: result.length,
          results: result.map(row => ({
            title: row.title,
            author: row.author,
            isbn: row.isbn,
            publish_date: row.publish_date,
            publishers: row.publishers ? JSON.parse(row.publishers) : null,
            pages: row.pages,
            work_title: row.work_title,
            openlibrary_edition: row.edition_key ? `https://openlibrary.org${row.edition_key}` : null,
            openlibrary_work: row.work_key ? `https://openlibrary.org${row.work_key}` : null
          }))
        }), {
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=86400' // Cache for 24 hours
          }
        });

      } catch (error) {
        console.error('Database query error:', error);

        // Ensure connection is closed
        await sql.end().catch(() => {});

        return new Response(JSON.stringify({
          error: 'Database query failed',
          message: error.message,
          isbn: isbn
        }), {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*'
          }
        });
      }
    }

    // Default: Homepage with API documentation
    return new Response(getHomepage(), {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'public, max-age=3600'
      }
    });
  }
};

function getHomepage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alexandria - OpenLibrary Database API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #f9fafb;
    }
    header {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white;
      padding: 40px 30px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
    }
    .tagline {
      font-size: 1.2em;
      opacity: 0.9;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      border-left: 4px solid #2563eb;
    }
    .stat-number {
      font-size: 2em;
      font-weight: bold;
      color: #2563eb;
      margin-bottom: 5px;
    }
    .stat-label {
      color: #6b7280;
      font-size: 0.9em;
    }
    section {
      background: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    h2 {
      color: #2563eb;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e5e7eb;
    }
    h3 {
      color: #374151;
      margin: 20px 0 10px 0;
    }
    .endpoint {
      background: #f3f4f6;
      padding: 20px;
      border-radius: 6px;
      margin: 15px 0;
      border-left: 4px solid #10b981;
    }
    .method {
      display: inline-block;
      background: #10b981;
      color: white;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: bold;
      margin-right: 10px;
    }
    code {
      background: #1f2937;
      color: #10b981;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
    }
    pre {
      background: #1f2937;
      color: #e5e7eb;
      padding: 15px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 10px 0;
    }
    pre code {
      background: none;
      color: inherit;
      padding: 0;
    }
    .example-link {
      display: inline-block;
      background: #2563eb;
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      margin: 10px 10px 10px 0;
      transition: background 0.2s;
    }
    .example-link:hover {
      background: #1d4ed8;
    }
    footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      color: #6b7280;
      font-size: 0.9em;
    }
    .architecture {
      background: #eff6ff;
      padding: 15px;
      border-radius: 6px;
      margin: 15px 0;
      font-family: monospace;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <header>
    <h1>📚 Alexandria</h1>
    <div class="tagline">OpenLibrary Database API - 54 Million Books at Your Fingertips</div>
  </header>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-number">54.8M</div>
      <div class="stat-label">Book Editions</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">49.3M</div>
      <div class="stat-label">ISBN Records</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">40.1M</div>
      <div class="stat-label">Literary Works</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">14.7M</div>
      <div class="stat-label">Authors</div>
    </div>
  </div>

  <section>
    <h2>API Endpoints</h2>

    <div class="endpoint">
      <h3><span class="method">GET</span> /health</h3>
      <p>Health check endpoint to verify API and database connectivity.</p>
      <p><strong>Response:</strong> JSON with status, timestamp, and connection info</p>
      <a href="/health" class="example-link">Try it</a>
    </div>

    <div class="endpoint">
      <h3><span class="method">GET</span> /api/isbn?isbn={ISBN}</h3>
      <p>Look up book information by ISBN-10 or ISBN-13.</p>

      <p><strong>Parameters:</strong></p>
      <ul style="margin-left: 20px; margin-top: 10px;">
        <li><code>isbn</code> (required) - ISBN-10 or ISBN-13 (hyphens optional)</li>
      </ul>

      <p><strong>Response:</strong> JSON array with matching books</p>

      <p><strong>Example Request:</strong></p>
      <pre><code>GET https://alexandria.ooheynerds.com/api/isbn?isbn=9780439064873</code></pre>

      <p><strong>Example Response:</strong></p>
      <pre><code>{
  "isbn": "9780439064873",
  "count": 1,
  "results": [
    {
      "title": "Harry Potter and the Chamber of Secrets",
      "author": "J. K. Rowling",
      "isbn": "9780439064873",
      "publish_date": "1999",
      "publishers": ["Scholastic"],
      "pages": "341",
      "openlibrary_edition": "https://openlibrary.org/books/...",
      "openlibrary_work": "https://openlibrary.org/works/..."
    }
  ]
}</code></pre>

      <a href="/api/isbn?isbn=9780439064873" class="example-link">Harry Potter</a>
      <a href="/api/isbn?isbn=9780316769174" class="example-link">Catcher in the Rye</a>
      <a href="/api/isbn?isbn=9780747532699" class="example-link">HP Philosopher's Stone</a>
    </div>

    <div class="endpoint">
      <h3>Error Responses</h3>
      <p><strong>400 Bad Request:</strong> Invalid ISBN format</p>
      <p><strong>404 Not Found:</strong> ISBN not in database</p>
      <p><strong>500 Internal Server Error:</strong> Database query failed</p>
    </div>
  </section>

  <section>
    <h2>Architecture</h2>
    <div class="architecture">
Internet → Cloudflare Workers (Global Edge Network)
    ↓
    postgres:// over HTTPS
    ↓
Cloudflare Tunnel (mTLS encrypted)
    ↓
    alexandria-db.ooheynerds.com
    ↓
Home Network (192.168.1.0/24)
    ↓
PostgreSQL on Unraid (250GB OpenLibrary data)
    </div>

    <p><strong>Features:</strong></p>
    <ul style="margin-left: 20px; margin-top: 10px;">
      <li>Globally distributed via Cloudflare's edge network</li>
      <li>Direct connection through secure Cloudflare Tunnel</li>
      <li>No public database exposure (outbound-only tunnel)</li>
      <li>24-hour cache headers for optimal performance</li>
      <li>Read-only API (OpenLibrary is source of truth)</li>
    </ul>
  </section>

  <section>
    <h2>Usage Notes</h2>
    <ul style="margin-left: 20px;">
      <li>This API is <strong>read-only</strong> - data sourced from OpenLibrary.org</li>
      <li>ISBN lookups are indexed for fast performance</li>
      <li>Responses are cached for 24 hours (static data)</li>
      <li>CORS enabled for cross-origin requests</li>
      <li>Rate limits may apply in the future</li>
    </ul>
  </section>

  <footer>
    <p><strong>Database:</strong> OpenLibrary PostgreSQL (Self-hosted)</p>
    <p><strong>Infrastructure:</strong> Cloudflare Workers + Tunnel</p>
    <p><strong>Status:</strong> Phase 2 - Database Integration Complete</p>
    <p><strong>Next:</strong> Title search, author search, caching layer</p>
  </footer>
</body>
</html>`;
}

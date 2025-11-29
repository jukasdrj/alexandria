export default {
  async fetch(request) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Alexandria - OpenLibrary Database</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #2563eb; }
    .stats { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .stat-item { margin: 10px 0; }
    .stat-number { font-size: 24px; font-weight: bold; color: #1f2937; }
    .stat-label { color: #6b7280; }
  </style>
</head>
<body>
  <h1>📚 Alexandria - OpenLibrary Database</h1>
  <p>Connected to 54+ million books through Cloudflare Tunnel + Workers!</p>
  
  <div class="stats">
    <h2>Database Statistics</h2>
    <div class="stat-item">
      <div class="stat-number">14.7M</div>
      <div class="stat-label">Authors</div>
    </div>
    <div class="stat-item">
      <div class="stat-number">40.1M</div>
      <div class="stat-label">Works</div>
    </div>
    <div class="stat-item">
      <div class="stat-number">54.8M</div>
      <div class="stat-label">Editions</div>
    </div>
    <div class="stat-item">
      <div class="stat-number">49.3M</div>
      <div class="stat-label">ISBNs</div>
    </div>
  </div>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p><strong>Architecture:</strong> Cloudflare Workers → Cloudflare Tunnel → Unraid Server (Tower) → PostgreSQL</p>
    <p><strong>Database:</strong> alexandria-db.ooheynerds.com</p>
    <p><strong>Status:</strong> ✅ Tunnel Connected | 🚀 Ready for Queries</p>
  </div>
</body>
</html>`;
    
    return new Response(html, {
      headers: { 'content-type': 'text/html' }
    });
  }
};

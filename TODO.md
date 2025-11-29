# Alexandria Development Roadmap

Current status and next steps for development.

## ✅ Phase 1: Infrastructure (COMPLETE)

- [x] Set up Cloudflare Tunnel on Unraid
- [x] Configure DNS (alexandria-db.ooheynerds.com)
- [x] Deploy hello world Worker (alexandria.ooheynerds.com)
- [x] Verify tunnel connectivity (4 active connections)
- [x] Document architecture and setup
- [x] Create deployment scripts

## ✅ Phase 2: Live Database Queries (COMPLETE)

### Hyperdrive Implementation (Production)
- [x] Enable SSL on PostgreSQL database
- [x] Set up Cloudflare Access application
- [x] Create Service Token for authentication
- [x] Configure Hyperdrive with Access credentials
- [x] Update Worker to use Hyperdrive binding
- [x] Implement ISBN search endpoint
- [x] Add error handling and validation
- [x] Test connection pooling
- [x] Deploy to production
- [x] Verify live queries working

**Status**: API is LIVE at https://alexandria.ooheynerds.com
- Health endpoint: `/health`
- ISBN lookup: `/api/isbn?isbn={ISBN}`
- Homepage with docs: `/`

## 🎯 Phase 3: Features & UI

- [ ] Build search interface
  - [ ] ISBN search
  - [ ] Title search
  - [ ] Author search
- [ ] Display book details
  - [ ] Cover images (if available)
  - [ ] Author information
  - [ ] Edition details
- [ ] Add pagination for results
- [ ] Implement autocomplete
- [ ] Add loading states

## 📊 Phase 4: API Endpoints

Create RESTful API:
- [ ] GET /api/search?isbn={isbn}
- [ ] GET /api/search?title={title}
- [ ] GET /api/search?author={author}
- [ ] GET /api/book/{id}
- [ ] GET /api/author/{id}
- [ ] GET /api/stats (database statistics)

## ⚡ Phase 5: Performance & Optimization

- [ ] Add query result caching
- [ ] Implement database indexes for common queries
- [ ] Add rate limiting
- [ ] Monitor query performance
- [ ] Optimize slow queries
- [ ] Add CDN caching headers

## 🔐 Phase 6: Security & Access Control

- [ ] Add API authentication (optional)
- [ ] Implement rate limiting per IP
- [ ] Add CORS configuration
- [ ] Security headers
- [ ] Input validation & sanitization
- [ ] SQL injection prevention

## 📱 Phase 7: Advanced Features

- [ ] Mobile-responsive design
- [ ] Dark mode
- [ ] Export results (CSV, JSON)
- [ ] Bookmark functionality
- [ ] Reading lists
- [ ] Share functionality

## 🧪 Testing & Quality

- [ ] Unit tests for Worker functions
- [ ] Integration tests for database queries
- [ ] Load testing with Hyperdrive
- [ ] Error monitoring setup
- [ ] Performance benchmarks

## 📝 Documentation

- [ ] API documentation
- [ ] User guide
- [ ] Contributing guidelines
- [ ] Deployment guide
- [ ] Troubleshooting guide

## 🚀 Deployment & Operations

- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Staging environment
- [ ] Production monitoring
- [ ] Automated backups (database)
- [ ] Disaster recovery plan

---

## Quick Wins (Start Here)

For immediate progress, start with:

1. **Add Database Querying** (2-3 hours)
   - Install postgres driver
   - Add connection logic
   - Test simple query

2. **ISBN Search Endpoint** (1-2 hours)
   - Parse query parameters
   - Execute database query
   - Return JSON response

3. **Simple Search UI** (2-3 hours)
   - Input form for ISBN
   - Display results
   - Basic styling

## Resources for Development

### PostgreSQL Drivers for Workers
- **node-postgres**: Most popular, full-featured
- **postgres.js**: Faster, smaller bundle size
- **Hyperdrive**: Cloudflare's connection pooler (recommended)

### Testing Database Queries
```bash
# Connect directly to test queries
ssh root@Tower.local "docker exec -it postgres psql -U openlibrary -d openlibrary"

# Test query
SELECT * FROM editions LIMIT 5;
```

### Helpful Wrangler Commands
```bash
cd worker/
npm run dev      # Local development
npm run deploy   # Deploy to production
npm run tail     # View live logs
```

## Questions to Consider

- Should we use Hyperdrive now or add it later?
- Do we want public API or authenticated only?
- What rate limits make sense?
- Should we add analytics/tracking?
- Do we need a custom domain for API? (api.alexandria.ooheynerds.com)

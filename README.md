# Alexandria - OpenLibrary Database on Cloudflare

A Cloudflare Workers application that exposes the complete OpenLibrary database (54M+ books) through a secure Cloudflare Tunnel connection to a self-hosted PostgreSQL database.

## 🏗️ Architecture

```
Internet → Cloudflare Edge
    ↓
Cloudflare Worker (alexandria.ooheynerds.com)
    ↓ (Future: Hyperdrive for connection pooling)
Cloudflare Tunnel (alexandria-db.ooheynerds.com)
    ↓
Unraid Server "Tower" (192.168.1.240)
    ↓
PostgreSQL Container (openlibrary database)
```

## 📊 Database Statistics

- **14.7M** Authors
- **40.1M** Works  
- **54.8M** Editions
- **49.3M** ISBNs
- **42.8M** Author-Work relationships

## 🚀 Current Status

✅ **Phase 1 Complete**: Infrastructure & Hello World
- Cloudflare Tunnel deployed on Unraid
- Worker deployed at https://alexandria.ooheynerds.com
- DNS configured (alexandria-db.ooheynerds.com)
- Static hello world page live

🔄 **Phase 2 Next**: Live Database Queries
- Add PostgreSQL driver to Worker
- Implement search functionality
- Optional: Add Hyperdrive for performance

## 📁 Project Structure

```
alex/
├── worker/           # Cloudflare Worker code
│   ├── index.js      # Main worker application
│   └── wrangler.toml # Wrangler configuration
├── tunnel/           # Tunnel configuration
│   └── config.yml    # Tunnel ingress rules
├── docs/             # Documentation
│   ├── SETUP.md      # Initial setup guide
│   ├── CREDENTIALS.md # Credential storage
│   └── ARCHITECTURE.md # Architecture details
└── scripts/          # Deployment scripts
    ├── deploy-worker.sh
    └── tunnel-status.sh
```

## 🔑 Key Information

### Cloudflare Resources
- **Account**: Jukasdrj@gmail.com's Account
- **Domain**: ooheynerds.com
- **Worker**: alexandria
- **Tunnel ID**: 848928ab-4ab9-4733-93b0-3e7967c60acb
- **Tunnel Name**: alexandria

### Server Details
- **Unraid Server**: Tower (192.168.1.240)
- **SSH Access**: root@Tower.local (passwordless via SSH key)
- **PostgreSQL Port**: 5432
- **Database**: openlibrary
- **User**: openlibrary
- **Data Path**: /mnt/user/domains/OL_DB/

## 🛠️ Quick Commands

```bash
# Deploy worker
cd worker && npx wrangler deploy

# Check tunnel status (on Unraid)
ssh root@Tower.local "docker logs alexandria-tunnel --tail 20"

# Access database directly
ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary"

# View live site
open https://alexandria.ooheynerds.com
```

## 📚 Documentation

- [Setup Guide](./docs/SETUP.md) - Complete setup instructions
- [Architecture](./docs/ARCHITECTURE.md) - Technical architecture details
- [Credentials](./docs/CREDENTIALS.md) - All credentials and access info

## 🎯 Next Development Goals

1. **Add Live Queries**: Implement ISBN search functionality
2. **Hyperdrive Setup**: Add connection pooling for performance
3. **Search UI**: Build search interface with results
4. **API Endpoints**: Create RESTful API for book queries
5. **Performance**: Add caching and optimization

## 🤝 Getting Started with Claude Code

This project is ready for Claude Code agents:
- All configuration files in place
- SSH access configured
- Deployment scripts ready
- Comprehensive documentation

## 📝 Notes

- Tunnel runs as Docker container on Unraid
- Database already fully populated with OpenLibrary data
- Worker deployed via Wrangler CLI
- Future: Add Cloudflare Access for enhanced security

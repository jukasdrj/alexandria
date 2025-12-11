# Security Rules for Alexandria

These rules are automatically loaded and enforced for all tasks.

## Never Commit These Files

- `docs/CREDENTIALS.md` - Contains passwords and API keys
- `.env` files - Environment variables
- `**/*.key`, `**/*.pem`, `**/*.crt` - Certificate files

## API Key Handling

1. **ISBNdb API Key**: Stored in Wrangler secrets, access via `env.ISBNDB_API_KEY`
2. **Google Books API Key**: Stored in Wrangler secrets, access via `env.GOOGLE_BOOKS_API_KEY`
3. **Database Password**: In Hyperdrive config, never expose in code

## Cover URL Whitelist

Only these domains are allowed for cover downloads:
- `books.google.com`
- `covers.openlibrary.org`
- `images.isbndb.com`
- `images-na.ssl-images-amazon.com`
- `m.media-amazon.com`

## Access Control

- API secured with Cloudflare Access
- Only accessible from home IP: `47.187.18.143/32`
- Tunnel uses Zero Trust remotely-managed configuration

## Error Response Guidelines

- Never leak database connection details
- Never expose internal error messages to clients
- Use generic error messages: "Query failed", "Invalid input"
- Log detailed errors server-side only

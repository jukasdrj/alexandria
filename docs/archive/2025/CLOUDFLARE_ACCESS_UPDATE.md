# Update Cloudflare Access for Current Device

## Current Situation

- Alexandria API is protected by Cloudflare Access
- Currently only accessible from home IP: **47.187.18.143/32**
- Your current device IP: **75.104.93.176**
- OAuth tokens don't support Access API management

## Option 1: Update via Cloudflare Dashboard (RECOMMENDED)

1. Go to **Cloudflare Zero Trust Dashboard**: https://one.dash.cloudflare.com/
2. Navigate to **Access** → **Applications**
3. Find the **Alexandria** application (alexandria.ooheynerds.com)
4. Click **Edit**
5. Go to the **Policies** tab
6. Find the IP-based policy (usually named "Allow Home IP" or similar)
7. Update the IP ranges to include:
   - **47.187.18.143/32** (home IP)
   - **75.104.93.176/32** (current device)
8. Save the policy

## Option 2: Create API Token for Automation

If you want the script to work, you need to create an API Token with Access permissions:

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Choose **Custom Token**
4. Add permissions:
   - **Account** → **Access: Organizations, Identity Providers, and Groups** → **Edit**
5. Set **Account Resources** → Include → **Jukasdrj@gmail.com's Account**
6. Create the token and save it
7. Run the script with: `CF_API_TOKEN=your-token-here node scripts/update-access-policy.js`

## Option 3: Temporary Public Access (NOT RECOMMENDED)

You could temporarily disable Cloudflare Access for testing, but this is NOT recommended for security reasons.

## Quick Manual Fix (5 minutes)

The fastest way is **Option 1** - just log into the Cloudflare dashboard and add your IP to the policy.

Once updated, test with:
```bash
curl https://alexandria.ooheynerds.com/api/harvest/quota
```

You should see the quota status JSON response.
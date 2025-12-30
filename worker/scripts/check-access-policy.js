#!/usr/bin/env node

/**
 * Check Cloudflare Access policy for alexandria-db tunnel
 */

const ACCOUNT_ID = '8bc2c9d1bb39f5596cef97b3b86c54e7';
const APPLICATION_AUD = '51df407761f1fa363a477f99c9f881e7f55b82179f0bdeb72cff10a3ff5ff388';
const SERVICE_TOKEN_CLIENT_ID = '7fbfd3c70cafed2941be8e94ed884b68.access';

async function main() {
  console.log('\n=== Cloudflare Access Policy Check ===\n');
  console.log(`Application AUD: ${APPLICATION_AUD}`);
  console.log(`Expected Service Token: ${SERVICE_TOKEN_CLIENT_ID}\n`);
  
  // For now, just output the information needed
  console.log('To check the Access policy manually:');
  console.log('1. Go to https://one.dash.cloudflare.com/');
  console.log(`2. Select account: ${ACCOUNT_ID}`);
  console.log('3. Navigate to Zero Trust → Access → Applications');
  console.log(`4. Find application with AUD: ${APPLICATION_AUD}`);
  console.log('5. Check if the policy includes this Service Token:');
  console.log(`   ${SERVICE_TOKEN_CLIENT_ID}`);
  console.log('\nIf the Service Token is NOT in the policy, add it.');
  console.log('If it IS in the policy but still getting 403, the token may be expired.');
}

main().catch(console.error);

#!/usr/bin/env node

/**
 * Update Cloudflare Access Policy to allow current device IP
 *
 * This script:
 * 1. Gets the current device's public IP
 * 2. Finds the Alexandria Access application
 * 3. Updates the IP whitelist to include both home IP and current IP
 */

import { execSync } from 'child_process';

const ACCOUNT_ID = 'd03bed0be6d976acd8a1707b55052f79'; // From wrangler whoami
const HOME_IP = '47.187.18.143/32'; // Home IP from CLAUDE.md

async function main() {
  try {
    console.log('🔍 Getting current device IP...');

    // Get current IP
    const currentIP = execSync('curl -s https://ipinfo.io/ip').toString().trim();
    console.log(`📍 Current device IP: ${currentIP}`);

    // Get Cloudflare API token from wrangler config
    console.log('🔐 Getting Cloudflare API token...');
    let apiToken;
    try {
      const configPath = `${process.env.HOME}/Library/Preferences/.wrangler/config/default.toml`;
      const configContent = execSync(`cat "${configPath}"`).toString();
      const tokenMatch = configContent.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (!tokenMatch) {
        console.error('❌ Could not find OAuth token in wrangler config');
        process.exit(1);
      }
      apiToken = tokenMatch[1];
      console.log('✅ Found OAuth token');
    } catch (error) {
      console.error('❌ Failed to get API token:', error.message);
      process.exit(1);
    }

    // Find the Access application for alexandria.ooheynerds.com
    console.log('🔍 Finding Alexandria Access application...');

    // Try Cloudflare Zero Trust API (different endpoint for Access)
    const appsResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/applications`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!appsResponse.ok) {
      const error = await appsResponse.json();
      console.error('❌ Failed to fetch Access applications:', error);
      process.exit(1);
    }

    const apps = await appsResponse.json();
    const alexandriaApp = apps.result.find(app =>
      app.domain === 'alexandria.ooheynerds.com' ||
      app.name.toLowerCase().includes('alexandria')
    );

    if (!alexandriaApp) {
      console.error('❌ Alexandria Access application not found');
      console.log('Available applications:', apps.result.map(app => ({ name: app.name, domain: app.domain })));
      process.exit(1);
    }

    console.log(`✅ Found Alexandria app: ${alexandriaApp.name} (${alexandriaApp.domain})`);
    console.log(`📱 App ID: ${alexandriaApp.id}`);

    // Get current policies for this app
    console.log('🔍 Getting current Access policies...');
    const policiesResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/apps/${alexandriaApp.id}/policies`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!policiesResponse.ok) {
      const error = await policiesResponse.json();
      console.error('❌ Failed to fetch Access policies:', error);
      process.exit(1);
    }

    const policies = await policiesResponse.json();
    console.log(`📋 Found ${policies.result.length} existing policies`);

    // Find the IP-based policy (usually the one with IP ranges)
    const ipPolicy = policies.result.find(policy =>
      policy.include && policy.include.some(rule => rule.ip && rule.ip.in)
    );

    if (!ipPolicy) {
      console.error('❌ Could not find IP-based Access policy');
      console.log('Existing policies:', policies.result.map(p => ({ name: p.name, include: p.include })));
      process.exit(1);
    }

    console.log(`🎯 Found IP policy: ${ipPolicy.name}`);

    // Current IP ranges
    const currentIPs = ipPolicy.include.find(rule => rule.ip && rule.ip.in)?.ip?.in || [];
    console.log(`📍 Current allowed IPs: ${currentIPs.join(', ')}`);

    // New IP ranges (home IP + current IP)
    const newIPs = Array.from(new Set([
      HOME_IP,
      `${currentIP}/32`
    ]));

    console.log(`🆕 New allowed IPs: ${newIPs.join(', ')}`);

    // Update the policy
    const updatedPolicy = {
      ...ipPolicy,
      include: ipPolicy.include.map(rule => {
        if (rule.ip && rule.ip.in) {
          return {
            ...rule,
            ip: {
              in: newIPs
            }
          };
        }
        return rule;
      })
    };

    console.log('🔧 Updating Access policy...');
    const updateResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/apps/${alexandriaApp.id}/policies/${ipPolicy.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatedPolicy)
    });

    if (!updateResponse.ok) {
      const error = await updateResponse.json();
      console.error('❌ Failed to update Access policy:', error);
      process.exit(1);
    }

    const result = await updateResponse.json();
    console.log('✅ Access policy updated successfully!');
    console.log(`🎉 Alexandria is now accessible from both home (${HOME_IP}) and current device (${currentIP}/32)`);

    // Test the connection
    console.log('🧪 Testing connection...');
    try {
      const testResponse = await fetch('https://alexandria.ooheynerds.com/api/harvest/quota');
      if (testResponse.ok) {
        const quotaData = await testResponse.json();
        console.log('✅ Connection test successful!');
        console.log('📊 Quota status:', quotaData);
      } else {
        console.log('⚠️  Access policy updated but connection test failed (may take a moment to propagate)');
      }
    } catch (error) {
      console.log('⚠️  Access policy updated but connection test failed:', error.message);
      console.log('🕐 Policy may take a few moments to propagate. Try again in 30 seconds.');
    }

  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

main();
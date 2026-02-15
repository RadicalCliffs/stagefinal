#!/usr/bin/env node
/**
 * Sentry Integration Setup Script
 * 
 * Automates Sentry integration for error tracking and monitoring.
 * 
 * Usage:
 *   node scripts/setup-sentry.mjs --dsn=<YOUR_SENTRY_DSN>
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Parse DSN from command line
const args = process.argv.slice(2);
const dsnArg = args.find(arg => arg.startsWith('--dsn='));
const SENTRY_DSN = dsnArg?.split('=')[1];

if (!SENTRY_DSN) {
  log('Error: --dsn=<YOUR_SENTRY_DSN> is required', 'red');
  log('\nGet your DSN from:', 'blue');
  log('  1. Go to https://sentry.io', 'blue');
  log('  2. Create or select a project', 'blue');
  log('  3. Go to Settings > Client Keys (DSN)', 'blue');
  log('  4. Copy the DSN', 'blue');
  log('\nUsage:', 'blue');
  log('  node scripts/setup-sentry.mjs --dsn=https://xxx@xxx.ingest.sentry.io/xxx', 'blue');
  process.exit(1);
}

log('\n╔════════════════════════════════════════════╗', 'magenta');
log('║      SENTRY INTEGRATION SETUP            ║', 'magenta');
log('╚════════════════════════════════════════════╝', 'magenta');

// Step 1: Install Sentry package
log('\nStep 1: Installing @sentry/react...', 'blue');
log('Run: npm install @sentry/react', 'cyan');

// Step 2: Create Sentry configuration file
log('\nStep 2: Creating Sentry configuration...', 'blue');

const sentryConfig = `/**
 * Sentry Error Tracking Configuration
 * 
 * Automatically tracks errors and performance issues in production.
 * See: https://docs.sentry.io/platforms/javascript/guides/react/
 */

import * as Sentry from "@sentry/react";

// Initialize Sentry
export function initSentry() {
  // Only initialize in production
  if (import.meta.env.MODE !== 'production') {
    console.log('[Sentry] Skipping initialization in development mode');
    return;
  }

  Sentry.init({
    dsn: "${SENTRY_DSN}",
    
    // Environment
    environment: import.meta.env.MODE,
    
    // Release tracking
    release: import.meta.env.VITE_APP_VERSION || 'unknown',
    
    // Performance Monitoring
    integrations: [
      new Sentry.BrowserTracing({
        // Set sampling rate for performance monitoring
        // 1.0 = 100% of transactions, 0.1 = 10%
        tracePropagationTargets: [
          "localhost",
          /^\\/api\\//,
          import.meta.env.VITE_SUPABASE_URL,
        ],
      }),
      new Sentry.Replay({
        // Session replay for debugging
        // Mask all text and block all media by default
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    
    // Performance traces sample rate
    // Lower this in production to reduce data volume
    tracesSampleRate: 0.1, // 10% of transactions
    
    // Session Replay sample rate
    replaysSessionSampleRate: 0.01, // 1% of sessions
    replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
    
    // Before sending, filter out sensitive data
    beforeSend(event, hint) {
      // Don't send errors in development
      if (import.meta.env.MODE !== 'production') {
        return null;
      }
      
      // Filter out known third-party errors
      if (event.exception) {
        const exceptionValues = event.exception.values || [];
        for (const exception of exceptionValues) {
          // Filter out browser extension errors
          if (exception.value?.includes('chrome-extension://')) {
            return null;
          }
          // Filter out MetaMask errors
          if (exception.value?.includes('MetaMask')) {
            return null;
          }
        }
      }
      
      // Sanitize URLs
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/[?&]token=[^&]+/, '?token=REDACTED');
      }
      
      return event;
    },
    
    // Ignore specific errors
    ignoreErrors: [
      // Browser extensions
      'top.GLOBALS',
      'chrome-extension://',
      'moz-extension://',
      // Network errors (often not actionable)
      'NetworkError',
      'Failed to fetch',
      // Wallet connection errors (user cancelled)
      'User rejected',
      'User denied',
    ],
  });
  
  console.log('[Sentry] Initialized successfully');
}

// Error boundary component
export const SentryErrorBoundary = Sentry.ErrorBoundary;

// Manual error reporting
export function reportError(error: Error, context?: Record<string, any>) {
  if (context) {
    Sentry.setContext("error_context", context);
  }
  Sentry.captureException(error);
}

// Set user context
export function setSentryUser(user: { id: string; email?: string }) {
  Sentry.setUser({
    id: user.id,
    email: user.email,
  });
}

// Clear user context (on logout)
export function clearSentryUser() {
  Sentry.setUser(null);
}

// Add breadcrumb for debugging
export function addBreadcrumb(message: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    message,
    level: 'info',
    data,
  });
}
`;

const sentryConfigPath = join(__dirname, '../src/lib/sentry.ts');
writeFileSync(sentryConfigPath, sentryConfig);
log(`✓ Created ${sentryConfigPath}`, 'green');

// Step 3: Update main.tsx to initialize Sentry
log('\nStep 3: Updating main.tsx...', 'blue');

const mainTsxPath = join(__dirname, '../src/main.tsx');
if (existsSync(mainTsxPath)) {
  let mainContent = readFileSync(mainTsxPath, 'utf-8');
  
  // Add import if not already present
  if (!mainContent.includes('from \'./lib/sentry\'')) {
    mainContent = `import { initSentry } from './lib/sentry';\n${mainContent}`;
  }
  
  // Add initialization if not already present
  if (!mainContent.includes('initSentry()')) {
    mainContent = mainContent.replace(
      /(import.*\n\n)/,
      '$1// Initialize Sentry error tracking\ninitSentry();\n\n'
    );
  }
  
  writeFileSync(mainTsxPath, mainContent);
  log(`✓ Updated ${mainTsxPath}`, 'green');
} else {
  log(`⚠ Could not find main.tsx, add manually:`, 'yellow');
  log(`  import { initSentry } from './lib/sentry';`, 'cyan');
  log(`  initSentry();`, 'cyan');
}

// Step 4: Add environment variable
log('\nStep 4: Environment variables...', 'blue');
log('Add to .env.production:', 'cyan');
log(`  VITE_SENTRY_DSN=${SENTRY_DSN}`, 'cyan');
log('  VITE_APP_VERSION=1.0.0', 'cyan');

// Step 5: Update .env.example
const envExamplePath = join(__dirname, '../.env.example');
if (existsSync(envExamplePath)) {
  let envExample = readFileSync(envExamplePath, 'utf-8');
  
  if (!envExample.includes('VITE_SENTRY_DSN')) {
    envExample += `\n# Sentry Error Tracking
# Get your DSN from: https://sentry.io/settings/projects/
# Format: https://[key]@[organization].ingest.sentry.io/[project]
VITE_SENTRY_DSN=${SENTRY_DSN}
VITE_APP_VERSION=1.0.0\n`;
    
    writeFileSync(envExamplePath, envExample);
    log(`✓ Updated ${envExamplePath}`, 'green');
  }
}

// Step 6: Create error boundary wrapper
log('\nStep 5: Creating error boundary wrapper...', 'blue');

const errorBoundaryComponent = `import React from 'react';
import { SentryErrorBoundary } from '../lib/sentry';

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error, resetError }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="max-w-md w-full bg-gray-800 rounded-lg p-8 text-center">
        <h2 className="text-2xl font-bold text-white mb-4">
          Oops! Something went wrong
        </h2>
        <p className="text-gray-400 mb-6">
          We've been notified and are working on a fix. Please try again.
        </p>
        <button
          onClick={resetError}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Try Again
        </button>
        {import.meta.env.MODE === 'development' && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-gray-400 hover:text-white">
              Error Details
            </summary>
            <pre className="mt-2 text-xs text-red-400 overflow-auto">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};

export const withErrorBoundary = (Component: React.ComponentType) => {
  return (props: any) => (
    <SentryErrorBoundary fallback={ErrorFallback}>
      <Component {...props} />
    </SentryErrorBoundary>
  );
};
`;

const errorBoundaryPath = join(__dirname, '../src/components/ErrorBoundary.tsx');
writeFileSync(errorBoundaryPath, errorBoundaryComponent);
log(`✓ Created ${errorBoundaryPath}`, 'green');

// Step 7: Usage examples
log('\n╔════════════════════════════════════════════╗', 'magenta');
log('║          INTEGRATION COMPLETE             ║', 'magenta');
log('╚════════════════════════════════════════════╝', 'magenta');

log('\nUsage Examples:', 'blue');
log('\n1. Manual error reporting:', 'yellow');
log('   import { reportError } from \'./lib/sentry\';', 'cyan');
log('   reportError(error, { context: \'payment_flow\' });', 'cyan');

log('\n2. Set user context:', 'yellow');
log('   import { setSentryUser } from \'./lib/sentry\';', 'cyan');
log('   setSentryUser({ id: user.id, email: user.email });', 'cyan');

log('\n3. Add breadcrumbs:', 'yellow');
log('   import { addBreadcrumb } from \'./lib/sentry\';', 'cyan');
log('   addBreadcrumb(\'User clicked checkout\', { amount: 50 });', 'cyan');

log('\n4. Wrap components with error boundary:', 'yellow');
log('   import { withErrorBoundary } from \'./components/ErrorBoundary\';', 'cyan');
log('   export default withErrorBoundary(MyComponent);', 'cyan');

log('\nNext Steps:', 'blue');
log('  1. Run: npm install @sentry/react', 'cyan');
log('  2. Add VITE_SENTRY_DSN to .env.production', 'cyan');
log('  3. Test in development: throw new Error(\'test\');', 'cyan');
log('  4. Deploy and verify in Sentry dashboard', 'cyan');
log('  5. Set up alerts in Sentry settings', 'cyan');

log('\n✅ Sentry integration setup complete!', 'green');

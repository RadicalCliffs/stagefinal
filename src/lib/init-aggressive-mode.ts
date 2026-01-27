/**
 * Aggressive Mode Initialization
 * 
 * Import this file EARLY in your app (in main.tsx) to enable aggressive mode.
 * 
 * What it does:
 * - Initializes admin client with service-level credentials
 * - Enables global error interception
 * - Sets up automatic schema fixes
 * - Configures aggressive CRUD operations
 * 
 * Usage:
 *   import './lib/init-aggressive-mode';
 * 
 * Then use the omnipotent data service or aggressive CRUD anywhere in your app.
 */

import { hasAdminAccess } from './supabase-admin';
import { enableConsoleInterception } from './error-interceptor';
import { omnipotentData } from './omnipotent-data-service';
import { databaseLogger } from './debug-console';

// Initialize aggressive mode
function initializeAggressiveMode() {
  console.log('\n🚀 ===============================================');
  console.log('🚀 AGGRESSIVE MODE INITIALIZATION');
  console.log('🚀 ===============================================\n');

  if (hasAdminAccess()) {
    console.log('✅ Admin credentials detected');
    console.log('✅ Service-level access enabled');
    console.log('✅ Auto-schema management active');
    console.log('✅ Error interception enabled');
    console.log('✅ Aggressive CRUD operations ready');
    
    // Enable console error interception
    enableConsoleInterception();
    
    // Set omnipotent data to aggressive mode
    omnipotentData.aggressiveMode = true;
    
    console.log('\n🔥 AGGRESSIVE MODE: FULLY OPERATIONAL');
    console.log('🔥 Database will auto-fix all schema issues');
    console.log('🔥 No more "column does not exist" errors\n');
    
    databaseLogger.info('[AggressiveMode] Initialization complete');
  } else {
    console.warn('⚠️  Admin credentials not found');
    console.warn('⚠️  Set VITE_SUPABASE_SERVICE_ROLE_KEY to enable aggressive mode');
    console.warn('⚠️  Falling back to standard mode\n');
    
    databaseLogger.warn('[AggressiveMode] Not available - missing service key');
  }

  console.log('===============================================\n');
}

// Run initialization
initializeAggressiveMode();

// Export utilities for manual use
export { hasAdminAccess } from './supabase-admin';
export { omnipotentData } from './omnipotent-data-service';
export { aggressiveCRUD } from './aggressive-crud';
export { schemaManager } from './aggressive-schema-manager';
export { errorInterceptor } from './error-interceptor';

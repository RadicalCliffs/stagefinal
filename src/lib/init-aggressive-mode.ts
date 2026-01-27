/**
 * Aggressive Mode Initialization
 * 
 * AUTOMATIC - This file is imported early in main.tsx and sets up everything.
 * 
 * What it does:
 * - Initializes admin client with service-level credentials
 * - Enables global error interception
 * - Sets up automatic schema fixes
 * - Configures aggressive CRUD operations
 * - Makes all user operations seamless
 * 
 * Users never see technical errors - everything "just works"
 */

import { hasAdminAccess } from './supabase-admin';
import { enableConsoleInterception } from './error-interceptor';
import { omnipotentData } from './omnipotent-data-service';
import { databaseLogger } from './debug-console';

// Initialize aggressive mode
function initializeAggressiveMode() {
  console.log('\n🚀 ===============================================');
  console.log('🚀 SEAMLESS MODE INITIALIZATION');
  console.log('🚀 ===============================================\n');

  if (hasAdminAccess()) {
    console.log('✅ Service-level access enabled');
    console.log('✅ Auto-schema management active');
    console.log('✅ Error auto-fix enabled');
    console.log('✅ User-friendly error messages active');
    console.log('✅ Seamless operations ready');
    
    // Enable console error interception
    enableConsoleInterception();
    
    // Set omnipotent data to aggressive mode
    omnipotentData.aggressiveMode = true;
    
    console.log('\n🔥 SEAMLESS MODE: FULLY OPERATIONAL');
    console.log('🔥 All user operations will "just work"');
    console.log('🔥 Database auto-fixes all issues silently');
    console.log('🔥 Users get friendly, actionable messages\n');
    
    databaseLogger.info('[SeamlessMode] Initialization complete');
  } else {
    console.warn('⚠️  Service credentials not configured');
    console.warn('⚠️  Set VITE_SUPABASE_SERVICE_ROLE_KEY to enable seamless mode');
    console.warn('⚠️  Falling back to standard mode\n');
    
    databaseLogger.warn('[SeamlessMode] Not available - missing service key');
  }

  console.log('===============================================\n');
}

// Run initialization immediately
initializeAggressiveMode();

// Export the main interface - this is what apps should use
export { seamlessOps } from './seamless-ops';
export { hasAdminAccess } from './supabase-admin';
export { omnipotentData } from './omnipotent-data-service';

// Advanced operations (for edge cases)
export { aggressiveCRUD } from './aggressive-crud';
export { aggressiveOps } from './aggressive-ops';
export { schemaManager } from './aggressive-schema-manager';
export { errorInterceptor } from './error-interceptor';
export { userFriendlyErrors } from './user-friendly-errors';


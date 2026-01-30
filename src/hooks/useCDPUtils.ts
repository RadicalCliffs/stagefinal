/**
 * CDP Utility Hooks
 * 
 * Centralized exports for Coinbase Developer Platform (CDP) utility hooks.
 * These hooks provide configuration access and advanced features like X402 (pay-per-use APIs).
 * 
 * Usage:
 * ```tsx
 * import { useConfig, useX402 } from '@/hooks/useCDPUtils';
 * 
 * function ConfigComponent() {
 *   const { config } = useConfig();
 *   const { fetchWithX402 } = useX402();
 *   
 *   console.log('Project ID:', config.projectId);
 *   
 *   // Use X402 for pay-per-use API calls
 *   const data = await fetchWithX402('/api/premium-feature');
 *   
 *   return <div>Config loaded</div>;
 * }
 * ```
 */

// Re-export CDP utility hooks for centralized access
export {
  // Configuration
  useConfig,
  
  // X402 (Pay-per-use APIs)
  useX402,
} from '@coinbase/cdp-hooks';

/**
 * Type re-exports for TypeScript support
 */
export type {
  Config,
  FetchWithX402Options,
  FetchWithX402ReturnType,
  SecureIframeStatus,
  SecureIframeTheme,
} from '@coinbase/cdp-hooks';

/**
 * VRF Integration Exports
 * 
 * Central export file for all VRF-related components, services, and types
 */

// ============================================================================
// Services
// ============================================================================

export { default as vrfMonitor } from './lib/vrf-monitor';
export type { VRFStatus, VRFQueueItem, TransactionStatus } from './lib/vrf-monitor';

export { default as adminService } from './services/adminService';
export type { WinnerEntry } from './services/adminService';

// ============================================================================
// Components
// ============================================================================

// VRF Status Components
export {
  VRFStatusBadge,
  VRFTransactionDetails,
  useVRFStatus,
} from './components/VRFStatusComponents';

// Winner Widgets
export { default as RecentWinnersWidget } from './components/RecentWinnersWidget';
export { default as CompetitionStats } from './components/CompetitionStats';

// Dashboard Components
export {
  VRFStatsCard,
  VRFDashboardSection,
} from './components/UserDashboard/VRFDashboardSection';

// ============================================================================
// Contract Information
// ============================================================================

export {
  COMPETITION_VRF_ADDRESS,
  CONTRACT_CONFIG,
  COMPETITION_VRF_ABI,
  COMPETITION_VRF_CONTRACT,
} from './lib/vrf-contract';

export type {
  Competition,
  Winners,
  CompetitionDetails,
  VRFStatus as ContractVRFStatus,
} from './lib/vrf-contract';

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * Example 1: Get VRF Status
 * 
 * ```typescript
 * import { vrfMonitor } from '@/vrf';
 * 
 * const status = await vrfMonitor.getVRFStatus(competitionId);
 * console.log(status.status); // 'completed', 'processing', etc.
 * ```
 */

/**
 * Example 2: Subscribe to VRF Updates
 * 
 * ```typescript
 * import { vrfMonitor } from '@/vrf';
 * import { useEffect } from 'react';
 * 
 * function MyComponent({ competitionId }) {
 *   useEffect(() => {
 *     const unsubscribe = vrfMonitor.subscribeToVRFStatus(competitionId, (status) => {
 *       console.log('VRF status updated:', status);
 *     });
 *     return () => unsubscribe();
 *   }, [competitionId]);
 * }
 * ```
 */

/**
 * Example 3: Display VRF Status Badge
 * 
 * ```typescript
 * import { VRFStatusBadge } from '@/vrf';
 * 
 * <VRFStatusBadge competitionId={competitionId} />
 * ```
 */

/**
 * Example 4: Get Competition Winners (Admin)
 * 
 * ```typescript
 * import { adminService } from '@/vrf';
 * 
 * const winners = await adminService.getCompetitionWinners(competitionId);
 * winners.forEach(w => {
 *   console.log(`Ticket #${w.ticket_number} - ${w.canonical_users?.username}`);
 * });
 * ```
 */

/**
 * Example 5: Generate BaseScan URL
 * 
 * ```typescript
 * import { vrfMonitor } from '@/vrf';
 * 
 * const txUrl = vrfMonitor.getTransactionUrl(txHash);
 * // Returns: "https://basescan.org/tx/0x..."
 * ```
 */

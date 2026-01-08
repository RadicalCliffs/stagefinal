/**
 * Lucky Dip Components
 *
 * Components for interacting with the CompetitionSystemV3 smart contract.
 *
 * Available components:
 * - LuckyDipButton: Purchase random tickets (both REGULAR and INSTANT_WIN)
 * - TicketPicker: Manually select specific tickets (REGULAR only)
 *
 * Usage:
 * ```tsx
 * import { LuckyDipButton, TicketPicker } from './components/LuckyDip';
 *
 * // Lucky Dip (random tickets)
 * <LuckyDipButton
 *   competitionId={0}
 *   onSuccess={(result) => console.log(result.ticketNumbers)}
 *   onInstantWin={(ticketNum, tierId) => celebrate()}
 * />
 *
 * // Manual ticket selection (REGULAR competitions only)
 * <TicketPicker
 *   competitionId={0}
 *   onSuccess={(result) => console.log(result.ticketNumbers)}
 * />
 * ```
 */

export { default as LuckyDipButton } from './LuckyDipButton';
export { default as TicketPicker } from './TicketPicker';

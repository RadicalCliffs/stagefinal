/**
 * LuckyDipButton Component
 *
 * A React component for purchasing random tickets via the on-chain VRF Lucky Dip system.
 * Now uses the CompetitionSystemV3 contract which supports both REGULAR and INSTANT_WIN
 * competition types.
 *
 * Features:
 * - Real-time competition details from smart contract
 * - Automatic network switching to Base
 * - Support for both REGULAR and INSTANT_WIN competitions
 * - Instant win detection and celebration
 * - Transaction status tracking with BaseScan links
 * - Event-driven updates for real-time ticket availability
 * - User-friendly error handling
 *
 * Usage:
 * ```tsx
 * <LuckyDipButton
 *   competitionId={0}
 *   onSuccess={(result) => console.log(result.ticketNumbers)}
 *   onInstantWin={(ticketNumber, tierId) => celebrate(ticketNumber, tierId)}
 * />
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthUser } from '../../contexts/AuthContext';
import { createWalletClient, custom } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import {
  buyLuckyDipTickets,
  getCompetitionDetails,
  useCompetitionEvents,
  type CompetitionDetails,
  type PurchaseResult,
  type InstantWinResult,
  CompetitionType
} from '../../lib/luckyDip';

// Determine which chain to use based on environment
const isBaseMainnet = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BASE_MAINNET === 'true';
const activeChain = isBaseMainnet ? base : baseSepolia;
const CHAIN_ID = activeChain.id;
const EXPLORER_URL = isBaseMainnet ? 'https://basescan.org' : 'https://sepolia.basescan.org';

interface LuckyDipButtonProps {
  /** The on-chain competition ID from the smart contract */
  competitionId: number;
  /** Callback fired after successful purchase with ticket numbers and tx hash */
  onSuccess?: (result: PurchaseResult) => void;
  /** Callback fired when user wins instantly (INSTANT_WIN competitions only) */
  onInstantWin?: (ticketNumber: number, tierId: string) => void;
  /** Optional callback for error handling */
  onError?: (error: Error) => void;
  /** Optional custom class name for the container */
  className?: string;
}

interface SuccessState {
  tickets: number[];
  txHash: string;
  instantWins: InstantWinResult[];
}

export default function LuckyDipButton({
  competitionId,
  onSuccess,
  onInstantWin,
  onError,
  className = ''
}: LuckyDipButtonProps) {
  const { authenticated, ready, login, linkedWallets } = useAuthUser();

  const [numTickets, setNumTickets] = useState(1);
  const [loading, setLoading] = useState(false);
  const [competition, setCompetition] = useState<CompetitionDetails | null>(null);
  const [competitionLoading, setCompetitionLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  // Load competition details from smart contract
  const loadCompetition = useCallback(async () => {
    try {
      const details = await getCompetitionDetails(competitionId);
      setCompetition(details);
      setCompetitionLoading(false);
    } catch (err) {
      console.error('Error loading competition:', err);
      setCompetitionLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    loadCompetition();

    // Refresh every 10 seconds to keep availability current
    const interval = setInterval(loadCompetition, 10000);
    return () => clearInterval(interval);
  }, [loadCompetition]);

  // Subscribe to real-time ticket purchase events for instant updates
  useCompetitionEvents({
    onTicketsPurchased: () => {
      // Refresh competition details when tickets are purchased
      loadCompetition();
    },
    onInstantWinSeedSet: (event) => {
      if (Number(event.competitionId) === competitionId) {
        // VRF seed received, refresh to enable purchases
        loadCompetition();
      }
    }
  }, competitionId);

  const handleBuy = async () => {
    setError(null);
    setSuccess(null);

    // Check if user is authenticated with Base auth
    if (!ready || !authenticated) {
      login();
      return;
    }

    // Get the active wallet from Base auth
    const wallet = linkedWallets?.[0];
    if (!wallet) {
      setError("No wallet connected. Please connect a wallet first.");
      return;
    }

    setLoading(true);

    try {
      // For CDP/Base wallets, use window.ethereum as the provider
      // The wallet object from AuthContext is a simplified representation
      // and doesn't have a direct provider property
      const provider = (window as any).ethereum;

      if (!provider) {
        throw new Error("No wallet provider available. Please ensure your wallet is connected.");
      }

      // Create viem wallet client with wallet provider
      const walletClient = createWalletClient({
        chain: activeChain,
        transport: custom(provider)
      });

      // Buy tickets via smart contract
      const result = await buyLuckyDipTickets(walletClient, competitionId, numTickets);

      setSuccess({
        tickets: result.ticketNumbers,
        txHash: result.txHash,
        instantWins: result.instantWins
      });

      // Refresh competition details to show updated availability
      await loadCompetition();

      // Call parent callback
      if (onSuccess) {
        onSuccess(result);
      }

      // Notify about instant wins
      if (result.instantWins.length > 0 && onInstantWin) {
        result.instantWins.forEach(win => {
          onInstantWin(win.ticketNumber, win.tierId);
        });
      }

    } catch (err) {
      console.error('Error buying tickets:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to buy tickets';

      // Provide user-friendly error messages
      let friendlyError = errorMessage;
      if (errorMessage.includes('rejected') || errorMessage.includes('denied')) {
        friendlyError = 'Transaction was rejected in your wallet';
      } else if (errorMessage.includes('insufficient')) {
        friendlyError = 'Insufficient ETH balance for this purchase';
      } else if (errorMessage.includes('not active')) {
        friendlyError = 'This competition is no longer accepting entries';
      } else if (errorMessage.includes('VRF') || errorMessage.includes('randomness')) {
        friendlyError = 'Waiting for randomness from VRF. Please try again in a moment.';
      } else if (errorMessage.includes('Manual ticket picking')) {
        friendlyError = errorMessage;
      }

      setError(friendlyError);

      if (onError && err instanceof Error) {
        onError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const totalCost = competition
    ? (parseFloat(competition.pricePerTicket) * numTickets).toFixed(6)
    : '0';

  const maxTickets = competition
    ? Math.min(competition.available, competition.maxTicketsPerTx)
    : 1;

  const handleTicketChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value) || 1;
    setNumTickets(Math.max(1, Math.min(maxTickets, value)));
  };

  // Check if purchases are allowed
  const canPurchase = competition?.active &&
    competition?.seedReady &&
    (authenticated ? competition.available >= numTickets : true);

  // Determine button state and text
  const isDisabled = loading || !canPurchase;
  const buttonText = loading
    ? 'Processing...'
    : !authenticated
    ? 'Connect Wallet to Buy'
    : !competition?.seedReady
    ? '⏳ Waiting for VRF...'
    : `Buy ${numTickets} Lucky Dip Ticket${numTickets > 1 ? 's' : ''}`;

  // Competition type label
  const competitionTypeLabel = competition?.isInstantWin
    ? '🎲 Instant Win'
    : '🎫 Regular Draw';

  return (
    <div className={`bg-white rounded-lg shadow-lg p-6 max-w-md w-full ${className}`}>
      <h3 className="text-2xl font-bold mb-4 text-gray-800">
        Lucky Dip
      </h3>

      {competitionLoading ? (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      ) : competition ? (
        <div className="mb-4 p-4 bg-blue-50 rounded-lg">
          <div className="flex justify-between mb-2">
            <span className="text-gray-600">Type:</span>
            <span className="font-semibold">{competitionTypeLabel}</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-gray-600">Price per ticket:</span>
            <span className="font-semibold">{competition.pricePerTicket} ETH</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-gray-600">Available tickets:</span>
            <span className="font-semibold text-green-600">{competition.available}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Total sold:</span>
            <span className="font-semibold">{competition.ticketsSold} / {competition.totalTickets}</span>
          </div>
          {competition.isInstantWin && !competition.seedReady && (
            <div className="mt-2 p-2 bg-yellow-100 rounded text-yellow-800 text-sm">
              ⏳ Waiting for VRF randomness... Purchases will be enabled shortly.
            </div>
          )}
          {competition.isInstantWin && competition.seedReady && (
            <div className="mt-2 p-2 bg-green-100 rounded text-green-800 text-sm">
              ✨ Instant win enabled! You could win immediately!
            </div>
          )}
        </div>
      ) : (
        <div className="mb-4 p-4 bg-red-50 rounded-lg">
          <p className="text-red-600 text-sm">Could not load competition details</p>
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Number of tickets
        </label>
        <input
          type="number"
          min="1"
          max={maxTickets}
          value={numTickets}
          onChange={handleTicketChange}
          disabled={loading || !competition?.active || !competition?.seedReady}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <p className="text-sm text-gray-500 mt-1">
          Max: {maxTickets} tickets per purchase
        </p>
      </div>

      <div className="mb-4 p-3 bg-gray-100 rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-gray-700 font-medium">Total Cost:</span>
          <span className="text-2xl font-bold text-blue-600">{totalCost} ETH</span>
        </div>
      </div>

      <button
        onClick={handleBuy}
        disabled={isDisabled}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center"
      >
        {loading ? (
          <>
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Processing...
          </>
        ) : (
          buttonText
        )}
      </button>

      {!competition?.active && competition && (
        <p className="text-red-600 text-sm mt-2 text-center">
          Competition is not active
        </p>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 font-semibold mb-2">Success!</p>
          <p className="text-sm text-gray-700 mb-2">
            Your ticket numbers: <strong>{success.tickets.join(', ')}</strong>
          </p>

          {success.instantWins.length > 0 && (
            <div className="mt-2 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
              <p className="text-yellow-800 font-bold text-lg mb-1">🎉 INSTANT WIN!</p>
              {success.instantWins.map((win, idx) => (
                <p key={idx} className="text-yellow-700">
                  Ticket #{win.ticketNumber} won: {win.tierId}
                </p>
              ))}
            </div>
          )}

          <a
            href={`${EXPLORER_URL}/tx/${success.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 text-sm underline"
          >
            View transaction on {isBaseMainnet ? 'BaseScan' : 'Sepolia BaseScan'}
          </a>
        </div>
      )}
    </div>
  );
}

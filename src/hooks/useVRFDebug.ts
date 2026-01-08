import { useState, useCallback, useEffect } from 'react';
import {
  debugCompetition,
  parseVRFState,
  type VRFDebugResponse,
  type ParsedVRFState,
  type VRFOnchainState,
} from '../lib/vrf-debug';

/**
 * Options for the useVRFDebug hook
 */
interface UseVRFDebugOptions {
  /** The on-chain competition ID to debug */
  competitionId?: number | null;
  /** Whether to automatically fetch on mount */
  autoFetch?: boolean;
  /** Polling interval in milliseconds (0 to disable) */
  pollingInterval?: number;
  /** Callback when debug data is fetched successfully */
  onSuccess?: (data: ParsedVRFState) => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

/**
 * Return type for the useVRFDebug hook
 */
interface UseVRFDebugReturn {
  /** The raw response from the debug function */
  response: VRFDebugResponse | null;
  /** Parsed VRF state with computed values */
  vrfState: ParsedVRFState | null;
  /** Whether the request is in progress */
  loading: boolean;
  /** Error message if the request failed */
  error: string | null;
  /** Manually trigger a debug request */
  debug: (id?: number) => Promise<void>;
  /** Clear the current state */
  reset: () => void;
  /** Whether the competition is ready for VRF draw */
  isReadyForDraw: boolean;
  /** Whether the competition has already been drawn */
  isDrawn: boolean;
  /** Whether the competition is active */
  isActive: boolean;
  /** Formatted status string */
  statusText: string;
}

/**
 * React hook for debugging VRF competition state
 *
 * Provides an easy way to fetch and track on-chain competition state
 * for debugging and admin purposes.
 *
 * @example
 * ```tsx
 * function CompetitionAdmin({ onchainId }) {
 *   const {
 *     vrfState,
 *     loading,
 *     error,
 *     isReadyForDraw,
 *     debug
 *   } = useVRFDebug({ competitionId: onchainId, autoFetch: true });
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <ErrorMessage>{error}</ErrorMessage>;
 *
 *   return (
 *     <div>
 *       <p>Status: {vrfState?.statusEmoji} {vrfState?.statusLabel}</p>
 *       {isReadyForDraw && <button>Trigger VRF Draw</button>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useVRFDebug(options: UseVRFDebugOptions = {}): UseVRFDebugReturn {
  const {
    competitionId,
    autoFetch = false,
    pollingInterval = 0,
    onSuccess,
    onError,
  } = options;

  const [response, setResponse] = useState<VRFDebugResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debug = useCallback(async (id?: number) => {
    const targetId = id ?? competitionId;

    if (targetId === undefined || targetId === null) {
      setError('Competition ID is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await debugCompetition(targetId);
      setResponse(result);

      if (result.ok) {
        const parsed = parseVRFState(result.onchain);
        onSuccess?.(parsed);
      } else {
        setError(result.error);
        onError?.(result.error);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [competitionId, onSuccess, onError]);

  const reset = useCallback(() => {
    setResponse(null);
    setLoading(false);
    setError(null);
  }, []);

  // Auto-fetch on mount if enabled and competitionId is provided
  useEffect(() => {
    if (autoFetch && competitionId !== undefined && competitionId !== null) {
      debug(competitionId);
    }
  }, [autoFetch, competitionId, debug]);

  // Set up polling if enabled
  useEffect(() => {
    if (pollingInterval <= 0 || !competitionId) {
      return;
    }

    const interval = setInterval(() => {
      debug(competitionId);
    }, pollingInterval);

    return () => clearInterval(interval);
  }, [pollingInterval, competitionId, debug]);

  // Compute derived state
  const vrfState = response?.ok ? parseVRFState(response.onchain) : null;
  const isReadyForDraw = vrfState?.status === 'ready_for_draw';
  const isDrawn = vrfState?.drawn ?? false;
  const isActive = vrfState?.active ?? false;
  const statusText = vrfState
    ? `${vrfState.statusEmoji} ${vrfState.statusLabel}`
    : error
      ? `Error: ${error}`
      : 'Not loaded';

  return {
    response,
    vrfState,
    loading,
    error,
    debug,
    reset,
    isReadyForDraw,
    isDrawn,
    isActive,
    statusText,
  };
}

/**
 * Lightweight hook for checking if a competition is ready for VRF draw
 *
 * @example
 * ```tsx
 * function DrawButton({ onchainId }) {
 *   const { ready, loading, error, check } = useVRFReadyCheck(onchainId);
 *
 *   return (
 *     <button
 *       disabled={!ready || loading}
 *       onClick={() => triggerDraw()}
 *     >
 *       {loading ? 'Checking...' : ready ? 'Draw Winners' : 'Not Ready'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useVRFReadyCheck(competitionId?: number | null): {
  ready: boolean;
  loading: boolean;
  error: string | null;
  check: () => Promise<boolean>;
} {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (): Promise<boolean> => {
    if (competitionId === undefined || competitionId === null) {
      setError('Competition ID is required');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await debugCompetition(competitionId);

      if (result.ok) {
        const parsed = parseVRFState(result.onchain);
        const isReady = parsed.status === 'ready_for_draw';
        setReady(isReady);
        return isReady;
      } else {
        setError(result.error);
        setReady(false);
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setReady(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  // Check on mount if competitionId is provided
  useEffect(() => {
    if (competitionId !== undefined && competitionId !== null) {
      check();
    }
  }, [competitionId, check]);

  return { ready, loading, error, check };
}

export default useVRFDebug;

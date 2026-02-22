import { useState, type FormEvent } from 'react';
import { useVRFDebug } from '../../hooks/useVRFDebug';
import { triggerDraw, syncResults, type VRFTriggerDrawResponse, type VRFSyncResultsResponse } from '../../lib/vrf-debug';

/**
 * CompetitionDebugger Component
 *
 * A debugging tool for checking on-chain VRF competition state.
 * Use this component in admin dashboards to diagnose VRF draw issues.
 * Now includes controls for triggering VRF draws and syncing results.
 *
 * @example
 * ```tsx
 * <CompetitionDebugger />
 * ```
 */
export function CompetitionDebugger() {
  const [inputId, setInputId] = useState('');
  const {
    vrfState,
    loading,
    error,
    debug,
    reset,
    isReadyForDraw,
    response,
  } = useVRFDebug();

  // VRF trigger state
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerResult, setTriggerResult] = useState<VRFTriggerDrawResponse | null>(null);

  // VRF sync state
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<VRFSyncResultsResponse | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = parseInt(inputId, 10);
    if (!isNaN(id) && id > 0) {
      debug(id);
      // Clear previous results
      setTriggerResult(null);
      setSyncResult(null);
    }
  };

  const handleReset = () => {
    setInputId('');
    reset();
    setTriggerResult(null);
    setSyncResult(null);
  };

  const handleTriggerDraw = async () => {
    const id = parseInt(inputId, 10);
    if (isNaN(id) || id <= 0) return;

    setTriggerLoading(true);
    setTriggerResult(null);
    try {
      const result = await triggerDraw(id);
      setTriggerResult(result);
      // Refresh debug state after triggering
      if (result.ok) {
        setTimeout(() => debug(id), 2000);
      }
    } finally {
      setTriggerLoading(false);
    }
  };

  const handleSyncResults = async () => {
    setSyncLoading(true);
    setSyncResult(null);
    try {
      const result = await syncResults();
      setSyncResult(result);
      // Refresh debug state after syncing
      const id = parseInt(inputId, 10);
      if (!isNaN(id) && id > 0) {
        setTimeout(() => debug(id), 2000);
      }
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="competition-debugger bg-[#1a1a2e] rounded-xl p-6 border border-[#2a2a4e]">
      <h3 className="text-xl font-bold text-white mb-4">
        VRF Competition Debugger
      </h3>

      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-3">
          <input
            type="number"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="Enter On-Chain Competition ID"
            className="flex-1 px-4 py-3 bg-[#0d0d1a] border border-[#2a2a4e] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#6366f1] transition-colors"
            min="1"
          />
          <button
            type="submit"
            disabled={loading || !inputId}
            className="px-6 py-3 bg-linear-to-r from-[#6366f1] to-[#8b5cf6] text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {loading ? 'Checking...' : 'Debug'}
          </button>
          {(vrfState || error) && (
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-3 bg-[#2a2a4e] text-gray-300 rounded-lg hover:bg-[#3a3a5e] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {error && !response?.ok && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
          <p className="text-red-400 font-medium">Error</p>
          <p className="text-red-300 text-sm mt-1">{error}</p>
        </div>
      )}

      {vrfState && response?.ok && (
        <div className="debug-results space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Competition ID */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Competition ID</p>
              <p className="text-white font-mono text-lg">{response.competitionId}</p>
            </div>

            {/* Status */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Status</p>
              <p className="text-white text-lg">
                <span className="mr-2">{vrfState.statusEmoji}</span>
                {vrfState.statusLabel}
              </p>
            </div>

            {/* Active */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Active</p>
              <p className={`text-lg ${vrfState.active ? 'text-green-400' : 'text-red-400'}`}>
                {vrfState.active ? '✅ Yes' : '❌ No'}
              </p>
            </div>

            {/* Drawn */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Drawn</p>
              <p className={`text-lg ${vrfState.drawn ? 'text-blue-400' : 'text-yellow-400'}`}>
                {vrfState.drawn ? '✅ Yes' : '❌ No'}
              </p>
            </div>

            {/* Tickets Sold */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Tickets Sold</p>
              <p className="text-white text-lg font-mono">
                {vrfState.ticketsSold} / {vrfState.totalTickets}
              </p>
            </div>

            {/* End Time */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">End Time</p>
              <p className="text-white text-sm">
                {vrfState.endTimeDate.toLocaleString()}
              </p>
              <p className={`text-xs mt-1 ${vrfState.isEnded ? 'text-green-400' : 'text-yellow-400'}`}>
                {vrfState.isEnded ? '(Ended)' : '(Not ended yet)'}
              </p>
            </div>

            {/* Number of Winners */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Number of Winners</p>
              <p className="text-white text-lg font-mono">{vrfState.numWinners}</p>
            </div>

            {/* Price per Ticket */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Price per Ticket</p>
              <p className="text-white text-lg font-mono">
                {vrfState.pricePerTicketEth.toFixed(6)} ETH
              </p>
            </div>

            {/* Max Tickets per TX */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Max Tickets per TX</p>
              <p className="text-white text-lg font-mono">{vrfState.maxTicketsPerTx}</p>
            </div>

            {/* Competition Type */}
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Competition Type</p>
              <p className="text-white text-lg font-mono">{vrfState.compType}</p>
            </div>
          </div>

          {/* Draw Seeds */}
          <div className="bg-[#0d0d1a] rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-2">VRF Seeds</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">Instant Win Seed</p>
                <p className="text-white font-mono text-xs break-all">
                  {vrfState.instantWinSeed === '0' ? '(Not set)' : vrfState.instantWinSeed}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Draw Seed</p>
                <p className="text-white font-mono text-xs break-all">
                  {vrfState.drawSeed === '0' ? '(Not set)' : vrfState.drawSeed}
                </p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          {isReadyForDraw && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <p className="text-green-400 font-medium mb-2">
                Competition is ready for VRF draw!
              </p>
              <p className="text-green-300 text-sm mb-4">
                All conditions met: active, not drawn, and end time has passed.
              </p>
              <button
                type="button"
                onClick={handleTriggerDraw}
                disabled={triggerLoading}
                className="px-6 py-3 bg-linear-to-r from-green-500 to-emerald-600 text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {triggerLoading ? 'Triggering Draw...' : 'Trigger VRF Draw'}
              </button>
            </div>
          )}

          {/* Trigger Draw Result */}
          {triggerResult && (
            <div className={`rounded-lg p-4 ${
              triggerResult.ok
                ? 'bg-green-500/10 border border-green-500/30'
                : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <p className={`font-medium mb-2 ${triggerResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                {triggerResult.ok ? 'Draw Transaction Sent!' : 'Draw Failed'}
              </p>
              {triggerResult.ok && triggerResult.txHash && (
                <div className="space-y-2">
                  <p className="text-green-300 text-sm">
                    Transaction hash: <code className="bg-black/30 px-2 py-1 rounded text-xs">{triggerResult.txHash}</code>
                  </p>
                  <a
                    href={`https://basescan.org/tx/${triggerResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-blue-400 hover:text-blue-300 text-sm underline"
                  >
                    View on BaseScan
                  </a>
                  <p className="text-yellow-300 text-sm mt-2">
                    Wait 30-90 seconds for VRF callback, then click "Sync Results".
                  </p>
                </div>
              )}
              {!triggerResult.ok && (
                <p className="text-red-300 text-sm">{triggerResult.error}</p>
              )}
            </div>
          )}

          {/* Sync Results Button - show when draw was triggered or competition is drawn */}
          {(triggerResult?.ok || vrfState?.drawn || vrfState) && (
            <div className="bg-[#0d0d1a] rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-3">
                {triggerResult?.ok
                  ? 'After waiting for VRF callback (30-90 seconds), sync the results:'
                  : 'Sync winner data from blockchain to database:'}
              </p>
              <button
                type="button"
                onClick={handleSyncResults}
                disabled={syncLoading}
                className="px-6 py-3 bg-linear-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {syncLoading ? 'Syncing...' : 'Sync Results'}
              </button>
            </div>
          )}

          {/* Sync Results Display */}
          {syncResult && (
            <div className={`rounded-lg p-4 ${
              syncResult.ok
                ? 'bg-blue-500/10 border border-blue-500/30'
                : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <p className={`font-medium mb-2 ${syncResult.ok ? 'text-blue-400' : 'text-red-400'}`}>
                {syncResult.ok ? 'Sync Complete' : 'Sync Failed'}
              </p>
              {syncResult.ok && syncResult.results && syncResult.results.length > 0 ? (
                <div className="space-y-2">
                  {syncResult.results.map((r, idx) => (
                    <div key={idx} className="bg-black/30 p-3 rounded">
                      <p className="text-white text-sm">
                        Competition: <span className="font-mono">{r.competitionId}</span>
                      </p>
                      <p className={`text-sm ${
                        r.status === 'synced' ? 'text-green-400' :
                        r.status === 'waiting' ? 'text-yellow-400' : 'text-gray-400'
                      }`}>
                        Status: {r.status} {r.message && `- ${r.message}`}
                      </p>
                      {r.winnersCreated !== undefined && (
                        <p className="text-green-300 text-sm">
                          Winners synced: {r.winnersCreated}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : syncResult.ok ? (
                <p className="text-blue-300 text-sm">{syncResult.message || 'No competitions to sync'}</p>
              ) : (
                <p className="text-red-300 text-sm">{syncResult.error}</p>
              )}
            </div>
          )}

          {vrfState.active && !vrfState.drawn && !vrfState.isEnded && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-yellow-400 font-medium">
                ⏳ Competition is still running
              </p>
              <p className="text-yellow-300 text-sm mt-1">
                End time hasn't passed yet. Draw can be triggered after {vrfState.endTimeDate.toLocaleString()}.
              </p>
            </div>
          )}

          {vrfState.drawn && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-blue-400 font-medium">
                🎲 Winners already drawn
              </p>
              <p className="text-blue-300 text-sm mt-1">
                This competition has already had its winners selected via VRF.
              </p>
            </div>
          )}

          {!vrfState.active && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-400 font-medium">
                ❌ Competition is not active
              </p>
              <p className="text-red-300 text-sm mt-1">
                This competition is marked as inactive on-chain.
              </p>
            </div>
          )}
        </div>
      )}

      {!vrfState && !error && !loading && (
        <div className="text-center py-8">
          <p className="text-gray-400">
            Enter an on-chain competition ID to debug its VRF state
          </p>
          <p className="text-gray-500 text-sm mt-2">
            This tool reads directly from the Base mainnet blockchain
          </p>
        </div>
      )}
    </div>
  );
}

export default CompetitionDebugger;

import { useState, useMemo, useEffect, useCallback } from "react";
import FilterTabs from "../FilterButtons";
import EntriesTable from "./Entries";
import Heading from "../Heading";
import type { Options } from "../../models/models";
import { supabase } from "../../lib/supabase";
import { entriesLogger, requestTracker, showDebugHintOnError } from "../../lib/debug-console";
import { getCompetitionEntries } from "../../lib/supabase-rpc-helpers";
import { useSupabaseRealtimeMultiple } from "../../hooks/useSupabaseRealtime";

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidUuid = (value: string | undefined | null): boolean => {
  if (!value) return false;
  return UUID_REGEX.test(value);
};

interface EntriesWithFilterTabsProps {
  competitionId?: string;
  competitionUid?: string;
}

const EntriesWithFilterTabs = ({ competitionId, competitionUid }: EntriesWithFilterTabsProps = {}) => {
  const [entries, setEntries] = useState<Array<{ ticketNumber: number; date: string; walletAddress: string; username?: string; transactionHash?: string; vrfHash?: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Fetch real competition entries
  const fetchEntries = useCallback(async () => {
      // Get the ID to use, preferring competitionId if valid UUID
      const idToUse = competitionId || competitionUid;
      const startTime = Date.now();

      entriesLogger.group(`Fetching entries for competition`, true);

      // Skip query if no valid UUID to prevent 400 errors
      if (!idToUse || !isValidUuid(idToUse)) {
        entriesLogger.warn('Invalid or missing competition ID', { idToUse });
        setEntries([]);
        setLoading(false);
        entriesLogger.groupEnd();
        return;
      }

      try {
        setLoading(true);
        entriesLogger.info('Starting entries fetch', {
          competitionId: idToUse.slice(0, 8) + '...'
        });

        // Transform data to match expected format
        const transformedEntries: Array<{ ticketNumber: number; date: string; walletAddress: string; username?: string; transactionHash?: string; vrfHash?: string }> = [];

        // Collect wallet addresses for username lookup
        const walletAddresses = new Set<string>();

        // Map to store user IDs to their most recent top-up transaction hash
        const userToTopUpTxHash = new Map<string, string>();

        // Strategy 1: Try standard RPC function first (staging compatible with anon key)
        let rpcSucceeded = false;
        try {
          entriesLogger.request('get_competition_entries', {
            competition_identifier: idToUse.slice(0, 8) + '...'
          });

          const rpcStartTime = Date.now();
          // Try standard RPC first (non-bypass, if EXECUTE granted to anon)
          let rpcData: any[] | null = null;
          let rpcError: any = null;

          const { data: standardData, error: standardError } = await getCompetitionEntries(supabase, idToUse);

          if (!standardError && standardData) {
            rpcData = standardData;
          } else {
            // Fallback to bypass_rls version if standard fails (permission may not be granted)
            console.log('[EntriesWithFilterTabs] Standard RPC unavailable, trying bypass_rls');
            const { data: bypassData, error: bypassError } = await supabase
              .rpc('get_competition_entries_bypass_rls', {
                competition_identifier: idToUse
              });
            rpcData = bypassData;
            rpcError = bypassError;
          }

          if (!rpcError && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
            entriesLogger.success('RPC returned entries', {
              count: rpcData.length,
              duration: Date.now() - rpcStartTime
            });
            rpcSucceeded = true;

            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: 'get_competition_entries',
              method: 'RPC',
              success: true,
              duration: Date.now() - rpcStartTime
            });

            rpcData.forEach((entry: any) => {
              const wallet = entry.wallet_address || entry.privy_user_id || '';
              if (wallet && wallet.startsWith('0x')) {
                walletAddresses.add(wallet.toLowerCase());
              }

              // Get transaction hash - could be from crypto payment or stored in entry
              const txHash = entry.transactionhash || entry.transaction_hash || entry.vrf_hash || '';

              if (entry.ticketnumbers) {
                const ticketNumbers = entry.ticketnumbers
                  .split(',')
                  .map((t: string) => parseInt(t.trim()))
                  .filter((t: number) => !isNaN(t));

                ticketNumbers.forEach((ticketNum: number) => {
                  transformedEntries.push({
                    ticketNumber: ticketNum,
                    date: new Date(entry.purchasedate).toLocaleString('en-US', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false
                    }),
                    walletAddress: wallet || 'Unknown',
                    username: entry.username || undefined,
                    transactionHash: txHash || undefined
                  });
                });
              }
            });
          } else if (rpcError) {
            entriesLogger.rpcError('get_competition_entries', rpcError, 'direct v_joincompetition_active query');
            showDebugHintOnError();

            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: 'get_competition_entries',
              method: 'RPC',
              success: false,
              error: rpcError.message,
              errorCode: 404,
              duration: Date.now() - rpcStartTime
            });
          }
        } catch (rpcErr) {
          entriesLogger.error('RPC function exception', rpcErr);
          showDebugHintOnError();
        }

        // Strategy 2: Query v_joincompetition_active directly if RPC failed or returned no data
        // Try multiple ID formats since competitionid might be stored as UUID or legacy uid
        if (!rpcSucceeded || transformedEntries.length === 0) {
          entriesLogger.info('Trying direct v_joincompetition_active query');

          // First try exact match
          let jcData: any[] | null = null;
          let jcError: any = null;

          const exactStartTime = Date.now();
          const { data: exactData, error: exactError } = await supabase
            .from('v_joincompetition_active')
            .select('ticketnumbers, purchasedate, wallet_address, userid, canonical_user_id, transactionhash')
            .eq('competitionid', idToUse);

          if (!exactError && exactData && exactData.length > 0) {
            jcData = exactData;
            entriesLogger.success('Exact competitionid match found', {
              count: exactData.length,
              duration: Date.now() - exactStartTime
            });

            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: 'v_joincompetition_active.select',
              method: 'QUERY',
              success: true,
              duration: Date.now() - exactStartTime
            });
          } else {
            // If no exact match, try with competition uid lookup
            // Some entries might be stored with the uid instead of the id
            entriesLogger.debug('No exact match, trying uid lookup');

            const { data: compData } = await supabase
              .from('competitions')
              .select('uid')
              .eq('id', idToUse)
              .single();

            if (compData?.uid && compData.uid !== idToUse) {
              const uidStartTime = Date.now();
              const { data: uidData, error: uidError } = await supabase
                .from('v_joincompetition_active')
                .select('ticketnumbers, purchasedate, wallet_address, userid, canonical_user_id, transactionhash')
                .eq('competitionid', compData.uid);

              if (!uidError && uidData && uidData.length > 0) {
                jcData = uidData;
                entriesLogger.success('Found entries by competition uid', {
                  count: uidData.length,
                  duration: Date.now() - uidStartTime
                });

                requestTracker.addRequest({
                  timestamp: Date.now(),
                  endpoint: 'v_joincompetition_active.select.by_uid',
                  method: 'QUERY',
                  success: true,
                  duration: Date.now() - uidStartTime
                });
              }
            }

            if (!jcData || jcData.length === 0) {
              jcError = exactError;
            }
          }

          if (jcData && jcData.length > 0) {
            entriesLogger.info('Direct v_joincompetition_active query returned data', {
              count: jcData.length
            });

            jcData.forEach((entry: any) => {
              const wallet = entry.wallet_address || entry.userid || '';
              if (wallet && wallet.startsWith('0x')) {
                walletAddresses.add(wallet.toLowerCase());
              }

              // Get transaction hash from entry
              const txHash = entry.transactionhash || entry.transaction_hash || '';

              if (entry.ticketnumbers) {
                const ticketNumbers = entry.ticketnumbers
                  .split(',')
                  .map((t: string) => parseInt(t.trim()))
                  .filter((t: number) => !isNaN(t));

                ticketNumbers.forEach((ticketNum: number) => {
                  // Check if this ticket already exists (avoid duplicates)
                  if (!transformedEntries.some(e => e.ticketNumber === ticketNum)) {
                    transformedEntries.push({
                      ticketNumber: ticketNum,
                      date: entry.purchasedate ? new Date(entry.purchasedate).toLocaleString('en-US', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                      }) : 'Unknown',
                      walletAddress: wallet || 'Unknown',
                      transactionHash: txHash || undefined
                    });
                  }
                });
              }
            });
          } else if (jcError) {
            entriesLogger.warn('v_joincompetition_active query error', jcError);

            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: 'v_joincompetition_active.select',
              method: 'QUERY',
              success: false,
              error: jcError.message
            });
          }
        }

        // Strategy 3: Query tickets table directly as fallback
        if (transformedEntries.length === 0) {
          entriesLogger.info('Trying tickets table fallback');

          const ticketsStartTime = Date.now();
          const { data: ticketsData, error: ticketsError } = await supabase
            .from('tickets')
            .select('ticket_number, created_at, privy_user_id, user_id, transaction_hash')
            .eq('competition_id', idToUse);

          if (!ticketsError && ticketsData && ticketsData.length > 0) {
            entriesLogger.success('Tickets table returned data', {
              count: ticketsData.length,
              duration: Date.now() - ticketsStartTime
            });

            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: 'tickets.select',
              method: 'QUERY',
              success: true,
              duration: Date.now() - ticketsStartTime
            });

            ticketsData.forEach((ticket: any) => {
              const wallet = ticket.user_id || ticket.privy_user_id || '';
              if (wallet && wallet.startsWith('0x')) {
                walletAddresses.add(wallet.toLowerCase());
              }

              if (ticket.ticket_number != null) {
                const ticketNum = parseInt(ticket.ticket_number);
                if (!isNaN(ticketNum) && !transformedEntries.some(e => e.ticketNumber === ticketNum)) {
                  transformedEntries.push({
                    ticketNumber: ticketNum,
                    date: ticket.created_at ? new Date(ticket.created_at).toLocaleString('en-US', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false
                    }) : 'Unknown',
                    walletAddress: wallet || 'Unknown',
                    transactionHash: ticket.transaction_hash || undefined
                  });
                }
              }
            });
          } else if (ticketsError) {
            entriesLogger.warn('tickets table query error', ticketsError);

            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: 'tickets.select',
              method: 'QUERY',
              success: false,
              error: ticketsError.message
            });
          }
        }

        // Strategy 4: Query pending_tickets table (used for confirmed purchases, kept for posterity)
        // Note: Despite the name, pending_tickets now contains confirmed entries
        entriesLogger.info('Querying pending_tickets table');
        const pendingStartTime = Date.now();
        const { data: pendingData, error: pendingError } = await supabase
          .from('pending_tickets')
          .select('ticket_numbers, created_at, canonical_user_id, wallet_address, transaction_hash, status, user_id')
          .eq('competition_id', idToUse);

        if (!pendingError && pendingData && pendingData.length > 0) {
          entriesLogger.success('pending_tickets table returned data', {
            count: pendingData.length,
            duration: Date.now() - pendingStartTime
          });

          pendingData.forEach((pending: any) => {
            const wallet = pending.wallet_address || pending.canonical_user_id || pending.user_id || '';
            if (wallet && wallet.startsWith('0x')) {
              walletAddresses.add(wallet.toLowerCase());
            }

            // Parse ticket_numbers - could be JSON array string like '["516"]' or comma-separated
            let ticketNumbers: number[] = [];
            if (pending.ticket_numbers) {
              try {
                // Try parsing as JSON array first
                const parsed = JSON.parse(pending.ticket_numbers);
                if (Array.isArray(parsed)) {
                  ticketNumbers = parsed.map((t: string | number) => parseInt(String(t).trim())).filter((t: number) => !isNaN(t));
                }
              } catch {
                // Fall back to comma-separated parsing
                ticketNumbers = String(pending.ticket_numbers)
                  .split(',')
                  .map((t: string) => parseInt(t.trim()))
                  .filter((t: number) => !isNaN(t));
              }
            }

            ticketNumbers.forEach((ticketNum: number) => {
              // Check if this ticket already exists (avoid duplicates)
              if (!transformedEntries.some(e => e.ticketNumber === ticketNum)) {
                transformedEntries.push({
                  ticketNumber: ticketNum,
                  date: pending.created_at ? new Date(pending.created_at).toLocaleString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                  }) : 'Unknown',
                  walletAddress: wallet || 'Unknown',
                  transactionHash: pending.transaction_hash || undefined
                });
              }
            });
          });
        } else if (pendingError) {
          entriesLogger.warn('pending_tickets table query error', pendingError);
        }

        // Fetch usernames for all wallet addresses from multiple sources
        if (walletAddresses.size > 0) {
          try {
            const walletArray = Array.from(walletAddresses);

            // First try: Query canonical_users with direct wallet_address match
            const { data: usersData } = await supabase
              .from('canonical_users')
              .select('wallet_address, username, canonical_user_id, base_wallet_address')
              .or(`wallet_address.in.(${walletArray.map(w => `"${w}"`).join(',')}),base_wallet_address.in.(${walletArray.map(w => `"${w}"`).join(',')})`);

            const walletToUsername = new Map<string, string>();
            const walletToAddress = new Map<string, string>();

            if (usersData && usersData.length > 0) {
              usersData.forEach((user: any) => {
                if (user.wallet_address) {
                  const lowercaseWallet = user.wallet_address.toLowerCase();
                  if (user.username) {
                    walletToUsername.set(lowercaseWallet, user.username);
                  }
                  walletToAddress.set(lowercaseWallet, user.wallet_address);
                }
                if (user.base_wallet_address) {
                  const lowercaseBase = user.base_wallet_address.toLowerCase();
                  if (user.username) {
                    walletToUsername.set(lowercaseBase, user.username);
                  }
                  walletToAddress.set(lowercaseBase, user.base_wallet_address);
                }
              });
            }

            // Second try: Look up by canonical_user_id in joincompetition entries
            // Get canonical_user_ids from entries and look them up
            const canonicalIds = new Set<string>();
            transformedEntries.forEach(entry => {
              if (entry.walletAddress && entry.walletAddress.startsWith('prize:pid:')) {
                canonicalIds.add(entry.walletAddress);
              }
            });

            if (canonicalIds.size > 0) {
              const canonicalArray = Array.from(canonicalIds);
              const { data: canonicalUsersData } = await supabase
                .from('canonical_users')
                .select('wallet_address, username, canonical_user_id, base_wallet_address')
                .in('canonical_user_id', canonicalArray);

              if (canonicalUsersData && canonicalUsersData.length > 0) {
                canonicalUsersData.forEach((user: any) => {
                  if (user.canonical_user_id) {
                    if (user.username) {
                      walletToUsername.set(user.canonical_user_id.toLowerCase(), user.username);
                    }
                    if (user.wallet_address) {
                      walletToAddress.set(user.canonical_user_id.toLowerCase(), user.wallet_address);
                    }
                  }
                });
              }
            }

            // Third try: Query joincompetition for this competition to get wallet/user mapping
            const { data: joinData } = await supabase
              .from('joincompetition')
              .select('wallet_address, userid, canonical_user_id')
              .eq('competitionid', idToUse);

            if (joinData && joinData.length > 0) {
              // Collect all user IDs to lookup
              const userIds = new Set<string>();
              joinData.forEach((entry: any) => {
                if (entry.userid) userIds.add(entry.userid);
                if (entry.canonical_user_id) userIds.add(entry.canonical_user_id);
              });

              // Look up these users
              if (userIds.size > 0) {
                const userIdArray = Array.from(userIds);
                const { data: moreUsersData } = await supabase
                  .from('canonical_users')
                  .select('wallet_address, username, canonical_user_id, base_wallet_address')
                  .or(`canonical_user_id.in.(${userIdArray.map(u => `"${u}"`).join(',')}),wallet_address.in.(${userIdArray.map(u => `"${u}"`).join(',')})`);

                if (moreUsersData && moreUsersData.length > 0) {
                  moreUsersData.forEach((user: any) => {
                    if (user.wallet_address) {
                      const lowercaseWallet = user.wallet_address.toLowerCase();
                      if (user.username && !walletToUsername.has(lowercaseWallet)) {
                        walletToUsername.set(lowercaseWallet, user.username);
                      }
                    }
                    if (user.canonical_user_id) {
                      const lowercaseId = user.canonical_user_id.toLowerCase();
                      if (user.username && !walletToUsername.has(lowercaseId)) {
                        walletToUsername.set(lowercaseId, user.username);
                      }
                      if (user.wallet_address && !walletToAddress.has(lowercaseId)) {
                        walletToAddress.set(lowercaseId, user.wallet_address);
                      }
                    }
                  });
                }
              }
            }

            // Update entries with usernames and wallet addresses
            transformedEntries.forEach(entry => {
              if (entry.walletAddress) {
                const lowercaseWallet = entry.walletAddress.toLowerCase();

                // Try to get username
                const username = walletToUsername.get(lowercaseWallet);
                if (username) {
                  entry.username = username;
                }

                // If wallet is not a proper 0x address, try to resolve it
                if (!entry.walletAddress.startsWith('0x') || entry.walletAddress === 'Unknown') {
                  const resolvedAddress = walletToAddress.get(lowercaseWallet);
                  if (resolvedAddress && resolvedAddress.startsWith('0x')) {
                    entry.walletAddress = resolvedAddress;
                  }
                }
              }
            });
          } catch (userErr) {
            entriesLogger.warn('Failed to fetch usernames', userErr);
          }
        }

        // For entries without transaction hashes, try to fetch from user's most recent top-up
        // This handles balance payments where the tx hash isn't directly on the entry
        const entriesWithoutTxHash = transformedEntries.filter(e => !e.transactionHash);
        if (entriesWithoutTxHash.length > 0) {
          try {
            // Collect unique user identifiers that need tx hash lookup
            const usersNeedingTxHash = new Set<string>();
            entriesWithoutTxHash.forEach(entry => {
              if (entry.walletAddress && entry.walletAddress !== 'Unknown') {
                usersNeedingTxHash.add(entry.walletAddress.toLowerCase());
              }
            });

            if (usersNeedingTxHash.size > 0) {
              const userArray = Array.from(usersNeedingTxHash);

              // Query pending_tickets for the most recent tx hash per user (from top-ups)
              const { data: topUpData } = await supabase
                .from('pending_tickets')
                .select('canonical_user_id, wallet_address, user_id, transaction_hash, created_at')
                .not('transaction_hash', 'is', null)
                .order('created_at', { ascending: false });

              if (topUpData && topUpData.length > 0) {
                // Build map of user identifier -> most recent tx hash
                const userToTxHash = new Map<string, string>();
                topUpData.forEach((record: any) => {
                  const identifiers = [
                    record.canonical_user_id?.toLowerCase(),
                    record.wallet_address?.toLowerCase(),
                    record.user_id?.toLowerCase()
                  ].filter(Boolean);

                  identifiers.forEach(id => {
                    if (id && record.transaction_hash && !userToTxHash.has(id)) {
                      userToTxHash.set(id, record.transaction_hash);
                    }
                  });
                });

                // Update entries with the fetched tx hashes
                entriesWithoutTxHash.forEach(entry => {
                  if (entry.walletAddress && !entry.transactionHash) {
                    const txHash = userToTxHash.get(entry.walletAddress.toLowerCase());
                    if (txHash) {
                      entry.transactionHash = txHash;
                    }
                  }
                });
              }
            }
          } catch (txHashErr) {
            entriesLogger.warn('Failed to fetch top-up tx hashes', txHashErr);
          }
        }

        // Sort by ticket number
        transformedEntries.sort((a, b) => a.ticketNumber - b.ticketNumber);

        entriesLogger.successWithTiming('Entries fetch complete', startTime, {
          finalCount: transformedEntries.length,
          strategies: {
            rpcSucceeded,
            usedFallbacks: !rpcSucceeded
          }
        });

        setEntries(transformedEntries);
      } catch (error) {
        entriesLogger.error('Error in fetchEntries', error);
        showDebugHintOnError();
        setEntries([]);
      } finally {
        setLoading(false);
        entriesLogger.groupEnd();
      }
    };

    fetchEntries();
  }, [fetchEntries]);

  // Subscribe to realtime updates for this competition's tickets and transactions
  const idToUse = competitionId || competitionUid;
  const shouldSubscribe = idToUse && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idToUse);

  useSupabaseRealtimeMultiple([
    {
      table: 'tickets',
      handlers: {
        onInsert: (payload) => {
          if (payload.new.competition_id === idToUse) {
            console.log('[EntriesWithFilterTabs] New ticket detected, refreshing entries');
            fetchEntries();
          }
        }
      }
    },
    {
      table: 'user_transactions',
      handlers: {
        onInsert: (payload) => {
          if (payload.new.competition_id === idToUse) {
            console.log('[EntriesWithFilterTabs] New transaction detected, refreshing entries');
            fetchEntries();
          }
        }
      }
    },
    {
      table: 'balance_ledger',
      handlers: {
        onInsert: () => {
          console.log('[EntriesWithFilterTabs] Balance ledger updated, refreshing entries');
          fetchEntries();
        }
      }
    }
  ], shouldSubscribe);

  useEffect(() => {
    fetchEntries();
  }, [competitionId, competitionUid]);

  // Dynamically determine filter ranges based on entries
  const maxTicketNumber = useMemo(() => {
    if (entries.length === 0) return 5000;
    return Math.max(...entries.map(e => e.ticketNumber));
  }, [entries]);

  const filterOptions: Options[] = useMemo(() => {
    const rangeSize = 500;
    const numRanges = Math.ceil(maxTicketNumber / rangeSize);
    const options: Options[] = [];

    for (let i = 0; i < Math.min(numRanges, 10); i++) {
      const start = i * rangeSize + 1;
      const end = (i + 1) * rangeSize;
      options.push({
        key: `${start}-${end}`,
        label: `${start} - ${end}`,
        range: [start, end]
      });
    }

    return options;
  }, [maxTicketNumber]);

  // --- Tabs setup ---
  const [activeFilter, setActiveFilter] = useState<Options>(filterOptions[0]);

  // Update active filter when options change
  useEffect(() => {
    if (filterOptions.length > 0 && !filterOptions.find(opt => opt.key === activeFilter?.key)) {
      setActiveFilter(filterOptions[0]);
    }
  }, [filterOptions, activeFilter?.key]);

  // --- Filtered list based on selected tab ---
  const filteredEntries = useMemo(() => {
    if (!activeFilter?.range) return entries;

    const [min, max] = activeFilter.range as number[];
    return entries.filter(
      (e) =>
        Number(e.ticketNumber) >= min &&
        Number(e.ticketNumber) <= max
    );
  }, [activeFilter, entries]);

  if (loading) {
    return (
      <div className="py-10 space-y-8 max-w-7xl mx-auto">
        <Heading text="Entries" classes="text-white sequel-95"/>
        <div className="text-center text-white/50 sequel-45 py-10">
          Loading entries...
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 space-y-8 max-w-7xl mx-auto">
      <Heading text="Entries" classes="text-white sequel-95"/>
      {entries.length === 0 ? (
        <div className="text-center text-white/50 sequel-45 py-10 border-2 border-[#DDE404] rounded-2xl">
          No entries yet for this competition. Be the first to enter!
        </div>
      ) : (
        <>
          <div className="my-10">
            <FilterTabs
              options={filterOptions}
              active={activeFilter}
              onChange={setActiveFilter}
              containerClasses="grid xl:grid-cols-5 lg:grid-cols-4 md:grid-cols-3 grid-cols-2 gap-3"
              buttonClasses=" border-none"
            />
          </div>
          <EntriesTable entries={filteredEntries} />
        </>
      )}
    </div>
  );
};

export default EntriesWithFilterTabs;

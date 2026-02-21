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
  const [totalTickets, setTotalTickets] = useState<number | null>(null);

  // Fetch competition data to get total_tickets
  const fetchCompetitionData = useCallback(async () => {
    const idToUse = competitionId || competitionUid;
    
    if (!idToUse || !isValidUuid(idToUse)) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('competitions')
        .select('total_tickets')
        .eq('id', idToUse)
        .single() as any;

      if (!error && data) {
        setTotalTickets((data as any).total_tickets || null);
      }
    } catch (error) {
      console.error('[EntriesWithFilterTabs] Error fetching competition data:', error);
    }
  }, [competitionId, competitionUid]);

  // Fetch competition data on mount
  useEffect(() => {
    fetchCompetitionData();
  }, [fetchCompetitionData]);

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

        // Track ticket numbers we've already added to prevent duplicates (O(1) lookup)
        const seenTicketNumbers = new Set<number>();

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

          const { data: standardData, error: standardError } = await getCompetitionEntries(supabase, idToUse) as any;

          if (!standardError && standardData) {
            rpcData = standardData;
          } else {
            // Fallback to bypass_rls version if standard fails (permission may not be granted)
            console.log('[EntriesWithFilterTabs] Standard RPC unavailable, trying bypass_rls');
            const { data: bypassData, error: bypassError } = await supabase
              .rpc('get_competition_entries_bypass_rls', {
                competition_identifier: idToUse
              } as any);
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
              // DEBUG: Log first entry to see actual field names
              if (rpcData.indexOf(entry) === 0) {
                console.log('[EntriesWithFilterTabs] First RPC entry fields:', Object.keys(entry));
                console.log('[EntriesWithFilterTabs] First RPC entry data:', JSON.stringify(entry, null, 2));
              }
              
              // RPC returns walletaddress (no underscore), view returns wallet_address
              // Also check userid which may contain the wallet address
              // canonical_user_id format is 'prize:pid:' + wallet_address
              let wallet = entry.walletaddress || entry.wallet_address || entry.userid || entry.user_id || entry.privy_user_id || '';
              
              // Extract wallet from canonical_user_id if present
              if ((!wallet || !wallet.startsWith('0x')) && entry.canonical_user_id && entry.canonical_user_id.startsWith('prize:pid:')) {
                wallet = entry.canonical_user_id.substring(10); // Remove 'prize:pid:' prefix
              }
              
              if (wallet && wallet.startsWith('0x')) {
                walletAddresses.add(wallet.toLowerCase());
              }

              // Get transaction hash - could be from crypto payment or stored in entry
              const txHash = entry.transactionhash || entry.transaction_hash || entry.vrf_hash || '';

              // RPC returns ticketnumbers (no underscore), view returns ticket_numbers
              const ticketNumbersStr = entry.ticketnumbers || entry.ticket_numbers;
              if (ticketNumbersStr) {
                const ticketNumbers = ticketNumbersStr
                  .split(',')
                  .map((t: string) => parseInt(t.trim()))
                  .filter((t: number) => !isNaN(t));

                ticketNumbers.forEach((ticketNum: number) => {
                  if (!seenTicketNumbers.has(ticketNum)) {
                    seenTicketNumbers.add(ticketNum);
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
                  }
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
            .select('ticket_numbers, purchasedate, wallet_address, user_id, canonical_user_id, transactionhash')
            .eq('competition_id', idToUse);

          if (!exactError && exactData && exactData.length > 0) {
            jcData = exactData;
            entriesLogger.success('Exact competition_id match found', {
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
              .single() as any;

            if (compData?.uid && compData.uid !== idToUse) {
              const uidStartTime = Date.now();
              const { data: uidData, error: uidError } = await supabase
                .from('v_joincompetition_active')
                .select('ticket_numbers, purchasedate, wallet_address, user_id, canonical_user_id, transactionhash')
                .eq('competition_id', compData.uid);

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
              // DEBUG: Log first entry to see actual field names
              if (jcData.indexOf(entry) === 0) {
                console.log('[EntriesWithFilterTabs] First v_jc entry fields:', Object.keys(entry));
                console.log('[EntriesWithFilterTabs] First v_jc entry data:', JSON.stringify(entry, null, 2));
              }
              
              // View has wallet_address and user_id (with underscores)
              // canonical_user_id format is 'prize:pid:' + wallet_address
              let wallet = entry.wallet_address || entry.user_id || entry.userid || '';
              
              // Extract wallet from canonical_user_id if present
              if ((!wallet || !wallet.startsWith('0x')) && entry.canonical_user_id && entry.canonical_user_id.startsWith('prize:pid:')) {
                wallet = entry.canonical_user_id.substring(10); // Remove 'prize:pid:' prefix
              }
              
              if (wallet && wallet.startsWith('0x')) {
                walletAddresses.add(wallet.toLowerCase());
              }

              // Get transaction hash from entry
              const txHash = entry.transactionhash || entry.transaction_hash || '';

              // View may have ticket_numbers or ticketnumbers
              const ticketNumbersStr = entry.ticket_numbers || entry.ticketnumbers;
              if (ticketNumbersStr) {
                const ticketNumbers = ticketNumbersStr
                  .split(',')
                  .map((t: string) => parseInt(t.trim()))
                  .filter((t: number) => !isNaN(t));

                ticketNumbers.forEach((ticketNum: number) => {
                  if (!seenTicketNumbers.has(ticketNum)) {
                    seenTicketNumbers.add(ticketNum);
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
            .select('ticket_number, created_at, privy_user_id, user_id, wallet_address, canonical_user_id, transaction_hash')
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
              // Check wallet_address first as it's the most reliable
              // canonical_user_id format is 'prize:pid:' + wallet_address
              let wallet = ticket.wallet_address || ticket.user_id || ticket.privy_user_id || '';
              
              // Extract wallet from canonical_user_id if present
              if ((!wallet || !wallet.startsWith('0x')) && ticket.canonical_user_id && ticket.canonical_user_id.startsWith('prize:pid:')) {
                wallet = ticket.canonical_user_id.substring(10); // Remove 'prize:pid:' prefix
              }
              
              if (wallet && wallet.startsWith('0x')) {
                walletAddresses.add(wallet.toLowerCase());
              }

              if (ticket.ticket_number != null) {
                const ticketNum = parseInt(ticket.ticket_number);
                if (!isNaN(ticketNum) && !seenTicketNumbers.has(ticketNum)) {
                  seenTicketNumbers.add(ticketNum);
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
            // canonical_user_id format is 'prize:pid:' + wallet_address
            let wallet = pending.wallet_address || pending.user_id || '';
            
            // Extract wallet from canonical_user_id if present
            if ((!wallet || !wallet.startsWith('0x')) && pending.canonical_user_id && pending.canonical_user_id.startsWith('prize:pid:')) {
              wallet = pending.canonical_user_id.substring(10); // Remove 'prize:pid:' prefix
            }
            
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
              if (!seenTicketNumbers.has(ticketNum)) {
                seenTicketNumbers.add(ticketNum);
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
                .in('canonical_user_id', canonicalArray) as any;

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
              .select('wallet_address, user_id, canonical_user_id')
              .eq('competition_id', idToUse);

            if (joinData && joinData.length > 0) {
              // Collect all user IDs to lookup
              const userIds = new Set<string>();
              joinData.forEach((entry: any) => {
                if (entry.user_id) userIds.add(entry.user_id);
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

            // CRITICAL FIX: For entries with Unknown wallet, query tickets table directly by ticket number
            const entriesNeedingWallet = transformedEntries.filter(e => !e.walletAddress || e.walletAddress === 'Unknown' || !e.walletAddress.startsWith('0x'));
            if (entriesNeedingWallet.length > 0) {
              const ticketNumbersToLookup = entriesNeedingWallet.map(e => e.ticketNumber);
              console.log('[EntriesWithFilterTabs] Looking up wallet addresses for', ticketNumbersToLookup.length, 'entries');
              
              const { data: ticketWalletData, error: ticketLookupError } = await supabase
                .from('tickets')
                .select('ticket_number, wallet_address, canonical_user_id, user_id')
                .eq('competition_id', idToUse)
                .in('ticket_number', ticketNumbersToLookup);
              
              if (!ticketLookupError && ticketWalletData && ticketWalletData.length > 0) {
                console.log('[EntriesWithFilterTabs] Found wallet data for', ticketWalletData.length, 'tickets');
                console.log('[EntriesWithFilterTabs] First ticket wallet data:', JSON.stringify(ticketWalletData[0], null, 2));
                
                // Build ticket number -> wallet address map
                const ticketToWallet = new Map<number, string>();
                ticketWalletData.forEach((t: any) => {
                  let wallet = t.wallet_address || '';
                  // Extract wallet from canonical_user_id if needed
                  if ((!wallet || !wallet.startsWith('0x')) && t.canonical_user_id && t.canonical_user_id.startsWith('prize:pid:')) {
                    wallet = t.canonical_user_id.substring(10);
                  }
                  // Try user_id as fallback
                  if ((!wallet || !wallet.startsWith('0x')) && t.user_id && t.user_id.startsWith('0x')) {
                    wallet = t.user_id;
                  }
                  if (wallet && wallet.startsWith('0x') && t.ticket_number != null) {
                    ticketToWallet.set(parseInt(t.ticket_number), wallet);
                    walletAddresses.add(wallet.toLowerCase());
                  }
                });
                
                // Update entries with resolved wallet addresses
                entriesNeedingWallet.forEach(entry => {
                  const resolvedWallet = ticketToWallet.get(entry.ticketNumber);
                  if (resolvedWallet) {
                    entry.walletAddress = resolvedWallet;
                  }
                });
                
                // Fetch usernames for the newly resolved wallet addresses
                const newWallets = Array.from(walletAddresses).filter(w => !walletToUsername.has(w));
                if (newWallets.length > 0) {
                  const { data: newUsersData } = await supabase
                    .from('canonical_users')
                    .select('wallet_address, username, canonical_user_id, base_wallet_address')
                    .or(`wallet_address.in.(${newWallets.map(w => `"${w}"`).join(',')}),base_wallet_address.in.(${newWallets.map(w => `"${w}"`).join(',')})`);
                  
                  if (newUsersData && newUsersData.length > 0) {
                    newUsersData.forEach((user: any) => {
                      if (user.wallet_address) {
                        const lowercaseWallet = user.wallet_address.toLowerCase();
                        if (user.username) {
                          walletToUsername.set(lowercaseWallet, user.username);
                        }
                      }
                      if (user.base_wallet_address) {
                        const lowercaseBase = user.base_wallet_address.toLowerCase();
                        if (user.username) {
                          walletToUsername.set(lowercaseBase, user.username);
                        }
                      }
                    });
                  }
                }
              } else if (ticketLookupError) {
                console.warn('[EntriesWithFilterTabs] Ticket wallet lookup error:', ticketLookupError);
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
                .order('created_at', { ascending: false } as any);

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
    }, [competitionId, competitionUid]);

  // Initial fetch
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Subscribe to realtime updates for this competition's tickets and transactions
  const idToUse = competitionId || competitionUid;
  const shouldSubscribe = !!(idToUse && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idToUse));

  // Debounced fetch to prevent rapid re-fetches when multiple tickets are inserted
  const fetchEntriesDebounced = useMemo(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fetchEntries();
      }, 500); // Wait 500ms after last event before fetching
    };
  }, [fetchEntries]);

  useSupabaseRealtimeMultiple([
    {
      table: 'tickets',
      handlers: {
        onInsert: (payload) => {
          if (payload.new.competition_id === idToUse) {
            console.log('[EntriesWithFilterTabs] New ticket detected, refreshing entries (debounced)');
            fetchEntriesDebounced();
          }
        }
      }
    },
    {
      table: 'user_transactions',
      handlers: {
        onInsert: (payload) => {
          if (payload.new.competition_id === idToUse) {
            console.log('[EntriesWithFilterTabs] New transaction detected, refreshing entries (debounced)');
            fetchEntriesDebounced();
          }
        }
      }
    }
    // Note: Removed balance_ledger subscription - it was triggering on ALL ledger entries globally
    // and is not relevant to competition entries display
  ], shouldSubscribe);

  // Dynamically determine filter ranges based on entries or competition total_tickets
  const maxTicketNumber = useMemo(() => {
    // Use total_tickets from competition if available, otherwise fall back to max entry number or 5000
    if (totalTickets && totalTickets > 0) {
      return totalTickets;
    }
    if (entries.length === 0) return 5000;
    return Math.max(...entries.map(e => e.ticketNumber));
  }, [entries, totalTickets]);

  // Constants for pagination
  const TICKETS_PER_RANGE = 500;
  const MAX_TABS_PER_PAGE = 10; // Show 10 ranges (5000 tickets) per page

  const filterOptions: Options[] = useMemo(() => {
    const rangeSize = TICKETS_PER_RANGE;
    const numRanges = Math.ceil(maxTicketNumber / rangeSize);
    const options: Options[] = [];

    // Remove the limit of 10 ranges to support full pagination
    for (let i = 0; i < numRanges; i++) {
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

  // --- Pagination for filter tabs ---
  const [tabPage, setTabPage] = useState(0);
  
  const totalTabPages = Math.ceil(filterOptions.length / MAX_TABS_PER_PAGE);
  const paginatedFilterOptions = useMemo(() => {
    const startIdx = tabPage * MAX_TABS_PER_PAGE;
    const endIdx = startIdx + MAX_TABS_PER_PAGE;
    return filterOptions.slice(startIdx, endIdx);
  }, [filterOptions, tabPage]);

  // --- Tabs setup ---
  const [activeFilter, setActiveFilter] = useState<Options>(filterOptions[0]);

  // Update active filter when options change
  useEffect(() => {
    if (filterOptions.length > 0 && !filterOptions.find(opt => opt.key === activeFilter?.key)) {
      setActiveFilter(filterOptions[0]);
    }
  }, [filterOptions, activeFilter?.key]);
  
  // Reset to first page when filter options change significantly
  useEffect(() => {
    if (tabPage >= totalTabPages && totalTabPages > 0) {
      setTabPage(0);
    }
  }, [totalTabPages, tabPage]);

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
          {/* Pagination info and controls for large competitions */}
          {totalTabPages > 1 && (
            <div className="flex items-center justify-between bg-[#1a1a1a] border border-[#DDE404] rounded-lg p-4 mb-4">
              <div className="text-white sequel-45 text-sm">
                Showing ticket ranges {(tabPage * MAX_TABS_PER_PAGE * TICKETS_PER_RANGE) + 1} - {Math.min((tabPage + 1) * MAX_TABS_PER_PAGE * TICKETS_PER_RANGE, maxTicketNumber)}
                <span className="text-white/50 ml-2">
                  (Page {tabPage + 1} of {totalTabPages})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTabPage(p => Math.max(0, p - 1))}
                  disabled={tabPage === 0}
                  className="px-4 py-2 bg-[#DDE404] text-black sequel-45 text-sm rounded hover:bg-[#DDE404]/90 disabled:bg-[#2a2a2a] disabled:text-white/30 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setTabPage(p => Math.min(totalTabPages - 1, p + 1))}
                  disabled={tabPage >= totalTabPages - 1}
                  className="px-4 py-2 bg-[#DDE404] text-black sequel-45 text-sm rounded hover:bg-[#DDE404]/90 disabled:bg-[#2a2a2a] disabled:text-white/30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          
          <div className="my-10">
            <FilterTabs
              options={paginatedFilterOptions}
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

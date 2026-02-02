import { supabase } from './supabase';
import { withRetry, handleDatabaseError } from './error-handler';
import { databaseLogger, requestTracker, showDebugHintOnError } from './debug-console';
import {
  resolveUserIdentity,
  buildIdentityFilter,
  type ResolvedIdentity,
} from './identity';
import {
  isCompetitionVisible,
  COMPETITION_VISIBILITY_CUTOFF,
} from './appConfig';
import { userIdsEqual, normalizeWalletAddress, toPrizePid, isWalletAddress } from '../utils/userId';
import { getDashboardEntries, getUnavailableTickets, getUserCompetitionEntries } from './supabase-rpc-helpers';
import type {
  WinnerCardProps,
  Faq,
  EntryCard,
  PurchaseOrder,
  TableRow
} from '../models/models';
import {
  ethTier,
  btcTier,
  solTier,
  tierOne,
  bitcoinImage,
  watchImage,
  sportsCar,
  monkeyNft,
  nft
} from '../assets/images';
import { VALID_AVATAR_FILENAMES, SUPABASE_AVATAR_BASE_URL } from './avatarConstants';

// ISSUE #5 FIX: Visibility configuration is now centralized in src/lib/appConfig.ts
// Use isCompetitionVisible() to check if a competition should be shown

const imageMap: Record<string, string> = {
  'eth tier 1.png': ethTier,
  'eth tier 2.png': ethTier,
  'eth tier 3.png': ethTier,
  'ethtier1.png': ethTier,
  'ethtier2.png': ethTier,
  'ethtier3.png': ethTier,
  'ethtier3.jpg': ethTier,
  'btc tier 1.png': btcTier,
  'btc tier 2.png': btcTier,
  'btc tier 3.png': btcTier,
  'btctier1.png': btcTier,
  'btctier2.png': btcTier,
  'btctier2.jpg': btcTier,
  'sol tier 1.png': solTier,
  'sol tier 2.png': solTier,
  'soltier1.png': solTier,
  'soltier1.jpg': solTier,
  'tier1.jpg': tierOne,
  'bitcoin.webp': bitcoinImage,
  'watch.webp': watchImage,
  'car.webp': sportsCar,
  'monkey.webp': monkeyNft,
  'nft.webp': nft,
};

function getImageUrl(imageUrl: string | null): string {
  if (!imageUrl) return '';

  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    // Fix malformed Supabase Competition Images URLs
    // The correct path is: Competition%20Images/Competition%20Images/<filename>
    // But some URLs are stored as: Competition%20Images/<filename> (missing the subfolder)
    const supabasePattern = /supabase\.co\/storage\/v1\/object\/public\/Competition%20Images\/([^/]+\.(jpg|jpeg|png|gif|webp|svg|bmp))$/i;
    const match = imageUrl.match(supabasePattern);
    if (match) {
      // URL is missing the "Competition Images" subfolder - fix it
      const filename = match[1];
      return `https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/${filename}`;
    }
    return imageUrl;
  }

  const filename = imageUrl.split('/').pop()?.toLowerCase() || '';
  const mapped = imageMap[filename];
  return mapped || imageUrl;
}

/**
 * Transform a joincompetition row to the expected entry format
 */
function transformJoinCompetitionEntry(jc: any, identity: ResolvedIdentity): any {
  const comp = jc.competitions;
  const compStatus = comp?.status || 'active';

  // Map database status to frontend status
  let mappedStatus = 'live';
  if (compStatus === 'active') {
    mappedStatus = 'live';
  } else if (compStatus === 'completed' || compStatus === 'drawn' || compStatus === 'drawing') {
    mappedStatus = 'drawn';
  } else if (compStatus === 'cancelled') {
    mappedStatus = 'cancelled';
  }

  // Check winner using case-insensitive comparison for wallet addresses
  // SCHEMA: joincompetition has userid, not wallet_address
  const isWinner = identity.walletAddress && comp?.winner_address
    ? userIdsEqual(jc.userid, comp.winner_address) ||
      userIdsEqual(identity.walletAddress, comp.winner_address)
    : false;

  // Generate a safe ID - use a combination of fields if uid/id are missing
  // SCHEMA: Use userid and joinedat (not wallet_address and purchasedate)
  const entryId = jc.uid || jc.id || `entry-${jc.competitionid || 'no-comp'}-${jc.userid?.substring(0, 8) || 'no-user'}-${jc.joinedat || 'unknown'}`;

  // Calculate number of tickets from ticketnumbers array
  const ticketCount = Array.isArray(jc.ticketnumbers) ? jc.ticketnumbers.length : 1;

  return {
    id: entryId,
    competition_id: jc.competitionid,
    title: comp?.title || 'Unknown Competition',
    description: comp?.description || '',
    image: comp?.image_url,
    status: mappedStatus,
    entry_type: 'completed', // joincompetition entries are always completed
    expires_at: null,
    is_winner: isWinner,
    ticket_numbers: jc.ticketnumbers,
    // SCHEMA: joincompetition doesn't have numberoftickets - calculate from array
    number_of_tickets: ticketCount,
    // SCHEMA: joincompetition doesn't have amountspent - calculate if ticket_price available
    amount_spent: comp?.ticket_price ? (comp.ticket_price * ticketCount) : undefined,
    // SCHEMA: Use joinedat instead of purchasedate
    purchase_date: jc.joinedat || jc.created_at,
    // SCHEMA: Use userid instead of walletaddress
    wallet_address: jc.userid,
    // SCHEMA: joincompetition doesn't have transactionhash
    transaction_hash: undefined,
    is_instant_win: comp?.is_instant_win || false,
    prize_value: comp?.prize_value,
    competition_status: compStatus,
    end_date: comp?.end_date,
  };
}

export const database = {
  //   async getCompetitions(status?: string, limit: number = 8) {
  //     try {
  //       return await withRetry(async () => {
  //         let query = supabase
  //           .from('competitions')
  //           .select('*')
  //           // .order('crdate', { ascending: false })
  //           .limit(limit);
  // console.log({query})
  //         if (status === 'active') {
  //           // query = query.eq('competitionended', 0);
  //         } else if (status === 'ended') {
  //           // query = query.eq('competitionended', 1);
  //         }

  //         const { data: competitions, error } = await query;

  //         if (error) {
  //           handleDatabaseError(error, 'getCompetitions');
  //           return [];
  //         }

  //         if (!competitions || competitions.length === 0) return [];

  //         const competitionsWithCounts = await Promise.all(
  //           competitions.map(async (comp) => {
  //             let ticketsSold = comp.havetickets || 0;

  //             try {
  //               const { count } = await supabase
  //                 .from('joincompetition')
  //                 .select('*', { count: 'exact', head: true })
  //                 .eq('competitionid', comp.uid);

  //               ticketsSold = count || ticketsSold;
  //             } catch (error) {
  //               handleDatabaseError(error, `getCompetitions - count for ${comp.uid}`);
  //             }

  //             return {
  //               id: comp.uid,
  //               title: comp.competitionname || 'Untitled Competition',
  //               description: comp.competitioninformation || '',
  //               image_url: getImageUrl(comp.imageurl),
  //               prize_type: comp.category || 'crypto',
  //               prize_value: comp.competitionprize || '',
  //               total_tickets: comp.competitionticketsize || 0,
  //               ticket_price: 1,
  //               draw_date: comp.competitionenddate,
  //               end_date: comp.competitionenddate,
  //               status: comp.competitionended === 0 ? 'active' : 'finished',
  //               is_instant_win: comp.instant || false,
  //               is_featured: comp.featured === 1,
  //               tickets_sold: ticketsSold,
  //               created_at: comp.crdate,
  //               updated_at: comp.crdate,
  //             };
  //           })
  //         );

  //         return competitionsWithCounts;
  //       }, { context: 'getCompetitions', maxRetries: 2 });
  //     } catch (error) {
  //       handleDatabaseError(error, 'getCompetitions - outer catch');
  //       return [];
  //     }
  //   },

  async getCompetitionsV2(status: "active" | "completed" | 'drawing' | 'drawn' | 'cancelled' | 'expired' | 'draft', limit: number = 8) {
    try {
      // Fetch all competitions without date filter
      let query = supabase
        .from('competitions')
        .select('*')
        .eq('deleted', false)
        .limit(limit);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        handleDatabaseError(error, 'getCompetitionsV2');
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      // Get accurate ticket counts for all competitions in a single batch query
      // This avoids N+1 queries and ensures landing page counters match individual pages
      const competitionIds = data.map(comp => comp.id || comp.uid).filter(Boolean);
      
      // Fetch ticket counts for all competitions at once using aggregation
      const { data: ticketCounts, error: countError } = await supabase
        .from('tickets')
        .select('competition_id')
        .in('competition_id', competitionIds);

      if (countError) {
        console.warn('Failed to fetch ticket counts, using fallback:', countError);
      }

      // Build a map of competition_id -> ticket count
      const ticketCountMap = new Map<string, number>();
      if (ticketCounts) {
        ticketCounts.forEach(ticket => {
          const compId = ticket.competition_id;
          ticketCountMap.set(compId, (ticketCountMap.get(compId) || 0) + 1);
        });
      }

      // Process image URLs and hydrate ticket progress
      const processedData = data.map(comp => {
        const competitionId = comp.id || comp.uid;
        const ticketsSold = ticketCountMap.get(competitionId) || 0;

        return {
          ...comp,
          tickets_sold: ticketsSold,
          image_url: getImageUrl(comp.image_url || comp.imageurl),
        };
      });

      return processedData;
    } catch (error) {
      handleDatabaseError(error, 'getCompetitionsV2 - outer catch');
      return [];
    }
  },

  async getCompetitionByIdV2(competitionId: string) {
    try {
      const { data, error } = await supabase
        .from('competitions')
        .select('*')
        .eq('id', competitionId)
        .eq('deleted', false)
        .maybeSingle()

      if (error) {
        console.error('Error fetching competition:', error);
        return null;
      }

      if (!data) return null;

      // Process image URL
      return {
        ...data,
        image_url: getImageUrl(data.image_url || data.imageurl),
      };
    } catch (error) {
      console.log('Error:', error);
      return null;
    }
},

  async getCompetitionById(id: string) {
    try {
      return await withRetry(async () => {
        const { data, error } = await supabase
          .from('competitions')
          .select('*')
          .eq('id', id)
          .eq('deleted', false)
          .maybeSingle();

        if (error) {
          handleDatabaseError(error, 'getCompetitionById');
          return null;
        }

        if (!data) return null;

        let ticketsSold = data.havetickets || 0;

        try {
          // Use RPC to get accurate ticket count - avoids uuid/text type mismatch in OR queries
          // The RPC properly resolves competition ID and handles both UUID and legacy uid formats
          const { data: availability } = await supabase.rpc('get_competition_ticket_availability_text', {
            competition_id_text: data.id
          });

          if (availability && availability.sold_count !== undefined) {
            ticketsSold = availability.sold_count;
          } else {
            // Fallback: Direct query using only the competition ID (not OR)
            // Use v_joincompetition_active view for stable read interface
            const { count } = await supabase
              .from('v_joincompetition_active')
              .select('*', { count: 'exact', head: true })
              .eq('competitionid', data.id);

            ticketsSold = count || ticketsSold;
          }
        } catch (error) {
          handleDatabaseError(error, `getCompetitionById - count for ${id}`);
        }

        return {
          id: data.id,
          title: data.competitionname || 'Untitled Competition',
          description: data.competitioninformation || '',
          image_url: getImageUrl(data.imageurl),
          prize_type: data.category || 'crypto',
          prize_value: data.competitionprize || '',
          total_tickets: data.competitionticketsize || 0,
          ticket_price: 1,
          draw_date: data.end_date,
          end_date: data.end_date,
          status: (!data.competitionended || (data.competitionended as any) === 0 || data.competitionended === null) ? 'active' : 'finished',
          is_instant_win: data.instant || false,
          is_featured: ((data.featured as any) === 1 || data.featured === true),
          tickets_sold: ticketsSold,
          created_at: data.crdate,
          updated_at: data.crdate,
        };
      }, { context: 'getCompetitionById', maxRetries: 2 });
    } catch (error) {
      handleDatabaseError(error, 'getCompetitionById - outer catch');
      return null;
    }
  },

  async getAllWinners(limit: number = 50): Promise<WinnerCardProps[]>{
    try {
      // First, try fetching with distribution_hash column
      let winners: any[] | null = null;
      let error: any = null;
      
      try {
        const result = await supabase
          .from('winners')
          .select(`
            id,
            wallet_address,
            prize_value,
            won_at,
            created_at,
            ticket_number,
            competition_id,
            distribution_hash,
            competitions (
              id,
              title,
              image_url,
              end_date,
              draw_date,
              prize_description,
              prize_value,
              prize_type
            )
          `)
          .not('wallet_address', 'is', null)
          .order('won_at', { ascending: false, nullsLast: true })
          .limit(150); // Query more to account for filtered test data
        
        winners = result.data;
        error = result.error;
      } catch (queryError: any) {
        // Check if this is a schema drift error (missing column)
        const errorCode = queryError?.code ?? queryError?.details?.code;
        const errorMessage = queryError?.message || '';
        
        // PostgreSQL error code 42703 = column does not exist
        // Also check for similar error messages
        if (
          errorCode === '42703' || 
          (errorMessage.includes('column') && errorMessage.includes('does not exist'))
        ) {
          console.warn('[Database] distribution_hash column not found, retrying query without it');
          
          // Retry query without distribution_hash
          const fallbackResult = await supabase
            .from('winners')
            .select(`
              id,
              wallet_address,
              prize_value,
              won_at,
              created_at,
              ticket_number,
              competition_id,
              competitions (
                id,
                title,
                image_url,
                end_date,
                draw_date,
                prize_description,
                prize_value,
                prize_type
              )
            `)
            .not('wallet_address', 'is', null)
            .order('won_at', { ascending: false, nullsLast: true })
            .limit(150);
          
          winners = fallbackResult.data;
          error = fallbackResult.error;
        } else {
          // Re-throw non-schema errors
          throw queryError;
        }
      }

      if (error) {
        handleDatabaseError(error, 'getAllWinners');
        return [];
      }

      // Helper to check if a wallet address looks like test/fake data
      const isValidWinnerAddress = (address: string | null): boolean => {
        if (!address) return false;
        // Filter out null wallet addresses, all-zeros, or addresses that are obviously test data
        const cleanAddr = address.toLowerCase().trim();
        // Reject addresses that are all zeros (like 0x0000...0000)
        if (/^0x0+$/.test(cleanAddr)) return false;
        // Reject if address is too short to be real
        if (cleanAddr.length < 10) return false;
        // Reject obvious test patterns
        if (cleanAddr.includes('test') || cleanAddr.includes('fake')) return false;
        // Reject did:priv patterns which are test identifiers
        if (cleanAddr.startsWith('did:priv')) return false;
        // Reject prize:pid patterns which are pseudo-identifiers (not real wallets)
        if (cleanAddr.startsWith('prize:pid:')) return false;
        return true;
      };

      // Filter for valid winners with real wallet addresses
      const filteredWinners = (winners || []).filter((winner) => {
        // Filter out fake/test wallet addresses
        return isValidWinnerAddress(winner.wallet_address);
      });

      // Batch fetch user data for winners
      const winnerAddresses = [...new Set(filteredWinners.slice(0, limit).map(w => w.wallet_address).filter(Boolean))];
      const { data: usersData } = winnerAddresses.length > 0
        ? await supabase
            .from('canonical_users')
            .select('username, avatar_url, wallet_address, country')
            .in('wallet_address', winnerAddresses)
        : { data: [] };

      // Create user lookup map
      const userMap = new Map<string, { username: string | null; avatar_url: string | null; country: string | null }>();
      for (const user of usersData || []) {
        if (user.wallet_address) {
          userMap.set(user.wallet_address.toLowerCase(), {
            username: user.username,
            avatar_url: user.avatar_url,
            country: user.country
          });
        }
      }

      let lastUsedAvatar = '';
      const getRandomAvatar = () => {
        let avatar;
        do {
          const randomIndex = Math.floor(Math.random() * VALID_AVATAR_FILENAMES.length);
          avatar = VALID_AVATAR_FILENAMES[randomIndex];
        } while (avatar === lastUsedAvatar && VALID_AVATAR_FILENAMES.length > 1);

        lastUsedAvatar = avatar;
        return `${SUPABASE_AVATAR_BASE_URL}/${avatar}`;
      };

      // Helper to format date
      const formatDate = (dateStr: string | null): string => {
        if (!dateStr) return 'Recent';
        try {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) return 'Recent';
          return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
        } catch {
          return 'Recent';
        }
      };

      const mappedWinners: WinnerCardProps[] = [];
      for (let i = 0; i < Math.min(filteredWinners.length, limit); i++) {
        const winner = filteredWinners[i];
        const competition = winner.competitions;
        
        // Determine prize display - prioritize prize info over competition title
        let prizeDisplay = '';
        
        // First try: Use prize_description from winner or competition
        if (winner.prize_description) {
          prizeDisplay = winner.prize_description;
        } else if (competition?.prize_description) {
          prizeDisplay = competition.prize_description;
        }
        
        // Second try: Construct from prize_value and prize_type
        if (!prizeDisplay && winner.prize_value) {
          const prizeType = competition?.prize_type || '';
          // Check if prize type indicates crypto currency
          if (prizeType.toLowerCase().includes('btc') || prizeType.toLowerCase().includes('bitcoin')) {
            prizeDisplay = `${winner.prize_value} BTC`;
          } else if (prizeType.toLowerCase().includes('eth') || prizeType.toLowerCase().includes('ethereum')) {
            prizeDisplay = `${winner.prize_value} ETH`;
          } else if (prizeType.toLowerCase().includes('sol') || prizeType.toLowerCase().includes('solana')) {
            prizeDisplay = `${winner.prize_value} SOL`;
          } else if (prizeType.toLowerCase().includes('crypto') || prizeType.toLowerCase().includes('usdt') || prizeType.toLowerCase().includes('usdc')) {
            // For generic crypto or stablecoins, use $ prefix
            prizeDisplay = `$${winner.prize_value} ${prizeType}`;
          } else {
            // Default to $ prefix for monetary prizes
            prizeDisplay = `$${winner.prize_value}` + (prizeType ? ` ${prizeType}` : '');
          }
        }
        
        // Last resort: Use competition title
        if (!prizeDisplay && competition?.title) {
          prizeDisplay = competition.title;
        }
        
        // Skip if we still don't have a prize to display
        if (!prizeDisplay) continue;

        const winnerAddress = winner.wallet_address;
        const userData = winnerAddress ? userMap.get(winnerAddress.toLowerCase()) : null;

        // Format wallet address for display
        const walletDisplay = winnerAddress && winnerAddress.length > 10
          ? winnerAddress.substring(0, 8) + '...' + winnerAddress.slice(-4)
          : winnerAddress || 'N/A';

        // Use real username if available, otherwise truncated wallet
        const displayName = userData?.username || walletDisplay;

        // Use won_at date for display, or competition end_date/draw_date as fallback
        const drawDate = formatDate(winner.won_at || competition?.draw_date || competition?.end_date || winner.created_at);

        mappedWinners.push({
          prize: prizeDisplay,
          username: displayName,
          country: userData?.country || 'International',
          wallet: walletDisplay,
          date: drawDate,
          showInstantWin: false,
          avatarUrl: userData?.avatar_url || getRandomAvatar(),
          competitionId: winner.competition_id || '',
          // Use optional chaining for distribution_hash which may not exist in some environments
          txHash: winner?.distribution_hash ?? '',
        });
      }

      return mappedWinners;
    } catch (error) {
      handleDatabaseError(error, 'getAllWinners - outer catch');
      return [];
    }
  },


  async getWinners(limit: number = 50): Promise<WinnerCardProps[]> {
    // First, try fetching with distribution_hash column
    let winners: any[] | null = null;
    let error: any = null;
    
    try {
      const result = await supabase
        .from('winners')
        .select(`
          id,
          wallet_address,
          prize_value,
          prize_description,
          won_at,
          created_at,
          ticket_number,
          competition_id,
          distribution_hash,
          competitions (
            id,
            title,
            image_url,
            end_date,
            draw_date,
            prize_description,
            prize_value,
            prize_type
          )
        `)
        .not('wallet_address', 'is', null)
        .order('won_at', { ascending: false, nullsLast: true })
        .limit(150); // Query more to account for filtered test data
      
      winners = result.data;
      error = result.error;
    } catch (queryError: any) {
      // Check if this is a schema drift error (missing column)
      const errorCode = queryError?.code ?? queryError?.details?.code;
      const errorMessage = queryError?.message || '';
      
      // PostgreSQL error code 42703 = column does not exist
      // Also check for similar error messages
      if (
        errorCode === '42703' || 
        (errorMessage.includes('column') && errorMessage.includes('does not exist'))
      ) {
        console.warn('[Database] distribution_hash column not found in getWinners, retrying query without it');
        
        // Retry query without distribution_hash
        const fallbackResult = await supabase
          .from('winners')
          .select(`
            id,
            wallet_address,
            prize_value,
            prize_description,
            won_at,
            created_at,
            ticket_number,
            competition_id,
            competitions (
              id,
              title,
              image_url,
              end_date,
              draw_date,
              prize_description,
              prize_value,
              prize_type
            )
          `)
          .not('wallet_address', 'is', null)
          .order('won_at', { ascending: false, nullsLast: true })
          .limit(150);
        
        winners = fallbackResult.data;
        error = fallbackResult.error;
      } else {
        // Re-throw non-schema errors
        throw queryError;
      }
    }

    if (error) {
      console.error('Error fetching winners from winners table:', error);
      return [];
    }

    // Helper to check if a wallet address looks like test/fake data
    const isValidWinnerAddress = (address: string | null): boolean => {
      if (!address) return false;
      const cleanAddr = address.toLowerCase().trim();
      if (/^0x0+$/.test(cleanAddr)) return false;
      if (cleanAddr.length < 10) return false;
      if (cleanAddr.includes('test') || cleanAddr.includes('fake')) return false;
      if (cleanAddr.startsWith('did:priv')) return false;
      // Reject prize:pid patterns which are pseudo-identifiers (not real wallets)
      if (cleanAddr.startsWith('prize:pid:')) return false;
      return true;
    };

    // Filter for valid winners with real wallet addresses
    const filteredWinners = (winners || []).filter((winner) => {
      // Filter out fake/test wallet addresses
      return isValidWinnerAddress(winner.wallet_address);
    });

    // Batch fetch user data for winners
    const winnerAddresses = [...new Set(filteredWinners.slice(0, limit).map(w => w.wallet_address).filter(Boolean))];
    const { data: usersData } = winnerAddresses.length > 0
      ? await supabase
          .from('canonical_users')
          .select('username, avatar_url, wallet_address, country')
          .in('wallet_address', winnerAddresses)
      : { data: [] };

    // Create user lookup map
    const userMap = new Map<string, { username: string | null; avatar_url: string | null; country: string | null }>();
    for (const user of usersData || []) {
      if (user.wallet_address) {
        userMap.set(user.wallet_address.toLowerCase(), {
          username: user.username,
          avatar_url: user.avatar_url,
          country: user.country
        });
      }
    }

    let lastUsedAvatar = '';
    const getRandomAvatar = () => {
      let avatar;
      do {
        const randomIndex = Math.floor(Math.random() * VALID_AVATAR_FILENAMES.length);
        avatar = VALID_AVATAR_FILENAMES[randomIndex];
      } while (avatar === lastUsedAvatar && VALID_AVATAR_FILENAMES.length > 1);

      lastUsedAvatar = avatar;
      return `${SUPABASE_AVATAR_BASE_URL}/${avatar}`;
    };

    // Helper to format date
    const formatDate = (dateStr: string | null): string => {
      if (!dateStr) return 'Recent';
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Recent';
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
      } catch {
        return 'Recent';
      }
    };

    const mappedWinners: WinnerCardProps[] = [];
    for (let i = 0; i < Math.min(filteredWinners.length, limit); i++) {
      const winner = filteredWinners[i];
      const competition = winner.competitions;
      
      // Determine prize display - prioritize prize info over competition title
      let prizeDisplay = '';
      
      // First try: Use prize_description from winner or competition
      if (winner.prize_description) {
        prizeDisplay = winner.prize_description;
      } else if (competition?.prize_description) {
        prizeDisplay = competition.prize_description;
      }
      
      // Second try: Construct from prize_value and prize_type
      if (!prizeDisplay && winner.prize_value) {
        const prizeType = competition?.prize_type || '';
        // Check if prize type indicates crypto currency
        if (prizeType.toLowerCase().includes('btc') || prizeType.toLowerCase().includes('bitcoin')) {
          prizeDisplay = `${winner.prize_value} BTC`;
        } else if (prizeType.toLowerCase().includes('eth') || prizeType.toLowerCase().includes('ethereum')) {
          prizeDisplay = `${winner.prize_value} ETH`;
        } else if (prizeType.toLowerCase().includes('sol') || prizeType.toLowerCase().includes('solana')) {
          prizeDisplay = `${winner.prize_value} SOL`;
        } else if (prizeType.toLowerCase().includes('crypto') || prizeType.toLowerCase().includes('usdt') || prizeType.toLowerCase().includes('usdc')) {
          // For generic crypto or stablecoins, use $ prefix
          prizeDisplay = `$${winner.prize_value} ${prizeType}`;
        } else {
          // Default to $ prefix for monetary prizes
          prizeDisplay = `$${winner.prize_value}` + (prizeType ? ` ${prizeType}` : '');
        }
      }
      
      // Last resort: Use competition title
      if (!prizeDisplay && competition?.title) {
        prizeDisplay = competition.title;
      }
      
      // Skip if we still don't have a prize to display
      if (!prizeDisplay) continue;

      const winnerAddress = winner.wallet_address;
      const userData = winnerAddress ? userMap.get(winnerAddress.toLowerCase()) : null;

      // Format wallet address for display
      const walletDisplay = winnerAddress && winnerAddress.length > 10
        ? winnerAddress.substring(0, 8) + '...' + winnerAddress.slice(-4)
        : winnerAddress || 'N/A';

      // Use real username if available, otherwise truncated wallet
      const displayName = userData?.username || walletDisplay;

      // Use won_at date for display, or competition end_date/draw_date as fallback
      const drawDate = formatDate(winner.won_at || competition?.draw_date || competition?.end_date || winner.created_at);

      mappedWinners.push({
        prize: prizeDisplay,
        username: displayName,
        country: userData?.country || 'International',
        wallet: walletDisplay,
        date: drawDate,
        showInstantWin: false,
        avatarUrl: userData?.avatar_url || getRandomAvatar(),
        competitionId: winner.competition_id || '',
        // Use optional chaining for distribution_hash which may not exist in some environments
        txHash: winner?.distribution_hash ?? '',
      });
    }

    return mappedWinners;
  },

  async getFaqs(): Promise<Faq[]> {
    return [
      {
        question: "How do I participate in a competition?",
        answer: "Simply connect your wallet, select the competition you want to enter, choose your ticket numbers, and complete the purchase using cryptocurrency."
      },
      {
        question: "When are winners announced?",
        answer: "Winners are announced immediately after each competition ends. You'll be notified if you win, and results are publicly displayed on our Winners page."
      },
      {
        question: "How is the winner selected?",
        answer: "We use a provably fair random number generator (RNG) on the blockchain to ensure complete transparency and fairness in selecting winners."
      },
      {
        question: "What payment methods do you accept?",
        answer: "We accept various cryptocurrencies including Bitcoin, Ethereum, and Solana. Connect your wallet to see all available payment options."
      },
      {
        question: "How do I claim my prize?",
        answer: "If you win, the prize will be automatically transferred to your wallet address. For physical prizes, our team will contact you to arrange delivery."
      }
    ];
  },

  async getUserTickets(userId: string): Promise<EntryCard[]> {
    const { data, error } = await supabase
      .from('v_joincompetition_active')
      .select('*')
      .eq('userid', userId)
      .order('buytime', { ascending: false });

    if (error) {
      console.error('Error fetching user tickets:', error);
      return [];
    }

    if (!data) return [];

    const tickets = await Promise.all(
      data.map(async (ticket: any, index: number) => {
        // Try looking up competition by id first, then fallback to uid
        // joincompetition.competitionid may contain either the UUID id or the text uid
        const compId = ticket.competitionid;
        let comp = null;

        // First try direct id match (if it's a valid UUID)
        const { data: byId } = await supabase
          .from('competitions')
          .select('competitionname, competitioninformation, imageurl, uid, winner_address')
          .eq('id', compId)
          .maybeSingle();

        if (byId) {
          comp = byId;
        } else {
          // Fallback to uid lookup
          const { data: byUid } = await supabase
            .from('competitions')
            .select('competitionname, competitioninformation, imageurl, uid, winner_address')
            .eq('uid', compId)
            .maybeSingle();
          comp = byUid;
        }

        return {
          id: index + 1,
          title: comp?.competitionname || 'Unknown Competition',
          description: comp?.competitioninformation || '',
          image: getImageUrl(comp?.imageurl || ''),
          status: (userIdsEqual(comp?.winner_address, userId) ? 'win' : 'loss') as 'win' | 'loss',
        };
      })
    );

    return tickets;
  },

  async getUserPurchaseOrders(userId: string): Promise<PurchaseOrder[]> {
    const { data, error } = await supabase
      .from('v_joincompetition_active')
      .select('*')
      .eq('userid', userId)
      .order('buytime', { ascending: false });

    if (error) {
      console.error('Error fetching purchase orders:', error);
      return [];
    }

    const ordersByTx = data?.reduce((acc: any, ticket: any) => {
      const txHash = ticket.trxhash || 'no-hash';
      if (!acc[txHash]) {
        acc[txHash] = {
          tickets: [],
          amount: 0,
          date: ticket.buytime,
        };
      }
      acc[txHash].tickets.push(ticket);
      acc[txHash].amount += parseFloat(ticket.buyvalue || 0);
      return acc;
    }, {});

    return (Object.entries(ordersByTx || {}).map(([txHash, order]: [string, any], index: number) => ({
      id: index + 1,
      ticketsBought: order.tickets.length,
      network: order.tickets[0]?.chain || 'Ethereum',
      txHash: txHash,
      date: new Date(order.date).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      amount: `$${order.amount.toFixed(2)}`,
    })) as unknown) as PurchaseOrder[];
  },

  // async getUserEntries(userId: string): Promise<EntryOrder[]> {
  //   const { data, error } = await supabase
  //     .from('joincompetition')
  //     .select('*')
  //     .eq('userid', userId)
  //     .order('buytime', { ascending: false });

  //   if (error) {
  //     console.error('Error fetching user entries:', error);
  //     return [];
  //   }

  //   if (!data) return [];

  //   const entries = await Promise.all(
  //     data.map(async (ticket: any, index: number) => {
  //       const { data: comp } = await supabase
  //         .from('competitions')
  //         .select('competitionname')
  //         .eq('uid', ticket.competitionuid)
  //         .maybeSingle();

  //       return {
  //         id: index + 101,
  //         competitionName: comp?.competitionname || 'Unknown Competition',
  //         date: new Date(ticket.buytime).toLocaleString('en-US', {
  //           year: 'numeric',
  //           month: '2-digit',
  //           day: '2-digit',
  //           hour: '2-digit',
  //           minute: '2-digit',
  //         }),
  //         amount: `$${parseFloat(ticket.buyvalue || 0).toFixed(2)}`,
  //         actions: 'View',
  //       };
  //     })
  //   );

  //   return entries;
  // },

  async createTicket(
    competitionId: string,
    userId: string,
    ticketNumber: string,
    txHash: string,
    _network: string,
    amountPaid: number
  ) {
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        competition_id: competitionId,
        user_id: userId,
        ticket_number: parseInt(ticketNumber),
        payment_tx_hash: txHash,
        payment_amount: amountPaid,
      })
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error creating ticket:', error);
      throw error;
    }

    return data;
  },

  async createPurchaseOrder(
    userId: string,
    competitionId: string,
    ticketsBought: number,
    _network: string,
    txHash: string,
    amount: number
  ) {
    const tickets = [];
    for (let i = 0; i < ticketsBought; i++) {
      tickets.push({
        competition_id: competitionId,
        user_id: userId,
        ticket_number: Math.floor(Math.random() * 1000000),
        payment_tx_hash: txHash,
        payment_amount: amount / ticketsBought,
      });
    }

    const { data, error } = await supabase
      .from('tickets')
      .insert(tickets)
      .select();

    if (error) {
      console.error('Error creating purchase order:', error);
      throw error;
    }

    return data;
  },

  async getUser(userId: string) {
    // 1) Try canonical_user_id (prize:pid:0x...)
    const byCanonical = await supabase
      .from('canonical_users')
      .select('*')
      .eq('canonical_user_id', userId)
      .maybeSingle();
    
    if (byCanonical.data) return byCanonical.data;

    // 2) Fallback: try primary uuid id
    const byUuid = await supabase
      .from('canonical_users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (byUuid.error) {
      console.error('Error fetching user:', byUuid.error);
      return null;
    }
    
    return byUuid.data;
  },

  async getUserProfile(userId: string) {
    const byCanonical = await supabase
      .from('canonical_users')
      .select('*')
      .eq('canonical_user_id', userId)
      .maybeSingle();
    
    if (byCanonical.data) return byCanonical.data;

    const byUuid = await supabase
      .from('canonical_users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (byUuid.error) {
      console.error('Error fetching user profile:', byUuid.error);
      return null;
    }
    
    return byUuid.data;
  },

  async updateUserProfile(
    userId: string,
    profile: {
      username?: string;
      email?: string;
      telegram_handle?: string;
      telephone_number?: string;
    }
  ) {
    // Prefer canonical_user_id targeting
    let { data, error } = await supabase
      .from('canonical_users')
      .update(profile)
      .eq('canonical_user_id', userId)
      .select()
      .maybeSingle();

    // Fallback to id (uuid) if needed
    if ((!data && error) || (!data && !error)) {
      const alt = await supabase
        .from('canonical_users')
        .update(profile)
        .eq('id', userId)
        .select()
        .maybeSingle();
      data = alt.data;
      error = alt.error;
    }

    if (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
    
    return data;
  },

  async getRecentActivity(limit: number = 20): Promise<TableRow[]> {
    // Fetch all recent entries without date filter
    const { data: entryData, error: entryError } = await supabase
      .from('v_joincompetition_active')
      .select('*')
      .order('purchasedate', { ascending: false })
      .limit(limit);

    if (entryError) {
      console.error('Error fetching recent entries:', entryError);
      return [];
    }

    let lastUsedAvatar = '';
    const getRandomAvatar = () => {
      let avatar;
      do {
        const randomIndex = Math.floor(Math.random() * VALID_AVATAR_FILENAMES.length);
        avatar = VALID_AVATAR_FILENAMES[randomIndex];
      } while (avatar === lastUsedAvatar && VALID_AVATAR_FILENAMES.length > 1);

      lastUsedAvatar = avatar;
      return `${SUPABASE_AVATAR_BASE_URL}/${avatar}`;
    };

    // Default placeholder image when no competition image is available
    const DEFAULT_COMPETITION_IMAGE = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/Tier%201%20(1).jpg';

    // PERFORMANCE FIX: Batch fetch all competitions and users instead of N+1 queries
    // Extract unique IDs for batch fetching
    const competitionIds = [...new Set((entryData || []).map(t => t.competitionid).filter(Boolean))];
    const walletAddresses = [...new Set((entryData || []).map(t => t.wallet_address).filter(Boolean))];

    // Batch fetch competitions (single query instead of N queries)
    const { data: competitionsData } = competitionIds.length > 0
      ? await supabase
          .from('competitions')
          .select('id, title, image_url, prize_value, end_date')
          .in('id', competitionIds as string[])
      : { data: [] };

    // Create competition lookup map for O(1) access
    const competitionMap = new Map<string, { competitionname: string; uid: string; imageurl: string | null; competitionprize: string | null; end_date: string | null }>();
    for (const comp of competitionsData || []) {
      competitionMap.set(comp.id, {
        competitionname: comp.title || '',
        uid: comp.id,
        imageurl: comp.image_url,
        competitionprize: String(comp.prize_value || ''),
        end_date: comp.end_date
      });
    }

    // Batch fetch users by wallet addresses AND canonical_user_ids (single query instead of N queries)
    // NOTE: wallet_address in joincompetition can be either a plain wallet address OR a canonical_user_id (prize:pid:0x...)
    const { data: usersData } = walletAddresses.length > 0
      ? await supabase
          .from('canonical_users')
          .select('username, avatar_url, wallet_address, canonical_user_id')
          .or(walletAddresses.map(addr => `wallet_address.eq.${addr},canonical_user_id.eq.${addr}`).join(','))
      : { data: [] };

    // Create user lookup map for O(1) access
    // Map by both wallet_address and canonical_user_id for flexible lookups
    const userMap = new Map<string, { username: string | null; avatar_url: string | null }>();
    for (const user of usersData || []) {
      const userData = {
        username: user.username,
        avatar_url: user.avatar_url
      };
      
      // Map by wallet_address (lowercase for case-insensitive lookup)
      if (user.wallet_address) {
        userMap.set(user.wallet_address.toLowerCase(), userData);
      }
      
      // Also map by canonical_user_id for entries that store canonical IDs
      if (user.canonical_user_id) {
        userMap.set(user.canonical_user_id.toLowerCase(), userData);
      }
    }

    // Helper function to format time display for winners (relative time)
    const formatTimeDisplay = (date: Date): string => {
      const now = new Date();
      const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

      if (diffMinutes < 1) return 'Just now';
      if (diffMinutes < 60) return `${diffMinutes}m ago`;
      if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    };

    // Build entries using lookup maps (no more N+1 queries)
    // Skip entries without valid competition data to avoid showing mock/placeholder info
    const entries: TableRow[] = [];
    for (const ticket of entryData || []) {
      const comp = ticket.competitionid ? competitionMap.get(ticket.competitionid) : null;

      // Skip entries where we can't find valid competition data
      if (!comp || !comp.competitionname) continue;

      // Look up user data by wallet address (lowercase for case-insensitive match)
      const userData = ticket.wallet_address ? userMap.get(ticket.wallet_address.toLowerCase()) : null;

      // For the TIME column on Entry actions, show when the activity happened (purchase date)
      // not the competition end date - users want to see when the entry was made
      let timeDisplay: string;
      if (ticket.purchasedate) {
        const purchaseDate = new Date(ticket.purchasedate);
        timeDisplay = formatTimeDisplay(purchaseDate);
      } else {
        timeDisplay = 'Recent';
      }

      const displayName = userData?.username ||
        (ticket.wallet_address
          ? ticket.wallet_address.substring(0, 6) + '...' + ticket.wallet_address.slice(-4)
          : 'Anonymous');

      const avatarUrl = userData?.avatar_url || getRandomAvatar();
      // Use actual prize from database, skip if no prize value exists
      const prize = comp.competitionprize;
      if (!prize) continue;

      const competitionImage = comp.imageurl ? getImageUrl(comp.imageurl) : DEFAULT_COMPETITION_IMAGE;

      // For Entry actions, show number of tickets purchased as the amount
      const ticketCount = ticket.numberoftickets || 1;
      const ticketDisplay = ticketCount === 1 ? '1 Ticket' : `${ticketCount} Tickets`;

      entries.push({
        competition: comp.competitionname,
        user: {
          name: displayName,
          avatar: avatarUrl,
        },
        action: 'Entry' as const,
        amount: ticketDisplay,
        time: timeDisplay,
        competitionId: comp.uid,
        competitionImage,
        competitionPrize: prize,
      });
    }

    // Fetch all winners without date filter
    // Include winner_username from the updated competition_winners view
    const { data: winnerData } = await supabase
      .from('competition_winners')
      .select('competitionprize, Winner, winner_username, crDate, competitionname, imageurl')
      .not('Winner', 'is', null as any)
      .order('crDate', { ascending: false, nullsFirst: false } as any)
      .limit(50);

    // Helper to check if a wallet address looks like test/fake data
    const isValidWinnerAddress = (address: string | null): boolean => {
      if (!address) return false;
      const cleanAddr = address.toLowerCase().trim();
      if (/^0x0+$/.test(cleanAddr)) return false;
      if (cleanAddr.length < 10) return false;
      if (cleanAddr.includes('test') || cleanAddr.includes('fake')) return false;
      if (cleanAddr.startsWith('did:priv')) return false;
      return true;
    };

    // Filter for only monetary ($) or crypto prizes
    // Also include numeric prizes (treat any prize with a valid value as displayable)
    // AND filter out test/fake winner addresses
    const filteredWinnerData = (winnerData || []).filter((winner) => {
      // First, filter out fake/test wallet addresses
      if (!isValidWinnerAddress(winner.Winner)) return false;

      const prize = winner.competitionprize || '';
      // Show if prize starts with $
      const isMonetary = prize.startsWith('$');
      // Show if prize contains crypto keywords
      const isCrypto = /\b(BTC|ETH|SOL|USDT|USDC|BITCOIN|ETHEREUM|SOLANA)\b/i.test(prize);
      // Show if prize is a numeric value (stored as number)
      const isNumeric = !isNaN(parseFloat(prize)) && parseFloat(prize) > 0;
      // Show if prize contains any amount indicators
      const hasAmount = /\d/.test(prize);
      return isMonetary || isCrypto || isNumeric || hasAmount;
    });

    // PERFORMANCE FIX: Batch fetch winner user data instead of N+1 queries
    const winnerIdentifiers = [...new Set(filteredWinnerData.slice(0, 10).map(w => w.Winner).filter(Boolean))];

    // Batch fetch winner users (single query instead of N queries)
    // NOTE: Winner field can be either a plain wallet address OR a canonical_user_id (prize:pid:0x...)
    const { data: winnerUsersData } = winnerIdentifiers.length > 0
      ? await supabase
          .from('canonical_users')
          .select('canonical_user_id, id, username, avatar_url, wallet_address')
          .or(winnerIdentifiers.map(id => `canonical_user_id.eq.${id},wallet_address.eq.${id}`).join(','))
      : { data: [] };

    // Create winner user lookup map - map by both canonical_user_id and wallet_address
    const winnerUserMap = new Map<string, { username: string | null; avatar_url: string | null }>();
    for (const user of winnerUsersData || []) {
      const userData = { username: user.username, avatar_url: user.avatar_url };
      
      // Map by canonical_user_id
      if (user.canonical_user_id) {
        winnerUserMap.set(user.canonical_user_id, userData);
        winnerUserMap.set(user.canonical_user_id.toLowerCase(), userData);
      }
      
      // Map by wallet_address (lowercase for case-insensitive lookup)
      if (user.wallet_address) {
        winnerUserMap.set(user.wallet_address.toLowerCase(), userData);
      }
    }

    // Build winners using lookup map
    // Skip winners without valid competition/prize data to avoid showing mock/placeholder info
    const winners: TableRow[] = [];
    for (const comp of filteredWinnerData.slice(0, 10)) {
      // Skip winners without a valid prize or competition name
      if (!comp.competitionprize || !comp.competitionname) continue;

      const userData = comp.Winner
        ? (winnerUserMap.get(comp.Winner) || winnerUserMap.get(comp.Winner.toLowerCase()))
        : null;

      // Use actual date from database, not fabricated date
      let timeDisplay: string;
      if (comp.crDate) {
        const drawDate = new Date(comp.crDate);
        timeDisplay = formatTimeDisplay(drawDate);
      } else {
        timeDisplay = 'Recent';
      }

      // Priority for username display:
      // 1. winner_username from winners table (stored directly when winner is declared)
      // 2. username from canonical_users lookup
      // 3. Truncated wallet address as fallback
      const displayName = comp.winner_username ||
        userData?.username ||
        (comp.Winner
          ? comp.Winner.substring(0, 6) + '...' + comp.Winner.slice(-4)
          : 'Anonymous');

      const avatarUrl = userData?.avatar_url || getRandomAvatar();
      const competitionImage = comp.imageurl ? getImageUrl(comp.imageurl) : DEFAULT_COMPETITION_IMAGE;

      winners.push({
        competition: comp.competitionname,
        user: {
          name: displayName,
          avatar: avatarUrl,
        },
        action: 'Win' as const,
        amount: comp.competitionprize,
        time: timeDisplay,
        competitionId: '',
        competitionImage,
        competitionPrize: comp.competitionprize,
      });
    }

    return [...winners, ...entries].slice(0, limit);
  },

  async getSiteStats() {
    const { data, error } = await supabase
      .from('site_stats')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching site stats:', error);
      return [];
    }

    return data || [];
  },

  async getPartners() {
    const { data, error } = await supabase
      .from('partners')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching partners:', error);
      return [];
    }

    return data || [];
  },

  async getTestimonials() {
    const { data, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching testimonials:', error);
      return [];
    }

    return data || [];
  },

  async getHeroCompetitions() {
    const { data, error } = await supabase
      .from('hero_competitions')
      .select(`
        *,
        competition:competitions!hero_competitions_competition_id_fkey(*)
      `)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching hero competitions:', error);
      return [];
    }

    return data || [];
  },

  async getHeroCompetitionBySlug(slug: string) {
    if (!slug) return null;

    try {
      // First try to get the hero competition with its linked competition
      const { data, error } = await supabase
        .from('hero_competitions')
        .select(`
          *,
          competition:competitions!hero_competitions_competition_id_fkey(*)
        `)
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Error fetching hero competition by slug:', error);
        return null;
      }

      if (!data) {
        // Fallback: try to find a competition directly by checking if any competition
        // has a matching slug-like identifier
        return null;
      }

      // If competition_id is set and we have linked competition data, return it
      if (data.competition_id && data.competition) {
        return {
          heroCompetition: data,
          competition: {
            ...data.competition,
            image_url: getImageUrl(data.competition.image_url || data.competition.imageurl),
          },
        };
      }

      // Return hero competition data even without linked competition
      return {
        heroCompetition: data,
        competition: null,
      };
    } catch (error) {
      console.error('Error in getHeroCompetitionBySlug:', error);
      return null;
    }
  },

  async getSoldTicketsForCompetition(competitionId: string): Promise<number[]> {
    // Validate competitionId to prevent 400 errors
    if (!competitionId || competitionId.trim() === '') {
      return [];
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      return [];
    }

    try {
      return await withRetry(async () => {
        // Use RPC for accurate sold ticket data - avoids uuid/text type mismatch in OR queries
        // The RPC properly resolves competition ID and handles both UUID and legacy uid formats
        const { data: availability, error: rpcError } = await supabase.rpc('get_competition_ticket_availability_text', {
          competition_id_text: competitionId
        });

        // If RPC provides sold_tickets array directly, use it
        if (!rpcError && availability && availability.sold_tickets) {
          return Array.isArray(availability.sold_tickets) ? availability.sold_tickets : [];
        }

        // Fallback: Direct query using only the competition ID (not OR)
        // Use v_joincompetition_active view for stable read interface
        const { data: soldTicketData, error } = await supabase
          .from('v_joincompetition_active')
          .select('ticketnumbers')
          .eq('competitionid', competitionId.trim());

        if (error) {
          handleDatabaseError(error, 'getSoldTicketsForCompetition');
          return [];
        }

        // Ensure soldTicketData is an array before processing
        if (!soldTicketData) {
          return [];
        }

        // Handle case where query returns a single object instead of an array
        const dataArray = Array.isArray(soldTicketData) ? soldTicketData : [soldTicketData];

        if (dataArray.length === 0) {
          return [];
        }

        // ticketnumbers is stored as comma-separated string in joincompetition
        const soldTickets: number[] = [];
        dataArray.forEach((row: { ticketnumbers: string | null }) => {
          const nums = String(row.ticketnumbers || '')
            .split(',')
            .map(x => parseInt(x.trim(), 10))
            .filter(n => Number.isFinite(n) && n > 0);
          soldTickets.push(...nums);
        });

        return [...new Set(soldTickets)];
      }, { context: 'getSoldTicketsForCompetition', maxRetries: 2 });
    } catch (error) {
      handleDatabaseError(error, 'getSoldTicketsForCompetition - outer catch');
      return [];
    }
  },

  async getUnavailableTicketsForCompetition(competitionId: string, excludeUserId?: string): Promise<Set<number>> {
    const startTime = Date.now();
    databaseLogger.group(`getUnavailableTickets: ${competitionId.slice(0, 8)}...`, true);

    // Validate competitionId to prevent 400 errors
    if (!competitionId || competitionId.trim() === '') {
      databaseLogger.warn('Empty competition ID provided');
      databaseLogger.groupEnd();
      return new Set();
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      databaseLogger.warn('Invalid UUID format', { competitionId });
      databaseLogger.groupEnd();
      return new Set();
    }

    try {
      const unavailable = new Set<number>();

      // Use Supabase RPC to get ALL unavailable tickets (sold + pending) in one call
      // The RPC function get_unavailable_tickets returns distinct ticket numbers that are not available
      // Queries pending_ticket_items.ticket_number (joined with pending_tickets for expires_at/status check)
      databaseLogger.request('rpc/get_unavailable_tickets', {
        competition_id: competitionId.slice(0, 8) + '...'
      });

      const { data: unavailableTickets, error: rpcError } = await getUnavailableTickets(supabase, competitionId.trim());

      if (rpcError) {
        // RPC call failed - log error and try direct query fallback
        databaseLogger.warn('RPC get_unavailable_tickets failed', { error: rpcError.message });
        showDebugHintOnError();

        requestTracker.addRequest({
          timestamp: Date.now(),
          endpoint: 'rpc/get_unavailable_tickets',
          method: 'POST',
          success: false,
          error: rpcError.message || 'Unknown error',
          errorCode: 500,
          duration: Date.now() - startTime
        });

        // Fallback: Try to get sold tickets directly (pending tickets may fail due to RLS)
        databaseLogger.info('Using fallback: direct joincompetition query');

        // Use single eq filter to avoid uuid/text type mismatch in OR queries
        // Use v_joincompetition_active view for stable read interface
        const { data: soldData } = await supabase
          .from('v_joincompetition_active')
          .select('ticketnumbers')
          .eq('competitionid', competitionId);

        if (soldData) {
          soldData.forEach((row: { ticketnumbers: string | null }) => {
            const nums = String(row.ticketnumbers || '')
              .split(',')
              .map(x => parseInt(x.trim(), 10))
              .filter(n => Number.isFinite(n) && n > 0);
            nums.forEach(n => unavailable.add(n));
          });
        }

        databaseLogger.successWithTiming('Fallback completed', startTime, { unavailableCount: unavailable.size });
        databaseLogger.groupEnd();
        return unavailable;
      }

      // Process RPC results - returns int4[] array
      if (Array.isArray(unavailableTickets)) {
        unavailableTickets.forEach((ticketNum: number) => {
          if (Number.isFinite(ticketNum)) {
            unavailable.add(ticketNum);
          }
        });
      }

      databaseLogger.successWithTiming('RPC get_unavailable_tickets completed', startTime, { unavailableCount: unavailable.size });
      requestTracker.addRequest({
        timestamp: Date.now(),
        endpoint: 'rpc/get_unavailable_tickets',
        method: 'POST',
        success: true,
        duration: Date.now() - startTime
      });

      databaseLogger.groupEnd();
      return unavailable;
    } catch (error) {
      databaseLogger.error('Outer catch error', error);
      showDebugHintOnError();
      handleDatabaseError(error, 'getUnavailableTicketsForCompetition - outer catch');
      databaseLogger.groupEnd();
      return new Set();
    }
  },

  async getAvailableTicketsForCompetition(competitionId: string, totalTickets: number, excludeUserId?: string): Promise<number[]> {
    const startTime = Date.now();
    databaseLogger.debug('getAvailableTickets called', {
      competitionId: competitionId.slice(0, 8) + '...',
      totalTickets,
      excludeUserId: excludeUserId ? excludeUserId.slice(0, 8) + '...' : null
    });

    try {
      const unavailable = await this.getUnavailableTicketsForCompetition(competitionId, excludeUserId);
      const allTickets = Array.from({ length: totalTickets }, (_, i) => i + 1);
      const available = allTickets.filter(ticket => !unavailable.has(ticket));

      databaseLogger.successWithTiming('Available tickets calculated', startTime, {
        total: totalTickets,
        unavailable: unavailable.size,
        available: available.length
      });

      return available;
    } catch (error) {
      databaseLogger.error('getAvailableTicketsForCompetition error', error);
      handleDatabaseError(error, 'getAvailableTicketsForCompetition');
      return Array.from({ length: totalTickets }, (_, i) => i + 1);
    }
  },

  async getUserOrders(userId: string){
    try {
      const {data, error} = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if(error){
        handleDatabaseError(error, 'getUserOrders');
        return [];
      }

      return data || [];
    } catch (error) {
      handleDatabaseError(error, 'getUserOrders - outer catch');
      return [];
    }
  },

  async getUserTransactions(userId: string) {
    try {
      // Use standard RPC function (not bypass_rls) for staging compatibility with anon key
      console.log('[getUserTransactions] Calling RPC with user_identifier:', userId.substring(0, 20) + '...');
      const { data, error } = await supabase
        .rpc('get_user_transactions', {
          user_identifier: userId.trim()  // Fixed: parameter name is user_identifier, not p_user_identifier
        });

      console.log('[getUserTransactions] RPC response:', { 
        dataLength: data?.length, 
        hasError: !!error,
        errorCode: error?.code,
        errorMessage: error?.message 
      });

      if (error) {
        // If permission denied or function not found, try fallback direct query
        if (error.code === '42501' || error.code === '42883' || error.message?.includes('permission denied')) {
          console.warn('[database] get_user_transactions RPC failed, using fallback:', error.message);
          return await this.getUserTransactionsFallback(userId);
        }
        handleDatabaseError(error, 'getUserTransactions');
        return [];
      }

      // RPC now returns enriched data with competition_name and competition_image from JOIN
      // No need for separate competition fetch anymore
      
      console.log('[getUserTransactions] Processing data:', { 
        rawDataLength: data?.length,
        firstItem: data?.[0] ? {
          id: data[0].id,
          competition_id: data[0].competition_id,
          competition_name: data[0].competition_name,
          amount: data[0].amount,
          status: data[0].status
        } : null
      });
      
      // Format transactions for display - DON'T filter here, let the frontend decide
      // The Orders tab needs ALL transactions including pending ones
      const formattedTransactions = (data || [])
        .map((tx: any) => {
        // Use is_topup flag from RPC if available, otherwise calculate it
        const isTopUp = tx.is_topup ?? (!tx.competition_id || (tx.webhook_ref && tx.webhook_ref.startsWith('TOPUP_')));
        
        return {
          id: tx.id,
          user_id: tx.user_id,
          competition_id: tx.competition_id,
          // Use competition_name and competition_image from RPC (already enriched)
          competition_name: tx.competition_name || (isTopUp ? 'Wallet Top-Up' : 'Unknown Competition'),
          competition_image: tx.competition_image ? getImageUrl(tx.competition_image) : null,
          ticket_count: tx.ticket_count || 0,
          ticket_numbers: tx.ticket_numbers,
          amount: tx.amount || 0,
          amount_usd: tx.currency === 'usd' || tx.currency === 'USDC' || tx.currency === 'USD'
            ? `$${Number(tx.amount || 0).toFixed(2)}`
            : `${tx.amount} ${tx.currency?.toUpperCase() || ''}`,
          currency: tx.currency,
          network: tx.network || tx.payment_provider || 'crypto',
          tx_id: tx.tx_id || tx.transaction_hash || tx.order_id || null,
          status: tx.status,
          payment_status: tx.payment_status,
          created_at: tx.created_at,
          completed_at: tx.completed_at,
          is_topup: isTopUp,
          transaction_type: isTopUp ? 'topup' : 'entry',
          // Additional fields for Orders dashboard
          type: tx.type,
          balance_before: tx.balance_before,
          balance_after: tx.balance_after,
          payment_provider: tx.payment_provider || 'unknown',
          metadata: tx.metadata,
          transaction_hash: tx.transaction_hash,
          webhook_ref: tx.webhook_ref,
          order_id: tx.order_id,
          action: (() => {
            const statusLower = (tx.status || tx.payment_status || '').toLowerCase().trim();
            if (statusLower === 'completed' || statusLower === 'finished' || statusLower === 'confirmed' || statusLower === 'success') return 'View';
            if (statusLower === 'pending') return 'Pending';
            if (statusLower === 'failed' || statusLower === 'cancelled' || statusLower === 'expired') return 'Failed';
            return 'Processing';
          })(),
        };
      });

      console.log('[getUserTransactions] Formatted transactions:', { 
        count: formattedTransactions.length,
        firstFormatted: formattedTransactions[0] || null
      });

      return formattedTransactions;
    } catch (error) {
      handleDatabaseError(error, 'getUserTransactions - outer catch');
      return [];
    }
  },

  // Fallback for getUserTransactions when RPC is not available
  async getUserTransactionsFallback(userId: string) {
    try {
      const canonicalId = toPrizePid(userId);
      const normalizedWallet = isWalletAddress(userId) ? userId.toLowerCase() : userId;

      // Direct query to user_transactions table
      // NOTE: user_id is TEXT type, so we can safely use eq/ilike
      // But wallet_address might be UUID, so we use eq for exact match
      const { data, error} = await supabase
        .from('user_transactions')
        .select('*')
        .or(`user_id.eq.${normalizedWallet},canonical_user_id.eq.${canonicalId},wallet_address.eq.${normalizedWallet}`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        handleDatabaseError(error, 'getUserTransactionsFallback');
        return [];
      }

      // Get competition details
      const competitionIds = [...new Set((data || []).map((tx: any) => tx.competition_id).filter(Boolean))];
      let competitionsMap: { [key: string]: any } = {};

      if (competitionIds.length > 0) {
        const { data: competitions } = await supabase
          .from('competitions')
          .select('id, uid, title, image_url, prize_value')
          .in('id', competitionIds);

        if (competitions) {
          competitionsMap = competitions.reduce((map: { [key: string]: any }, comp: any) => {
            map[comp.id] = comp;
            return map;
          }, {});
        }
      }

      // Format transactions
      return (data || [])
        .filter((tx: any) => {
          const status = (tx.status || '').toLowerCase();
          return status === 'completed' || status === 'finished' || status === 'confirmed' || status === 'success';
        })
        .map((tx: any) => {
          const competition = competitionsMap[tx.competition_id];
          const isTopUp = !tx.competition_id || (tx.webhook_ref && tx.webhook_ref.startsWith('TOPUP_'));
          return {
            id: tx.id,
            user_id: tx.user_id,
            competition_id: tx.competition_id,
            competition_name: isTopUp ? 'Wallet Top-Up' : (competition?.title || 'Unknown Competition'),
            competition_image: competition?.image_url ? getImageUrl(competition.image_url) : null,
            ticket_count: tx.ticket_count || 0,
            amount: tx.amount || 0,
            amount_usd: tx.currency === 'usd' || tx.currency === 'USDC' || tx.currency === 'USD'
              ? `$${Number(tx.amount || 0).toFixed(2)}`
              : `${tx.amount} ${tx.currency?.toUpperCase() || ''}`,
            currency: tx.currency,
            network: tx.network || tx.payment_provider || 'crypto',
            tx_id: tx.tx_id || tx.transaction_hash || tx.order_id || null,
            status: tx.status,
            payment_status: tx.payment_status,
            created_at: tx.created_at,
            completed_at: tx.completed_at,
            is_topup: isTopUp,
            transaction_type: isTopUp ? 'topup' : 'entry',
            // Additional fields for Orders dashboard
            type: tx.type,
            balance_before: tx.balance_before,
            balance_after: tx.balance_after,
            payment_provider: tx.payment_provider || 'unknown',
            metadata: tx.metadata,
            transaction_hash: tx.transaction_hash,
            action: (() => {
              const statusLower = (tx.status || '').toLowerCase().trim();
              if (statusLower === 'completed' || statusLower === 'finished' || statusLower === 'confirmed' || statusLower === 'success') return 'View';
              if (statusLower === 'pending') return 'Pending';
              if (statusLower === 'failed' || statusLower === 'cancelled' || statusLower === 'expired') return 'Failed';
              return 'Processing';
            })(),
          };
        });
    } catch (error) {
      handleDatabaseError(error, 'getUserTransactionsFallback - outer catch');
      return [];
    }
  },

  async getUserEntries(userId: string){
    try {
      if (!userId || userId.trim() === '') {
        databaseLogger.warn('getUserEntries: No userId provided');
        return [];
      }

      // ISSUE #1 FIX: Use unified identity resolution for consistent data retrieval
      // This resolves the multi-source identity problem by querying all identifier types atomically
      const identity = await resolveUserIdentity(userId);

      if (!identity) {
        databaseLogger.warn('getUserEntries: Could not resolve user identity for: ' + userId.substring(0, 10) + '...');
        return [];
      }

      databaseLogger.info('getUserEntries: Resolved identity', {
        primaryIdType: identity.walletAddress ? 'wallet' : identity.privyUserId ? 'privy' : 'legacy',
        identifierCount: identity.allIdentifiers.length
      });

      // Try the comprehensive RPC function first
      let entries: any[] = [];
      let rpcFailed = false;

      try {
        // Use the comprehensive RPC function that aggregates entries from multiple sources:
        // - joincompetition table (legacy confirmed entries)
        // - user_transactions table (payment-based entries with "finished" status)
        // - pending_tickets table (reservations awaiting payment confirmation)
        const { data, error } = await getDashboardEntries(supabase, identity.primaryId);

        if (error) {
          databaseLogger.rpcError('get_comprehensive_user_dashboard_entries', error, 'direct query fallback');
          rpcFailed = true;
        } else {
          // Ensure data is always an array - RPC might return a single object in edge cases
          entries = Array.isArray(data) ? data : (data ? [data] : []);
          if (entries.length > 0) {
            databaseLogger.success('getUserEntries RPC succeeded', { entryCount: entries.length });
          }
        }
      } catch (rpcError) {
        databaseLogger.rpcError('get_comprehensive_user_dashboard_entries', rpcError, 'direct query fallback');
        rpcFailed = true;
      }

      // Fallback: Query joincompetition table directly using unified identity filter
      if (rpcFailed || entries.length === 0) {
        databaseLogger.info('getUserEntries: Using direct query fallback with unified identity filter');

        try {
          // FIX: Use identity filter WITHOUT canonical_user_id for v_joincompetition_active
          // The view does not have canonical_user_id column (yet), so we exclude it
          // to prevent "column does not exist" errors
          const identityFilter = buildIdentityFilter(identity, {
            // Skip canonical_user_id by setting it to a non-existent empty column name
            // This effectively removes it from the filter
            canonicalColumn: '', // Disabled - column doesn't exist in this view
            walletColumn: 'wallet_address',
            privyColumn: 'privy_user_id',
            userIdColumn: 'userid',
          });

          // Log the filter for debugging
          databaseLogger.debug('getUserEntries identity filter', { filter: identityFilter });

          // Validate the filter - if it's empty or malformed, try individual queries
          if (!identityFilter || identityFilter.length === 0) {
            databaseLogger.warn('getUserEntries: Empty identity filter, using direct wallet query');

            // Fallback to simple direct query by wallet address
            if (identity.walletAddress) {
              const { data: directData, error: directError } = await supabase
                .from('v_joincompetition_active')
                .select(`
                  *,
                  competitions!inner (
                    id,
                    uid,
                    title,
                    description,
                    image_url,
                    status,
                    prize_value,
                    is_instant_win,
                    end_date,
                    winner_address
                  )
                `)
                .ilike('wallet_address', identity.walletAddress)
                .order('purchasedate', { ascending: false });

              if (directError) {
                databaseLogger.error('getUserEntries direct wallet query error', directError);
              } else if (directData && directData.length > 0) {
                databaseLogger.success('getUserEntries: Found entries with direct wallet query', { count: directData.length });
                entries = directData.map((jc: any) => transformJoinCompetitionEntry(jc, identity));
              }
            }
          } else {
            const { data: joinData, error: joinError } = await supabase
              .from('v_joincompetition_active')
              .select(`
                *,
                competitions!inner (
                  id,
                  uid,
                  title,
                  description,
                  image_url,
                  status,
                  prize_value,
                  is_instant_win,
                  end_date,
                  winner_address
                )
              `)
              .or(identityFilter)
              .order('purchasedate', { ascending: false });

            if (joinError) {
              databaseLogger.error('getUserEntries unified query error', {
                error: joinError,
                code: joinError.code,
                message: joinError.message,
                details: joinError.details,
                hint: joinError.hint,
                filter: identityFilter
              });

              // If OR filter fails (400 error or column doesn't exist), try individual queries as fallback
              if (joinError.code === 'PGRST100' || joinError.code === '42703' || joinError.message?.includes('400') || joinError.message?.includes('does not exist')) {
                databaseLogger.info('getUserEntries: OR filter failed, trying individual queries');
                entries = await this._getUserEntriesIndividualQueries(identity);
              }
            } else if (joinData && joinData.length > 0) {
              databaseLogger.success('getUserEntries: Found entries with unified query', { count: joinData.length });

            // Transform joincompetition data to match expected format
            entries = joinData.map((jc: any) => transformJoinCompetitionEntry(jc, identity));
            }
          }
        } catch (fallbackError) {
          databaseLogger.error('getUserEntries unified query exception', fallbackError);
          // Don't return early - try individual queries as ultimate fallback
        }
      }

      // CRITICAL FIX: If still no entries found, try individual queries as ultimate fallback
      // This queries multiple sources: joincompetition table, tickets table, user_transactions table
      if (!entries || entries.length === 0) {
        databaseLogger.info('getUserEntries: No entries from primary sources, trying multi-source fallback');
        entries = await this._getUserEntriesIndividualQueries(identity);
      }

      if (!entries || entries.length === 0) {
        databaseLogger.info('getUserEntries: No entries found after all fallbacks for user: ' + userId.substring(0, 20) + '...');
        return [];
      }

      databaseLogger.success(`getUserEntries: Found ${entries.length} entries for user`);

      // Format entries for display (data already includes competition details from RPC)
      const formattedEntries = entries.map((entry: any) => {
        // Filter out entries with missing required data (no id AND no competition_id)
        // These are phantom entries that shouldn't be displayed
        if (!entry.competition_id && !entry.id) {
          databaseLogger.warn('getUserEntries: Filtering out entry with no id and no competition_id');
          return null;
        }

        // Also filter out entries where competition_id is missing or empty
        // These are orphaned entries that reference deleted competitions
        if (!entry.competition_id || entry.competition_id === '' || entry.competition_id === 'null') {
          databaseLogger.warn(`getUserEntries: Filtering out entry ${entry.id} with missing competition_id`);
          return null;
        }

        // Entry type determines if it's pending or completed
        const entryType = entry.entry_type || 'completed';

        // Status is already mapped by the RPC function:
        // - 'live' for active competitions (database status = 'active')
        // - 'completed' for completed competitions (database status = 'completed')
        // - 'drawn' for drawn competitions (database status = 'drawn')
        // - 'pending' for pending reservations
        // - 'cancelled' for cancelled competitions
        const status = entry.status || 'live';

        // Determine if user won this competition (from RPC)
        const isWinner = entry.is_winner || false;

        // Format prize value for display
        const formattedPrizeValue = entry.prize_value
          ? `$${Number(entry.prize_value).toLocaleString()}`
          : null;

        return {
          id: entry.id,
          competition_id: entry.competition_id,
          title: entry.title || 'Unknown Competition',
          description: entry.description || '',
          image: getImageUrl(entry.image),
          status: status,
          entry_type: entryType,
          expires_at: entry.expires_at || null,
          is_winner: isWinner,
          ticket_numbers: entry.ticket_numbers,
          number_of_tickets: entry.total_tickets || entry.number_of_tickets || 1,
          amount_spent: entry.total_amount_spent || entry.amount_spent,
          purchase_date: entry.purchase_date,
          wallet_address: entry.wallet_address,
          transaction_hash: entry.transaction_hash,
          is_instant_win: entry.is_instant_win || false,
          prize_value: formattedPrizeValue,
          competition_status: entry.competition_status || 'active',
          end_date: entry.end_date,
        };
      }).filter((entry: any) => entry !== null);

      return formattedEntries;
    } catch (error) {
      handleDatabaseError(error, 'getUserEntries - outer catch');
      return [];
    }
  },

  /**
   * Fallback method to query entries using individual queries instead of OR filter
   * This is used when the unified OR filter fails (e.g., due to PostgREST syntax issues)
   *
   * UPDATED: Now queries multiple data sources:
   * 1. v_joincompetition_active view (if exists)
   * 2. Base joincompetition table directly (ultimate fallback)
   * 3. tickets table
   * 4. user_transactions table (for completed payments)
   */
  async _getUserEntriesIndividualQueries(identity: ResolvedIdentity): Promise<any[]> {
    const allEntries: any[] = [];
    const seenIds = new Set<string>();

    // Helper to add entry if not already seen
    const addEntry = (entry: any, source: string) => {
      const id = entry.id || entry.uid || `${source}-${entry.competition_id || entry.competitionid}-${Date.now()}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allEntries.push(entry);
      }
    };

    // Query options for v_joincompetition_active view (may not exist)
    const viewSelectQuery = `
      *,
      competitions!inner (
        id,
        uid,
        title,
        description,
        image_url,
        status,
        prize_value,
        is_instant_win,
        end_date,
        winner_address
      )
    `;

    // ===== SOURCE 1: Try v_joincompetition_active view first =====
    let viewQueryFailed = false;

    if (identity.walletAddress) {
      try {
        const { data, error } = await supabase
          .from('v_joincompetition_active')
          .select(viewSelectQuery)
          .ilike('wallet_address', identity.walletAddress)
          .order('purchasedate', { ascending: false });

        if (error) {
          databaseLogger.warn('View query (wallet) error - will try base table', { code: error.code });
          viewQueryFailed = true;
        } else if (data && data.length > 0) {
          data.forEach((jc: any) => {
            addEntry(transformJoinCompetitionEntry(jc, identity), 'view');
          });
          databaseLogger.debug('View query (wallet) found entries', { count: data.length });
        }
      } catch (e) {
        databaseLogger.warn('View query (wallet) exception - will try base table');
        viewQueryFailed = true;
      }
    }

    // ===== SOURCE 2: Query base joincompetition table directly (ultimate fallback) =====
    // This works even if the view doesn't exist or has issues
    // NOTE: We query without join first, then fetch competition data separately
    // This avoids issues with PostgREST not inferring relationships correctly
    if (viewQueryFailed || allEntries.length === 0) {
      databaseLogger.info('Using base joincompetition table fallback');

      if (identity.walletAddress) {
        try {
          // Query joincompetition WITHOUT join to competitions
          // SCHEMA: joincompetition has: userid, competitionid, ticketnumbers, joinedat, created_at
          const { data, error } = await supabase
            .from('joincompetition')
            .select('*')
            .ilike('userid', identity.walletAddress)
            .order('joinedat', { ascending: false });

          if (!error && data && data.length > 0) {
            databaseLogger.success('Base joincompetition query (wallet) found entries', { count: data.length });

            // Fetch competition data separately for all unique competition IDs
            const competitionIds = [...new Set(data.map((jc: any) => jc.competitionid).filter(Boolean))];

            // Fetch competitions by both id (UUID) and uid (legacy text)
            let competitionsMap = new Map<string, any>();
            if (competitionIds.length > 0) {
              try {
                // Try to fetch by id (UUID format) first
                const uuidIds = competitionIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
                const textIds = competitionIds.filter(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

                // Fetch UUID-based competitions
                if (uuidIds.length > 0) {
                  const { data: compData } = await supabase
                    .from('competitions')
                    .select('id, uid, title, description, image_url, status, prize_value, is_instant_win, end_date, winner_address')
                    .in('id', uuidIds);
                  if (compData) {
                    compData.forEach((c: any) => {
                      competitionsMap.set(c.id, c);
                    });
                  }
                }

                // Fetch text UID-based competitions (legacy)
                if (textIds.length > 0) {
                  const { data: compData } = await supabase
                    .from('competitions')
                    .select('id, uid, title, description, image_url, status, prize_value, is_instant_win, end_date, winner_address')
                    .in('uid', textIds);
                  if (compData) {
                    compData.forEach((c: any) => {
                      competitionsMap.set(c.uid, c);
                    });
                  }
                }

                databaseLogger.debug('Fetched competition data', { found: competitionsMap.size, requested: competitionIds.length });
              } catch (compErr) {
                databaseLogger.warn('Error fetching competition data', compErr);
              }
            }

            // Transform entries with competition data
            data.forEach((jc: any) => {
              // Try to find competition by competitionid (could be UUID or legacy text uid)
              const comp = competitionsMap.get(jc.competitionid);

              // Create synthetic jc.competitions object for transform function
              const jcWithComp = { ...jc, competitions: comp || null };
              addEntry(transformJoinCompetitionEntry(jcWithComp, identity), 'joincompetition');
            });
          } else if (error) {
            databaseLogger.error('Base joincompetition query (wallet) error', error);
          }
        } catch (e) {
          databaseLogger.error('Base joincompetition query (wallet) exception', e);
        }
      }

      // Also try by userid
      if (identity.legacyUserId && allEntries.length === 0) {
        try {
          // SCHEMA: joincompetition has: userid, competitionid, ticketnumbers, joinedat, created_at
          const { data, error } = await supabase
            .from('joincompetition')
            .select('*')
            .eq('userid', identity.legacyUserId)
            .order('joinedat', { ascending: false });

          if (!error && data && data.length > 0) {
            // Fetch competition data separately (same logic as above)
            const competitionIds = [...new Set(data.map((jc: any) => jc.competitionid).filter(Boolean))];
            let competitionsMap = new Map<string, any>();

            if (competitionIds.length > 0) {
              try {
                const uuidIds = competitionIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
                const textIds = competitionIds.filter(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

                if (uuidIds.length > 0) {
                  const { data: compData } = await supabase
                    .from('competitions')
                    .select('id, uid, title, description, image_url, status, prize_value, is_instant_win, end_date, winner_address')
                    .in('id', uuidIds);
                  if (compData) compData.forEach((c: any) => competitionsMap.set(c.id, c));
                }

                if (textIds.length > 0) {
                  const { data: compData } = await supabase
                    .from('competitions')
                    .select('id, uid, title, description, image_url, status, prize_value, is_instant_win, end_date, winner_address')
                    .in('uid', textIds);
                  if (compData) compData.forEach((c: any) => competitionsMap.set(c.uid, c));
                }
              } catch (compErr) {
                databaseLogger.warn('Error fetching competition data (userid)', compErr);
              }
            }

            data.forEach((jc: any) => {
              const comp = competitionsMap.get(jc.competitionid);
              const jcWithComp = { ...jc, competitions: comp || null };
              addEntry(transformJoinCompetitionEntry(jcWithComp, identity), 'joincompetition-userid');
            });
            databaseLogger.debug('Base joincompetition query (userid) found entries', { count: data.length });
          }
        } catch (e) {
          databaseLogger.error('Base joincompetition query (userid) exception', e);
        }
      }
    }

    // ===== SOURCE 3: Query tickets table =====
    // Some entries may exist in tickets table but not in joincompetition
    if (identity.walletAddress || identity.legacyUserId) {
      try {
        let ticketsQuery = supabase
          .from('tickets')
          .select(`
            id,
            competition_id,
            user_id,
            ticket_number,
            purchase_price,
            purchased_at,
            is_winner,
            canonical_user_id,
            competitions (
              id,
              uid,
              title,
              description,
              image_url,
              status,
              prize_value,
              is_instant_win,
              end_date,
              winner_address
            )
          `)
          .order('purchased_at', { ascending: false });

        // Build OR filter for tickets
        // NOTE: user_id is TEXT type in tickets table, use eq for exact match (case-insensitive handled by LOWER())
        const ticketFilters: string[] = [];
        if (identity.walletAddress) {
          // Use eq instead of ilike to avoid UUID type error
          ticketFilters.push(`user_id.eq.${identity.walletAddress}`);
        }
        if (identity.canonicalUserId) {
          ticketFilters.push(`canonical_user_id.eq.${identity.canonicalUserId}`);
        }
        if (identity.legacyUserId) {
          ticketFilters.push(`user_id.eq.${identity.legacyUserId}`);
        }

        if (ticketFilters.length > 0) {
          const { data: ticketsData, error: ticketsError } = await ticketsQuery.or(ticketFilters.join(','));

          if (!ticketsError && ticketsData && ticketsData.length > 0) {
            // Group tickets by competition_id
            const ticketsByComp = new Map<string, any[]>();
            ticketsData.forEach((t: any) => {
              const compId = t.competition_id;
              if (!ticketsByComp.has(compId)) {
                ticketsByComp.set(compId, []);
              }
              ticketsByComp.get(compId)!.push(t);
            });

            // Transform grouped tickets to entries
            ticketsByComp.forEach((tickets, compId) => {
              const firstTicket = tickets[0];
              const comp = firstTicket.competitions;
              const ticketNumbers = tickets.map((t: any) => t.ticket_number).filter(Boolean).join(',');
              const totalAmount = tickets.reduce((sum: number, t: any) => sum + (parseFloat(t.purchase_price) || 0), 0);
              const isWinner = tickets.some((t: any) => t.is_winner);

              const entry = {
                id: `tickets-${compId}-${identity.walletAddress?.substring(0, 8) || 'user'}`,
                competition_id: compId,
                title: comp?.title || 'Unknown Competition',
                description: comp?.description || '',
                image: comp?.image_url,
                status: comp?.status === 'active' ? 'live' : (comp?.status || 'live'),
                entry_type: 'completed',
                expires_at: null,
                is_winner: isWinner,
                ticket_numbers: ticketNumbers,
                number_of_tickets: tickets.length,
                amount_spent: totalAmount,
                purchase_date: firstTicket.purchased_at,
                wallet_address: identity.walletAddress,
                transaction_hash: null,
                is_instant_win: comp?.is_instant_win || false,
                prize_value: comp?.prize_value,
                competition_status: comp?.status || 'active',
                end_date: comp?.end_date,
              };

              addEntry(entry, 'tickets');
            });
            databaseLogger.debug('Tickets query found entries', { count: ticketsByComp.size });
          } else if (ticketsError) {
            databaseLogger.warn('Tickets query error', { code: ticketsError.code, message: ticketsError.message });
          }
        }
      } catch (e) {
        databaseLogger.warn('Tickets query exception', e);
      }
    }

    // ===== SOURCE 4: Query user_transactions table =====
    // Completed payments that may not be in joincompetition yet
    if (identity.walletAddress || identity.legacyUserId || identity.canonicalUserId) {
      try {
        const txFilters: string[] = [];
        if (identity.walletAddress) {
          // Use eq instead of ilike to avoid UUID type error
          txFilters.push(`wallet_address.eq.${identity.walletAddress}`);
        }
        if (identity.canonicalUserId) {
          txFilters.push(`canonical_user_id.eq.${identity.canonicalUserId}`);
        }
        if (identity.legacyUserId) {
          txFilters.push(`user_id.eq.${identity.legacyUserId}`);
        }

        if (txFilters.length > 0) {
          const { data: txData, error: txError } = await supabase
            .from('user_transactions')
            .select(`
              id,
              competition_id,
              user_id,
              wallet_address,
              amount,
              ticket_count,
              payment_status,
              tx_id,
              order_id,
              charge_id,
              charge_code,
              tx_ref,
              created_at,
              canonical_user_id,
              competitions (
                id,
                uid,
                title,
                description,
                image_url,
                status,
                prize_value,
                is_instant_win,
                end_date,
                winner_address
              )
            `)
            .or(txFilters.join(','))
            // Include ALL valid completed statuses (including 'complete', 'success', 'paid')
            .in('payment_status', ['completed', 'complete', 'finished', 'confirmed', 'success', 'paid'])
            .order('created_at', { ascending: false });

          if (!txError && txData && txData.length > 0) {
            txData.forEach((tx: any) => {
              const comp = tx.competitions;
              const entry = {
                id: tx.id,
                competition_id: tx.competition_id,
                title: comp?.title || 'Unknown Competition',
                description: comp?.description || '',
                image: comp?.image_url,
                status: comp?.status === 'active' ? 'live' : (comp?.status || 'live'),
                entry_type: 'completed',
                expires_at: null,
                is_winner: false,
                ticket_numbers: '',
                number_of_tickets: tx.ticket_count || 1,
                amount_spent: tx.amount,
                purchase_date: tx.created_at,
                wallet_address: tx.wallet_address || identity.walletAddress,
                // Balance payments won't have tx_id, so generate from charge_id, charge_code, tx_ref, or order_id
                transaction_hash: tx.tx_id || tx.charge_id || tx.charge_code || tx.tx_ref || tx.order_id || null,
                is_instant_win: comp?.is_instant_win || false,
                prize_value: comp?.prize_value,
                competition_status: comp?.status || 'active',
                end_date: comp?.end_date,
              };

              addEntry(entry, 'user_transactions');
            });
            databaseLogger.debug('User transactions query found entries', { count: txData.length });
          } else if (txError) {
            databaseLogger.warn('User transactions query error', { code: txError.code, message: txError.message });
          }
        }
      } catch (e) {
        databaseLogger.warn('User transactions query exception', e);
      }
    }

    // ===== SOURCE 5: Query orders table =====
    // Completed orders that may not be in other tables yet
    if (identity.walletAddress || identity.legacyUserId || identity.canonicalUserId) {
      try {
        // Orders table uses user_id column which stores the user identifier
        const orderFilters: string[] = [];
        if (identity.walletAddress) {
          orderFilters.push(`user_id.eq.${identity.walletAddress}`);
        }
        if (identity.legacyUserId) {
          orderFilters.push(`user_id.eq.${identity.legacyUserId}`);
        }
        if (identity.canonicalUserId) {
          orderFilters.push(`user_id.eq.${identity.canonicalUserId}`);
        }

        if (orderFilters.length > 0) {
          const { data: ordersData, error: ordersError } = await supabase
            .from('orders')
            .select(`
              id,
              competition_id,
              user_id,
              amount,
              ticket_count,
              status,
              payment_status,
              payment_tx_hash,
              created_at,
              completed_at,
              competitions (
                id,
                uid,
                title,
                description,
                image_url,
                status,
                prize_value,
                is_instant_win,
                end_date,
                winner_address
              )
            `)
            .or(orderFilters.join(','))
            // Include ALL valid completed statuses (including 'success')
            .in('status', ['completed', 'confirmed', 'paid', 'success'])
            .not('competition_id', 'is', null)
            .order('created_at', { ascending: false });

          if (!ordersError && ordersData && ordersData.length > 0) {
            ordersData.forEach((order: any) => {
              const comp = order.competitions;
              const entry = {
                id: order.id,
                competition_id: order.competition_id,
                title: comp?.title || 'Unknown Competition',
                description: comp?.description || '',
                image: comp?.image_url,
                status: comp?.status === 'active' ? 'live' : (comp?.status || 'live'),
                entry_type: 'completed',
                expires_at: null,
                is_winner: false,
                ticket_numbers: '',
                number_of_tickets: order.ticket_count || 1,
                amount_spent: order.amount,
                purchase_date: order.completed_at || order.created_at,
                wallet_address: identity.walletAddress,
                transaction_hash: order.payment_tx_hash || null,
                is_instant_win: comp?.is_instant_win || false,
                prize_value: comp?.prize_value,
                competition_status: comp?.status || 'active',
                end_date: comp?.end_date,
              };

              addEntry(entry, 'orders');
            });
            databaseLogger.debug('Orders query found entries', { count: ordersData.length });
          } else if (ordersError) {
            databaseLogger.warn('Orders query error', { code: ordersError.code, message: ordersError.message });
          }
        }
      } catch (e) {
        databaseLogger.warn('Orders query exception', e);
      }
    }

    // ===== SOURCE 6: Query balance_ledger table =====
    // Balance-based purchases are recorded in balance_ledger with source='purchase'
    if (identity.canonicalUserId || identity.walletAddress) {
      try {
        // First, get the user UUID from canonical_users for balance_ledger lookup
        let userUuid: string | null = null;

        if (identity.canonicalUserId) {
          const { data: userData } = await supabase
            .from('canonical_users')
            .select('id')
            .eq('canonical_user_id', identity.canonicalUserId)
            .maybeSingle();
          if (userData?.id) {
            userUuid = userData.id;
          }
        }

        // Fallback to wallet address lookup
        if (!userUuid && identity.walletAddress) {
          const { data: userData } = await supabase
            .from('canonical_users')
            .select('id')
            .or(`wallet_address.ilike.${identity.walletAddress},base_wallet_address.ilike.${identity.walletAddress}`)
            .maybeSingle();
          if (userData?.id) {
            userUuid = userData.id;
          }
        }

        if (userUuid) {
          const { data: ledgerData, error: ledgerError } = await supabase
            .from('balance_ledger')
            .select('*')
            .eq('user_id', userUuid)
            .eq('source', 'purchase')
            .lt('amount', 0) // Purchases are negative (debits)
            .not('metadata->competition_id', 'is', null)
            .order('created_at', { ascending: false });

          if (!ledgerError && ledgerData && ledgerData.length > 0) {
            // Fetch competition data for all competition IDs
            const competitionIds = [...new Set(
              ledgerData
                .map((bl: any) => bl.metadata?.competition_id)
                .filter(Boolean)
            )];

            let competitionsMap = new Map<string, any>();
            if (competitionIds.length > 0) {
              const { data: compData } = await supabase
                .from('competitions')
                .select('id, title, description, image_url, status, prize_value, is_instant_win, end_date, winner_address')
                .in('id', competitionIds);
              if (compData) {
                compData.forEach((c: any) => {
                  competitionsMap.set(c.id, c);
                });
              }
            }

            ledgerData.forEach((bl: any) => {
              const compId = bl.metadata?.competition_id;
              if (!compId) return;

              const comp = competitionsMap.get(compId);
              const entry = {
                id: bl.id,
                competition_id: compId,
                title: comp?.title || 'Unknown Competition',
                description: comp?.description || '',
                image: comp?.image_url,
                status: comp?.status === 'active' ? 'live' : (comp?.status || 'live'),
                entry_type: 'completed',
                expires_at: null,
                is_winner: false,
                ticket_numbers: bl.metadata?.ticket_numbers || '',
                number_of_tickets: bl.metadata?.ticket_count || 1,
                amount_spent: Math.abs(bl.amount),
                purchase_date: bl.created_at,
                wallet_address: bl.metadata?.wallet_address || identity.walletAddress,
                transaction_hash: bl.transaction_id || bl.metadata?.transaction_hash || bl.metadata?.order_id || null,
                is_instant_win: comp?.is_instant_win || false,
                prize_value: comp?.prize_value,
                competition_status: comp?.status || 'active',
                end_date: comp?.end_date,
              };

              addEntry(entry, 'balance_ledger');
            });
            databaseLogger.debug('Balance ledger query found entries', { count: ledgerData.length });
          } else if (ledgerError) {
            databaseLogger.warn('Balance ledger query error', { code: ledgerError.code, message: ledgerError.message });
          }
        }
      } catch (e) {
        databaseLogger.warn('Balance ledger query exception', e);
      }
    }

    databaseLogger.info('Individual queries complete', { totalEntries: allEntries.length, sources: 'view+joincompetition+tickets+transactions+orders+balance_ledger' });
    return allEntries;
  },

  /**
   * Get available ticket count only (without fetching all ticket numbers).
   * More efficient than getAvailableTicketsForCompetition when only the count is needed.
   * Use this for display purposes like "X tickets remaining".
   */
  async getAvailableTicketCount(competitionId: string): Promise<{
    available_count: number;
    total_tickets: number;
    sold_count: number;
    pending_count: number;
  } | null> {
    // Validate competitionId
    if (!competitionId || competitionId.trim() === '') {
      return null;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      return null;
    }

    try {
      // Try the new count-only RPC function first
      const { data, error } = await supabase.rpc('get_available_ticket_count_v2', {
        p_competition_id: competitionId.trim()
      });

      if (error) {
        console.warn('RPC get_available_ticket_count_v2 not available, using fallback:', error.message);
        // Fallback to existing method (less efficient but works)
        const unavailable = await this.getUnavailableTicketsForCompetition(competitionId);
        const { data: competition } = await supabase
          .from('competitions')
          .select('total_tickets')
          .eq('id', competitionId)
          .maybeSingle();

        const totalTickets = competition?.total_tickets || 1000;
        const availableCount = Math.max(0, totalTickets - unavailable.size);

        return {
          available_count: availableCount,
          total_tickets: totalTickets,
          sold_count: unavailable.size,
          pending_count: 0 // Can't determine pending count in fallback
        };
      }

      if (data && typeof data === 'object' && (data as any).success) {
        return {
          available_count: (data as any).available_count || 0,
          total_tickets: (data as any).total_tickets || 0,
          sold_count: (data as any).sold_count || 0,
          pending_count: (data as any).pending_count || 0
        };
      }

      // RPC returned error
      console.warn('get_available_ticket_count_v2 returned error:', (data as any)?.error);
      return null;
    } catch (error) {
      handleDatabaseError(error, 'getAvailableTicketCount');
      return null;
    }
  },

  /**
   * Allocate lucky dip tickets atomically on the server side.
   * This function selects random available tickets and reserves them in a single transaction.
   * Use this instead of client-side selection + reservation for race condition prevention.
   *
   * For purchases of more than 100 tickets, use allocateBulkLuckyDipTickets instead.
   */
  async allocateLuckyDipTickets(
    competitionId: string,
    userId: string,
    count: number,
    ticketPrice: number = 1,
    holdMinutes: number = 15,
    sessionId?: string
  ): Promise<{
    success: boolean;
    reservation_id?: string;
    ticket_numbers?: number[];
    ticket_count?: number;
    total_amount?: number;
    expires_at?: string;
    available_count?: number;
    error?: string;
  }> {
    // For large purchases (>100 tickets), delegate to bulk allocation
    if (count > 100) {
      return this.allocateBulkLuckyDipTickets(competitionId, userId, count, ticketPrice, holdMinutes, sessionId);
    }

    // Validate inputs
    if (!competitionId || !userId || count < 1) {
      return {
        success: false,
        error: 'Invalid input parameters'
      };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      return {
        success: false,
        error: 'Invalid competition ID format'
      };
    }

    try {
      const { data, error } = await supabase.rpc('allocate_lucky_dip_tickets', {
        p_user_id: userId.trim(),
        p_competition_id: competitionId.trim(),
        p_ticket_count: count,
        p_ticket_price: ticketPrice,
        p_hold_minutes: holdMinutes,
        p_session_id: sessionId || null
      });

      if (error) {
        console.error('allocate_lucky_dip_tickets RPC error:', error);
        return {
          success: false,
          error: error.message || 'Failed to allocate tickets'
        };
      }

      if (data && typeof data === 'object') {
        const rpcData = data as any;
        return {
          success: rpcData.success === true,
          reservation_id: rpcData.reservation_id,
          ticket_numbers: rpcData.ticket_numbers,
          ticket_count: rpcData.ticket_count,
          total_amount: rpcData.total_amount,
          expires_at: rpcData.expires_at,
          available_count: rpcData.available_count || rpcData.available_count_after,
          error: rpcData.error
        };
      }

      return {
        success: false,
        error: 'Unexpected response from server'
      };
    } catch (error) {
      handleDatabaseError(error, 'allocateLuckyDipTickets');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to allocate tickets'
      };
    }
  },

  /**
   * Allocate bulk lucky dip tickets for large purchases (100+ tickets).
   *
   * This function handles purchases of up to 10,000+ tickets by:
   * 1. Fetching all unavailable tickets upfront via get_competition_unavailable_tickets
   * 2. Splitting the request into batches of max 500 tickets each
   * 3. Executing batches with 3x quiet retries and exponential backoff
   * 4. Aggregating results into a single response
   *
   * @param competitionId - The competition UUID
   * @param userId - The user's canonical ID (will be converted to prize:pid: format)
   * @param count - Number of tickets to allocate (1 to 10,000+)
   * @param ticketPrice - Price per ticket (default: 1)
   * @param holdMinutes - How long to hold the reservation (default: 15)
   * @param sessionId - Optional session ID for tracking
   */
  async allocateBulkLuckyDipTickets(
    competitionId: string,
    userId: string,
    count: number,
    ticketPrice: number = 1,
    holdMinutes: number = 15,
    sessionId?: string
  ): Promise<{
    success: boolean;
    reservation_id?: string;
    reservation_ids?: string[];
    ticket_numbers?: number[];
    ticket_count?: number;
    total_amount?: number;
    expires_at?: string;
    available_count?: number;
    error?: string;
    batch_count?: number;
    retry_attempts?: number;
  }> {
    const MAX_BATCH_SIZE = 500;
    const MAX_RETRIES = 3;
    const BASE_RETRY_DELAY_MS = 500;

    // Validate inputs
    if (!competitionId || competitionId.trim() === '') {
      return { success: false, error: 'Competition ID is required' };
    }

    if (!userId || userId.trim() === '') {
      return { success: false, error: 'User ID is required' };
    }

    if (count < 1) {
      return { success: false, error: 'Count must be at least 1' };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      return { success: false, error: 'Invalid competition ID format' };
    }

    // Normalize user ID
    const canonicalUserId = toPrizePid(userId.trim());
    console.log(`[BulkLuckyDip] Starting allocation of ${count} tickets for ${canonicalUserId.slice(0, 20)}...`);

    try {
      // Step 1: Fetch all unavailable tickets upfront
      let excludedTickets: number[] = [];
      try {
        const { data: unavailableData, error: unavailableError } = await supabase.rpc(
          'get_competition_unavailable_tickets',
          { p_competition_id: competitionId.trim() }
        );

        if (!unavailableError && unavailableData && Array.isArray(unavailableData)) {
          excludedTickets = unavailableData
            .filter((row: any) => row.ticket_number != null)
            .map((row: any) => row.ticket_number);
          console.log(`[BulkLuckyDip] Found ${excludedTickets.length} unavailable tickets`);
        }
      } catch (err) {
        console.warn('[BulkLuckyDip] Could not fetch unavailable tickets, proceeding anyway:', err);
      }

      // Step 2: Calculate batches
      const numBatches = Math.ceil(count / MAX_BATCH_SIZE);
      const batches: number[] = [];
      let remaining = count;
      for (let i = 0; i < numBatches; i++) {
        const batchSize = Math.min(remaining, MAX_BATCH_SIZE);
        batches.push(batchSize);
        remaining -= batchSize;
      }

      console.log(`[BulkLuckyDip] Split into ${numBatches} batches:`, batches);

      // Step 3: Execute batches sequentially with retries
      const allTicketNumbers: number[] = [];
      const allReservationIds: string[] = [];
      let totalRetries = 0;
      let lastExpiresAt: string | null = null;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batchSize = batches[batchIndex];
        let batchSuccess = false;
        let lastBatchError = '';

        // Retry loop for this batch
        for (let attempt = 0; attempt < MAX_RETRIES && !batchSuccess; attempt++) {
          if (attempt > 0) {
            totalRetries++;
            const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1), 5000);
            const jitter = delay * 0.3 * (Math.random() * 2 - 1);
            await new Promise(resolve => setTimeout(resolve, Math.max(0, delay + jitter)));
            console.log(`[BulkLuckyDip] Batch ${batchIndex + 1} retry ${attempt}...`);
          }

          try {
            // Combine pre-existing unavailable + newly allocated from previous batches
            const currentExcluded = [...excludedTickets, ...allTicketNumbers];

            const { data, error } = await supabase.rpc('allocate_lucky_dip_tickets_batch', {
              p_user_id: canonicalUserId,
              p_competition_id: competitionId.trim(),
              p_ticket_count: batchSize,
              p_ticket_price: ticketPrice,
              p_hold_minutes: holdMinutes,
              p_session_id: sessionId || null,
              p_excluded_tickets: currentExcluded.length > 0 ? currentExcluded : null
            });

            if (error) {
              lastBatchError = error.message;
              console.warn(`[BulkLuckyDip] Batch ${batchIndex + 1} attempt ${attempt + 1} error:`, error.message);
              continue;
            }

            const result = typeof data === 'string' ? JSON.parse(data) : data;

            if (!result?.success) {
              lastBatchError = result?.error || 'Unknown error';
              const isRetryable = result?.retryable === true ||
                lastBatchError.includes('locked') ||
                lastBatchError.includes('temporarily');

              if (!isRetryable) {
                // Non-retryable error, break out of retry loop
                break;
              }
              continue;
            }

            // Batch succeeded
            batchSuccess = true;
            if (result.ticket_numbers) {
              allTicketNumbers.push(...result.ticket_numbers);
            }
            if (result.reservation_id) {
              allReservationIds.push(result.reservation_id);
            }
            if (result.expires_at) {
              lastExpiresAt = result.expires_at;
            }

            console.log(`[BulkLuckyDip] Batch ${batchIndex + 1} succeeded: ${result.ticket_count} tickets`);

          } catch (err) {
            lastBatchError = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[BulkLuckyDip] Batch ${batchIndex + 1} attempt ${attempt + 1} exception:`, lastBatchError);
          }
        }

        // If batch failed after all retries
        if (!batchSuccess) {
          console.error(`[BulkLuckyDip] Batch ${batchIndex + 1} failed after ${MAX_RETRIES} attempts`);

          // Return partial success if we have some tickets
          if (allTicketNumbers.length > 0) {
            return {
              success: false,
              reservation_ids: allReservationIds,
              ticket_numbers: allTicketNumbers,
              ticket_count: allTicketNumbers.length,
              total_amount: allTicketNumbers.length * ticketPrice,
              expires_at: lastExpiresAt || undefined,
              error: `Partial allocation: ${allTicketNumbers.length}/${count} tickets reserved. Batch ${batchIndex + 1} failed: ${lastBatchError}`,
              batch_count: batchIndex,
              retry_attempts: totalRetries
            };
          }

          return {
            success: false,
            error: lastBatchError || 'Failed to allocate tickets',
            batch_count: 0,
            retry_attempts: totalRetries
          };
        }
      }

      // All batches succeeded
      console.log(`[BulkLuckyDip] Successfully allocated ${allTicketNumbers.length} tickets across ${numBatches} batches`);

      return {
        success: true,
        reservation_id: allReservationIds[0], // Primary reservation ID
        reservation_ids: allReservationIds,
        ticket_numbers: allTicketNumbers,
        ticket_count: allTicketNumbers.length,
        total_amount: allTicketNumbers.length * ticketPrice,
        expires_at: lastExpiresAt || undefined,
        batch_count: numBatches,
        retry_attempts: totalRetries
      };

    } catch (error) {
      handleDatabaseError(error, 'allocateBulkLuckyDipTickets');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to allocate tickets'
      };
    }
  },

  // Get accurate ticket availability using RPC function (if available)
  // Falls back to existing getUnavailableTicketsForCompetition if RPC not available
  async getAccurateTicketAvailability(competitionId: string): Promise<{
    competition_id: string;
    total_tickets: number;
    available_tickets: number[];
    sold_count: number;
    available_count: number;
  } | null> {
    // Validate competitionId
    if (!competitionId || competitionId.trim() === '') {
      return null;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      return null;
    }

    try {
      // Use the text wrapper RPC to avoid uuid = text type errors
      const { data, error } = await supabase.rpc('get_competition_ticket_availability_text', {
        competition_id_text: competitionId.trim()
      });

      if (error) {
        console.warn('RPC get_competition_ticket_availability_text not available, using fallback:', error.message);
        // Fallback to existing method
        return null;
      }

      // Parse the JSON response if needed
      if (data && typeof data === 'object') {
        const rpcData = data as any;
        // Check for error responses from the RPC function
        // The RPC returns { error: "message" } when competition is not found or invalid
        if (rpcData.error) {
          console.warn('RPC get_competition_ticket_availability_text returned error:', rpcData.error);
          return null;
        }
        return {
          competition_id: rpcData.competition_id || competitionId,
          total_tickets: rpcData.total_tickets || 0,
          available_tickets: Array.isArray(rpcData.available_tickets) ? rpcData.available_tickets : [],
          sold_count: rpcData.sold_count || 0,
          available_count: rpcData.available_count || 0
        };
      }

      return null;
    } catch (error) {
      handleDatabaseError(error, 'getAccurateTicketAvailability');
      return null;
    }
  },

  // Get user's tickets for a specific competition using RPC function (if available)
  async getUserTicketsForCompetition(userId: string, competitionId: string): Promise<{
    user_id: string;
    competition_id: string;
    tickets: number[];
    ticket_count: number;
  } | null> {
    // Validate inputs
    if (!userId || !competitionId) {
      return null;
    }

    try {
      const { data, error } = await supabase.rpc('get_user_tickets_for_competition', {
        user_id: userId.trim(),
        competition_id: competitionId.trim()
      });

      if (error) {
        console.warn('RPC get_user_tickets_for_competition not available:', error.message);
        return null;
      }

      return (data || []) as any;
    } catch (error) {
      handleDatabaseError(error, 'getUserTicketsForCompetition');
      return null;
    }
  },

  /**
   * Assign tickets to a user with priority for user-selected tickets
   * PRIORITY: Use user selections first, fallback to random assignment
   */
  async assignTickets(
    competitionId: string,
    userId: string,
    selectedTickets: number[] | null = null
  ): Promise<number[]> {
    // PRIORITY: Use user selections first
    if (selectedTickets && selectedTickets.length > 0) {
      // Verify tickets are available
      const availableTickets = await this.getAvailableTicketsForCompetition(
        competitionId,
        1000 // Max tickets to check
      );
      const availableSet = new Set(availableTickets);
      const unavailable = selectedTickets.filter(t => !availableSet.has(t));

      if (unavailable.length > 0) {
        throw new Error(`Tickets ${unavailable.join(', ')} are no longer available`);
      }

      // Reserve tickets first to prevent race conditions
      const { error } = await supabase
        .from('pending_tickets')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          competition_id: competitionId,
          ticket_numbers: selectedTickets,
          ticket_count: selectedTickets.length,
          status: 'pending',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        handleDatabaseError(error, 'assignTickets - reserve');
        throw new Error('Failed to reserve tickets');
      }

      return selectedTickets;
    }

    // Fallback only if no selection provided - assign random tickets
    return await this.assignRandomTickets(competitionId, userId, 1);
  },

  /**
   * Assign random tickets when user doesn't specify selection
   */
  async assignRandomTickets(
    competitionId: string,
    userId: string,
    ticketCount: number = 1
  ): Promise<number[]> {
    try {
      const { data: competition } = await supabase
        .from('competitions')
        .select('total_tickets')
        .eq('id', competitionId)
        .maybeSingle();

      const totalTickets = competition?.total_tickets || 1000;
      const availableTickets = await this.getAvailableTicketsForCompetition(competitionId, totalTickets);

      if (availableTickets.length < ticketCount) {
        throw new Error(`Not enough tickets available. Requested: ${ticketCount}, Available: ${availableTickets.length}`);
      }

      // Shuffle and pick random tickets
      const shuffled = [...availableTickets].sort(() => Math.random() - 0.5);
      const selectedTickets = shuffled.slice(0, ticketCount);

      // Reserve the tickets
      const { error } = await supabase
        .from('pending_tickets')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          competition_id: competitionId,
          ticket_numbers: selectedTickets,
          ticket_count: selectedTickets.length,
          status: 'pending',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        handleDatabaseError(error, 'assignRandomTickets');
        throw new Error('Failed to reserve random tickets');
      }

      return selectedTickets;
    } catch (error) {
      handleDatabaseError(error, 'assignRandomTickets - outer catch');
      throw error;
    }
  },

  /**
   * Reserve tickets with database lock to prevent race conditions
   * ISSUE #4 FIX: Uses atomic RPC function for transaction-level consistency
   */
  async reserveTickets(
    competitionId: string,
    ticketNumbers: number[],
    userId: string,
    timeoutMinutes: number = 10
  ): Promise<{ reservationId: string; success: boolean; error?: string }> {
    try {
      const reservationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

      // ISSUE #4 FIX: Try to use atomic RPC function first for transaction-level consistency
      // This prevents race conditions by using database-level locking
      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('reserve_tickets_atomically', {
          p_competition_id: competitionId,
          p_user_id: userId,
          p_ticket_count: ticketNumbers.length,
          p_hold_minutes: timeoutMinutes,
        } as any);

        if (!rpcError && rpcResult) {
          const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
          if (result.success) {
            return { reservationId: result.reservation_id || reservationId, success: true };
          } else {
            return { reservationId: '', success: false, error: result.error || 'Atomic reservation failed' };
          }
        }
        // If RPC not available, fall back to non-atomic approach
        console.warn('Atomic reservation RPC not available, using fallback');
      } catch (rpcErr) {
        console.warn('Atomic reservation RPC failed, using fallback:', rpcErr);
      }

      // Fallback: non-atomic approach (original implementation)
      // First, verify all tickets are still available (includes user exclusion)
      const unavailable = await this.getUnavailableTicketsForCompetition(competitionId, userId);
      const conflicting = ticketNumbers.filter(t => unavailable.has(t));

      if (conflicting.length > 0) {
        return {
          reservationId: '',
          success: false,
          error: `Tickets ${conflicting.join(', ')} are no longer available`
        };
      }

      // Cancel any existing pending reservations for this user/competition
      await supabase
        .from('pending_tickets')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('competition_id', competitionId)
        .eq('status', 'pending');

      // ISSUE #4 FIX: Double-check availability after cancelling own reservations
      // This narrows the race condition window
      const recheckUnavailable = await this.getUnavailableTicketsForCompetition(competitionId, userId);
      const recheckConflicting = ticketNumbers.filter(t => recheckUnavailable.has(t));

      if (recheckConflicting.length > 0) {
        return {
          reservationId: '',
          success: false,
          error: `Tickets ${recheckConflicting.join(', ')} were reserved by another user`
        };
      }

      // Create new reservation
      const { error } = await supabase
        .from('pending_tickets')
        .insert({
          id: reservationId,
          user_id: userId,
          competition_id: competitionId,
          ticket_numbers: ticketNumbers,
          ticket_count: ticketNumbers.length,
          status: 'pending',
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        // ISSUE #4 FIX: Check if error is a unique constraint violation (another user reserved)
        if (error.code === '23505' || error.message?.includes('unique') || error.message?.includes('duplicate')) {
          return { reservationId: '', success: false, error: 'One or more tickets were just reserved by another user' };
        }
        handleDatabaseError(error, 'reserveTickets');
        return { reservationId: '', success: false, error: error.message };
      }

      return { reservationId, success: true };
    } catch (error) {
      handleDatabaseError(error, 'reserveTickets - outer catch');
      return { reservationId: '', success: false, error: 'Failed to reserve tickets' };
    }
  },

  /**
   * Confirm reserved tickets after payment is complete
   */
  async confirmReservedTickets(reservationId: string): Promise<boolean> {
    try {
      // Use RPC function to bypass RLS which fails with Privy auth (auth.uid() is null)
      const { data, error: rpcError } = await supabase.rpc(
        'confirm_pending_ticket_reservation' as any,
        { p_reservation_id: reservationId }
      );

      if (rpcError) {
        // Fallback to direct update if RPC doesn't exist yet
        console.warn('[confirmReservedTickets] RPC not available, using fallback:', rpcError.message);

        const { error } = await supabase
          .from('pending_tickets')
          .update({
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', reservationId)
          .eq('status', 'pending');

        if (error) {
          handleDatabaseError(error, 'confirmReservedTickets');
          return false;
        }

        return true;
      }

      return data === true;
    } catch (error) {
      handleDatabaseError(error, 'confirmReservedTickets - outer catch');
      return false;
    }
  },

  /**
   * ISSUE 4C FIX: Sync stale competition statuses on dashboard load
   *
   * This function checks if any competitions the user has entered have ended
   * (based on end_date) but haven't had their status updated by the scheduled job.
   * It's called on dashboard load to ensure users see accurate entry statuses.
   *
   * The status sync only affects the local display - actual status updates
   * are handled by the server-side competition-lifecycle-checker.mts function.
   */
  async syncStaleCompetitionStatuses(competitionIds: string[]): Promise<{ updated: string[]; failed: string[] }> {
    const updated: string[] = [];
    const failed: string[] = [];

    if (!competitionIds || competitionIds.length === 0) {
      return { updated, failed };
    }

    try {
      // Get competitions that might be stale (ended but still marked active)
      const { data: competitions, error } = await supabase
        .from('competitions')
        .select('id, status, end_date')
        .in('id', competitionIds)
        .eq('status', 'active')
        .not('end_date', 'is', null);

      if (error) {
        console.warn('[syncStaleCompetitionStatuses] Error fetching competitions:', error);
        return { updated, failed };
      }

      if (!competitions || competitions.length === 0) {
        return { updated, failed };
      }

      const now = new Date();
      const staleCompetitions = competitions.filter(c => {
        if (!c.end_date) return false;
        const endDate = new Date(c.end_date);
        return endDate < now;
      });

      if (staleCompetitions.length === 0) {
        return { updated, failed };
      }

      databaseLogger.info(`[syncStaleCompetitionStatuses] Found ${staleCompetitions.length} stale competitions`);

      // Try to trigger a status sync via RPC (if available)
      // This will update the database so future loads don't need to sync
      for (const competition of staleCompetitions) {
        try {
          // Try calling an RPC to sync status (may not exist in all environments)
          const { error: rpcError } = await supabase.rpc('sync_competition_status_if_ended', {
            p_competition_id: competition.id
          });

          if (rpcError) {
            // RPC doesn't exist or failed - that's OK, we'll handle it client-side
            // The EntriesList already overrides status based on end_date
            databaseLogger.debug(`[syncStaleCompetitionStatuses] RPC not available for ${competition.id}`);
            failed.push(competition.id);
          } else {
            updated.push(competition.id);
          }
        } catch (rpcErr) {
          failed.push(competition.id);
        }
      }

      if (updated.length > 0) {
        databaseLogger.success(`[syncStaleCompetitionStatuses] Updated ${updated.length} competition(s)`);
      }

      return { updated, failed };
    } catch (error) {
      handleDatabaseError(error, 'syncStaleCompetitionStatuses');
      return { updated, failed };
    }
  },

  /**
   * Fetch user entries from the public.competition_entries table.
   * This is the primary source for user dashboard entries.
   * Falls back to getUserEntries if the RPC is not available.
   */
  async getUserEntriesFromCompetitionEntries(userId: string) {
    try {
      if (!userId || userId.trim() === '') {
        databaseLogger.warn('getUserEntriesFromCompetitionEntries: No userId provided');
        return [];
      }

      // Try the new RPC that reads from competition_entries table
      const { data, error } = await getUserCompetitionEntries(supabase, userId);

      if (error) {
        databaseLogger.warn('get_user_competition_entries RPC not available, falling back to getUserEntries', error.message);
        // Fallback to the legacy method
        return this.getUserEntries(userId);
      }

      if (!data || !Array.isArray(data) || data.length === 0) {
        databaseLogger.info('getUserEntriesFromCompetitionEntries: No entries in competition_entries, falling back to comprehensive method');
        // Fallback to the comprehensive method that queries joincompetition, tickets, user_transactions, and pending_tickets
        return this.getUserEntries(userId);
      }

      databaseLogger.success(`getUserEntriesFromCompetitionEntries: Found ${data.length} entries`);

      // Transform to the format expected by the frontend
      const formattedEntries = data.map((entry: any) => {
        // Map entry_status to frontend status
        let status = 'live';
        if (entry.entry_status === 'confirmed') {
          if (entry.competition_status === 'completed' || entry.competition_status === 'drawn') {
            status = 'completed';
          } else if (entry.competition_status === 'active') {
            status = 'live';
          } else {
            status = entry.competition_status || 'live';
          }
        } else if (entry.entry_status === 'pending') {
          status = 'pending';
        } else if (entry.entry_status === 'cancelled') {
          return null; // Filter out cancelled entries
        }

        // Check if competition has ended based on end_date
        const now = new Date();
        const endDate = entry.competition_end_date ? new Date(entry.competition_end_date) : null;
        const isCompetitionEnded = endDate !== null && endDate < now;
        if (isCompetitionEnded && status === 'live') {
          status = 'completed';
        }

        return {
          id: entry.id,
          competition_id: entry.competition_id,
          title: entry.competition_title || 'Unknown Competition',
          description: entry.competition_description || '',
          image: entry.competition_image_url,
          status: status,
          entry_type: entry.entry_status === 'pending' ? 'pending' : 'completed',
          expires_at: null,
          is_winner: entry.is_winner || false,
          ticket_numbers: Array.isArray(entry.ticket_numbers)
            ? entry.ticket_numbers.join(',')
            : entry.ticket_numbers || '',
          number_of_tickets: entry.tickets_count || entry.ticket_count || 0,
          amount_spent: entry.amount_spent || entry.amount_paid || 0,
          purchase_date: entry.latest_purchase_at || entry.created_at,
          wallet_address: entry.wallet_address,
          transaction_hash: entry.transaction_hash,
          is_instant_win: entry.is_instant_win || entry.competition_is_instant_win || false,
          prize_value: entry.prize_value || entry.competition_prize_value
            ? `$${Number(entry.prize_value || entry.competition_prize_value).toLocaleString()}`
            : null,
          competition_status: entry.competition_status || 'active',
          end_date: entry.end_date || entry.competition_end_date,
        };
      }).filter((entry: any) => entry !== null);

      return formattedEntries;
    } catch (error) {
      handleDatabaseError(error, 'getUserEntriesFromCompetitionEntries');
      // Fallback to legacy method on error
      return this.getUserEntries(userId);
    }
  }


};

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
  const isWinner = identity.walletAddress && comp?.winner_address
    ? userIdsEqual(jc.walletaddress, comp.winner_address) ||
      userIdsEqual(identity.walletAddress, comp.winner_address)
    : false;

  // Generate a safe ID - use a combination of fields if uid/id are missing
  const entryId = jc.uid || jc.id || `entry-${jc.competitionid || 'no-comp'}-${jc.walletaddress?.substring(0, 8) || 'no-wallet'}-${jc.purchasedate || 'unknown'}`;

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
    number_of_tickets: jc.numberoftickets || 1,
    amount_spent: jc.amountspent,
    purchase_date: jc.purchasedate || jc.created_at,
    wallet_address: jc.walletaddress,
    transaction_hash: jc.transactionhash,
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

      // Process image URLs and hydrate ticket progress
      const processedData = await Promise.all(
        (data || []).map(async comp => {
          const competitionId = comp.id || comp.uid;
          let ticketsSold = comp.tickets_sold;

          // Derive tickets sold (including active reservations) when not already present
          if (!Number.isFinite(ticketsSold) && competitionId) {
            const unavailable = await this.getUnavailableTicketsForCompetition(competitionId);
            ticketsSold = unavailable.size;
          }

          return {
            ...comp,
            tickets_sold: ticketsSold,
            image_url: getImageUrl(comp.image_url || comp.imageurl),
          };
        })
      );

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
          status: data.competitionended === 0 ? 'active' : 'finished',
          is_instant_win: data.instant || false,
          is_featured: data.featured === 1,
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
      // Fetch all winners with extended fields including competition and user data
      const { data: winners, error } = await supabase
        .from('competition_winners')
        .select('competitionprize, Winner, crDate, competitionname, imageurl, competitionid, txhash')
        .not('Winner', 'is', null)
        .order('crDate', { ascending: false, nullsLast: true })
        .limit(100);

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
        return true;
      };

      // Filter for only monetary ($) or crypto prizes (BTC, ETH, SOL, USDT, USDC, etc.)
      // Also include numeric prizes (treat any prize with a valid value as displayable)
      // AND filter out test/fake winner addresses
      const filteredWinners = (winners || []).filter((winner) => {
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

      // Batch fetch user data for winners
      const winnerAddresses = [...new Set(filteredWinners.slice(0, limit).map(w => w.Winner).filter(Boolean))];
      const { data: usersData } = winnerAddresses.length > 0
        ? await supabase
            .from('canonical_users')
            .select('username, avatar_url, wallet_address, country')
            .in('wallet_address', winnerAddresses)
        : { data: [] };

      // Batch fetch competition end_dates for draw dates
      const competitionIds = [...new Set(filteredWinners.slice(0, limit).map(w => w.competitionid).filter(Boolean))];
      const { data: competitionsData } = competitionIds.length > 0
        ? await supabase
            .from('competitions')
            .select('id, end_date')
            .in('id', competitionIds)
        : { data: [] };

      // Create competition lookup map for end_dates
      const competitionEndDateMap = new Map<string, string | null>();
      for (const comp of competitionsData || []) {
        if (comp.id) {
          competitionEndDateMap.set(comp.id, comp.end_date);
        }
      }

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
        // Skip winners without a valid prize - don't show placeholder data
        if (!winner.competitionprize) continue;

        const winnerAddress = winner.Winner;
        const userData = winnerAddress ? userMap.get(winnerAddress.toLowerCase()) : null;

        // Format wallet address for display
        const walletDisplay = winnerAddress && winnerAddress.length > 10
          ? winnerAddress.substring(0, 8) + '...' + winnerAddress.slice(-4)
          : winnerAddress || 'N/A';

        // Use real username if available, otherwise truncated wallet
        const displayName = userData?.username || walletDisplay;

        // Use actual competition end_date as the draw date, fallback to crDate if not available
        const competitionEndDate = winner.competitionid ? competitionEndDateMap.get(winner.competitionid) : null;
        const drawDate = formatDate(competitionEndDate || winner.crDate);

        mappedWinners.push({
          prize: winner.competitionprize,
          username: displayName,
          country: userData?.country || 'International',
          wallet: walletDisplay,
          date: drawDate,
          showInstantWin: false,
          avatarUrl: userData?.avatar_url || getRandomAvatar(),
          competitionId: winner.competitionid || '',
          txHash: winner.txhash || '',
        });
      }

      return mappedWinners;
    } catch (error) {
      handleDatabaseError(error, 'getAllWinners - outer catch');
      return [];
    }
  },


  async getWinners(limit: number = 50): Promise<WinnerCardProps[]> {
    // Fetch all winners with extended fields including competition and user data
    const { data: winners, error } = await supabase
      .from('competition_winners')
      .select('competitionprize, Winner, crDate, competitionname, imageurl, competitionid, txhash')
      .not('Winner', 'is', null)
      .order('crDate', { ascending: false, nullsLast: true })
      .limit(100);

    if (error) {
      console.error('Error fetching winners from competition_winners:', error);
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
      return true;
    };

    // Filter for only monetary ($) or crypto prizes (BTC, ETH, SOL, USDT, USDC, etc.)
    // Also include numeric prizes (treat any prize with a valid value as displayable)
    // AND filter out test/fake winner addresses
    const filteredWinners = (winners || []).filter((winner) => {
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

    // Batch fetch user data for winners
    const winnerAddresses = [...new Set(filteredWinners.slice(0, limit).map(w => w.Winner).filter(Boolean))];
    const { data: usersData } = winnerAddresses.length > 0
      ? await supabase
          .from('canonical_users')
          .select('username, avatar_url, wallet_address, country')
          .in('wallet_address', winnerAddresses)
      : { data: [] };

    // Batch fetch competition end_dates for draw dates
    const competitionIds = [...new Set(filteredWinners.slice(0, limit).map(w => w.competitionid).filter(Boolean))];
    const { data: competitionsData } = competitionIds.length > 0
      ? await supabase
          .from('competitions')
          .select('id, end_date')
          .in('id', competitionIds)
      : { data: [] };

    // Create competition lookup map for end_dates
    const competitionEndDateMap = new Map<string, string | null>();
    for (const comp of competitionsData || []) {
      if (comp.id) {
        competitionEndDateMap.set(comp.id, comp.end_date);
      }
    }

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
      // Skip winners without a valid prize - don't show placeholder data
      if (!winner.competitionprize) continue;

      const winnerAddress = winner.Winner;
      const userData = winnerAddress ? userMap.get(winnerAddress.toLowerCase()) : null;

      // Format wallet address for display
      const walletDisplay = winnerAddress && winnerAddress.length > 10
        ? winnerAddress.substring(0, 8) + '...' + winnerAddress.slice(-4)
        : winnerAddress || 'N/A';

      // Use real username if available, otherwise truncated wallet
      const displayName = userData?.username || walletDisplay;

      // Use actual competition end_date as the draw date, fallback to crDate if not available
      const competitionEndDate = winner.competitionid ? competitionEndDateMap.get(winner.competitionid) : null;
      const drawDate = formatDate(competitionEndDate || winner.crDate);

      mappedWinners.push({
        prize: winner.competitionprize,
        username: displayName,
        country: userData?.country || 'International',
        wallet: walletDisplay,
        date: drawDate,
        showInstantWin: false,
        avatarUrl: userData?.avatar_url || getRandomAvatar(),
        competitionId: winner.competitionid || '',
        txHash: winner.txhash || '',
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
          image: getImageUrl(comp?.imageurl),
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

    return Object.entries(ordersByTx || {}).map(([txHash, order]: [string, any], index: number) => ({
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
    }));
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
    const walletAddresses = [...new Set((entryData || []).map(t => t.walletaddress).filter(Boolean))];

    // Batch fetch competitions (single query instead of N queries)
    const { data: competitionsData } = competitionIds.length > 0
      ? await supabase
          .from('competitions')
          .select('id, title, image_url, prize_value, end_date')
          .in('id', competitionIds)
      : { data: [] };

    // Create competition lookup map for O(1) access
    const competitionMap = new Map<string, { competitionname: string; uid: string; imageurl: string | null; competitionprize: string; end_date: string | null }>();
    for (const comp of competitionsData || []) {
      competitionMap.set(comp.id, {
        competitionname: comp.title,
        uid: comp.id,
        imageurl: comp.image_url,
        competitionprize: comp.prize_value,
        end_date: comp.end_date
      });
    }

    // Batch fetch users by wallet addresses (single query instead of N queries)
    const { data: usersData } = walletAddresses.length > 0
      ? await supabase
          .from('canonical_users')
          .select('username, avatar_url, wallet_address')
          .in('wallet_address', walletAddresses)
      : { data: [] };

    // Create user lookup map for O(1) access
    const userMap = new Map<string, { username: string | null; avatar_url: string | null }>();
    for (const user of usersData || []) {
      if (user.wallet_address) {
        userMap.set(user.wallet_address.toLowerCase(), {
          username: user.username,
          avatar_url: user.avatar_url
        });
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

      const userData = ticket.walletaddress ? userMap.get(ticket.walletaddress.toLowerCase()) : null;

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
        (ticket.walletaddress
          ? ticket.walletaddress.substring(0, 6) + '...' + ticket.walletaddress.slice(-4)
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
    const { data: winnerData } = await supabase
      .from('competition_winners')
      .select('competitionprize, Winner, crDate, competitionname, imageurl')
      .not('Winner', 'is', null)
      .order('crDate', { ascending: false, nullsLast: true })
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
    const { data: winnerUsersData } = winnerIdentifiers.length > 0
      ? await supabase
          .from('canonical_users')
          .select('canonical_user_id, id, username, avatar_url, wallet_address')
          .or(winnerIdentifiers.map(id => `canonical_user_id.eq.${id},wallet_address.eq.${id}`).join(','))
      : { data: [] };

    // Create winner user lookup map
    const winnerUserMap = new Map<string, { username: string | null; avatar_url: string | null }>();
    for (const user of winnerUsersData || []) {
      if (user.canonical_user_id) {
        winnerUserMap.set(user.canonical_user_id, { username: user.username, avatar_url: user.avatar_url });
      }
      if (user.wallet_address) {
        winnerUserMap.set(user.wallet_address.toLowerCase(), { username: user.username, avatar_url: user.avatar_url });
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

      const displayName = userData?.username ||
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
      // Uses pending_tickets.ticket_numbers (array), filters where expires_at > now() and status IN ('pending','confirming')
      databaseLogger.request('rpc/get_unavailable_tickets', {
        competition_id: competitionId.slice(0, 8) + '...'
      });

      const { data: unavailableTickets, error: rpcError } = await supabase
        .rpc('get_unavailable_tickets', { p_competition_id: competitionId.trim() });

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
      const { data, error } = await supabase
        .rpc('get_user_transactions', {
          user_identifier: userId.trim()
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

      // Get unique competition IDs to fetch competition details separately
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

      // Format transactions for display - filter out incomplete/cancelled transactions
      const formattedTransactions = (data || [])
        .filter((tx: any) => {
          // Only show completed/finished transactions, not pending/failed/cancelled
          const status = (tx.status || '').toLowerCase();
          return status === 'completed' || status === 'finished' || status === 'confirmed' || status === 'success';
        })
        .map((tx: any) => {
        const competition = competitionsMap[tx.competition_id];
        // Recognize top-ups: no competition_id OR webhook_ref starts with 'TOPUP_'
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
          tx_id: tx.tx_id || tx.order_id || null,
          status: tx.status,
          payment_status: tx.payment_status,
          created_at: tx.created_at,
          completed_at: tx.completed_at,
          is_topup: isTopUp,
          transaction_type: isTopUp ? 'topup' : 'entry',
          action: (() => {
            const statusLower = (tx.status || '').toLowerCase().trim();
            if (statusLower === 'completed' || statusLower === 'finished' || statusLower === 'confirmed' || statusLower === 'success') return 'View';
            if (statusLower === 'pending') return 'Pending';
            if (statusLower === 'failed' || statusLower === 'cancelled' || statusLower === 'expired') return 'Failed';
            return 'Processing';
          })(),
        };
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
      const { data, error } = await supabase
        .from('user_transactions')
        .select('*')
        .or(`user_id.ilike.${normalizedWallet},canonical_user_id.eq.${canonicalId},wallet_address.ilike.${normalizedWallet}`)
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
            tx_id: tx.tx_id || tx.order_id || null,
            status: tx.status,
            payment_status: tx.payment_status,
            created_at: tx.created_at,
            completed_at: tx.completed_at,
            is_topup: isTopUp,
            transaction_type: isTopUp ? 'topup' : 'entry',
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
        const { data, error } = await supabase
          .rpc('get_comprehensive_user_dashboard_entries', {
            user_identifier: identity.primaryId
          });

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
          // ISSUE #1 FIX: Use single OR query with all identifier types instead of sequential fallback queries
          // This ensures we find all entries regardless of which identifier was stored
          const identityFilter = buildIdentityFilter(identity);

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
                .eq('walletaddress', identity.walletAddress)
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

              // If OR filter fails (400 error), try individual queries as fallback
              if (joinError.code === 'PGRST100' || joinError.message?.includes('400')) {
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
          return [];
        }
      }

      if (!entries || entries.length === 0) {
        databaseLogger.info('getUserEntries: No entries found for user: ' + userId.substring(0, 20) + '...');
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
          number_of_tickets: entry.number_of_tickets || 1,
          amount_spent: entry.amount_spent,
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
   */
  async _getUserEntriesIndividualQueries(identity: ResolvedIdentity): Promise<any[]> {
    const allEntries: any[] = [];
    const seenIds = new Set<string>();

    const selectQuery = `
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

    // Try wallet address first (most common for Base auth)
    if (identity.walletAddress) {
      try {
        const { data, error } = await supabase
          .from('v_joincompetition_active')
          .select(selectQuery)
          .eq('walletaddress', identity.walletAddress)
          .order('purchasedate', { ascending: false });

        if (!error && data) {
          data.forEach((jc: any) => {
            const id = jc.uid || jc.id;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              allEntries.push(transformJoinCompetitionEntry(jc, identity));
            }
          });
          databaseLogger.debug('Individual query (wallet) found entries', { count: data.length });
        } else if (error) {
          databaseLogger.error('Individual query (wallet) error', error);
        }
      } catch (e) {
        databaseLogger.error('Individual query (wallet) exception', e);
      }
    }

    // Try canonical_user_id if available
    if (identity.canonicalUserId) {
      try {
        const { data, error } = await supabase
          .from('v_joincompetition_active')
          .select(selectQuery)
          .eq('userid', identity.canonicalUserId)
          .order('purchasedate', { ascending: false });

        if (!error && data) {
          data.forEach((jc: any) => {
            const id = jc.uid || jc.id;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              allEntries.push(transformJoinCompetitionEntry(jc, identity));
            }
          });
          databaseLogger.debug('Individual query (canonical) found entries', { count: data.length });
        } else if (error) {
          databaseLogger.error('Individual query (canonical) error', error);
        }
      } catch (e) {
        databaseLogger.error('Individual query (canonical) exception', e);
      }
    }

    // Try legacy userid
    if (identity.legacyUserId) {
      try {
        const { data, error } = await supabase
          .from('v_joincompetition_active')
          .select(selectQuery)
          .eq('userid', identity.legacyUserId)
          .order('purchasedate', { ascending: false });

        if (!error && data) {
          data.forEach((jc: any) => {
            const id = jc.uid || jc.id;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              allEntries.push(transformJoinCompetitionEntry(jc, identity));
            }
          });
          databaseLogger.debug('Individual query (legacy) found entries', { count: data.length });
        } else if (error) {
          databaseLogger.error('Individual query (legacy) error', error);
        }
      } catch (e) {
        databaseLogger.error('Individual query (legacy) exception', e);
      }
    }

    databaseLogger.info('Individual queries complete', { totalEntries: allEntries.length });
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

      if (data && typeof data === 'object' && data.success) {
        return {
          available_count: data.available_count || 0,
          total_tickets: data.total_tickets || 0,
          sold_count: data.sold_count || 0,
          pending_count: data.pending_count || 0
        };
      }

      // RPC returned error
      console.warn('get_available_ticket_count_v2 returned error:', data?.error);
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
    // Validate inputs
    if (!competitionId || !userId || count < 1 || count > 100) {
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
        p_count: count,
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
        return {
          success: data.success === true,
          reservation_id: data.reservation_id,
          ticket_numbers: data.ticket_numbers,
          ticket_count: data.ticket_count,
          total_amount: data.total_amount,
          expires_at: data.expires_at,
          available_count: data.available_count || data.available_count_after,
          error: data.error
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
        // Check for error responses from the RPC function
        // The RPC returns { error: "message" } when competition is not found or invalid
        if (data.error) {
          console.warn('RPC get_competition_ticket_availability_text returned error:', data.error);
          return null;
        }
        return {
          competition_id: data.competition_id || competitionId,
          total_tickets: data.total_tickets || 0,
          available_tickets: Array.isArray(data.available_tickets) ? data.available_tickets : [],
          sold_count: data.sold_count || 0,
          available_count: data.available_count || 0
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

      return data;
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
          p_ticket_numbers: ticketNumbers,
          p_reservation_id: reservationId,
          p_expires_at: expiresAt,
        });

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
        'confirm_pending_ticket_reservation',
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
  }


};

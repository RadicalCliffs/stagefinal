import { useState, useEffect } from "react";
import { CopyIcon, CopyCheckIcon, ExternalLink } from "lucide-react";
import { handleCopy } from "../../utils/util";
import { supabase } from "../../lib/supabase";

interface WinnerResultsTableProps {
  competitionId: string;
}

interface WinnerData {
  txHash: string | null;
  min: number;
  max: number;
  winningNumber: number;
  result: number;
  username: string | null;
  walletAddress: string | null;
}

const WinnerResultsTable = ({ competitionId }: WinnerResultsTableProps) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [data, setData] = useState<WinnerData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWinnerData = async () => {
      if (!competitionId) {
        setLoading(false);
        return;
      }

      try {
        // Fetch winners from the winners table
        const { data: winnersData, error: winnersError } = await supabase
          .from('winners')
          .select('ticket_number, wallet_address')
          .eq('competition_id', competitionId);

        if (winnersError) {
          console.error('Error fetching winners:', winnersError);
        }

        // Fetch competition details for total tickets and VRF data
        const { data: compData, error: compError } = await supabase
          .from('competitions')
          .select('total_tickets, tickets_sold, vrf_tx_hash, outcomes_vrf_seed')
          .eq('id', competitionId)
          .maybeSingle() as any;

        if (compError) {
          console.error('Error fetching competition:', compError);
        }

        // Fetch usernames for winner wallet addresses
        const usernameMap = new Map<string, string>();
        if (winnersData && winnersData.length > 0) {
          const walletAddresses = winnersData.map((w: any) => w.wallet_address).filter(Boolean);
          if (walletAddresses.length > 0) {
            const { data: usersData } = await supabase
              .from('canonical_users')
              .select('username, wallet_address')
              .in('wallet_address', walletAddresses) as any;
            
            if (usersData) {
              for (const user of usersData) {
                if (user.wallet_address) {
                  usernameMap.set(user.wallet_address.toLowerCase(), user.username || '');
                }
              }
            }
          }
        }

        // Build the results data
        const results: WinnerData[] = [];

        // Add data from winners table
        if (winnersData && winnersData.length > 0) {
          for (const winner of winnersData as any[]) {
            const username = winner.wallet_address 
              ? usernameMap.get(winner.wallet_address.toLowerCase()) 
              : null;
            
            results.push({
              txHash: compData?.vrf_tx_hash || null,
              min: 1,
              max: compData?.tickets_sold || compData?.total_tickets || 1000,
              winningNumber: winner.ticket_number || 0,
              result: winner.ticket_number || 0,
              username: username || null,
              walletAddress: winner.wallet_address,
            });
          }
        }

        setData(results);
      } catch (error) {
        console.error('Error fetching winner data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWinnerData();
  }, [competitionId]);



  // Generate BaseScan URL from transaction hash
  const getBaseScanUrl = (txHash: string): string => {
    if (!txHash) return '';
    const cleanHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
    const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
    const explorerDomain = isMainnet ? 'basescan.org' : 'sepolia.basescan.org';
    return `https://${explorerDomain}/tx/${cleanHash}`;
  };

  // Check if a hash is a valid transaction hash
  const isValidTxHash = (hash: string | null): boolean => {
    if (!hash) return false;
    const cleanHash = hash.startsWith('0x') ? hash : `0x${hash}`;
    return /^0x[a-fA-F0-9]{64}$/.test(cleanHash);
  };

  if (loading) {
    return (
      <div className="lg:max-w-6xl max-w-7xl bg-[#191919] rounded-2xl mx-auto lg:px-14 px-8 py-8 relative z-10">
        <div className="animate-pulse">
          <div className="h-6 bg-[#2A2A2A] rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-[#2A2A2A] rounded w-2/3 mb-2"></div>
        </div>
      </div>
    );
  }

  // If no winner data, don't show the table
  if (data.length === 0) {
    return null;
  }

  return (
    <div className="lg:max-w-6xl max-w-7xl bg-[#191919] rounded-2xl mx-auto lg:px-14 px-8 py-8 relative z-10">
      <h3 className="text-white sequel-95 text-xl mb-6">Winner Results</h3>

      {/* Desktop Header */}
      <div className="hidden md:grid grid-cols-5 text-white sequel-75 text-base mb-6 whitespace-nowrap">
        <p>TX Hash</p>
        <p className="text-center">Min</p>
        <p className="text-center">Max</p>
        <p className="text-center">Winning Ticket</p>
        <p className="text-end">Winner</p>
      </div>

      {/* Divider line for desktop */}
      <div className="hidden md:block h-0.5 w-full bg-[#DDE404] mb-6"></div>

      {/* Rows */}
      <div className="space-y-4">
        {data.map((item, index) => (
          <div key={index}>
            {/* Desktop Layout */}
            <div className="hidden md:grid grid-cols-5 text-white sequel-45 items-center">
              {/* TX Hash + Copy + Link */}
              <div className="flex items-center space-x-2">
                {item.txHash && isValidTxHash(item.txHash) ? (
                  <>
                    <a
                      href={getBaseScanUrl(item.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#DDE404] hover:text-[#DDE404]/80 truncate max-w-[150px] flex items-center gap-1"
                    >
                      {item.txHash.substring(0, 10)}...{item.txHash.slice(-6)}
                      <ExternalLink size={14} />
                    </a>
                    <div
                      className="cursor-pointer hover:scale-110 transition-transform"
                      onClick={() => handleCopy(index, getBaseScanUrl(item.txHash!), setCopiedIndex)}
                    >
                      {copiedIndex === index ? (
                        <CopyCheckIcon size={18} className="text-[#DDE404]" />
                      ) : (
                        <CopyIcon size={18} />
                      )}
                    </div>
                  </>
                ) : (
                  <span className="text-white/40">-</span>
                )}
              </div>

              <p className="text-center">{item.min}</p>
              <p className="text-center">{item.max}</p>
              <p className="text-center text-[#DDE404]">#{item.winningNumber}</p>
              <p className="text-end truncate max-w-[150px]" title={item.walletAddress || undefined}>
                {item.username || (item.walletAddress ? `${item.walletAddress.substring(0, 6)}...${item.walletAddress.slice(-4)}` : '-')}
              </p>
            </div>

            {/* Mobile Layout */}
            <div className="block md:hidden text-white sequel-45 space-y-2 border-b border-[#DDE404] pb-4 ">
              <div className="flex justify-between items-center">
                <span className="text-white/60">TX Hash</span>
                <div className="flex items-center space-x-2">
                  {item.txHash && isValidTxHash(item.txHash) ? (
                    <>
                      <a
                        href={getBaseScanUrl(item.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#DDE404] truncate max-w-[130px]"
                      >
                        {item.txHash.substring(0, 8)}...
                      </a>
                      <div
                        className="cursor-pointer hover:scale-110 transition-transform"
                        onClick={() => handleCopy(index, getBaseScanUrl(item.txHash!), setCopiedIndex)}
                      >
                        {copiedIndex === index ? (
                          <CopyCheckIcon size={16} className="text-[#DDE404]" />
                        ) : (
                          <CopyIcon size={16} />
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-white/40">-</span>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Min</span>
                <span>{item.min}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Max</span>
                <span>{item.max}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Winning Ticket</span>
                <span className="text-[#DDE404]">#{item.winningNumber}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Winner</span>
                <span className="truncate max-w-[150px]">
                  {item.username || (item.walletAddress ? `${item.walletAddress.substring(0, 6)}...${item.walletAddress.slice(-4)}` : '-')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WinnerResultsTable;

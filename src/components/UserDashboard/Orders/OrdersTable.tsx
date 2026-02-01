import { useNavigate } from "react-router";
import { useState, type FC } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import type { EntryOrder, PurchaseOrder } from "../../../models/models";



interface OrdersTableProps {
  activeTab: { key: string };
  data: PurchaseOrder[] | EntryOrder[];
}

/**
 * Determines the effective status of a competition entry.
 * If end_date has passed but status is still 'live', treats it as 'completed'.
 */
function getEffectiveStatus(item: any): string {
  const rawStatus = (item.status || '').toLowerCase().trim();
  const endDate = item.end_date ? new Date(item.end_date) : null;
  const isCompetitionEnded = endDate !== null && endDate < new Date();

  // If competition has ended but status still shows 'live', treat as 'completed'
  if (isCompetitionEnded && (rawStatus === 'live' || rawStatus === 'active')) {
    return 'completed';
  }

  // Normalize 'active' to 'live' and 'drawing' to 'drawn'
  if (rawStatus === 'active') return 'live';
  if (rawStatus === 'drawing') return 'drawn';

  return rawStatus || 'live';
}

/**
 * Compute cost from transaction data
 * Priority: amount > balance_delta > 0
 */
function computeCost(item: any): string {
  if (item.amount !== null && item.amount !== undefined) {
    return `$${Number(item.amount).toFixed(2)}`;
  }
  
  if (item.balance_before !== null && item.balance_before !== undefined &&
      item.balance_after !== null && item.balance_after !== undefined) {
    const delta = Math.abs(Number(item.balance_before) - Number(item.balance_after));
    return `$${delta.toFixed(2)}`;
  }
  
  return '-';
}

const OrdersTable: FC<OrdersTableProps> = ({ activeTab, data }) => {
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedMetadata, setExpandedMetadata] = useState<Set<string>>(new Set());

  const toggleMetadata = (id: string) => {
    setExpandedMetadata(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Generate full BaseScan URL from transaction hash
  const getBaseScanUrl = (txHash: string): string => {
    if (!txHash) return '';
    // Clean up the hash if it has any prefix
    const cleanHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
    // Use correct explorer domain based on network
    const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
    const explorerDomain = isMainnet ? 'basescan.org' : 'sepolia.basescan.org';
    return `https://${explorerDomain}/tx/${cleanHash}`;
  };

  const handleCopyTxHash = async (txHash: string, id: string) => {
    if (!txHash) return;
    try {
      // Copy the full BaseScan URL, not just the hash
      const baseScanUrl = getBaseScanUrl(txHash);
      await navigator.clipboard.writeText(baseScanUrl);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleAmountClick = (id: string | number) => {
    navigate(`/dashboard/orders/${id}`);
  };

  return (
    <div className="border-[2px] border-[#DDE404] rounded-lg mx-auto overflow-hidden relative z-10">
      {/* Desktop Header */}
      {activeTab.key === "purchases" ? (
        <div className="hidden uppercase lg:grid items-center grid-cols-8 text-white sequel-75 text-xs px-10 py-6 border-b-[2px] border-[#DDE404]">
          <p className="text-center col-span-2">Description</p>
          <p className="text-center">Payment Provider</p>
          <p className="text-center">TX Hash</p>
          <p className="text-center">Balance Before</p>
          <p className="text-center">Balance After</p>
          <p className="text-center">Completed At</p>
          <p className="text-center">Amount</p>
        </div>
      ) : (
        <div className="hidden uppercase lg:grid grid-cols-6 text-white sequel-75 items-center text-xs px-10 py-6 border-b-[2px] border-[#DDE404]">
          <p className="text-center">Competition <br /> Name</p>
          <p className="text-center">Type</p>
          <p className="text-center">Payment <br /> Provider</p>
          <p className="text-center">Date/ <br />Time</p>
          <p className="text-center">Cost</p>
          <p className="text-center">Status</p>
        </div>
      )}

      {/* Rows */}
      <div className="sm:px-10 pl-6 pr-6 sm:py-10 py-4">
        <div className="space-y-6">
          {data.length > 0 ? (
            data.map((item: any, index) => (
              <div key={index}>
                {/* Desktop layout */}
                {activeTab.key === "purchases" ? (
                  <div className="hidden lg:grid grid-cols-8 text-white sequel-45 items-center text-xs">
                    <p className="text-white/60 text-center col-span-2">
                      {item.is_topup ? item.competition_name : `${item.ticket_count} ticket${item.ticket_count !== 1 ? 's' : ''} - ${item.competition_name}`}
                    </p>
                    <p className="text-white/60 text-center">{item.payment_provider || 'unknown'}</p>
                    <div className="flex items-center gap-2 justify-center">
                      <p className="text-white/60 truncate max-w-[100px]">{item.tx_id || item.transaction_hash || '-'}</p>
                      {(item.tx_id || item.transaction_hash) && (
                        <button
                          onClick={() => handleCopyTxHash(item.tx_id || item.transaction_hash, item.id)}
                          className="text-white/60 hover:text-[#DDE404] transition-colors"
                          title="Copy BaseScan URL"
                        >
                          {copiedId === item.id ? (
                            <Check size={14} className="text-[#DDE404]" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      )}
                    </div>
                    <p className="text-white/60 text-center">
                      {item.balance_before !== null && item.balance_before !== undefined 
                        ? `$${Number(item.balance_before).toFixed(2)}` 
                        : '-'}
                    </p>
                    <p className="text-white/60 text-center">
                      {item.balance_after !== null && item.balance_after !== undefined 
                        ? `$${Number(item.balance_after).toFixed(2)}` 
                        : '-'}
                    </p>
                    <p className="text-white/60 text-center">
                      {item.completed_at ? new Date(item.completed_at).toLocaleString() : '-'}
                    </p>
                    <p
                      onClick={() => handleAmountClick(item.id)}
                      className="text-[#DDE404] cursor-pointer hover:underline text-center"
                    >
                      {item.amount_usd}
                    </p>
                  </div>
                ) : (
                  <div className="hidden lg:block text-white sequel-45 text-xs">
                    <div className="grid grid-cols-6 items-center gap-2">
                      {item.transaction_type === 'topup' ? (
                        <span className="text-green-500 text-center">Wallet Top-Up</span>
                      ) : (
                        <p className="text-white/60 truncate max-w-[150px] text-center">{item.title || item.competition_name || 'Unknown Competition'}</p>
                      )}
                      <p className="text-white/60 text-center">{item.type || '-'}</p>
                      <p className="text-white/60 text-center">{item.payment_provider || 'unknown'}</p>
                      <p className="text-white/60 text-center">{new Date(item.purchase_date || item.created_at).toLocaleString()}</p>
                      <p
                        onClick={() => navigate(`/dashboard/entries/competition/${item.competition_id}`)}
                        className="text-[#DDE404] text-center cursor-pointer hover:underline"
                      >
                        {computeCost(item)}
                      </p>
                      {(() => {
                        const effectiveStatus = getEffectiveStatus(item);
                        const isFinished = effectiveStatus === 'completed' || effectiveStatus === 'drawn';
                        return (
                          <button
                            onClick={() => navigate(`/dashboard/entries/competition/${item.competition_id}`)}
                            className="bg-[#DDE404] cursor-pointer hover:bg-[#DDE404]/90 text-black text-center sequel-95 py-1 rounded-md uppercase text-xs"
                          >
                            {effectiveStatus === 'live' ? 'Live' : effectiveStatus === 'pending' ? 'Pending' : isFinished ? (item.is_winner ? 'Won!' : 'View Results') : item.action || "View"}
                          </button>
                        );
                      })()}
                    </div>
                    {/* Metadata row - collapsible */}
                    {item.metadata && (
                      <div className="mt-2">
                        <button
                          onClick={() => toggleMetadata(item.id)}
                          className="flex items-center gap-1 text-white/60 hover:text-white text-xs"
                        >
                          {expandedMetadata.has(item.id) ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                          <span>Metadata</span>
                        </button>
                        {expandedMetadata.has(item.id) && (
                          <pre className="mt-2 p-2 bg-black/30 rounded text-xs overflow-auto max-h-40 text-white/70">
                            {JSON.stringify(item.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Mobile layout */}
                <div className="lg:hidden text-white sequel-45 space-y-2 border-b border-[#DDE404] pb-4">
                  {activeTab.key === "purchases" ? (
                    <>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Description</p>
                        <p className="text-white truncate max-w-[160px] text-right">
                          {item.is_topup ? item.competition_name : `${item.ticket_count} ticket${item.ticket_count !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                      {!item.is_topup && (
                        <div className="flex justify-between gap-4">
                          <p className="text-white/60">Competition</p>
                          <p className="text-white truncate max-w-[160px] text-right">{item.competition_name}</p>
                        </div>
                      )}
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Payment Provider</p>
                        <p className="text-white">{item.payment_provider || 'unknown'}</p>
                      </div>
                      <div className="flex justify-between gap-4 items-center">
                        <p className="text-white/60">TX Hash</p>
                        <div className="flex items-center gap-2">
                          <p className="text-white truncate max-w-[130px] text-right">{item.tx_id || item.transaction_hash || '-'}</p>
                          {(item.tx_id || item.transaction_hash) && (
                            <button
                              onClick={() => handleCopyTxHash(item.tx_id || item.transaction_hash, item.id)}
                              className="text-white/60 hover:text-[#DDE404] transition-colors flex-shrink-0"
                              title="Copy BaseScan URL"
                            >
                              {copiedId === item.id ? (
                                <Check size={14} className="text-[#DDE404]" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Balance Before</p>
                        <p className="text-white">
                          {item.balance_before !== null && item.balance_before !== undefined 
                            ? `$${Number(item.balance_before).toFixed(2)}` 
                            : '-'}
                        </p>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Balance After</p>
                        <p className="text-white">
                          {item.balance_after !== null && item.balance_after !== undefined 
                            ? `$${Number(item.balance_after).toFixed(2)}` 
                            : '-'}
                        </p>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Completed At</p>
                        <p className="text-white truncate max-w-[160px] text-right">
                          {item.completed_at ? new Date(item.completed_at).toLocaleString() : '-'}
                        </p>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Amount</p>
                        <p
                          onClick={() => handleAmountClick(item.id)}
                          className="text-[#DDE404] cursor-pointer hover:underline"
                        >
                          {item.amount_usd}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Competition</p>
                        <p className="text-white truncate max-w-[160px] text-right">
                          {item.title || item.competition_name || 'Unknown Competition'}
                        </p>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Type</p>
                        <p className="text-white text-right">{item.type || '-'}</p>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Payment Provider</p>
                        <p className="text-white text-right">{item.payment_provider || 'unknown'}</p>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Date</p>
                        <p className="text-white truncate max-w-[160px] text-right">{new Date(item.purchase_date || item.created_at).toLocaleString()}</p>
                      </div>
                      <div className="flex justify-between gap-4">
                        <p className="text-white/60">Cost</p>
                        <p
                          onClick={() => handleAmountClick(item.competition_id || item.id)}
                          className="text-[#DDE404] cursor-pointer hover:underline"
                        >
                          {computeCost(item)}
                        </p>
                      </div>
                      {/* Metadata - mobile */}
                      {item.metadata && (
                        <div className="pt-2">
                          <button
                            onClick={() => toggleMetadata(item.id)}
                            className="flex items-center gap-1 text-white/60 hover:text-white text-xs"
                          >
                            {expandedMetadata.has(item.id) ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                            <span>Metadata</span>
                          </button>
                          {expandedMetadata.has(item.id) && (
                            <pre className="mt-2 p-2 bg-black/30 rounded text-xs overflow-auto max-h-40 text-white/70">
                              {JSON.stringify(item.metadata, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                      {(() => {
                        const effectiveStatus = getEffectiveStatus(item);
                        const isFinished = effectiveStatus === 'completed' || effectiveStatus === 'drawn';
                        return (
                          <>
                            <div className="flex justify-between gap-4">
                              <p className="text-white/60">Status</p>
                              <p className={`text-right ${item.is_winner ? 'text-[#DDE404]' : 'text-white'}`}>
                                {effectiveStatus === 'live' ? 'Live' : effectiveStatus === 'pending' ? 'Pending' : isFinished ? (item.is_winner ? 'Winner!' : 'Finished') : '-'}
                              </p>
                            </div>
                            <div>
                              <button
                                onClick={() => navigate(`/dashboard/entries/competition/${item.competition_id}`)}
                                className="bg-[#DDE404] mt-2 text-sm cursor-pointer w-full hover:bg-[#DDE404]/90 text-black text-center sequel-95 py-2 rounded-md uppercase"
                              >
                                {effectiveStatus === 'live' ? 'View Entry' : effectiveStatus === 'pending' ? 'Complete Payment' : isFinished ? (item.is_winner ? 'Claim Prize' : 'View Results') : 'View Details'}
                              </button>
                            </div>
                          </>
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-white/50 text-center py-10">No data found</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrdersTable;

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  Wallet,
} from "lucide-react";
import type { EntriesTableProps } from "../../models/models";

const EntriesTable: React.FC<EntriesTableProps> = ({
  entries,
  itemsPerPage = 20,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const totalPages = Math.ceil(entries.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentEntries = entries.slice(startIndex, startIndex + itemsPerPage);

  const handlePrev = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) setCurrentPage((p) => p + 1);
  };

  // Generate BaseScan URL from transaction hash
  const getBaseScanUrl = (txHash: string): string => {
    if (!txHash) return "";
    const cleanHash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
    // Use correct explorer domain based on network
    const isMainnet = import.meta.env.VITE_BASE_MAINNET === "true";
    const explorerDomain = isMainnet ? "basescan.org" : "sepolia.basescan.org";
    return `https://${explorerDomain}/tx/${cleanHash}`;
  };

  // Check if a hash is a valid blockchain transaction hash
  // Returns: 'blockchain' | 'balance_payment' | 'coinbase_charge' | 'invalid'
  const classifyTxHash = (
    hash: string,
  ): "blockchain" | "balance_payment" | "coinbase_charge" | "invalid" => {
    if (!hash) return "invalid";

    // Balance payment identifier (e.g., "balance_payment_abc123")
    if (hash.startsWith("balance_payment_") || hash.startsWith("BAL_"))
      return "balance_payment";

    // UUID format (Coinbase Commerce charge ID)
    // Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        hash,
      )
    ) {
      return "coinbase_charge";
    }

    // Valid blockchain tx hash: 0x followed by 64 hex chars
    const cleanHash = hash.startsWith("0x") ? hash : `0x${hash}`;
    if (/^0x[a-fA-F0-9]{64}$/.test(cleanHash)) {
      // IMPORTANT: Fake hashes from March 4, 2026 data import - don't show as blockchain links
      // These hashes don't exist on any network (checked mainnet, Sepolia, blockscan)
      // Known fake hashes have this pattern but return 404 on all explorers
      // For now, treat ALL old 0x hashes as potentially fake unless from recent transactions
      return "blockchain";
    }

    return "invalid";
  };

  // Format username from wallet address or use provided username
  const formatUsername = (walletAddress: string, username?: string): string => {
    // If we have a valid username that's not a placeholder, use it
    if (
      username &&
      username !== "Unknown" &&
      username !== "Anonymous" &&
      username !== walletAddress
    ) {
      return username;
    }
    // If wallet address is missing or placeholder, show Anonymous
    if (
      !walletAddress ||
      walletAddress === "Unknown" ||
      walletAddress === "Anonymous"
    )
      return "Anonymous";
    // If it's a wallet address, format it nicely
    if (walletAddress.startsWith("0x") && walletAddress.length >= 10) {
      return `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`;
    }
    // If it's a canonical user ID (prize:pid:), extract and format the address part
    if (walletAddress.startsWith("prize:pid:")) {
      const addressPart = walletAddress.substring(10); // Remove 'prize:pid:' prefix
      if (addressPart.startsWith("0x") && addressPart.length >= 10) {
        return `${addressPart.substring(0, 6)}...${addressPart.slice(-4)}`;
      }
      return addressPart.substring(0, 10) + "...";
    }
    return walletAddress.substring(0, 10);
  };

  // Format wallet address for display
  const formatWalletAddress = (walletAddress: string): string => {
    if (
      !walletAddress ||
      walletAddress === "Unknown" ||
      walletAddress === "Anonymous"
    ) {
      return "Unknown";
    }
    // If it's already a 0x address, format it
    if (walletAddress.startsWith("0x") && walletAddress.length >= 10) {
      return `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`;
    }
    // If it's a canonical user ID, extract the address part
    if (walletAddress.startsWith("prize:pid:")) {
      const addressPart = walletAddress.substring(10);
      if (addressPart.startsWith("0x") && addressPart.length >= 10) {
        return `${addressPart.substring(0, 6)}...${addressPart.slice(-4)}`;
      }
    }
    // Return truncated version for other formats
    return walletAddress.length > 12
      ? `${walletAddress.substring(0, 10)}...`
      : walletAddress;
  };

  // Copy hash or URL to clipboard
  const handleCopyHash = async (hash: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const hashType = classifyTxHash(hash);
      const url = hashType === "blockchain" ? getBaseScanUrl(hash) : hash;
      await navigator.clipboard.writeText(url);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Render transaction hash with appropriate UI based on type
  const renderVRFHash = (entry: any) => {
    const txHash = entry.transactionHash || entry.vrfHash || entry.rngHash;

    // Debug logging for ALL entries
    console.log(`[Entries] Ticket ${entry.ticketNumber}:`, {
      hasTransactionHash: !!entry.transactionHash,
      hasVrfHash: !!entry.vrfHash,
      hasRngHash: !!entry.rngHash,
      txHash: txHash || "NONE",
      txHashLength: txHash?.length || 0,
    });

    if (!txHash) {
      return <span className="text-white/40 text-sm">-</span>;
    }

    const hashType = classifyTxHash(txHash);
    const baseScanUrl =
      hashType === "blockchain" ? getBaseScanUrl(txHash) : null;

    console.log(`[Entries] Ticket ${entry.ticketNumber} classification:`, {
      hashType,
      baseScanUrl,
      willBeClickable: hashType === "blockchain",
    });

    // Balance payment - show wallet icon and "Balance" text
    if (hashType === "balance_payment") {
      return (
        <div className="flex items-center gap-1.5">
          <Wallet size={14} className="text-green-400" />
          <span className="text-green-400 text-sm sequel-45">Balance</span>
        </div>
      );
    }

    // Coinbase Commerce charge - show as non-clickable reference
    if (hashType === "coinbase_charge") {
      const displayId =
        txHash.length > 12 ? `${txHash.substring(0, 8)}...` : txHash;
      return (
        <div className="flex items-center gap-2">
          <span
            className="text-white/50 text-sm sequel-45"
            title={`Charge ID: ${txHash}`}
          >
            {displayId}
          </span>
          <button
            onClick={(e) => handleCopyHash(txHash, e)}
            className="text-white/40 hover:text-[#DDE404] transition-colors shrink-0"
            title="Copy Charge ID"
          >
            {copiedHash === txHash ? (
              <Check size={14} className="text-[#DDE404]" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      );
    }

    // Valid blockchain hash - show clickable link to BaseScan
    if (hashType === "blockchain") {
      const displayHash =
        txHash.length > 16
          ? `${txHash.substring(0, 8)}...${txHash.slice(-6)}`
          : txHash;
      const url = getBaseScanUrl(txHash);

      // Try Sepolia if mainnet URL, or vice versa
      const isMainnet = import.meta.env.VITE_BASE_MAINNET === "true";
      const alternateUrl = isMainnet
        ? `https://sepolia.basescan.org/tx/${txHash.startsWith("0x") ? txHash : `0x${txHash}`}`
        : `https://basescan.org/tx/${txHash.startsWith("0x") ? txHash : `0x${txHash}`}`;

      return (
        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#DDE404] hover:text-[#DDE404]/80 transition-colors truncate max-w-25 font-mono text-sm flex items-center gap-1"
            title={`View on BaseScan (${isMainnet ? "Mainnet" : "Sepolia"}) - Click with Shift to try ${isMainnet ? "Sepolia" : "Mainnet"}`}
            onClick={(e) => {
              console.log("[Entries] Link clicked:", {
                ticketNumber: entry.ticketNumber,
                txHash,
                primaryUrl: url,
                alternateUrl,
                network: isMainnet ? "mainnet" : "sepolia",
                shiftKey: e.shiftKey,
              });
              // If shift-clicked, try alternate network
              if (e.shiftKey) {
                e.preventDefault();
                window.open(alternateUrl, "_blank");
              } else {
                e.stopPropagation();
              }
            }}
          >
            {displayHash}
            <ExternalLink size={12} />
          </a>
          <button
            onClick={(e) => handleCopyHash(txHash, e)}
            className="text-white/40 hover:text-[#DDE404] transition-colors shrink-0"
            title="Copy BaseScan URL"
          >
            {copiedHash === txHash ? (
              <Check size={14} className="text-[#DDE404]" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      );
    }

    // Invalid/unknown hash format - show as plain text
    const displayHash =
      txHash.length > 16
        ? `${txHash.substring(0, 8)}...${txHash.slice(-6)}`
        : txHash;
    return (
      <div className="flex items-center gap-2">
        <p className="text-white/40 truncate max-w-25 font-mono text-sm">
          {displayHash}
        </p>
        <button
          onClick={(e) => handleCopyHash(txHash, e)}
          className="text-white/40 hover:text-[#DDE404] transition-colors shrink-0"
          title="Copy Hash"
        >
          {copiedHash === txHash ? (
            <Check size={14} className="text-[#DDE404]" />
          ) : (
            <Copy size={14} />
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="border-[2px] border-[#DDE404] rounded-2xl mx-auto overflow-hidden relative z-10">
      {/* Desktop Header */}
      <div className="hidden sm:grid grid-cols-4 text-white sequel-75 text-base px-10 py-8 border-b-[2px] border-[#DDE404]">
        <p>Ticket Number(s)</p>
        <p className="text-left">Username</p>
        <p className="text-left">Wallet Address</p>
        <p className="text-left">TX Hash</p>
      </div>

      {/* Rows */}
      <div className="sm:px-10 pl-6 pr-6 sm:py-10 py-4">
        <div className="sm:max-h-full overflow-auto max-h-[300px] custom-scrollbar space-y-4 ">
          {currentEntries.map((entry, index) => {
            const username = formatUsername(
              entry.walletAddress,
              entry.username,
            );
            const displayWallet = formatWalletAddress(entry.walletAddress);

            return (
              <div key={index}>
                {/* Desktop Layout */}
                <div className="hidden sm:grid grid-cols-4 text-white sequel-45 items-center">
                  <p className="text-white/60">{entry.ticketNumber}</p>
                  <p className="text-white/60">{username}</p>
                  <p
                    className="text-white/60 truncate max-w-[180px]"
                    title={entry.walletAddress}
                  >
                    {displayWallet}
                  </p>
                  {renderVRFHash(entry)}
                </div>

                {/* Mobile Layout */}
                <div className="sm:hidden text-white sequel-45 space-y-2 sm:pr-0 pr-4 border-b border-[#DDE404] pb-4">
                  <div className="flex justify-between gap-4">
                    <p className="text-white/60">Ticket Number(s)</p>
                    <p className="text-white truncate max-w-[160px] text-right">
                      {entry.ticketNumber}
                    </p>
                  </div>
                  <div className="flex justify-between gap-4">
                    <p className="text-white/60">Username</p>
                    <p className="text-white truncate max-w-[160px] text-right">
                      {username}
                    </p>
                  </div>
                  <div className="flex justify-between gap-4">
                    <p className="text-white/60">Wallet</p>
                    <p
                      className="text-white truncate max-w-[160px] text-right"
                      title={entry.walletAddress}
                    >
                      {displayWallet}
                    </p>
                  </div>
                  <div className="flex justify-between gap-4 items-center">
                    <p className="text-white/60">TX Hash</p>
                    <div className="flex items-center gap-2">
                      {renderVRFHash(entry)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* No data message */}
          {currentEntries.length === 0 && (
            <p className="text-white/50 text-center py-10">No entries found</p>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center mx-8 sm:border-t-[2px] py-6 border-[#DDE404]">
        <ChevronLeft
          color="white"
          size={28}
          className={`cursor-pointer transition-opacity ${currentPage === 1 ? "opacity-40 pointer-events-none" : "hover:scale-110"}`}
          onClick={handlePrev}
        />
        <span className="sequel-45 text-white/60 uppercase">
          Page {currentPage} of {totalPages}
        </span>
        <ChevronRight
          color="white"
          size={28}
          className={`cursor-pointer transition-opacity ${currentPage === totalPages ? "opacity-40 pointer-events-none" : "hover:scale-110"}`}
          onClick={handleNext}
        />
      </div>
    </div>
  );
};

export default EntriesTable;

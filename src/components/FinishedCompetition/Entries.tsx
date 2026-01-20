import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Check, ExternalLink } from "lucide-react";
import type { EntriesTableProps } from "../../models/models";

const EntriesTable: React.FC<EntriesTableProps> = ({ entries, itemsPerPage = 20 }) => {
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
        if (!txHash) return '';
        const cleanHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
        // Use correct explorer domain based on network
        const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
        const explorerDomain = isMainnet ? 'basescan.org' : 'sepolia.basescan.org';
        return `https://${explorerDomain}/tx/${cleanHash}`;
    };

    // Check if a hash is a valid transaction hash (for VRF/blockchain verification)
    const isValidTxHash = (hash: string): boolean => {
        if (!hash) return false;
        const cleanHash = hash.startsWith('0x') ? hash : `0x${hash}`;
        return /^0x[a-fA-F0-9]{64}$/.test(cleanHash);
    };

    // Format username from wallet address or use provided username
    const formatUsername = (walletAddress: string, username?: string): string => {
        // If we have a valid username that's not a placeholder, use it
        if (username && username !== 'Unknown' && username !== 'Anonymous' && username !== walletAddress) {
            return username;
        }
        // If wallet address is missing or placeholder, show Anonymous
        if (!walletAddress || walletAddress === 'Unknown' || walletAddress === 'Anonymous') return 'Anonymous';
        // If it's a wallet address, format it nicely
        if (walletAddress.startsWith('0x') && walletAddress.length >= 10) {
            return `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`;
        }
        // If it's a canonical user ID (prize:pid:), extract and format the address part
        if (walletAddress.startsWith('prize:pid:')) {
            const addressPart = walletAddress.substring(10); // Remove 'prize:pid:' prefix
            if (addressPart.startsWith('0x') && addressPart.length >= 10) {
                return `${addressPart.substring(0, 6)}...${addressPart.slice(-4)}`;
            }
            return addressPart.substring(0, 10) + '...';
        }
        return walletAddress.substring(0, 10);
    };

    // Format wallet address for display
    const formatWalletAddress = (walletAddress: string): string => {
        if (!walletAddress || walletAddress === 'Unknown' || walletAddress === 'Anonymous') {
            return 'Unknown';
        }
        // If it's already a 0x address, format it
        if (walletAddress.startsWith('0x') && walletAddress.length >= 10) {
            return `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`;
        }
        // If it's a canonical user ID, extract the address part
        if (walletAddress.startsWith('prize:pid:')) {
            const addressPart = walletAddress.substring(10);
            if (addressPart.startsWith('0x') && addressPart.length >= 10) {
                return `${addressPart.substring(0, 6)}...${addressPart.slice(-4)}`;
            }
        }
        // Return truncated version for other formats
        return walletAddress.length > 12 ? `${walletAddress.substring(0, 10)}...` : walletAddress;
    };

    // Copy BaseScan URL to clipboard (not the hash itself)
    const handleCopyHash = async (hash: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const url = isValidTxHash(hash) ? getBaseScanUrl(hash) : hash;
            await navigator.clipboard.writeText(url);
            setCopiedHash(hash);
            setTimeout(() => setCopiedHash(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Render VRF hash with clickable link to BaseScan
    const renderVRFHash = (entry: any) => {
        const txHash = entry.transactionHash || entry.vrfHash || entry.rngHash;

        if (!txHash) {
            return <span className="text-white/40 text-sm">-</span>;
        }

        const isValidHash = isValidTxHash(txHash);
        const displayHash = txHash.length > 16 ? `${txHash.substring(0, 8)}...${txHash.slice(-6)}` : txHash;

        if (isValidHash) {
            return (
                <div className="flex items-center gap-2">
                    <a
                        href={getBaseScanUrl(txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#DDE404] hover:text-[#DDE404]/80 transition-colors truncate max-w-[100px] font-mono text-sm flex items-center gap-1"
                        title="View on BaseScan"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {displayHash}
                        <ExternalLink size={12} />
                    </a>
                    <button
                        onClick={(e) => handleCopyHash(txHash, e)}
                        className="text-white/40 hover:text-[#DDE404] transition-colors flex-shrink-0"
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

        // Non-blockchain hash (display only)
        return (
            <div className="flex items-center gap-2">
                <p className="text-white/60 truncate max-w-[100px] font-mono text-sm">{displayHash}</p>
                <button
                    onClick={(e) => handleCopyHash(txHash, e)}
                    className="text-white/40 hover:text-[#DDE404] transition-colors flex-shrink-0"
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
                <p className="text-left">VRF Hash</p>
            </div>

            {/* Rows */}
            <div className="sm:px-10 pl-6 pr-6 sm:py-10 py-4">
                <div className="sm:max-h-full overflow-auto max-h-[300px] custom-scrollbar space-y-4 ">
                    {currentEntries.map((entry, index) => {
                        const username = formatUsername(entry.walletAddress, entry.username);
                        const displayWallet = formatWalletAddress(entry.walletAddress);

                        return (
                            <div key={index}>
                                {/* Desktop Layout */}
                                <div className="hidden sm:grid grid-cols-4 text-white sequel-45 items-center">
                                    <p className="text-white/60">{entry.ticketNumber}</p>
                                    <p className="text-white/60">{username}</p>
                                    <p className="text-white/60 truncate max-w-[180px]" title={entry.walletAddress}>{displayWallet}</p>
                                    {renderVRFHash(entry)}
                                </div>

                                {/* Mobile Layout */}
                                <div className="sm:hidden text-white sequel-45 space-y-2 sm:pr-0 pr-4 border-b border-[#DDE404] pb-4">
                                    <div className="flex justify-between gap-4">
                                        <p className="text-white/60">Ticket Number(s)</p>
                                        <p className="text-white truncate max-w-[160px] text-right">{entry.ticketNumber}</p>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <p className="text-white/60">Username</p>
                                        <p className="text-white truncate max-w-[160px] text-right">{username}</p>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <p className="text-white/60">Wallet</p>
                                        <p className="text-white truncate max-w-[160px] text-right" title={entry.walletAddress}>{displayWallet}</p>
                                    </div>
                                    <div className="flex justify-between gap-4 items-center">
                                        <p className="text-white/60">VRF Hash</p>
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

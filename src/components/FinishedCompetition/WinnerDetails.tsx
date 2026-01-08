import { useState, useEffect } from "react";
import type { WinnerInfoField } from "../../models/models";
import WinnerHashCard from "./WinnerHashCard";
import VRFVerificationCard from "./VRFVerificationCard";
import { supabase } from "../../lib/supabase";

interface WinnerDetailsProps {
    competitionId: string;
}

interface WinnerData {
    winnerAddress: string | null;
    winningTicket: number | null;
    txHash: string | null;
    vrfSeed: string | null;
    ticketsSold: number;
}

const WinnerDetails = ({ competitionId }: WinnerDetailsProps) => {
    const [winnerData, setWinnerData] = useState<WinnerData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchWinnerData = async () => {
            if (!competitionId) {
                setLoading(false);
                return;
            }

            try {
                // Fetch competition data including VRF info and winner info
                const { data: compData, error: compError } = await supabase
                    .from('competitions')
                    .select('winner_address, outcomes_vrf_seed, tickets_sold, vrf_pregenerated_tx_hash')
                    .eq('id', competitionId)
                    .maybeSingle();

                if (compError) {
                    console.error('Error fetching competition winner data:', compError);
                    setLoading(false);
                    return;
                }

                if (compData) {
                    setWinnerData({
                        winnerAddress: compData.winner_address,
                        winningTicket: null, // Will be fetched from competition_winners
                        txHash: compData.vrf_pregenerated_tx_hash, // Use VRF tx hash
                        vrfSeed: compData.outcomes_vrf_seed,
                        ticketsSold: compData.tickets_sold || 0,
                    });
                }

                // Also try to fetch from competition_winners table for winning ticket and winner address
                if (!compData?.vrf_pregenerated_tx_hash) {
                    const { data: winnerRow } = await supabase
                        .from('competition_winners')
                        .select('txhash, ticket_number, Winner')
                        .eq('competitionid', competitionId)
                        .maybeSingle();

                    if (winnerRow) {
                        setWinnerData(prev => ({
                            winnerAddress: prev?.winnerAddress || winnerRow.Winner,
                            winningTicket: prev?.winningTicket || winnerRow.ticket_number,
                            txHash: prev?.txHash || winnerRow.txhash,
                            vrfSeed: prev?.vrfSeed || null,
                            ticketsSold: prev?.ticketsSold || 0,
                        }));
                    }
                }
            } catch (err) {
                console.error('Error fetching winner data:', err);
            }
            setLoading(false);
        };

        fetchWinnerData();
    }, [competitionId]);

    if (loading) {
        return (
            <div className="bg-[#191919] max-w-7xl mx-auto rounded-2xl lg:px-20 px-6 lg:py-14 py-8">
                <div className="animate-pulse">
                    <div className="h-6 bg-[#2A2A2A] rounded w-1/3 mb-4"></div>
                    <div className="h-4 bg-[#2A2A2A] rounded w-2/3 mb-2"></div>
                    <div className="h-4 bg-[#2A2A2A] rounded w-1/2"></div>
                </div>
            </div>
        );
    }

    // If no winner data at all, show placeholder
    if (!winnerData || (!winnerData.winnerAddress && !winnerData.txHash)) {
        return (
            <div className="bg-[#191919] max-w-7xl mx-auto rounded-2xl lg:px-20 px-6 lg:py-14 py-8">
                <p className="sequel-45 text-white/60 text-center">Winner information not available yet.</p>
            </div>
        );
    }

    // Build fields array from available data
    const fields: WinnerInfoField[] = [];

    if (winnerData.winnerAddress) {
        fields.push({
            label: "Winner",
            value: winnerData.winnerAddress,
            copyable: true,
        });
    }

    if (winnerData.winningTicket !== null) {
        fields.push({
            label: "Winning Ticket",
            value: `#${winnerData.winningTicket}`,
            copyable: false,
        });
    }

    if (winnerData.txHash) {
        fields.push({
            label: "VRF Transaction Hash",
            value: winnerData.txHash,
            copyable: true,
            link: `https://basescan.org/tx/${winnerData.txHash}`
        });
    }

    if (winnerData.vrfSeed) {
        fields.push({
            label: "Blockchain RNG Seed",
            value: winnerData.vrfSeed,
            copyable: true,
        });
    }

    return (
        <div className="space-y-6">
            {/* Winner Details Card */}
            {fields.length > 0 && (
                <WinnerHashCard
                    fields={fields}
                />
            )}

            {/* VRF Verification Card - Only show if VRF seed is available */}
            {winnerData.vrfSeed && winnerData.ticketsSold > 0 && (
                <VRFVerificationCard
                    vrfSeed={winnerData.vrfSeed}
                    ticketsSold={winnerData.ticketsSold}
                    winningTicketNumber={winnerData.winningTicket}
                />
            )}
        </div>
    );
};

export default WinnerDetails;

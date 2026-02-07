import { useLocation, useOutletContext, useParams } from "react-router";
import { useState, useEffect, useMemo } from "react";
import { useAuthUser } from "../../../contexts/AuthContext";
import type { Options, WinnerInfoField } from "../../../models/models";
import EntriesCard from "./EntriesCard";
import EntriesTickets from "./EntriesTickets";
import EntriesWinnerSection from "./EntriesWinnerSection";
import { database } from "../../../lib/database";
import Loader from "../../Loader";

interface EntryData {
  id: string;
  competition_id: string;
  title: string;
  description: string;
  image: string;
  status: "live" | "drawn" | "pending";  // Added pending
  entry_type: string;
  is_winner: boolean;
  ticket_numbers?: string | null;
  number_of_tickets?: number | null;
  amount_spent?: string | number | null;  // Can be string or number from different sources
  purchase_date?: string | null;
  wallet_address?: string | null;
  transaction_hash?: string | null;
  is_instant_win: boolean;
  prize_value?: string | null;
  competition_status: string;
  end_date?: string | null;
  expires_at?: string | null;
}

interface AggregatedEntry {
  competition_id: string;
  title: string;
  description: string;
  image: string;
  status: "live" | "drawn" | "pending";
  is_winner: boolean;
  total_tickets: number;
  all_ticket_numbers: string;
  total_amount_spent: number;
  first_purchase_date?: string;
  last_purchase_date?: string;
  transaction_hashes: string[];
  prize_value?: string;
  end_date?: string;
  individual_entries: EntryData[];
  is_pending: boolean;
  expires_at?: string;
  is_instant_win: boolean;
}

const CompetitionEntryDetails = () => {
  const { competitionId } = useParams<{ competitionId: string }>();
  const { baseUser, canonicalUserId } = useAuthUser();
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { activeTab } = useOutletContext<{ activeTab: Options }>();
  const location = useLocation();

  // Get status and isWinner from location state as fallback
  const stateStatus = (location.state as { status?: "live" | "drawn" })?.status;
  const stateIsWinner = (location.state as { is_winner?: boolean })?.is_winner;

  useEffect(() => {
    const fetchEntries = async () => {
      if (!canonicalUserId || !competitionId) {
        setLoading(false);
        setError("Unable to load entry details");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // FIXED: Use the same data source as EntriesList to ensure consistency
        // getUserEntriesFromCompetitionEntries uses the new RPC that returns proper data
        const allEntries = await database.getUserEntriesFromCompetitionEntries(canonicalUserId);
        const competitionEntries = (allEntries || []).filter(
          (e: any): e is EntryData => e !== null && typeof e === 'object' && 'competition_id' in e && e.competition_id === competitionId
        ) as EntryData[];

        if (competitionEntries && competitionEntries.length > 0) {
          setEntries(competitionEntries);
        } else {
          setError("No entries found for this competition");
        }
      } catch (err) {
        console.error("Error fetching entries:", err);
        setError("Failed to load entry details");
      } finally {
        setLoading(false);
      }
    };

    fetchEntries();
  }, [canonicalUserId, competitionId]);

  // Helper function to deduplicate entries
  const deduplicateEntries = (entriesList: EntryData[]): EntryData[] => {
    return entriesList.reduce((acc: EntryData[], entry) => {
      // Create a unique key for deduplication based on:
      // - ticket numbers (sorted, to handle different orderings)
      // - amount spent
      // - purchase date (rounded to the minute to handle slight timestamp variations)
      const sortedTickets = entry.ticket_numbers
        ? entry.ticket_numbers.split(',').map(t => t.trim()).sort((a, b) => parseInt(a) - parseInt(b)).join(',')
        : '';
      const roundedDate = entry.purchase_date
        ? new Date(entry.purchase_date).setSeconds(0, 0) // Round to minute
        : 0;
      const dedupeKey = `${sortedTickets}|${entry.amount_spent}|${roundedDate}`;

      // Check if we already have an entry with the same key
      const existingIndex = acc.findIndex(e => {
        const existingSortedTickets = e.ticket_numbers
          ? e.ticket_numbers.split(',').map(t => t.trim()).sort((a, b) => parseInt(a) - parseInt(b)).join(',')
          : '';
        const existingRoundedDate = e.purchase_date
          ? new Date(e.purchase_date).setSeconds(0, 0)
          : 0;
        const existingKey = `${existingSortedTickets}|${e.amount_spent}|${existingRoundedDate}`;
        return existingKey === dedupeKey;
      });

      if (existingIndex === -1) {
        acc.push(entry);
      }
      return acc;
    }, []);
  };

  // Aggregate all entries for this competition
  const aggregatedEntry = useMemo((): AggregatedEntry | null => {
    if (entries.length === 0) return null;

    // Deduplicate entries before aggregating to prevent double-counting
    const uniqueEntries = deduplicateEntries(entries);

    const firstEntry = entries[0];

    // Collect all ticket numbers and dedupe
    const allTickets: string[] = [];
    uniqueEntries.forEach((entry) => {
      if (entry.ticket_numbers) {
        const tickets = entry.ticket_numbers.split(",").map((t) => t.trim());
        allTickets.push(...tickets);
      }
    });
    const uniqueTickets = [...new Set(allTickets)];

    // Sum total tickets and amount from deduplicated entries
    const totalTickets = uniqueEntries.reduce(
      (sum, e) => sum + (e.number_of_tickets || 0),
      0
    );
    const totalAmount = uniqueEntries.reduce(
      (sum, e) => sum + (parseFloat(e.amount_spent || '0') || 0),
      0
    );

    // Check if any entry is a winner
    const isWinner = entries.some((e) => e.is_winner);

    // Find first and last purchase dates from all entries (including duplicates for date range)
    const sortedByDate = [...entries].sort(
      (a, b) =>
        new Date(a.purchase_date || 0).getTime() -
        new Date(b.purchase_date || 0).getTime()
    );
    const firstPurchaseDate = sortedByDate[0]?.purchase_date;
    const lastPurchaseDate = sortedByDate[sortedByDate.length - 1]?.purchase_date;

    // Collect unique transaction hashes from all entries
    const transactionHashes = entries
      .map((e) => e.transaction_hash)
      .filter((hash): hash is string => hash !== null && hash !== undefined && hash !== "no-hash");
    const uniqueHashes = [...new Set(transactionHashes)];

    // Check if pending
    const isPending = entries.some(
      (e) => e.entry_type === "pending" || e.status === "pending"
    );

    // Find earliest expiration
    const expirations = entries
      .map((e) => e.expires_at)
      .filter(Boolean)
      .sort();

    return {
      competition_id: firstEntry.competition_id,
      title: firstEntry.title,
      description: firstEntry.description,
      image: firstEntry.image,
      status: firstEntry.status,
      is_winner: isWinner,
      total_tickets: totalTickets,
      all_ticket_numbers: uniqueTickets.join(", "),
      total_amount_spent: totalAmount,
      first_purchase_date: firstPurchaseDate ?? undefined,
      last_purchase_date: lastPurchaseDate ?? undefined,
      transaction_hashes: uniqueHashes.filter((h): h is string => h != null),
      prize_value: firstEntry.prize_value ?? undefined,
      end_date: firstEntry.end_date ?? undefined,
      individual_entries: uniqueEntries,
      is_pending: isPending,
      expires_at: expirations[0] || undefined,
      is_instant_win: firstEntry.is_instant_win || false,
    };
  }, [entries]);

  // Build fields for winner section
  const fields: WinnerInfoField[] = aggregatedEntry
    ? [
        {
          label: "Competition Status",
          value: status === "live" 
            ? "Active" 
            : status === "drawn" || status === "completed"
              ? "Completed"
              : status === "pending"
                ? "Pending"
                : "Drawing",
          copyable: false,
        },
        ...(status !== "live" && (status === "drawn" || status === "completed")
          ? [
              {
                label: "Result",
                value: isWinner ? "🎉 WINNER!" : "No Win",
                copyable: false,
              },
            ]
          : []),
        {
          label: "Draw Date",
          value: aggregatedEntry.end_date
            ? new Date(aggregatedEntry.end_date).toLocaleDateString("en-US", {
                month: "2-digit",
                day: "2-digit",
                year: "numeric",
              })
            : "TBD",
          copyable: false,
        },
        {
          label: "Total Spent",
          value: `$${aggregatedEntry.total_amount_spent.toFixed(2)}`,
          copyable: false,
        },
        {
          label: "Purchase History",
          value: entries.length === 1
            ? "1 purchase"
            : `${entries.length} purchases`,
          copyable: false,
        },
        ...(aggregatedEntry.transaction_hashes.length > 0
          ? [
              {
                label: "Latest Transaction",
                value: aggregatedEntry.transaction_hashes[aggregatedEntry.transaction_hashes.length - 1],
                copyable: true,
              },
            ]
          : []),
      ]
    : [];

  // Use aggregated data or fallback to location state
  const status = aggregatedEntry?.status || stateStatus || "live";
  const isWinner = aggregatedEntry?.is_winner ?? stateIsWinner ?? false;

  if (loading) {
    return (
      <div className="mt-10 py-20">
        <Loader />
      </div>
    );
  }

  if (error || !aggregatedEntry) {
    return (
      <div className="mt-10">
        <div className="text-center py-12">
          <p className="text-white/70 sequel-45 text-lg">
            {error || "Entries not found"}
          </p>
          <a
            href="/dashboard/entries"
            className="inline-block mt-4 text-[#DDE404] sequel-45 hover:underline"
          >
            &larr; Back to entries
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <EntriesCard
        variant="detailed"
        showButton
        showCountDown={status === "live"}
        status={status}
        isWinner={isWinner}
        title={aggregatedEntry.title}
        description={aggregatedEntry.description}
        competitionImage={aggregatedEntry.image}
        competitionId={aggregatedEntry.competition_id}
        endDate={aggregatedEntry.end_date}
        ticketNumbers={aggregatedEntry.all_ticket_numbers}
        amountSpent={aggregatedEntry.total_amount_spent.toFixed(2)}
        purchaseDate={aggregatedEntry.last_purchase_date}
        transactionHash={
          aggregatedEntry.transaction_hashes.length > 0
            ? aggregatedEntry.transaction_hashes[0]
            : undefined
        }
        prizeValue={aggregatedEntry.prize_value}
        numberOfTickets={aggregatedEntry.total_tickets}
        isPending={aggregatedEntry.is_pending}
        expiresAt={aggregatedEntry.expires_at}
        isInstantWin={aggregatedEntry.is_instant_win}
      />

      {/* Show all ticket numbers */}
      <EntriesTickets
        ticketNumbers={aggregatedEntry.all_ticket_numbers}
        numberOfTickets={aggregatedEntry.total_tickets}
      />

      {/* Purchase History Section */}
      {/* Uses deduplicated entries from aggregatedEntry to prevent showing the same purchase twice */}
      {/* Duplicates can occur when the same purchase creates entries in both joincompetition and tickets/user_transactions tables */}
      {aggregatedEntry.individual_entries.length > 1 && (
        <div className="mt-8">
          <h3 className="text-white sequel-95 uppercase text-xl mb-4">
            Purchase History
          </h3>
          <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-3">
            {aggregatedEntry.individual_entries
              .sort(
                (a, b) =>
                  new Date(b.purchase_date || 0).getTime() -
                  new Date(a.purchase_date || 0).getTime()
              )
              .map((entry, index) => (
                <div
                  key={`${entry.id}-${index}`}
                  className="flex flex-wrap justify-between items-center py-3 border-b border-white/10 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-white sequel-45 text-sm">
                      {new Date(entry.purchase_date || 0).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </div>
                    <div className="text-white/60 sequel-45 text-xs mt-1">
                      {entry.number_of_tickets} ticket
                      {entry.number_of_tickets !== 1 ? "s" : ""} - $
                      {typeof entry.amount_spent === 'number' 
                        ? entry.amount_spent.toFixed(2)
                        : entry.amount_spent || '0.00'}
                    </div>
                    {entry.ticket_numbers && (
                      <div className="text-white/40 sequel-45 text-xs mt-1">
                        #{entry.ticket_numbers.split(",").slice(0, 5).join(", ")}
                        {entry.ticket_numbers.split(",").length > 5 && "..."}
                      </div>
                    )}
                  </div>
                  {entry.is_winner && (
                    <span className="bg-[#DDE404] text-black text-xs sequel-95 px-2 py-1 rounded ml-2">
                      WINNER
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      <EntriesWinnerSection
        fields={fields}
        activeTab={activeTab}
        status={status === "pending" ? "live" : status}
        isWinner={isWinner}
      />
    </div>
  );
};

export default CompetitionEntryDetails;

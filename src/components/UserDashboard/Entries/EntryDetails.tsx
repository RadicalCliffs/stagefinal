import { useLocation, useOutletContext, useParams } from "react-router";
import { useState, useEffect } from "react";
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
  status: "live" | "drawn" | "pending";
  is_winner: boolean;
  ticket_numbers?: string | null;
  number_of_tickets?: number | null;
  amount_spent?: string | null;
  purchase_date?: string | null;
  wallet_address?: string | null;
  transaction_hash?: string | null;
  is_instant_win: boolean;
  prize_value?: string | null;
  competition_status: string;
  end_date?: string | null;
}

const EntryDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { baseUser } = useAuthUser();
  const [entry, setEntry] = useState<EntryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { activeTab } = useOutletContext<{ activeTab: Options }>();
  const location = useLocation();

  // Get status and isWinner from location state as fallback
  const stateStatus = (location.state as { status?: "live" | "drawn" })?.status;
  const stateIsWinner = (location.state as { is_winner?: boolean })?.is_winner;

  useEffect(() => {
    const fetchEntry = async () => {
      if (!baseUser?.id || !id) {
        setLoading(false);
        setError("Unable to load entry details");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Fetch all user entries and find the specific one
        const entries = await database.getUserEntries(baseUser.id);
        const foundEntry = entries?.find((e: EntryData) => e.id === id);

        if (foundEntry) {
          setEntry(foundEntry);
        } else {
          setError("Entry not found");
        }
      } catch (err) {
        console.error("Error fetching entry:", err);
        setError("Failed to load entry details");
      } finally {
        setLoading(false);
      }
    };

    fetchEntry();
  }, [baseUser, id]);

  // Build fields for winner section
  const fields: WinnerInfoField[] = entry
    ? [
        {
          label: "Draw Date",
          value: entry.end_date
            ? new Date(entry.end_date).toLocaleDateString("en-US", {
                month: "2-digit",
                day: "2-digit",
                year: "numeric",
              })
            : "TBD",
          copyable: false,
        },
        ...(entry.transaction_hash && entry.transaction_hash !== "no-hash"
          ? [
              {
                label: "Transaction Hash",
                value: entry.transaction_hash,
                copyable: true,
              },
            ]
          : []),
      ]
    : [];

  // Use entry data or fallback to location state
  const status = entry?.status || stateStatus || "live";
  const isWinner = entry?.is_winner ?? stateIsWinner ?? false;

  if (loading) {
    return (
      <div className="mt-10 py-20">
        <Loader />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="mt-10">
        <div className="text-center py-12">
          <p className="text-white/70 sequel-45 text-lg">
            {error || "Entry not found"}
          </p>
          <a
            href="/dashboard/entries"
            className="inline-block mt-4 text-[#DDE404] sequel-45 hover:underline"
          >
            ← Back to entries
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
        title={entry.title}
        description={entry.description}
        competitionImage={entry.image}
        competitionId={entry.competition_id}
        endDate={entry.end_date || undefined}
        ticketNumbers={entry.ticket_numbers || undefined}
        amountSpent={entry.amount_spent || undefined}
        purchaseDate={entry.purchase_date || undefined}
        transactionHash={entry.transaction_hash || undefined}
        prizeValue={entry.prize_value || undefined}
        numberOfTickets={entry.number_of_tickets || undefined}
        isInstantWin={entry.is_instant_win}
      />
      <EntriesTickets
        ticketNumbers={entry.ticket_numbers}
        numberOfTickets={entry.number_of_tickets}
      />
      <EntriesWinnerSection
        fields={fields}
        activeTab={activeTab}
        status={status}
        isWinner={isWinner}
      />
    </div>
  );
};

export default EntryDetail;

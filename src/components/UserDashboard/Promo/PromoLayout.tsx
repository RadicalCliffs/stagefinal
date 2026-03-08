import Heading from "../../Heading";
import { useState, useEffect, useCallback } from "react";
import { useAuthUser } from "../../../contexts/AuthContext";
import Loader from "../../Loader";

interface PromoCompetition {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  prize_name: string;
  prize_description: string | null;
  prize_value: number | null;
  total_tickets: number;
  tickets_allocated: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
  draw_date: string | null;
  winning_ticket_numbers: string | null;
}

interface PromoEntry {
  redemption_id: string;
  entries_granted: number;
  redeemed_at: string;
  competition: PromoCompetition;
  tickets: Array<{ number: number; isWinner: boolean }>;
  hasWinningTicket: boolean;
}

interface RedemptionResult {
  ok: boolean;
  success?: boolean;
  entries_granted?: number;
  ticket_numbers?: number[];
  competition?: { id: string; title: string };
  error?: string;
}

export default function Promo() {
  const { canonicalUserId, accessToken } = useAuthUser();
  const [promoEntries, setPromoEntries] = useState<PromoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoCode, setPromoCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<RedemptionResult | null>(
    null,
  );
  const [expandedCompetition, setExpandedCompetition] = useState<string | null>(
    null,
  );

  const fetchPromoEntries = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/promo-competitions/my-entries", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPromoEntries(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch promo entries:", err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchPromoEntries();
  }, [fetchPromoEntries]);

  const handleRedeemCode = async () => {
    if (!promoCode.trim() || !accessToken) return;

    setRedeeming(true);
    setRedeemError(null);
    setRedeemSuccess(null);

    try {
      const response = await fetch("/api/promo-competitions/redeem", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: promoCode.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok || !data.success) {
        setRedeemError(data.error || "Failed to redeem code");
      } else {
        setRedeemSuccess(data);
        setPromoCode("");
        // Refresh entries list
        fetchPromoEntries();
      }
    } catch (err) {
      console.error("Redeem error:", err);
      setRedeemError("Failed to redeem code. Please try again.");
    } finally {
      setRedeeming(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "TBD";
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string, hasWinningTicket: boolean) => {
    if (hasWinningTicket) {
      return (
        <span className="bg-green-500 text-black px-3 py-1 rounded-full text-xs sequel-75 uppercase">
          Winner!
        </span>
      );
    }
    switch (status) {
      case "active":
        return (
          <span className="bg-[#DDE404] text-black px-3 py-1 rounded-full text-xs sequel-75 uppercase">
            Live
          </span>
        );
      case "ended":
        return (
          <span className="bg-gray-500 text-white px-3 py-1 rounded-full text-xs sequel-75 uppercase">
            Ended
          </span>
        );
      case "draft":
        return (
          <span className="bg-orange-500 text-black px-3 py-1 rounded-full text-xs sequel-75 uppercase">
            Coming Soon
          </span>
        );
      default:
        return (
          <span className="bg-gray-600 text-white px-3 py-1 rounded-full text-xs sequel-75 uppercase">
            {status}
          </span>
        );
    }
  };

  if (!canonicalUserId) {
    return (
      <div className="py-12 text-center">
        <p className="text-white/70 sequel-45 text-lg">
          Please log in to access promotional competitions.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-20">
        <Loader />
      </div>
    );
  }

  return (
    <div>
      <Heading text="PROMOTIONAL COMPETITIONS" classes="text-white sequel-95" />
      <p className="sequel-45 text-white text-center mt-6 sm:leading-relaxed leading-loose sm:w-10/12 mx-auto sm:text-base text-sm">
        If you have been lucky enough to receive one of our{" "}
        <span className="sequel-75">PROMOTIONAL CODES</span> for one of our
        competitions, enter it below to redeem your free entries. Good luck!
      </p>

      {/* Code Redemption Section */}
      <div className="bg-[#151515] lg:py-8 xl:px-12 px-4 sm:px-6 py-6 rounded-lg my-8 w-full">
        <h3 className="sequel-75 text-white text-lg mb-4">Redeem Promo Code</h3>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <input
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleRedeemCode()}
            className="bg-white/10 border border-white/20 text-white sm:text-base text-sm w-full rounded-md sequel-45 px-4 py-3 placeholder:text-white/50 focus:outline-none focus:border-[#DDE404] transition-colors"
            placeholder="Enter your promo code..."
            disabled={redeeming}
            maxLength={20}
          />
          <button
            onClick={handleRedeemCode}
            disabled={redeeming || !promoCode.trim()}
            className="sequel-95 bg-[#DDE404] sm:text-base text-sm cursor-pointer text-black uppercase px-6 py-3 rounded-md shrink-0 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#c8cf03] transition-colors"
          >
            {redeeming ? "Redeeming..." : "Redeem"}
          </button>
        </div>

        {/* Error Message */}
        {redeemError && (
          <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-md">
            <p className="text-red-400 sequel-45 text-sm">{redeemError}</p>
          </div>
        )}

        {/* Success Message */}
        {redeemSuccess && (
          <div className="mt-4 p-4 bg-green-500/20 border border-green-500/50 rounded-md">
            <p className="text-green-400 sequel-75 text-base mb-2">
              🎉 Code Redeemed Successfully!
            </p>
            <p className="text-white sequel-45 text-sm">
              You've been granted{" "}
              <span className="text-[#DDE404] sequel-75">
                {redeemSuccess.entries_granted} free{" "}
                {redeemSuccess.entries_granted === 1 ? "entry" : "entries"}
              </span>{" "}
              to{" "}
              <span className="sequel-75">
                {redeemSuccess.competition?.title}
              </span>
              !
            </p>
            <p className="text-white/70 sequel-45 text-xs mt-2">
              Ticket numbers: {redeemSuccess.ticket_numbers?.join(", ")}
            </p>
          </div>
        )}
      </div>

      {/* My Promo Competitions */}
      <div className="bg-[#151515] lg:py-10 xl:px-12 px-4 sm:px-6 py-6 rounded-lg my-8 w-full">
        <h3 className="sequel-75 text-white text-xl mb-6">
          My Promotional Competitions
        </h3>

        {promoEntries.length > 0 ? (
          <div className="space-y-6">
            {promoEntries.map((entry) => (
              <div
                key={entry.redemption_id}
                className="bg-[#1a1a1a] rounded-lg overflow-hidden border border-white/10"
              >
                {/* Competition Header */}
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    {/* Image */}
                    {entry.competition.image_url && (
                      <div className="w-full sm:w-32 h-32 sm:h-24 rounded-lg overflow-hidden bg-black/30 shrink-0">
                        <img
                          src={entry.competition.image_url}
                          alt={entry.competition.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <h4 className="sequel-75 text-white text-lg">
                          {entry.competition.title}
                        </h4>
                        {getStatusBadge(
                          entry.competition.status,
                          entry.hasWinningTicket,
                        )}
                      </div>

                      <p className="sequel-45 text-white/70 text-sm mb-3">
                        {entry.competition.prize_name}
                        {entry.competition.prize_value && (
                          <span className="text-[#DDE404]">
                            {" "}
                            - ${entry.competition.prize_value.toLocaleString()}
                          </span>
                        )}
                      </p>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-white/50 sequel-45">
                            Your Entries
                          </p>
                          <p className="text-[#DDE404] sequel-75">
                            {entry.tickets.length}
                          </p>
                        </div>
                        <div>
                          <p className="text-white/50 sequel-45">
                            Total Tickets
                          </p>
                          <p className="text-white sequel-75">
                            {entry.competition.tickets_allocated}/
                            {entry.competition.total_tickets}
                          </p>
                        </div>
                        <div>
                          <p className="text-white/50 sequel-45">Draw Date</p>
                          <p className="text-white sequel-45 text-xs">
                            {formatDate(entry.competition.draw_date)}
                          </p>
                        </div>
                        <div>
                          <p className="text-white/50 sequel-45">Redeemed</p>
                          <p className="text-white sequel-45 text-xs">
                            {formatDate(entry.redeemed_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expand/Collapse Button */}
                  <button
                    onClick={() =>
                      setExpandedCompetition(
                        expandedCompetition === entry.competition.id
                          ? null
                          : entry.competition.id,
                      )
                    }
                    className="mt-4 text-[#DDE404] sequel-45 text-sm hover:underline flex items-center gap-2"
                  >
                    {expandedCompetition === entry.competition.id
                      ? "Hide"
                      : "View"}{" "}
                    My Tickets
                    <svg
                      className={`w-4 h-4 transition-transform ${expandedCompetition === entry.competition.id ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </div>

                {/* Expanded Tickets Section */}
                {expandedCompetition === entry.competition.id && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-white/10">
                    <p className="sequel-75 text-white text-sm mt-4 mb-3">
                      Your Ticket Numbers:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {entry.tickets.map((ticket) => (
                        <span
                          key={ticket.number}
                          className={`px-3 py-1.5 rounded-md text-sm sequel-75 ${
                            ticket.isWinner
                              ? "bg-green-500 text-black"
                              : "bg-[#DDE404]/20 text-[#DDE404] border border-[#DDE404]/30"
                          }`}
                        >
                          #{ticket.number}
                          {ticket.isWinner && " 🏆"}
                        </span>
                      ))}
                    </div>

                    {/* Winner Info */}
                    {entry.competition.status === "ended" &&
                      entry.competition.winning_ticket_numbers && (
                        <div className="mt-4 p-3 bg-white/5 rounded-md">
                          <p className="sequel-45 text-white/70 text-sm">
                            Winning Ticket(s):{" "}
                            <span className="text-[#DDE404] sequel-75">
                              {entry.competition.winning_ticket_numbers}
                            </span>
                          </p>
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-[#1a1a1a] rounded-lg">
            <div className="text-4xl mb-4">🎟️</div>
            <p className="text-white/70 sequel-45 text-lg mb-2">
              No promotional competitions yet
            </p>
            <p className="text-white/50 sequel-45 text-sm">
              Enter a promo code above to unlock exclusive competitions!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

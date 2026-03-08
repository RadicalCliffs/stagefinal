/**
 * ThePrize.io Promo Competition Client
 *
 * Drop this file into your admin dashboard to manage promotional competitions.
 * Promo competitions are special competitions accessible only via promo codes.
 *
 * Features:
 * - Create/manage promo competitions
 * - Generate promo codes (single or bulk)
 * - Each code grants X free entries to a specific promo competition
 * - Track redemptions and statistics
 *
 * Setup:
 * 1. Add THEPRIZE_API_KEY to your environment variables (same value as ADMIN_API_KEY on theprize.io)
 * 2. Import and use the client
 *
 * Example:
 *   import { promoCompetitionClient } from './theprize-promo-competition-client';
 *
 *   // Create a promo competition
 *   const comp = await promoCompetitionClient.createCompetition({
 *     title: "Exclusive Bitcoin Giveaway",
 *     prize_name: "1 BTC",
 *     prize_value: 65000,
 *     total_tickets: 500,
 *   });
 *
 *   // Generate 100 codes worth 10 entries each
 *   const codes = await promoCompetitionClient.bulkCreateCodes({
 *     promo_competition_id: comp.competition.id,
 *     count: 100,
 *     entries_granted: 10,
 *     prefix: "BTC",
 *   });
 */

const API_BASE = process.env.THEPRIZE_API_URL || "https://theprize.io";
const API_KEY = process.env.THEPRIZE_API_KEY || "";

// ============ Types ============

export interface PromoCompetition {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  prize_name: string;
  prize_description: string | null;
  prize_value: number | null;
  total_tickets: number;
  tickets_allocated: number;
  status: "draft" | "active" | "ended" | "cancelled";
  start_date: string | null;
  end_date: string | null;
  draw_date: string | null;
  winning_ticket_numbers: string | null;
  drawn_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromoCode {
  id: string;
  promo_competition_id: string;
  code: string;
  entries_granted: number;
  max_redemptions: number | null;
  current_redemptions: number;
  is_active: boolean;
  valid_from: string;
  valid_until: string | null;
  restricted_to_user_id: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  promo_competitions?: {
    id: string;
    title: string;
    status: string;
  };
}

export interface PromoRedemption {
  id: string;
  promo_competition_id: string;
  code_id: string;
  canonical_user_id: string;
  entries_granted: number;
  ticket_numbers: string;
  status: string;
  redeemed_at: string;
  promo_competitions?: {
    id: string;
    title: string;
  };
  promo_competition_codes?: {
    id: string;
    code: string;
    entries_granted: number;
  };
}

export interface CreateCompetitionInput {
  title: string;
  prize_name: string;
  description?: string;
  image_url?: string;
  prize_description?: string;
  prize_value?: number;
  total_tickets?: number;
  status?: "draft" | "active";
  start_date?: string;
  end_date?: string;
  draw_date?: string;
}

export interface UpdateCompetitionInput {
  title?: string;
  description?: string;
  image_url?: string;
  prize_name?: string;
  prize_description?: string;
  prize_value?: number;
  total_tickets?: number;
  status?: "draft" | "active" | "ended" | "cancelled";
  start_date?: string;
  end_date?: string;
  draw_date?: string;
  winning_ticket_numbers?: string;
  drawn_at?: string;
}

export interface CreateCodeInput {
  promo_competition_id: string;
  entries_granted: number;
  code?: string; // If not provided, will be auto-generated
  max_redemptions?: number;
  valid_from?: string;
  valid_until?: string;
  restricted_to_user_id?: string;
  description?: string;
}

export interface BulkCreateCodesInput {
  promo_competition_id: string;
  count: number;
  entries_granted: number;
  prefix?: string;
  max_redemptions?: number;
  valid_from?: string;
  valid_until?: string;
  description?: string;
}

export interface UpdateCodeInput {
  entries_granted?: number;
  max_redemptions?: number;
  is_active?: boolean;
  valid_from?: string;
  valid_until?: string;
  restricted_to_user_id?: string | null;
  description?: string;
}

export interface PromoStats {
  competitions_by_status: Record<string, number>;
  total_redemptions: number;
  total_tickets_allocated: number;
  active_codes: number;
  inactive_codes: number;
  total_code_redemptions: number;
}

// ============ API Helpers ============

async function sendRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: object,
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Api-Key": API_KEY,
    },
  };

  if (body && (method === "POST" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

// ============ Client ============

export const promoCompetitionClient = {
  // ============ COMPETITION MANAGEMENT ============

  /**
   * Create a new promo competition
   * @param input - Competition details
   * @returns Created competition
   */
  async createCompetition(
    input: CreateCompetitionInput,
  ): Promise<{ ok: boolean; competition: PromoCompetition }> {
    return sendRequest(
      "/api/promo-competitions/admin/competitions",
      "POST",
      input,
    );
  },

  /**
   * List all promo competitions
   * @param options - Filter options
   * @returns List of competitions
   */
  async listCompetitions(options?: {
    status?: "draft" | "active" | "ended" | "cancelled";
    limit?: number;
    offset?: number;
  }): Promise<{
    ok: boolean;
    competitions: PromoCompetition[];
    total: number;
  }> {
    const params = new URLSearchParams();
    if (options?.status) params.set("status", options.status);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.offset) params.set("offset", options.offset.toString());

    const query = params.toString() ? `?${params.toString()}` : "";
    return sendRequest(`/api/promo-competitions/admin/competitions${query}`);
  },

  /**
   * Update a promo competition
   * @param competitionId - Competition UUID
   * @param updates - Fields to update
   * @returns Updated competition
   */
  async updateCompetition(
    competitionId: string,
    updates: UpdateCompetitionInput,
  ): Promise<{ ok: boolean; competition: PromoCompetition }> {
    return sendRequest(
      `/api/promo-competitions/admin/competitions/${competitionId}`,
      "PATCH",
      updates,
    );
  },

  /**
   * Delete (cancel) a promo competition
   * @param competitionId - Competition UUID
   */
  async deleteCompetition(
    competitionId: string,
  ): Promise<{ ok: boolean; deleted: boolean }> {
    return sendRequest(
      `/api/promo-competitions/admin/competitions/${competitionId}`,
      "DELETE",
    );
  },

  /**
   * Activate a competition (set status to active)
   * @param competitionId - Competition UUID
   */
  async activateCompetition(
    competitionId: string,
  ): Promise<{ ok: boolean; competition: PromoCompetition }> {
    return this.updateCompetition(competitionId, { status: "active" });
  },

  /**
   * End a competition and set winning tickets
   * @param competitionId - Competition UUID
   * @param winningTicketNumbers - Comma-separated winning ticket numbers
   */
  async endCompetition(
    competitionId: string,
    winningTicketNumbers: string,
  ): Promise<{ ok: boolean; competition: PromoCompetition }> {
    return this.updateCompetition(competitionId, {
      status: "ended",
      winning_ticket_numbers: winningTicketNumbers,
      drawn_at: new Date().toISOString(),
    });
  },

  // ============ CODE MANAGEMENT ============

  /**
   * Create a single promo code
   * @param input - Code details
   * @returns Created code
   */
  async createCode(
    input: CreateCodeInput,
  ): Promise<{ ok: boolean; code: PromoCode }> {
    return sendRequest("/api/promo-competitions/admin/codes", "POST", input);
  },

  /**
   * Create multiple promo codes at once
   * @param input - Bulk creation options
   * @returns Created codes
   */
  async bulkCreateCodes(
    input: BulkCreateCodesInput,
  ): Promise<{ ok: boolean; created: number; codes: PromoCode[] }> {
    return sendRequest(
      "/api/promo-competitions/admin/codes/bulk",
      "POST",
      input,
    );
  },

  /**
   * List promo codes
   * @param options - Filter options
   * @returns List of codes
   */
  async listCodes(options?: {
    competition_id?: string;
    active_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ ok: boolean; codes: PromoCode[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.competition_id)
      params.set("competition_id", options.competition_id);
    if (options?.active_only) params.set("active_only", "true");
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.offset) params.set("offset", options.offset.toString());

    const query = params.toString() ? `?${params.toString()}` : "";
    return sendRequest(`/api/promo-competitions/admin/codes${query}`);
  },

  /**
   * Update a promo code
   * @param codeId - Code UUID
   * @param updates - Fields to update
   * @returns Updated code
   */
  async updateCode(
    codeId: string,
    updates: UpdateCodeInput,
  ): Promise<{ ok: boolean; code: PromoCode }> {
    return sendRequest(
      `/api/promo-competitions/admin/codes/${codeId}`,
      "PATCH",
      updates,
    );
  },

  /**
   * Deactivate a promo code
   * @param codeId - Code UUID
   */
  async deactivateCode(
    codeId: string,
  ): Promise<{ ok: boolean; deactivated: boolean }> {
    return sendRequest(
      `/api/promo-competitions/admin/codes/${codeId}`,
      "DELETE",
    );
  },

  /**
   * Reactivate a previously deactivated code
   * @param codeId - Code UUID
   */
  async reactivateCode(
    codeId: string,
  ): Promise<{ ok: boolean; code: PromoCode }> {
    return this.updateCode(codeId, { is_active: true });
  },

  // ============ REDEMPTIONS & STATS ============

  /**
   * Get redemption history
   * @param options - Filter options
   * @returns List of redemptions
   */
  async getRedemptions(options?: {
    competition_id?: string;
    code_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ ok: boolean; redemptions: PromoRedemption[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.competition_id)
      params.set("competition_id", options.competition_id);
    if (options?.code_id) params.set("code_id", options.code_id);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.offset) params.set("offset", options.offset.toString());

    const query = params.toString() ? `?${params.toString()}` : "";
    return sendRequest(`/api/promo-competitions/admin/redemptions${query}`);
  },

  /**
   * Get overall statistics
   * @returns Stats object
   */
  async getStats(): Promise<{ ok: boolean; stats: PromoStats }> {
    return sendRequest("/api/promo-competitions/admin/stats");
  },

  // ============ CONVENIENCE METHODS ============

  /**
   * Create a complete promo campaign: competition + codes
   * @param competition - Competition details
   * @param codeConfig - Code generation config
   * @returns Competition and codes
   */
  async createCampaign(
    competition: CreateCompetitionInput,
    codeConfig: {
      count: number;
      entries_per_code: number;
      prefix?: string;
      max_redemptions_per_code?: number;
      valid_until?: string;
    },
  ): Promise<{
    competition: PromoCompetition;
    codes: PromoCode[];
    summary: {
      total_codes: number;
      total_potential_entries: number;
    };
  }> {
    // Create competition
    const compResult = await this.createCompetition(competition);
    const comp = compResult.competition;

    // Generate codes
    const codesResult = await this.bulkCreateCodes({
      promo_competition_id: comp.id,
      count: codeConfig.count,
      entries_granted: codeConfig.entries_per_code,
      prefix: codeConfig.prefix,
      max_redemptions: codeConfig.max_redemptions_per_code,
      valid_until: codeConfig.valid_until,
    });

    return {
      competition: comp,
      codes: codesResult.codes,
      summary: {
        total_codes: codesResult.created,
        total_potential_entries:
          codesResult.created * codeConfig.entries_per_code,
      },
    };
  },

  /**
   * Export codes as CSV string (for distribution)
   * @param competitionId - Competition UUID
   * @returns CSV string with code details
   */
  async exportCodesAsCsv(competitionId: string): Promise<string> {
    const { codes } = await this.listCodes({
      competition_id: competitionId,
      limit: 10000,
    });

    const headers = [
      "Code",
      "Entries",
      "Max Redemptions",
      "Current Redemptions",
      "Active",
      "Valid Until",
    ];
    const rows = codes.map((c) => [
      c.code,
      c.entries_granted,
      c.max_redemptions || "Unlimited",
      c.current_redemptions,
      c.is_active ? "Yes" : "No",
      c.valid_until || "No Expiry",
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  },

  /**
   * Get codes that haven't been redeemed yet
   * @param competitionId - Competition UUID
   * @returns Unused codes
   */
  async getUnusedCodes(competitionId: string): Promise<PromoCode[]> {
    const { codes } = await this.listCodes({
      competition_id: competitionId,
      active_only: true,
      limit: 10000,
    });

    return codes.filter((c) => c.current_redemptions === 0);
  },

  /**
   * Create a personalized code for a specific user
   * @param competitionId - Competition UUID
   * @param userId - User's canonical_user_id or email
   * @param entries - Number of entries to grant
   * @param customCode - Optional custom code string
   */
  async createPersonalizedCode(
    competitionId: string,
    userId: string,
    entries: number,
    customCode?: string,
  ): Promise<{ ok: boolean; code: PromoCode }> {
    return this.createCode({
      promo_competition_id: competitionId,
      entries_granted: entries,
      code: customCode,
      max_redemptions: 1,
      restricted_to_user_id: userId,
      description: `Personalized code for ${userId}`,
    });
  },
};

// Default export
export default promoCompetitionClient;

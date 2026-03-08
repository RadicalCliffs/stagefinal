/**
 * ThePrize.io Hero Competition Admin Client
 *
 * Drop this file into your admin dashboard to manage hero competitions.
 * Hero competitions are the featured competitions shown in the main carousel.
 *
 * Features:
 * - Create/manage hero competitions
 * - Set display order and status
 * - Link to underlying database competitions
 * - Update images, titles, descriptions, and CTAs
 *
 * Setup:
 * 1. Add THEPRIZE_API_KEY to your environment variables (same value as ADMIN_API_KEY on theprize.io)
 * 2. Import and use the client
 *
 * Example:
 *   import { heroCompetitionClient } from './theprize-hero-competition-client';
 *
 *   // List all hero competitions
 *   const heroes = await heroCompetitionClient.listHeroCompetitions();
 *
 *   // Update a hero competition
 *   await heroCompetitionClient.updateHeroCompetition('lambo-123', {
 *     title: "WIN THE MOST OUTRAGEOUS URUS ON THE PLANET",
 *     cta_text: "Enter Now!",
 *     is_active: true,
 *   });
 */

const API_BASE = process.env.THEPRIZE_API_URL || "https://theprize.io";
const API_KEY = process.env.THEPRIZE_API_KEY || "";

// ============ Types ============

export interface HeroCompetition {
  id: string;
  slug: string;
  title: string;
  description: string;
  image_url: string;
  mobile_image_url: string | null;
  prize_name: string;
  prize_value: number | null;
  ticket_price: number;
  total_tickets: number;
  cta_text: string;
  cta_link: string;
  display_order: number;
  is_active: boolean;
  competition_id: string | null; // Link to underlying competition
  badge_text: string | null; // e.g., "CRYPTO DRAW", "LIMITED"
  badge_color: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHeroCompetitionInput {
  slug: string;
  title: string;
  description: string;
  image_url: string;
  prize_name: string;
  ticket_price: number;
  cta_text?: string;
  cta_link?: string;
  mobile_image_url?: string;
  prize_value?: number;
  total_tickets?: number;
  display_order?: number;
  is_active?: boolean;
  competition_id?: string;
  badge_text?: string;
  badge_color?: string;
  start_date?: string;
  end_date?: string;
}

export interface UpdateHeroCompetitionInput {
  title?: string;
  description?: string;
  image_url?: string;
  mobile_image_url?: string;
  prize_name?: string;
  prize_value?: number;
  ticket_price?: number;
  total_tickets?: number;
  cta_text?: string;
  cta_link?: string;
  display_order?: number;
  is_active?: boolean;
  competition_id?: string | null;
  badge_text?: string | null;
  badge_color?: string | null;
  start_date?: string | null;
  end_date?: string | null;
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

export const heroCompetitionClient = {
  // ============ HERO COMPETITION MANAGEMENT ============

  /**
   * List all hero competitions
   * @param options - Filter options
   * @returns List of hero competitions
   */
  async listHeroCompetitions(options?: {
    active_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    ok: boolean;
    heroCompetitions: HeroCompetition[];
    total: number;
  }> {
    const params = new URLSearchParams();
    if (options?.active_only) params.set("active_only", "true");
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.offset) params.set("offset", options.offset.toString());

    const query = params.toString() ? `?${params.toString()}` : "";
    return sendRequest(`/api/hero-competitions/admin/list${query}`);
  },

  /**
   * Get a single hero competition by ID or slug
   * @param idOrSlug - Hero competition UUID or slug
   * @returns Hero competition details
   */
  async getHeroCompetition(
    idOrSlug: string,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    return sendRequest(`/api/hero-competitions/admin/${idOrSlug}`);
  },

  /**
   * Create a new hero competition
   * @param input - Hero competition details
   * @returns Created hero competition
   */
  async createHeroCompetition(
    input: CreateHeroCompetitionInput,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    return sendRequest("/api/hero-competitions/admin/create", "POST", input);
  },

  /**
   * Update a hero competition
   * @param idOrSlug - Hero competition UUID or slug
   * @param updates - Fields to update
   * @returns Updated hero competition
   */
  async updateHeroCompetition(
    idOrSlug: string,
    updates: UpdateHeroCompetitionInput,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    return sendRequest(
      `/api/hero-competitions/admin/${idOrSlug}`,
      "PATCH",
      updates,
    );
  },

  /**
   * Delete a hero competition
   * @param idOrSlug - Hero competition UUID or slug
   */
  async deleteHeroCompetition(
    idOrSlug: string,
  ): Promise<{ ok: boolean; deleted: boolean }> {
    return sendRequest(`/api/hero-competitions/admin/${idOrSlug}`, "DELETE");
  },

  /**
   * Activate a hero competition (set is_active to true)
   * @param idOrSlug - Hero competition UUID or slug
   */
  async activateHeroCompetition(
    idOrSlug: string,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    return this.updateHeroCompetition(idOrSlug, { is_active: true });
  },

  /**
   * Deactivate a hero competition (set is_active to false)
   * @param idOrSlug - Hero competition UUID or slug
   */
  async deactivateHeroCompetition(
    idOrSlug: string,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    return this.updateHeroCompetition(idOrSlug, { is_active: false });
  },

  /**
   * Update display order for hero competitions
   * @param orderedIds - Array of hero competition IDs in desired display order
   */
  async updateDisplayOrder(
    orderedIds: string[],
  ): Promise<{ ok: boolean; updated: number }> {
    return sendRequest("/api/hero-competitions/admin/reorder", "POST", {
      ordered_ids: orderedIds,
    });
  },

  // ============ CONVENIENCE METHODS ============

  /**
   * Get all active hero competitions in display order
   * @returns Active hero competitions sorted by display_order
   */
  async getActiveHeroCompetitions(): Promise<HeroCompetition[]> {
    const { heroCompetitions } = await this.listHeroCompetitions({
      active_only: true,
      limit: 100,
    });
    return heroCompetitions.sort((a, b) => a.display_order - b.display_order);
  },

  /**
   * Quickly update just the CTA text and link
   * @param idOrSlug - Hero competition UUID or slug
   * @param ctaText - New CTA button text
   * @param ctaLink - New CTA link (optional)
   */
  async updateCta(
    idOrSlug: string,
    ctaText: string,
    ctaLink?: string,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    const updates: UpdateHeroCompetitionInput = { cta_text: ctaText };
    if (ctaLink) updates.cta_link = ctaLink;
    return this.updateHeroCompetition(idOrSlug, updates);
  },

  /**
   * Link a hero competition to a database competition
   * @param heroIdOrSlug - Hero competition UUID or slug
   * @param competitionId - Database competition UUID to link
   */
  async linkToCompetition(
    heroIdOrSlug: string,
    competitionId: string,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    return this.updateHeroCompetition(heroIdOrSlug, {
      competition_id: competitionId,
    });
  },

  /**
   * Unlink a hero competition from its database competition
   * @param heroIdOrSlug - Hero competition UUID or slug
   */
  async unlinkFromCompetition(
    heroIdOrSlug: string,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    return this.updateHeroCompetition(heroIdOrSlug, {
      competition_id: null,
    });
  },

  /**
   * Duplicate a hero competition
   * @param sourceIdOrSlug - Source hero competition UUID or slug
   * @param newSlug - Slug for the duplicated competition
   * @returns Newly created hero competition
   */
  async duplicateHeroCompetition(
    sourceIdOrSlug: string,
    newSlug: string,
  ): Promise<{ ok: boolean; heroCompetition: HeroCompetition }> {
    const { heroCompetition: source } =
      await this.getHeroCompetition(sourceIdOrSlug);

    const { id, created_at, updated_at, ...sourceData } = source;

    return this.createHeroCompetition({
      ...sourceData,
      slug: newSlug,
      title: `${source.title} (Copy)`,
      is_active: false, // Start as inactive
      display_order: source.display_order + 1,
    });
  },
};

// Default export
export default heroCompetitionClient;

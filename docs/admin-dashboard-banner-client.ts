/**
 * ThePrize.io Banner Admin Client
 *
 * Drop this file into your admin dashboard to manage site banners.
 * Supports different banners for users who have/haven't used their first top-up bonus.
 *
 * Features:
 * - Manage banner text for pre-first-topup users (default: "50% bonus credits")
 * - Manage banner text for post-first-topup users (editable promotional text)
 * - Set banner colors, links, and visibility
 * - Schedule banner changes
 *
 * Setup:
 * 1. Add THEPRIZE_API_KEY to your environment variables (same value as ADMIN_API_KEY on theprize.io)
 * 2. Import and use the client
 *
 * Example:
 *   import { bannerClient } from './theprize-banner-client';
 *
 *   // Update post-topup banner
 *   await bannerClient.updatePostTopupBanner({
 *     highlight_text: "LIMITED TIME",
 *     main_text: "Double entries on all competitions!",
 *     link: "/competitions",
 *   });
 */

const API_BASE = process.env.THEPRIZE_API_URL || "https://theprize.io";
const API_KEY = process.env.THEPRIZE_API_KEY || "";

// ============ Types ============

export type BannerType = "pre_topup" | "post_topup" | "global";

export interface Banner {
  id: string;
  type: BannerType;
  highlight_text: string; // Bold/highlighted portion (e.g., "50% bonus credits")
  main_text: string; // Regular text (e.g., "on your first wallet top-up!")
  background_color: string; // Hex color (e.g., "#EF008F")
  text_color: string; // Hex color (e.g., "#FFFFFF")
  link: string | null; // Optional link URL
  link_text: string | null; // Optional link display text
  is_active: boolean;
  priority: number; // Higher priority banners show first
  start_date: string | null; // ISO date string
  end_date: string | null; // ISO date string
  created_at: string;
  updated_at: string;
}

export interface CreateBannerInput {
  type: BannerType;
  highlight_text: string;
  main_text: string;
  background_color?: string;
  text_color?: string;
  link?: string;
  link_text?: string;
  is_active?: boolean;
  priority?: number;
  start_date?: string;
  end_date?: string;
}

export interface UpdateBannerInput {
  highlight_text?: string;
  main_text?: string;
  background_color?: string;
  text_color?: string;
  link?: string | null;
  link_text?: string | null;
  is_active?: boolean;
  priority?: number;
  start_date?: string | null;
  end_date?: string | null;
}

export interface BannerConfig {
  pre_topup: Banner | null;
  post_topup: Banner | null;
  global: Banner | null;
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

export const bannerClient = {
  // ============ BANNER MANAGEMENT ============

  /**
   * Get all banners
   * @returns All configured banners
   */
  async getAllBanners(): Promise<{
    ok: boolean;
    banners: Banner[];
    config: BannerConfig;
  }> {
    return sendRequest("/api/banners/admin/list");
  },

  /**
   * Get active banner configuration
   * Shows which banner each user type will see
   * @returns Banner configuration
   */
  async getBannerConfig(): Promise<{
    ok: boolean;
    config: BannerConfig;
  }> {
    return sendRequest("/api/banners/admin/config");
  },

  /**
   * Get a single banner by ID
   * @param bannerId - Banner UUID
   * @returns Banner details
   */
  async getBanner(bannerId: string): Promise<{ ok: boolean; banner: Banner }> {
    return sendRequest(`/api/banners/admin/${bannerId}`);
  },

  /**
   * Create a new banner
   * @param input - Banner details
   * @returns Created banner
   */
  async createBanner(
    input: CreateBannerInput,
  ): Promise<{ ok: boolean; banner: Banner }> {
    return sendRequest("/api/banners/admin/create", "POST", input);
  },

  /**
   * Update a banner
   * @param bannerId - Banner UUID
   * @param updates - Fields to update
   * @returns Updated banner
   */
  async updateBanner(
    bannerId: string,
    updates: UpdateBannerInput,
  ): Promise<{ ok: boolean; banner: Banner }> {
    return sendRequest(`/api/banners/admin/${bannerId}`, "PATCH", updates);
  },

  /**
   * Delete a banner
   * @param bannerId - Banner UUID
   */
  async deleteBanner(
    bannerId: string,
  ): Promise<{ ok: boolean; deleted: boolean }> {
    return sendRequest(`/api/banners/admin/${bannerId}`, "DELETE");
  },

  /**
   * Activate a banner
   * @param bannerId - Banner UUID
   */
  async activateBanner(
    bannerId: string,
  ): Promise<{ ok: boolean; banner: Banner }> {
    return this.updateBanner(bannerId, { is_active: true });
  },

  /**
   * Deactivate a banner
   * @param bannerId - Banner UUID
   */
  async deactivateBanner(
    bannerId: string,
  ): Promise<{ ok: boolean; banner: Banner }> {
    return this.updateBanner(bannerId, { is_active: false });
  },

  // ============ PRE-TOPUP BANNER (50% bonus - default) ============

  /**
   * Get the pre-topup banner (shown to users who haven't topped up yet)
   * Default: "50% bonus credits on your first wallet top-up!"
   */
  async getPreTopupBanner(): Promise<{
    ok: boolean;
    banner: Banner | null;
  }> {
    const { config } = await this.getBannerConfig();
    return { ok: true, banner: config.pre_topup };
  },

  /**
   * Update the pre-topup banner
   * @param updates - Fields to update
   */
  async updatePreTopupBanner(
    updates: Omit<UpdateBannerInput, "type">,
  ): Promise<{ ok: boolean; banner: Banner }> {
    const { config } = await this.getBannerConfig();

    if (config.pre_topup) {
      return this.updateBanner(config.pre_topup.id, updates);
    }

    // Create if doesn't exist
    return this.createBanner({
      type: "pre_topup",
      highlight_text: updates.highlight_text || "50% bonus credits",
      main_text: updates.main_text || "on your first wallet top-up!",
      background_color: updates.background_color || "#EF008F",
      text_color: updates.text_color || "#FFFFFF",
      link: updates.link || undefined,
      link_text: updates.link_text || undefined,
      is_active: updates.is_active ?? true,
    });
  },

  // ============ POST-TOPUP BANNER (editable promotional) ============

  /**
   * Get the post-topup banner (shown to users who have already topped up)
   * This is the editable promotional banner
   */
  async getPostTopupBanner(): Promise<{
    ok: boolean;
    banner: Banner | null;
  }> {
    const { config } = await this.getBannerConfig();
    return { ok: true, banner: config.post_topup };
  },

  /**
   * Update the post-topup banner (main editable banner)
   * @param updates - Fields to update
   *
   * Example:
   *   await bannerClient.updatePostTopupBanner({
   *     highlight_text: "SUBMIT OUR FEEDBACK FORM",
   *     main_text: "FOR $20 SITE CREDIT",
   *     link: "https://forms.gle/WvDabrEKk7ejUa188",
   *   });
   */
  async updatePostTopupBanner(
    updates: Omit<UpdateBannerInput, "type">,
  ): Promise<{ ok: boolean; banner: Banner }> {
    const { config } = await this.getBannerConfig();

    if (config.post_topup) {
      return this.updateBanner(config.post_topup.id, updates);
    }

    // Create if doesn't exist
    return this.createBanner({
      type: "post_topup",
      highlight_text: updates.highlight_text || "NEW",
      main_text: updates.main_text || "Check out our latest competitions!",
      background_color: updates.background_color || "#EF008F",
      text_color: updates.text_color || "#FFFFFF",
      link: updates.link || undefined,
      link_text: updates.link_text || undefined,
      is_active: updates.is_active ?? true,
    });
  },

  // ============ CONVENIENCE METHODS ============

  /**
   * Set the feedback form banner (post-topup)
   * Quick helper to set up the feedback form promotion
   */
  async setFeedbackFormBanner(
    formUrl: string = "https://forms.gle/WvDabrEKk7ejUa188",
    creditAmount: string = "$20",
  ): Promise<{ ok: boolean; banner: Banner }> {
    return this.updatePostTopupBanner({
      highlight_text: "SUBMIT OUR FEEDBACK FORM",
      main_text: `FOR ${creditAmount} SITE CREDIT`,
      link: formUrl,
      background_color: "#EF008F",
      is_active: true,
    });
  },

  /**
   * Reset pre-topup banner to default (50% bonus)
   */
  async resetPreTopupBannerToDefault(): Promise<{
    ok: boolean;
    banner: Banner;
  }> {
    return this.updatePreTopupBanner({
      highlight_text: "50% bonus credits",
      main_text: "on your first wallet top-up!",
      background_color: "#EF008F",
      text_color: "#FFFFFF",
      link: null,
      is_active: true,
    });
  },

  /**
   * Disable post-topup banner (only show pre-topup banner to all)
   */
  async disablePostTopupBanner(): Promise<{ ok: boolean }> {
    const { config } = await this.getBannerConfig();
    if (config.post_topup) {
      await this.deactivateBanner(config.post_topup.id);
    }
    return { ok: true };
  },

  /**
   * Schedule a banner to run between dates
   * @param bannerId - Banner UUID
   * @param startDate - Start date (ISO string)
   * @param endDate - End date (ISO string)
   */
  async scheduleBanner(
    bannerId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ ok: boolean; banner: Banner }> {
    return this.updateBanner(bannerId, {
      start_date: startDate,
      end_date: endDate,
      is_active: true,
    });
  },

  /**
   * Preview banner display for a user type
   * @param hasTopup - Whether user has made a top-up
   * @returns The banner that would be shown
   */
  async previewBannerForUser(hasTopup: boolean): Promise<{
    ok: boolean;
    banner: Banner | null;
    userType: string;
  }> {
    const { config } = await this.getBannerConfig();

    if (hasTopup && config.post_topup?.is_active) {
      return {
        ok: true,
        banner: config.post_topup,
        userType: "post_topup",
      };
    }

    if (!hasTopup && config.pre_topup?.is_active) {
      return {
        ok: true,
        banner: config.pre_topup,
        userType: "pre_topup",
      };
    }

    // Fallback to global if specific banner not active
    if (config.global?.is_active) {
      return {
        ok: true,
        banner: config.global,
        userType: "global",
      };
    }

    return {
      ok: true,
      banner: null,
      userType: hasTopup ? "post_topup" : "pre_topup",
    };
  },
};

// Default export
export default bannerClient;

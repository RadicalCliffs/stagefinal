/**
 * ThePrize.io Notification Client
 *
 * Drop this file into your admin dashboard to send notifications to users.
 *
 * Setup:
 * 1. Add THEPRIZE_API_KEY to your environment variables (same value as ADMIN_API_KEY on theprize.io)
 * 2. Import and use the client
 *
 * Example:
 *   import { notificationClient } from './theprize-notification-client';
 *   await notificationClient.sendWinnerNotification('user@email.com', '#1234', 'Bitcoin Prize');
 */

const API_BASE = process.env.THEPRIZE_API_URL || "https://theprize.io";
const API_KEY = process.env.THEPRIZE_API_KEY || "";

interface NotificationResponse {
  ok: boolean;
  sent?: number;
  failed?: number;
  total_targeted?: number;
  template?: string;
  title_sent?: string;
  message_sent?: string;
  error?: string;
}

interface TemplateData {
  [key: string]: string | number | undefined;
}

async function sendRequest(
  endpoint: string,
  body: object,
): Promise<NotificationResponse> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Api-Key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

export const notificationClient = {
  /**
   * Send winner notification
   * Matches the winner email template - short and celebratory
   */
  async sendWinnerNotification(
    userIdentifier: string | string[],
    ticketNumber: string,
    prizeName: string,
    competitionId?: string,
  ): Promise<NotificationResponse> {
    return sendRequest("/api/notifications/admin/template", {
      template: "winner",
      data: {
        ticket_number: ticketNumber,
        prize_name: prizeName,
      },
      user_ids: Array.isArray(userIdentifier)
        ? userIdentifier
        : [userIdentifier],
      competition_id: competitionId,
    });
  },

  /**
   * Send "closing soon" notification
   * For competitions ending within 24 hours
   */
  async sendClosingSoonNotification(
    userIdentifiers: string[],
    prizeName: string,
    hoursRemaining: number,
    ticketsRemaining: number,
    entryPrice: string,
    competitionId?: string,
  ): Promise<NotificationResponse> {
    return sendRequest("/api/notifications/admin/template", {
      template: "closing_soon",
      data: {
        prize_name: prizeName,
        hours_remaining: `${hoursRemaining} hours`,
        tickets_remaining: ticketsRemaining.toString(),
        entry_price: entryPrice,
      },
      user_ids: userIdentifiers,
      competition_id: competitionId,
    });
  },

  /**
   * Send "competition live" notification
   * For newly launched competitions
   */
  async sendCompetitionLiveNotification(
    userIdentifiers: string[] | "all",
    competitionName: string,
    prizeValue: string,
    ticketPrice: string,
    competitionId?: string,
  ): Promise<NotificationResponse> {
    const payload: any = {
      template: "comp_live",
      data: {
        competition_name: competitionName,
        prize_value: prizeValue,
        ticket_price: ticketPrice,
      },
      competition_id: competitionId,
    };

    if (userIdentifiers === "all") {
      payload.send_to_all = true;
    } else {
      payload.user_ids = userIdentifiers;
    }

    return sendRequest("/api/notifications/admin/template", payload);
  },

  /**
   * Send welcome notification to new user
   */
  async sendWelcomeNotification(
    userIdentifier: string,
    username: string,
  ): Promise<NotificationResponse> {
    return sendRequest("/api/notifications/admin/template", {
      template: "welcome",
      data: { username },
      user_ids: [userIdentifier],
    });
  },

  /**
   * Send FOMO notification
   * Engagement nudge showing active competitions
   */
  async sendFomoNotification(
    userIdentifiers: string[] | "all",
    activeCompetitions: number,
    totalPrizes: string,
  ): Promise<NotificationResponse> {
    const payload: any = {
      template: "fomo",
      data: {
        active_competitions: activeCompetitions.toString(),
        total_prizes: totalPrizes,
      },
    };

    if (userIdentifiers === "all") {
      payload.send_to_all = true;
    } else {
      payload.user_ids = userIdentifiers;
    }

    return sendRequest("/api/notifications/admin/template", payload);
  },

  /**
   * Send payment success notification
   */
  async sendPaymentNotification(
    userIdentifier: string,
    amount: string,
    details?: string,
  ): Promise<NotificationResponse> {
    return sendRequest("/api/notifications/admin/template", {
      template: "payment_success",
      data: {
        amount,
        details: details || "",
      },
      user_ids: [userIdentifier],
    });
  },

  /**
   * Send top-up success notification
   */
  async sendTopupNotification(
    userIdentifier: string,
    amount: string,
    newBalance: string,
  ): Promise<NotificationResponse> {
    return sendRequest("/api/notifications/admin/template", {
      template: "topup_success",
      data: {
        amount,
        balance: newBalance,
      },
      user_ids: [userIdentifier],
    });
  },

  /**
   * Send entry confirmed notification
   */
  async sendEntryNotification(
    userIdentifier: string,
    ticketCount: number,
    competitionName: string,
    competitionId?: string,
  ): Promise<NotificationResponse> {
    return sendRequest("/api/notifications/admin/template", {
      template: "entry_confirmed",
      data: {
        ticket_count: ticketCount.toString(),
        competition_name: competitionName,
      },
      user_ids: [userIdentifier],
      competition_id: competitionId,
    });
  },

  /**
   * Send competition ended notification
   */
  async sendCompetitionEndedNotification(
    userIdentifiers: string[],
    competitionName: string,
    competitionId?: string,
  ): Promise<NotificationResponse> {
    return sendRequest("/api/notifications/admin/template", {
      template: "competition_ended",
      data: {
        competition_name: competitionName,
      },
      user_ids: userIdentifiers,
      competition_id: competitionId,
    });
  },

  /**
   * Send custom announcement to specific users or all
   */
  async sendAnnouncement(
    userIdentifiers: string[] | "all",
    title: string,
    message: string,
    expiresAt?: string,
  ): Promise<NotificationResponse> {
    const payload: any = {
      template: "custom_announcement",
      data: { title, message },
      expires_at: expiresAt,
    };

    if (userIdentifiers === "all") {
      payload.send_to_all = true;
    } else {
      payload.user_ids = userIdentifiers;
    }

    return sendRequest("/api/notifications/admin/template", payload);
  },

  /**
   * Send custom special offer to specific users or all
   */
  async sendSpecialOffer(
    userIdentifiers: string[] | "all",
    title: string,
    message: string,
    expiresAt?: string,
  ): Promise<NotificationResponse> {
    const payload: any = {
      template: "custom_offer",
      data: { title, message },
      expires_at: expiresAt,
    };

    if (userIdentifiers === "all") {
      payload.send_to_all = true;
    } else {
      payload.user_ids = userIdentifiers;
    }

    return sendRequest("/api/notifications/admin/template", payload);
  },

  /**
   * Send fully custom notification (no template)
   */
  async sendCustomNotification(
    userIdentifiers: string[] | "all",
    type:
      | "win"
      | "competition_ended"
      | "special_offer"
      | "announcement"
      | "payment"
      | "topup"
      | "entry",
    title: string,
    message: string,
    options?: {
      competitionId?: string;
      prizeInfo?: string;
      expiresAt?: string;
    },
  ): Promise<NotificationResponse> {
    const payload: any = {
      type,
      title,
      message,
      competition_id: options?.competitionId,
      prize_info: options?.prizeInfo,
      expires_at: options?.expiresAt,
    };

    if (userIdentifiers === "all") {
      payload.send_to_all = true;
    } else {
      payload.user_ids = userIdentifiers;
    }

    return sendRequest("/api/notifications/admin/push", payload);
  },

  /**
   * Get notification statistics
   */
  async getStats(): Promise<{
    ok: boolean;
    stats: {
      total_notifications: number;
      unread_notifications: number;
      by_type: Record<string, number>;
      total_users: number;
    };
  }> {
    const response = await fetch(`${API_BASE}/api/notifications/admin/stats`, {
      method: "GET",
      headers: {
        "X-Admin-Api-Key": API_KEY,
      },
    });
    return response.json();
  },

  /**
   * Get available templates
   */
  async getTemplates(): Promise<{
    ok: boolean;
    templates: Array<{
      key: string;
      type: string;
      title_preview: string;
      message_template: string;
      placeholders: string[];
    }>;
  }> {
    const response = await fetch(
      `${API_BASE}/api/notifications/admin/templates`,
      {
        method: "GET",
        headers: {
          "X-Admin-Api-Key": API_KEY,
        },
      },
    );
    return response.json();
  },
};

// Default export
export default notificationClient;

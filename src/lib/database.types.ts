export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * Competition status values stored in the database.
 * Note: Frontend displays map these to user-friendly labels (e.g., 'active' -> 'live')
 */
export type CompetitionStatus =
  | 'active'      // Live competition accepting entries
  | 'drawing'     // Winner selection in progress
  | 'drawn'       // Winner has been selected
  | 'completed'   // Competition fully finalized
  | 'cancelled'   // Competition was cancelled
  | 'expired'     // Competition ended without draw
  | 'draft'       // Not yet published

/**
 * Frontend display status values (mapped from database status)
 * - 'live' = database 'active'
 * - 'drawn' = database 'drawn'
 * - 'completed' = database 'completed'
 * - 'pending' = pending reservations/payments
 * - 'cancelled' = database 'cancelled'
 */
export type DisplayStatus = 'live' | 'drawn' | 'completed' | 'pending' | 'cancelled'

/**
 * Payment/transaction status values
 */
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled'

/**
 * Pending ticket reservation status
 */
export type ReservationStatus = 'pending' | 'confirmed' | 'expired' | 'cancelled'

export interface Database {
  public: {
    Tables: {
      competitions: {
        Row: {
          id: string
          creator_id: string | null
          title: string | null
          description: string | null
          contract_address: string | null
          chain_id: number | null
          max_participants: number | null
          entry_fee: string | null
          status: string | null
          winner_address: string | null
          tx_hash: string | null
          vrf_request_id: string | null
          created_at: string | null
          drawn_at: string | null
          prize_type: string | null
          competition_type: string | null
          is_featured: boolean | null
          uid: string | null
          imageurl: string | null
          image_url: string | null
          prize_value: number | null
          ticket_price: number | null
          total_tickets: number | null
          tickets_sold: number | null
          start_date: string | null
          end_date: string | null
          draw_date: string | null
          is_instant_win: boolean | null
          winning_tickets_generated: boolean | null
          font_size_override: string | null
          font_weight_override: string | null
          metadata_title: string | null
          metadata_description: string | null
          metadata_image: string | null
          competitionended: number | null
          crdate: string | null
        }
        Insert: {
          id?: string
          creator_id?: string | null
          title?: string | null
          description?: string | null
          contract_address?: string | null
          chain_id?: number | null
          max_participants?: number | null
          entry_fee?: string | null
          status?: string | null
          winner_address?: string | null
          tx_hash?: string | null
          vrf_request_id?: string | null
          created_at?: string | null
          drawn_at?: string | null
          prize_type?: string | null
          competition_type?: string | null
          is_featured?: boolean | null
          uid?: string | null
          imageurl?: string | null
          image_url?: string | null
          prize_value?: number | null
          ticket_price?: number | null
          total_tickets?: number | null
          tickets_sold?: number | null
          start_date?: string | null
          end_date?: string | null
          draw_date?: string | null
          is_instant_win?: boolean | null
          winning_tickets_generated?: boolean | null
          font_size_override?: string | null
          font_weight_override?: string | null
          metadata_title?: string | null
          metadata_description?: string | null
          metadata_image?: string | null
          competitionended?: number | null
          crdate?: string | null
        }
        Update: {
          id?: string
          creator_id?: string | null
          title?: string | null
          description?: string | null
          contract_address?: string | null
          chain_id?: number | null
          max_participants?: number | null
          entry_fee?: string | null
          status?: string | null
          winner_address?: string | null
          tx_hash?: string | null
          vrf_request_id?: string | null
          created_at?: string | null
          drawn_at?: string | null
          prize_type?: string | null
          competition_type?: string | null
          is_featured?: boolean | null
          uid?: string | null
          imageurl?: string | null
          image_url?: string | null
          prize_value?: number | null
          ticket_price?: number | null
          total_tickets?: number | null
          tickets_sold?: number | null
          start_date?: string | null
          end_date?: string | null
          draw_date?: string | null
          is_instant_win?: boolean | null
          winning_tickets_generated?: boolean | null
          font_size_override?: string | null
          font_weight_override?: string | null
          metadata_title?: string | null
          metadata_description?: string | null
          metadata_image?: string | null
          competitionended?: number | null
          crdate?: string | null
        }
      }
      user_transactions: {
        Row: {
          id: string
          user_id: string | null
          canonical_user_id: string | null
          wallet_address: string | null
          type: string | null
          competition_id: string | null
          amount: number | null
          currency: string | null
          balance_before: number | null
          balance_after: number | null
          payment_status: string | null
          status: string | null
          tx_id: string | null
          tx_ref: string | null
          session_id: string | null
          order_id: string | null
          ticket_count: number | null
          network: string | null
          completed_at: string | null
          created_at: string | null
          updated_at: string | null
          webhook_ref: string | null
          payment_provider: string | null
          pay_currency: string | null
          user_privy_id: string | null
          charge_id: string | null
          charge_code: string | null
          checkout_url: string | null
          description: string | null
          metadata: Json | null
          provider: string | null
          primary_provider: string | null
          fallback_provider: string | null
          provider_attempts: number | null
          provider_error: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          canonical_user_id?: string | null
          wallet_address?: string | null
          type?: string | null
          competition_id?: string | null
          amount?: number | null
          currency?: string | null
          balance_before?: number | null
          balance_after?: number | null
          payment_status?: string | null
          status?: string | null
          tx_id?: string | null
          tx_ref?: string | null
          session_id?: string | null
          order_id?: string | null
          ticket_count?: number | null
          network?: string | null
          completed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          webhook_ref?: string | null
          payment_provider?: string | null
          pay_currency?: string | null
          user_privy_id?: string | null
          charge_id?: string | null
          charge_code?: string | null
          checkout_url?: string | null
          description?: string | null
          metadata?: Json | null
          provider?: string | null
          primary_provider?: string | null
          fallback_provider?: string | null
          provider_attempts?: number | null
          provider_error?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          canonical_user_id?: string | null
          wallet_address?: string | null
          type?: string | null
          competition_id?: string | null
          amount?: number | null
          currency?: string | null
          balance_before?: number | null
          balance_after?: number | null
          payment_status?: string | null
          status?: string | null
          tx_id?: string | null
          tx_ref?: string | null
          session_id?: string | null
          order_id?: string | null
          ticket_count?: number | null
          network?: string | null
          completed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          webhook_ref?: string | null
          payment_provider?: string | null
          pay_currency?: string | null
          user_privy_id?: string | null
          charge_id?: string | null
          charge_code?: string | null
          checkout_url?: string | null
          description?: string | null
          metadata?: Json | null
          provider?: string | null
          primary_provider?: string | null
          fallback_provider?: string | null
          provider_attempts?: number | null
          provider_error?: string | null
        }
      }
      Prize_Instantprizes: {
        Row: {
          UID: string
          competitionId: string | null
          winningTicket: number | null
          prize: string | null
          url: string | null
          description: string | null
          priority: number | null
          winningWalletAddress: string | null
          avatarUrl: string | null
        }
        Insert: {
          UID?: string
          competitionId?: string | null
          winningTicket?: number | null
          prize?: string | null
          url?: string | null
          description?: string | null
          priority?: number | null
          winningWalletAddress?: string | null
          avatarUrl?: string | null
        }
        Update: {
          UID?: string
          competitionId?: string | null
          winningTicket?: number | null
          prize?: string | null
          url?: string | null
          description?: string | null
          priority?: number | null
          winningWalletAddress?: string | null
          avatarUrl?: string | null
        }
      }
      canonical_users: {
        Row: {
          uid: string
          privy_user_id: string
          /** Canonical user identifier in prize:pid: format */
          canonical_user_id: string | null
          email: string | null
          wallet_address: string | null
          /** Base/CDP authenticated wallet address */
          base_wallet_address: string | null
          eth_wallet_address: string | null
          /** External wallet linked for display purposes only */
          linked_external_wallet: string | null
          smart_wallet_address: string | null
          /** JSONB array of all wallets linked to this user */
          linked_wallets: Json | null
          /** The wallet address designated as primary for this user */
          primary_wallet_address: string | null
          phone: string | null
          /** User's phone number (optional) */
          telephone_number: string | null
          google_email: string | null
          twitter_username: string | null
          discord_username: string | null
          telegram_handle: string | null
          avatar_url: string | null
          username: string | null
          country: string | null
          first_name: string | null
          last_name: string | null
          total_entries: number | null
          total_amount_spent: number | null
          competitions_entered: number | null
          usdc_balance: number | null
          has_used_new_user_bonus: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          uid?: string
          privy_user_id: string
          canonical_user_id?: string | null
          email?: string | null
          wallet_address?: string | null
          base_wallet_address?: string | null
          eth_wallet_address?: string | null
          linked_external_wallet?: string | null
          smart_wallet_address?: string | null
          linked_wallets?: Json | null
          primary_wallet_address?: string | null
          phone?: string | null
          telephone_number?: string | null
          google_email?: string | null
          twitter_username?: string | null
          discord_username?: string | null
          telegram_handle?: string | null
          avatar_url?: string | null
          username?: string | null
          country?: string | null
          first_name?: string | null
          last_name?: string | null
          total_entries?: number | null
          total_amount_spent?: number | null
          competitions_entered?: number | null
          usdc_balance?: number | null
          has_used_new_user_bonus?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          uid?: string
          privy_user_id?: string
          canonical_user_id?: string | null
          email?: string | null
          wallet_address?: string | null
          base_wallet_address?: string | null
          eth_wallet_address?: string | null
          linked_external_wallet?: string | null
          smart_wallet_address?: string | null
          linked_wallets?: Json | null
          primary_wallet_address?: string | null
          phone?: string | null
          telephone_number?: string | null
          google_email?: string | null
          twitter_username?: string | null
          discord_username?: string | null
          telegram_handle?: string | null
          avatar_url?: string | null
          username?: string | null
          country?: string | null
          first_name?: string | null
          last_name?: string | null
          total_entries?: number | null
          total_amount_spent?: number | null
          competitions_entered?: number | null
          usdc_balance?: number | null
          has_used_new_user_bonus?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      [key: string]: any
    }
    Views: {
      [_ : string]: never
    }
    Functions: {
      add_pending_balance: {
        Args: {
          user_identifier: string
          amount: number
        }
        Returns: Json
      }
      get_user_wallets: {
        Args: {
          user_identifier: string
        }
        Returns: Json
      }
      link_additional_wallet: {
        Args: {
          user_identifier: string
          p_wallet_address: string
          p_wallet_type?: string
          p_nickname?: string
        }
        Returns: Json
      }
      set_primary_wallet: {
        Args: {
          user_identifier: string
          p_wallet_address: string
        }
        Returns: Json
      }
      unlink_wallet: {
        Args: {
          user_identifier: string
          p_wallet_address: string
        }
        Returns: Json
      }
      update_wallet_nickname: {
        Args: {
          user_identifier: string
          p_wallet_address: string
          p_nickname: string
        }
        Returns: Json
      }
      allocate_lucky_dip_tickets: {
        Args: {
          p_competition_id: string
          p_user_id: string
          p_ticket_count: number
        }
        Returns: Json
      }
      allocate_lucky_dip_tickets_batch: {
        Args: {
          p_competition_id: string
          p_user_id: string
          p_ticket_count: number
        }
        Returns: Json
      }
      attach_identity_after_auth: {
        Args: {
          p_user_id: string
          p_email: string
          p_username: string
        }
        Returns: Json
      }
      check_and_mark_competition_sold_out: {
        Args: {
          p_competition_id: string
        }
        Returns: Json
      }
      credit_user_balance: {
        Args: {
          user_id: string
          amount: number
        }
        Returns: void
      }
      finalize_order: {
        Args: {
          p_reservation_id: string
          p_user_id: string
          p_competition_id: string
          p_unit_price: number
        }
        Returns: Json
      }
      get_available_ticket_count_v2: {
        Args: {
          p_competition_id: string
        }
        Returns: number
      }
      get_competition_entries: {
        Args: {
          p_competition_id: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      get_competition_entries_bypass_rls: {
        Args: {
          p_competition_id: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      get_competition_ticket_availability_text: {
        Args: {
          p_competition_id: string
        }
        Returns: string
      }
      get_competition_unavailable_tickets: {
        Args: {
          p_competition_id: string
        }
        Returns: number[]
      }
      get_comprehensive_user_dashboard_entries: {
        Args: {
          p_user_identifier: string
        }
        Returns: Json
      }
      get_linked_external_wallet: {
        Args: {
          user_identifier: string
        }
        Returns: Json
      }
      get_recent_entries_count: {
        Args: {
          p_competition_id: string
          p_minutes: number
        }
        Returns: number
      }
      get_unavailable_tickets: {
        Args: {
          p_competition_id: string
        }
        Returns: number[]
      }
      get_user_active_tickets: {
        Args: {
          p_user_identifier: string
          p_competition_id: string
        }
        Returns: Json
      }
      get_user_balance: {
        Args: {
          user_identifier: string
        }
        Returns: Json
      }
      get_user_tickets: {
        Args: {
          p_user_identifier: string
          p_competition_id: string
        }
        Returns: Json
      }
      get_user_tickets_for_competition: {
        Args: {
          competition_id: string
          user_id: string
        }
        Returns: Json
      }
      get_user_transactions: {
        Args: {
          p_user_identifier: string
        }
        Returns: Json
      }
      get_user_wallet_balance: {
        Args: {
          user_identifier: string
        }
        Returns: Json
      }
      migrate_user_balance: {
        Args: {
          p_user_identifier: string
        }
        Returns: Json
      }
      release_reservation: {
        Args: {
          p_reservation_id: string
          p_user_id: string
        }
        Returns: Json
      }
      reserve_tickets: {
        Args: {
          p_competition_id: string
          p_ticket_numbers: number[]
          p_user_id: string
          p_hold_minutes: number
        }
        Returns: Json
      }
      reserve_tickets_atomically: {
        Args: {
          p_competition_id: string
          p_ticket_count: number
          p_user_id: string
          p_hold_minutes?: number
        }
        Returns: Json
      }
      sync_competition_status_if_ended: {
        Args: {
          p_competition_id: string
        }
        Returns: Json
      }
      unlink_external_wallet: {
        Args: {
          user_identifier: string
        }
        Returns: Json
      }
      update_user_avatar: {
        Args: {
          p_user_identifier: string
          p_avatar_url: string
        }
        Returns: Json
      }
      update_user_profile_by_identifier: {
        Args: {
          p_user_identifier: string
          p_username?: string
          p_email?: string
          p_country?: string
          p_telephone_number?: string
          p_telegram_handle?: string
        }
        Returns: Json
      }
      upsert_canonical_user: {
        Args: {
          p_uid: string
          p_canonical_user_id: string
          p_email?: string | null
          p_username?: string | null
          p_wallet_address?: string | null
          p_base_wallet_address?: string | null
          p_eth_wallet_address?: string | null
          p_privy_user_id?: string | null
        }
        Returns: Json
      }
      [key: string]: any
    }
    Enums: {
      [_ : string]: never
    }
  }
}

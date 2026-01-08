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
          wallet_address: string | null
          competition_id: string | null
          amount: number | null
          currency: string | null
          payment_status: string | null
          status: string | null
          tx_id: string | null
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
        }
        Insert: {
          id?: string
          user_id?: string | null
          wallet_address?: string | null
          competition_id?: string | null
          amount?: number | null
          currency?: string | null
          payment_status?: string | null
          status?: string | null
          tx_id?: string | null
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
        }
        Update: {
          id?: string
          user_id?: string | null
          wallet_address?: string | null
          competition_id?: string | null
          amount?: number | null
          currency?: string | null
          payment_status?: string | null
          status?: string | null
          tx_id?: string | null
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
          /** External wallet linked for display purposes only */
          linked_external_wallet: string | null
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
          total_entries: number | null
          total_amount_spent: number | null
          competitions_entered: number | null
          usdc_balance: number | null
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
          linked_external_wallet?: string | null
          phone?: string | null
          telephone_number?: string | null
          google_email?: string | null
          twitter_username?: string | null
          discord_username?: string | null
          telegram_handle?: string | null
          avatar_url?: string | null
          username?: string | null
          country?: string | null
          total_entries?: number | null
          total_amount_spent?: number | null
          competitions_entered?: number | null
          usdc_balance?: number | null
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
          linked_external_wallet?: string | null
          phone?: string | null
          telephone_number?: string | null
          google_email?: string | null
          twitter_username?: string | null
          discord_username?: string | null
          telegram_handle?: string | null
          avatar_url?: string | null
          username?: string | null
          country?: string | null
          total_entries?: number | null
          total_amount_spent?: number | null
          competitions_entered?: number | null
          usdc_balance?: number | null
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
      credit_user_balance: {
        Args: {
          user_id: string
          amount: number
        }
        Returns: void
      }
      [key: string]: any
    }
    Enums: {
      [_ : string]: never
    }
  }
}

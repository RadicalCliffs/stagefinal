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
  | 'upcoming'
  | 'active'
  | 'drawing'
  | 'drawn'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'draft'
  | 'sold_out'

/**
 * Frontend display status values (mapped from database status)
 */
export type DisplayStatus = 'live' | 'drawn' | 'completed' | 'pending' | 'cancelled'

/**
 * Payment/transaction status values
 */
export type PaymentStatus = 'pending' | 'waiting' | 'confirmed' | 'completed' | 'failed' | 'refunded' | 'cancelled'

/**
 * Pending ticket reservation status
 */
export type ReservationStatus = 'pending' | 'confirmed' | 'expired' | 'cancelled'

export interface Database {
  public: {
    Tables: {
      Prize_Instantprizes: {
        Row: {
          UID: string
          competitionId: string
          prize: string
          prize_value: number | null
          winningTicket: number
          winningWalletAddress: string | null
          winningUserId: string | null
          privy_user_id: string | null
          wonAt: string | null
          claimed_at: string | null
          created_at: string | null
          human_id: string | null
        }
        Insert: {
          UID?: string
          competitionId: string
          prize: string
          prize_value?: number | null
          winningTicket: number
          winningWalletAddress?: string | null
          winningUserId?: string | null
          privy_user_id?: string | null
          wonAt?: string | null
          claimed_at?: string | null
          created_at?: string | null
          human_id?: string | null
        }
        Update: {
          UID?: string
          competitionId?: string
          prize?: string
          prize_value?: number | null
          winningTicket?: number
          winningWalletAddress?: string | null
          winningUserId?: string | null
          privy_user_id?: string | null
          wonAt?: string | null
          claimed_at?: string | null
          created_at?: string | null
          human_id?: string | null
        }
      }
      _entries_progress: {
        Row: {
          competition_id: string
          canonical_user_id: string
          last_ticket_number: number | null
          last_processed_at: string
        }
        Insert: {
          competition_id: string
          canonical_user_id: string
          last_ticket_number?: number | null
          last_processed_at?: string
        }
        Update: {
          competition_id?: string
          canonical_user_id?: string
          last_ticket_number?: number | null
          last_processed_at?: string
        }
      }
      _payment_settings: {
        Row: {
          key: string
          value_timestamp: string | null
        }
        Insert: {
          key: string
          value_timestamp?: string | null
        }
        Update: {
          key?: string
          value_timestamp?: string | null
        }
      }
      admin_sessions: {
        Row: {
          id: string
          admin_id: string | null
          token: string
          ip_address: string | null
          user_agent: string | null
          expires_at: string
          created_at: string | null
        }
        Insert: {
          id?: string
          admin_id?: string | null
          token: string
          ip_address?: string | null
          user_agent?: string | null
          expires_at: string
          created_at?: string | null
        }
        Update: {
          id?: string
          admin_id?: string | null
          token?: string
          ip_address?: string | null
          user_agent?: string | null
          expires_at?: string
          created_at?: string | null
        }
      }
      admin_users: {
        Row: {
          id: string
          email: string
          password_hash: string
          role: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          email: string
          password_hash: string
          role?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          password_hash?: string
          role?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      admin_users_audit: {
        Row: {
          id: string
          admin_id: string | null
          action: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          admin_id?: string | null
          action?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          admin_id?: string | null
          action?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
      }
      balance_ledger: {
        Row: {
          id: string
          canonical_user_id: string | null
          transaction_type: string | null
          amount: number
          currency: string | null
          balance_before: number | null
          balance_after: number | null
          reference_id: string | null
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          canonical_user_id?: string | null
          transaction_type?: string | null
          amount: number
          currency?: string | null
          balance_before?: number | null
          balance_after?: number | null
          reference_id?: string | null
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          canonical_user_id?: string | null
          transaction_type?: string | null
          amount?: number
          currency?: string | null
          balance_before?: number | null
          balance_after?: number | null
          reference_id?: string | null
          description?: string | null
          created_at?: string
        }
      }
      bonus_award_audit: {
        Row: {
          id: string
          wallet_address: string | null
          canonical_user_id: string | null
          amount: number
          currency: string
          awarded_at: string
          reason: string
          sub_account_balance_before: number | null
          sub_account_balance_after: number | null
          note: string | null
        }
        Insert: {
          id?: string
          wallet_address?: string | null
          canonical_user_id?: string | null
          amount: number
          currency?: string
          awarded_at?: string
          reason: string
          sub_account_balance_before?: number | null
          sub_account_balance_after?: number | null
          note?: string | null
        }
        Update: {
          id?: string
          wallet_address?: string | null
          canonical_user_id?: string | null
          amount?: number
          currency?: string
          awarded_at?: string
          reason?: string
          sub_account_balance_before?: number | null
          sub_account_balance_after?: number | null
          note?: string | null
        }
      }
      canonical_users: {
        Row: {
          id: string
          canonical_user_id: string | null
          uid: string
          privy_user_id: string | null
          email: string | null
          wallet_address: string | null
          base_wallet_address: string | null
          eth_wallet_address: string | null
          username: string | null
          avatar_url: string | null
          usdc_balance: number
          bonus_balance: number
          has_used_new_user_bonus: boolean
          created_at: string
          updated_at: string
          smart_wallet_address: string | null
          country: string | null
          first_name: string | null
          last_name: string | null
          telegram_handle: string | null
          is_admin: boolean
          auth_provider: string | null
          wallet_linked: string | null
          linked_wallets: Json | null
          primary_wallet_address: string | null
        }
        Insert: {
          id?: string
          canonical_user_id?: string | null
          uid?: string
          privy_user_id?: string | null
          email?: string | null
          wallet_address?: string | null
          base_wallet_address?: string | null
          eth_wallet_address?: string | null
          username?: string | null
          avatar_url?: string | null
          usdc_balance?: number
          bonus_balance?: number
          has_used_new_user_bonus?: boolean
          created_at?: string
          updated_at?: string
          smart_wallet_address?: string | null
          country?: string | null
          first_name?: string | null
          last_name?: string | null
          telegram_handle?: string | null
          is_admin?: boolean
          auth_provider?: string | null
          wallet_linked?: string | null
          linked_wallets?: Json | null
          primary_wallet_address?: string | null
        }
        Update: {
          id?: string
          canonical_user_id?: string | null
          uid?: string
          privy_user_id?: string | null
          email?: string | null
          wallet_address?: string | null
          base_wallet_address?: string | null
          eth_wallet_address?: string | null
          username?: string | null
          avatar_url?: string | null
          usdc_balance?: number
          bonus_balance?: number
          has_used_new_user_bonus?: boolean
          created_at?: string
          updated_at?: string
          smart_wallet_address?: string | null
          country?: string | null
          first_name?: string | null
          last_name?: string | null
          telegram_handle?: string | null
          is_admin?: boolean
          auth_provider?: string | null
          wallet_linked?: string | null
          linked_wallets?: Json | null
          primary_wallet_address?: string | null
        }
      }
      cdp_event_queue: {
        Row: {
          id: string
          event_name: string
          payload: Json
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          event_name: string
          payload: Json
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          event_name?: string
          payload?: Json
          status?: string
          created_at?: string
        }
      }
      competition_entries: {
        Row: {
          id: string
          canonical_user_id: string
          competition_id: string
          wallet_address: string | null
          tickets_count: number
          ticket_numbers_csv: string | null
          amount_spent: number | null
          payment_methods: string | null
          latest_purchase_at: string | null
          is_winner: boolean | null
          prize_tiers: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          canonical_user_id: string
          competition_id: string
          wallet_address?: string | null
          tickets_count?: number
          ticket_numbers_csv?: string | null
          amount_spent?: number | null
          payment_methods?: string | null
          latest_purchase_at?: string | null
          is_winner?: boolean | null
          prize_tiers?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          canonical_user_id?: string
          competition_id?: string
          wallet_address?: string | null
          tickets_count?: number
          ticket_numbers_csv?: string | null
          amount_spent?: number | null
          payment_methods?: string | null
          latest_purchase_at?: string | null
          is_winner?: boolean | null
          prize_tiers?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      competitions: {
        Row: {
          id: string
          title: string
          description: string | null
          image_url: string | null
          ticket_price: number
          total_tickets: number
          sold_tickets: number
          status: string
          start_time: string
          end_time: string | null
          winner_count: number
          prize_description: string | null
          vrfulfillment_address: string | null
          vrf_subscription_id: number | null
          created_at: string
          updated_at: string
          deleted: boolean
          max_tickets_per_user_percentage: number | null
          crdate: string
          description_text: string | null
          end_date: string | null
          is_featured: boolean | null
          is_instant_win: boolean | null
          num_winners: number | null
          prize_type: string | null
          prize_value: number | null
          tickets_sold: number | null
          uid: string | null
          winning_ticket_count: number | null
          vrf_request_id: string | null
          vrf_status: string | null
          vrf_tx_hash: string | null
          onchain_competition_id: string | null
          vrf_random_words: number[] | null
          vrf_proof: string | null
          winner_address: string | null
          start_date: string
          vrf_draw_requested_at: string | null
          vrf_draw_completed_at: string | null
          vrf_randomness: Json | null
          vrf_error: string | null
          vrf_completed_at: string | null
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          image_url?: string | null
          ticket_price?: number
          total_tickets?: number
          sold_tickets?: number
          status?: string
          start_time?: string
          end_time?: string | null
          winner_count?: number
          prize_description?: string | null
          vrfulfillment_address?: string | null
          vrf_subscription_id?: number | null
          created_at?: string
          updated_at?: string
          deleted?: boolean
          max_tickets_per_user_percentage?: number | null
          crdate?: string
          description_text?: string | null
          end_date?: string | null
          is_featured?: boolean | null
          is_instant_win?: boolean | null
          num_winners?: number | null
          prize_type?: string | null
          prize_value?: number | null
          tickets_sold?: number | null
          uid?: string | null
          winning_ticket_count?: number | null
          vrf_request_id?: string | null
          vrf_status?: string | null
          vrf_tx_hash?: string | null
          onchain_competition_id?: string | null
          vrf_random_words?: number[] | null
          vrf_proof?: string | null
          winner_address?: string | null
          start_date?: string
          vrf_draw_requested_at?: string | null
          vrf_draw_completed_at?: string | null
          vrf_randomness?: Json | null
          vrf_error?: string | null
          vrf_completed_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          image_url?: string | null
          ticket_price?: number
          total_tickets?: number
          sold_tickets?: number
          status?: string
          start_time?: string
          end_time?: string | null
          winner_count?: number
          prize_description?: string | null
          vrfulfillment_address?: string | null
          vrf_subscription_id?: number | null
          created_at?: string
          updated_at?: string
          deleted?: boolean
          max_tickets_per_user_percentage?: number | null
          crdate?: string
          description_text?: string | null
          end_date?: string | null
          is_featured?: boolean | null
          is_instant_win?: boolean | null
          num_winners?: number | null
          prize_type?: string | null
          prize_value?: number | null
          tickets_sold?: number | null
          uid?: string | null
          winning_ticket_count?: number | null
          vrf_request_id?: string | null
          vrf_status?: string | null
          vrf_tx_hash?: string | null
          onchain_competition_id?: string | null
          vrf_random_words?: number[] | null
          vrf_proof?: string | null
          winner_address?: string | null
          start_date?: string
          vrf_draw_requested_at?: string | null
          vrf_draw_completed_at?: string | null
          vrf_randomness?: Json | null
          vrf_error?: string | null
          vrf_completed_at?: string | null
        }
      }
      confirmation_incident_log: {
        Row: {
          id: string
          incident_id: string
          source: string
          error_type: string | null
          error_message: string | null
          error_stack: string | null
          request_context: Json | null
          env_context: Json | null
          function_context: Json | null
          severity: string | null
          status_code: number | null
          created_at: string | null
          created_by: string | null
          user_id: string | null
          competition_id: string | null
          endpoint: string | null
          occurred_at: string
        }
        Insert: {
          id?: string
          incident_id: string
          source: string
          error_type?: string | null
          error_message?: string | null
          error_stack?: string | null
          request_context?: Json | null
          env_context?: Json | null
          function_context?: Json | null
          severity?: string | null
          status_code?: number | null
          created_at?: string | null
          created_by?: string | null
          user_id?: string | null
          competition_id?: string | null
          endpoint?: string | null
          occurred_at?: string
        }
        Update: {
          id?: string
          incident_id?: string
          source?: string
          error_type?: string | null
          error_message?: string | null
          error_stack?: string | null
          request_context?: Json | null
          env_context?: Json | null
          function_context?: Json | null
          severity?: string | null
          status_code?: number | null
          created_at?: string | null
          created_by?: string | null
          user_id?: string | null
          competition_id?: string | null
          endpoint?: string | null
          occurred_at?: string
        }
      }
      custody_transactions: {
        Row: {
          id: string
          user_id: string | null
          transaction_type: string
          provider: string
          currency: string
          amount: number
          status: string
          reference_id: string | null
          blockchain_tx_hash: string | null
          nowpayments_id: string | null
          nowpayments_payment_id: string | null
          nowpayments_order_id: string | null
          metadata: Json | null
          processed_at: string | null
          created_at: string | null
          updated_at: string | null
          canonical_user_id: string | null
          privy_user_id: string | null
          wallet_address: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          transaction_type: string
          provider: string
          currency: string
          amount: number
          status: string
          reference_id?: string | null
          blockchain_tx_hash?: string | null
          nowpayments_id?: string | null
          nowpayments_payment_id?: string | null
          nowpayments_order_id?: string | null
          metadata?: Json | null
          processed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
          wallet_address?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          transaction_type?: string
          provider?: string
          currency?: string
          amount?: number
          status?: string
          reference_id?: string | null
          blockchain_tx_hash?: string | null
          nowpayments_id?: string | null
          nowpayments_payment_id?: string | null
          nowpayments_order_id?: string | null
          metadata?: Json | null
          processed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
          wallet_address?: string | null
        }
      }
      email_auth_sessions: {
        Row: {
          id: string
          email: string
          verification_code: string
          expires_at: string
          verified_at: string | null
          attempts: number | null
          created_at: string | null
          used_at: string | null
        }
        Insert: {
          id?: string
          email: string
          verification_code: string
          expires_at: string
          verified_at?: string | null
          attempts?: number | null
          created_at?: string | null
          used_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          verification_code?: string
          expires_at?: string
          verified_at?: string | null
          attempts?: number | null
          created_at?: string | null
          used_at?: string | null
        }
      }
      enqueue_cdp_event: {
        Row: {
          id: number
          event_type: string
          payload: Json
          status: string
          attempts: number
          last_error: string | null
          created_at: string
          processed_at: string | null
        }
        Insert: {
          id?: number
          event_type: string
          payload: Json
          status?: string
          attempts?: number
          last_error?: string | null
          created_at?: string
          processed_at?: string | null
        }
        Update: {
          id?: number
          event_type?: string
          payload?: Json
          status?: string
          attempts?: number
          last_error?: string | null
          created_at?: string
          processed_at?: string | null
        }
      }
      faqs: {
        Row: {
          id: string
          question: string
          answer: string
          display_order: number | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          question: string
          answer: string
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          question?: string
          answer?: string
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      hero_competitions: {
        Row: {
          id: string
          competition_id: string | null
          display_order: number | null
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          competition_id?: string | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          competition_id?: string | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
      }
      internal_transfers: {
        Row: {
          id: string
          transfer_id: string
          from_user_id: string
          to_user_id: string
          amount: number
          currency: string
          description: string | null
          status: string | null
          completed_at: string | null
          created_at: string | null
          updated_at: string | null
          from_canonical_user_id: string | null
          from_privy_user_id: string | null
          from_wallet_address: string | null
          to_canonical_user_id: string | null
          to_privy_user_id: string | null
          to_wallet_address: string | null
        }
        Insert: {
          id?: string
          transfer_id: string
          from_user_id: string
          to_user_id: string
          amount: number
          currency: string
          description?: string | null
          status?: string | null
          completed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          from_canonical_user_id?: string | null
          from_privy_user_id?: string | null
          from_wallet_address?: string | null
          to_canonical_user_id?: string | null
          to_privy_user_id?: string | null
          to_wallet_address?: string | null
        }
        Update: {
          id?: string
          transfer_id?: string
          from_user_id?: string
          to_user_id?: string
          amount?: number
          currency?: string
          description?: string | null
          status?: string | null
          completed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          from_canonical_user_id?: string | null
          from_privy_user_id?: string | null
          from_wallet_address?: string | null
          to_canonical_user_id?: string | null
          to_privy_user_id?: string | null
          to_wallet_address?: string | null
        }
      }
      joincompetition: {
        Row: {
          id: string
          userid: string
          wallet_address: string | null
          competitionid: string
          ticketnumbers: string
          purchasedate: string
          status: string
          created_at: string
          uid: string | null
          chain: string | null
          transactionhash: string | null
          numberoftickets: number | null
          amountspent: number | null
          canonical_user_id: string | null
          privy_user_id: string | null
        }
        Insert: {
          id?: string
          userid: string
          wallet_address?: string | null
          competitionid: string
          ticketnumbers: string
          purchasedate?: string
          status?: string
          created_at?: string
          uid?: string | null
          chain?: string | null
          transactionhash?: string | null
          numberoftickets?: number | null
          amountspent?: number | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
        }
        Update: {
          id?: string
          userid?: string
          wallet_address?: string | null
          competitionid?: string
          ticketnumbers?: string
          purchasedate?: string
          status?: string
          created_at?: string
          uid?: string | null
          chain?: string | null
          transactionhash?: string | null
          numberoftickets?: number | null
          amountspent?: number | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
        }
      }
      joined_competitions: {
        Row: {
          id: string
          user_uid: string | null
          competition_id: string | null
          number_of_tickets: number
          wallet_address: string | null
          join_date: string
          created_at: string | null
          canonical_user_id: string | null
          privy_user_id: string | null
        }
        Insert: {
          id?: string
          user_uid?: string | null
          competition_id?: string | null
          number_of_tickets: number
          wallet_address?: string | null
          join_date: string
          created_at?: string | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
        }
        Update: {
          id?: string
          user_uid?: string | null
          competition_id?: string | null
          number_of_tickets?: number
          wallet_address?: string | null
          join_date?: string
          created_at?: string | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          message: string | null
          data: Json | null
          read: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          message?: string | null
          data?: Json | null
          read?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          title?: string
          message?: string | null
          data?: Json | null
          read?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      order_tickets: {
        Row: {
          id: string
          order_id: string | null
          ticket_number: string
          created_at: string | null
        }
        Insert: {
          id?: string
          order_id?: string | null
          ticket_number: string
          created_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string | null
          ticket_number?: string
          created_at?: string | null
        }
      }
      orders: {
        Row: {
          id: string
          user_id: string
          competition_id: string | null
          amount: number
          currency: string
          status: string
          payment_status: string | null
          payment_provider: string | null
          payment_intent_id: string | null
          ticket_count: number
          created_at: string
          updated_at: string
          order_type: string | null
          amount_usd: number | null
          payment_method: string | null
          payment_session_id: string | null
          payment_url: string | null
          payment_tx_hash: string | null
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          competition_id?: string | null
          amount: number
          currency?: string
          status?: string
          payment_status?: string | null
          payment_provider?: string | null
          payment_intent_id?: string | null
          ticket_count?: number
          created_at?: string
          updated_at?: string
          order_type?: string | null
          amount_usd?: number | null
          payment_method?: string | null
          payment_session_id?: string | null
          payment_url?: string | null
          payment_tx_hash?: string | null
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          competition_id?: string | null
          amount?: number
          currency?: string
          status?: string
          payment_status?: string | null
          payment_provider?: string | null
          payment_intent_id?: string | null
          ticket_count?: number
          created_at?: string
          updated_at?: string
          order_type?: string | null
          amount_usd?: number | null
          payment_method?: string | null
          payment_session_id?: string | null
          payment_url?: string | null
          payment_tx_hash?: string | null
          completed_at?: string | null
        }
      }
      participants: {
        Row: {
          id: string
          competition_id: string | null
          user_id: string | null
          wallet_address: string | null
          tx_hash: string | null
          joined_at: string | null
          created_at: string | null
          canonical_user_id: string | null
          privy_user_id: string | null
        }
        Insert: {
          id?: string
          competition_id?: string | null
          user_id?: string | null
          wallet_address?: string | null
          tx_hash?: string | null
          joined_at?: string | null
          created_at?: string | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
        }
        Update: {
          id?: string
          competition_id?: string | null
          user_id?: string | null
          wallet_address?: string | null
          tx_hash?: string | null
          joined_at?: string | null
          created_at?: string | null
          canonical_user_id?: string | null
          privy_user_id?: string | null
        }
      }
      partners: {
        Row: {
          id: string
          name: string
          logo_url: string | null
          website_url: string | null
          display_order: number | null
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          logo_url?: string | null
          website_url?: string | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          logo_url?: string | null
          website_url?: string | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
      }
      payment_idempotency: {
        Row: {
          id: string
          idempotency_key: string
          user_id: string
          competition_id: string | null
          amount: number
          ticket_count: number
          result: Json
          created_at: string | null
          expires_at: string | null
        }
        Insert: {
          id?: string
          idempotency_key: string
          user_id: string
          competition_id?: string | null
          amount: number
          ticket_count: number
          result: Json
          created_at?: string | null
          expires_at?: string | null
        }
        Update: {
          id?: string
          idempotency_key?: string
          user_id?: string
          competition_id?: string | null
          amount?: number
          ticket_count?: number
          result?: Json
          created_at?: string | null
          expires_at?: string | null
        }
      }
      payment_webhook_events: {
        Row: {
          id: string
          provider: string
          event_type: string
          event_id: string
          payload: Json
          status: string
          processed_at: string | null
          created_at: string
          note: string | null
          received_at: string | null
          request_path: string | null
          headers: Json | null
          signature_valid: boolean | null
          order_id: string | null
          transaction_id: string | null
          payer_address: string | null
        }
        Insert: {
          id?: string
          provider: string
          event_type: string
          event_id: string
          payload: Json
          status?: string
          processed_at?: string | null
          created_at?: string
          note?: string | null
          received_at?: string | null
          request_path?: string | null
          headers?: Json | null
          signature_valid?: boolean | null
          order_id?: string | null
          transaction_id?: string | null
          payer_address?: string | null
        }
        Update: {
          id?: string
          provider?: string
          event_type?: string
          event_id?: string
          payload?: Json
          status?: string
          processed_at?: string | null
          created_at?: string
          note?: string | null
          received_at?: string | null
          request_path?: string | null
          headers?: Json | null
          signature_valid?: boolean | null
          order_id?: string | null
          transaction_id?: string | null
          payer_address?: string | null
        }
      }
      payments_jobs: {
        Row: {
          id: string
          created_at: string
          run_after: string
          status: string
          attempts: number
          max_attempts: number
          job_type: string
          payload: Json
        }
        Insert: {
          id?: string
          created_at?: string
          run_after?: string
          status?: string
          attempts?: number
          max_attempts?: number
          job_type: string
          payload: Json
        }
        Update: {
          id?: string
          created_at?: string
          run_after?: string
          status?: string
          attempts?: number
          max_attempts?: number
          job_type?: string
          payload?: Json
        }
      }
      pending_ticket_items: {
        Row: {
          id: string
          pending_ticket_id: string
          competition_id: string
          ticket_number: number
          status: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          pending_ticket_id: string
          competition_id: string
          ticket_number: number
          status?: string
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          pending_ticket_id?: string
          competition_id?: string
          ticket_number?: number
          status?: string
          expires_at?: string
          created_at?: string
        }
      }
      pending_tickets: {
        Row: {
          id: string
          user_id: string
          canonical_user_id: string | null
          wallet_address: string | null
          competition_id: string
          status: string
          hold_minutes: number
          expires_at: string
          reservation_id: string | null
          created_at: string
          ticket_count: number | null
          ticket_price: number | null
          total_amount: number | null
          session_id: string | null
          confirmed_at: string | null
          updated_at: string | null
          transaction_hash: string | null
          payment_provider: string | null
          ticket_numbers: number[] | null
          payment_id: string | null
          idempotency_key: string | null
        }
        Insert: {
          id?: string
          user_id: string
          canonical_user_id?: string | null
          wallet_address?: string | null
          competition_id: string
          status?: string
          hold_minutes?: number
          expires_at: string
          reservation_id?: string | null
          created_at?: string
          ticket_count?: number | null
          ticket_price?: number | null
          total_amount?: number | null
          session_id?: string | null
          confirmed_at?: string | null
          updated_at?: string | null
          transaction_hash?: string | null
          payment_provider?: string | null
          ticket_numbers?: number[] | null
          payment_id?: string | null
          idempotency_key?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          canonical_user_id?: string | null
          wallet_address?: string | null
          competition_id?: string
          status?: string
          hold_minutes?: number
          expires_at?: string
          reservation_id?: string | null
          created_at?: string
          ticket_count?: number | null
          ticket_price?: number | null
          total_amount?: number | null
          session_id?: string | null
          confirmed_at?: string | null
          updated_at?: string | null
          transaction_hash?: string | null
          payment_provider?: string | null
          ticket_numbers?: number[] | null
          payment_id?: string | null
          idempotency_key?: string | null
        }
      }
      platform_statistics: {
        Row: {
          id: string
          stat_date: string
          total_users: number | null
          active_competitions: number | null
          completed_competitions: number | null
          total_competitions: number | null
          total_tickets_sold: number | null
          total_revenue_usd: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          stat_date: string
          total_users?: number | null
          active_competitions?: number | null
          completed_competitions?: number | null
          total_competitions?: number | null
          total_tickets_sold?: number | null
          total_revenue_usd?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          stat_date?: string
          total_users?: number | null
          active_competitions?: number | null
          completed_competitions?: number | null
          total_competitions?: number | null
          total_tickets_sold?: number | null
          total_revenue_usd?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      profiles: {
        Row: {
          id: string
          user_id: string
          username: string | null
          email: string | null
          avatar_url: string | null
          phone: string | null
          created_at: string
          updated_at: string
          canonical_user_id: string | null
          privy_user_id: string | null
          wallet_address: string | null
          country: string | null
          telegram_handle: string | null
          telephone_number: string | null
          prior_signup_payload: Json | null
        }
        Insert: {
          id?: string
          user_id: string
          username?: string | null
          email?: string | null
          avatar_url?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
          canonical_user_id?: string | null
          privy_user_id?: string | null
          wallet_address?: string | null
          country?: string | null
          telegram_handle?: string | null
          telephone_number?: string | null
          prior_signup_payload?: Json | null
        }
        Update: {
          id?: string
          user_id?: string
          username?: string | null
          email?: string | null
          avatar_url?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
          canonical_user_id?: string | null
          privy_user_id?: string | null
          wallet_address?: string | null
          country?: string | null
          telegram_handle?: string | null
          telephone_number?: string | null
          prior_signup_payload?: Json | null
        }
      }
      purchase_requests: {
        Row: {
          request_id: string
          competition_id: string
          user_id: string
          reservation_id: string | null
          selected_tickets: number[]
          ticket_count: number
          created_at: string
          processed_at: string | null
          result_ticket_ids: number[] | null
          total_cost: number | null
          currency: string | null
          transaction_id: string | null
          entry_id: string | null
          status: string
          error_message: string | null
          reservation_ref: string | null
        }
        Insert: {
          request_id: string
          competition_id: string
          user_id: string
          reservation_id?: string | null
          selected_tickets?: number[]
          ticket_count: number
          created_at?: string
          processed_at?: string | null
          result_ticket_ids?: number[] | null
          total_cost?: number | null
          currency?: string | null
          transaction_id?: string | null
          entry_id?: string | null
          status?: string
          error_message?: string | null
          reservation_ref?: string | null
        }
        Update: {
          request_id?: string
          competition_id?: string
          user_id?: string
          reservation_id?: string | null
          selected_tickets?: number[]
          ticket_count?: number
          created_at?: string
          processed_at?: string | null
          result_ticket_ids?: number[] | null
          total_cost?: number | null
          currency?: string | null
          transaction_id?: string | null
          entry_id?: string | null
          status?: string
          error_message?: string | null
          reservation_ref?: string | null
        }
      }
      site_metadata: {
        Row: {
          id: string
          category: string
          key: string
          value: string
          description: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          category: string
          key: string
          value: string
          description?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          category?: string
          key?: string
          value?: string
          description?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      site_stats: {
        Row: {
          id: string
          label: string
          value: string
          icon: string | null
          display_order: number | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          label: string
          value: string
          icon?: string | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          label?: string
          value?: string
          icon?: string | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      sub_account_balances: {
        Row: {
          id: string
          user_id: string | null
          currency: string
          available_balance: number
          pending_balance: number
          last_updated: string | null
          canonical_user_id: string
          privy_user_id: string | null
          wallet_address: string | null
          canonical_user_id_norm: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          currency: string
          available_balance: number
          pending_balance: number
          last_updated?: string | null
          canonical_user_id: string
          privy_user_id?: string | null
          wallet_address?: string | null
          canonical_user_id_norm?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          currency?: string
          available_balance?: number
          pending_balance?: number
          last_updated?: string | null
          canonical_user_id?: string
          privy_user_id?: string | null
          wallet_address?: string | null
          canonical_user_id_norm?: string | null
        }
      }
      testimonials: {
        Row: {
          id: string
          author_name: string
          content: string
          author_avatar: string | null
          rating: number | null
          display_order: number | null
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          author_name: string
          content: string
          author_avatar?: string | null
          rating?: number | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          author_name?: string
          content?: string
          author_avatar?: string | null
          rating?: number | null
          display_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
      }
      tickets: {
        Row: {
          id: string
          competition_id: string
          ticket_number: number
          status: string
          purchased_by: string | null
          purchased_at: string | null
          order_id: string | null
          created_at: string
          user_id: string | null
          purchase_price: number | null
          is_active: boolean | null
          is_winner: boolean | null
          privy_user_id: string | null
          prize_tier: string | null
          pending_ticket_id: string | null
          payment_amount: number | null
          payment_tx_hash: string | null
          purchase_date: string | null
          canonical_user_id: string | null
          wallet_address: string | null
          payment_provider: string | null
          tx_id: string | null
        }
        Insert: {
          id?: string
          competition_id: string
          ticket_number: number
          status?: string
          purchased_by?: string | null
          purchased_at?: string | null
          order_id?: string | null
          created_at?: string
          user_id?: string | null
          purchase_price?: number | null
          is_active?: boolean | null
          is_winner?: boolean | null
          privy_user_id?: string | null
          prize_tier?: string | null
          pending_ticket_id?: string | null
          payment_amount?: number | null
          payment_tx_hash?: string | null
          purchase_date?: string | null
          canonical_user_id?: string | null
          wallet_address?: string | null
          payment_provider?: string | null
          tx_id?: string | null
        }
        Update: {
          id?: string
          competition_id?: string
          ticket_number?: number
          status?: string
          purchased_by?: string | null
          purchased_at?: string | null
          order_id?: string | null
          created_at?: string
          user_id?: string | null
          purchase_price?: number | null
          is_active?: boolean | null
          is_winner?: boolean | null
          privy_user_id?: string | null
          prize_tier?: string | null
          pending_ticket_id?: string | null
          payment_amount?: number | null
          payment_tx_hash?: string | null
          purchase_date?: string | null
          canonical_user_id?: string | null
          wallet_address?: string | null
          payment_provider?: string | null
          tx_id?: string | null
        }
      }
      tickets_sold: {
        Row: {
          competition_id: string
          ticket_number: number
          purchaser_id: string
          sold_at: string
        }
        Insert: {
          competition_id: string
          ticket_number: number
          purchaser_id: string
          sold_at?: string
        }
        Update: {
          competition_id?: string
          ticket_number?: number
          purchaser_id?: string
          sold_at?: string
        }
      }
      user_notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          message: string
          notification_type: string | null
          read: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          message: string
          notification_type?: string | null
          read?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          message?: string
          notification_type?: string | null
          read?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      user_transactions: {
        Row: {
          id: string
          user_id: string
          canonical_user_id: string | null
          wallet_address: string | null
          type: string
          amount: number
          currency: string
          balance_before: number | null
          balance_after: number | null
          competition_id: string | null
          order_id: string | null
          description: string | null
          status: string
          created_at: string
          user_privy_id: string | null
          metadata: Json | null
          provider: string | null
          tx_ref: string | null
          payment_provider: string | null
          payment_status: string | null
          ticket_count: number | null
          webhook_ref: string | null
          charge_id: string | null
          charge_code: string | null
          checkout_url: string | null
          updated_at: string
          primary_provider: string | null
          fallback_provider: string | null
          provider_attempts: number
          provider_error: string | null
          posted_to_balance: boolean
          completed_at: string | null
          expires_at: string | null
          method: string | null
          tx_id: string | null
          network: string | null
        }
        Insert: {
          id?: string
          user_id: string
          canonical_user_id?: string | null
          wallet_address?: string | null
          type: string
          amount: number
          currency?: string
          balance_before?: number | null
          balance_after?: number | null
          competition_id?: string | null
          order_id?: string | null
          description?: string | null
          status?: string
          created_at?: string
          user_privy_id?: string | null
          metadata?: Json | null
          provider?: string | null
          tx_ref?: string | null
          payment_provider?: string | null
          payment_status?: string | null
          ticket_count?: number | null
          webhook_ref?: string | null
          charge_id?: string | null
          charge_code?: string | null
          checkout_url?: string | null
          updated_at?: string
          primary_provider?: string | null
          fallback_provider?: string | null
          provider_attempts?: number
          provider_error?: string | null
          posted_to_balance?: boolean
          completed_at?: string | null
          expires_at?: string | null
          method?: string | null
          tx_id?: string | null
          network?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          canonical_user_id?: string | null
          wallet_address?: string | null
          type?: string
          amount?: number
          currency?: string
          balance_before?: number | null
          balance_after?: number | null
          competition_id?: string | null
          order_id?: string | null
          description?: string | null
          status?: string
          created_at?: string
          user_privy_id?: string | null
          metadata?: Json | null
          provider?: string | null
          tx_ref?: string | null
          payment_provider?: string | null
          payment_status?: string | null
          ticket_count?: number | null
          webhook_ref?: string | null
          charge_id?: string | null
          charge_code?: string | null
          checkout_url?: string | null
          updated_at?: string
          primary_provider?: string | null
          fallback_provider?: string | null
          provider_attempts?: number
          provider_error?: string | null
          posted_to_balance?: boolean
          completed_at?: string | null
          expires_at?: string | null
          method?: string | null
          tx_id?: string | null
          network?: string | null
        }
      }
      users: {
        Row: {
          id: string
          user_id: string
          wallet_address: string | null
          email: string | null
          privy_id: string | null
          created_at: string
          updated_at: string
          canonical_user_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          wallet_address?: string | null
          email?: string | null
          privy_id?: string | null
          created_at?: string
          updated_at?: string
          canonical_user_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          wallet_address?: string | null
          email?: string | null
          privy_id?: string | null
          created_at?: string
          updated_at?: string
          canonical_user_id?: string | null
        }
      }
      wallet_balances_table_backup: {
        Row: {
          id: string
          user_id: string
          canonical_user_id: string
          wallet_address: string
          balance: number
          pending_balance: number
          last_updated: string
        }
        Insert: {
          id?: string
          user_id: string
          canonical_user_id: string
          wallet_address: string
          balance?: number
          pending_balance?: number
          last_updated?: string
        }
        Update: {
          id?: string
          user_id?: string
          canonical_user_id?: string
          wallet_address?: string
          balance?: number
          pending_balance?: number
          last_updated?: string
        }
      }
      winners: {
        Row: {
          id: string
          competition_id: string
          user_id: string
          wallet_address: string | null
          prize_position: number | null
          prize_amount: number | null
          vrfulfillment_address: string | null
          vrf_proof: string | null
          claimed: boolean
          claimed_at: string | null
          created_at: string
          uid: string | null
          username: string | null
          ticket_number: number | null
          prize: string | null
          prize_value: number | null
          country: string | null
          prize_claimed: boolean | null
          tx_hash: string | null
          is_instant_win: boolean | null
          is_promoted: boolean | null
          isShow: boolean | null
          vrf_request_id: string | null
          won_at: string | null
          crdate: string | null
        }
        Insert: {
          id?: string
          competition_id: string
          user_id: string
          wallet_address?: string | null
          prize_position?: number | null
          prize_amount?: number | null
          vrfulfillment_address?: string | null
          vrf_proof?: string | null
          claimed?: boolean
          claimed_at?: string | null
          created_at?: string
          uid?: string | null
          username?: string | null
          ticket_number?: number | null
          prize?: string | null
          prize_value?: number | null
          country?: string | null
          prize_claimed?: boolean | null
          tx_hash?: string | null
          is_instant_win?: boolean | null
          is_promoted?: boolean | null
          isShow?: boolean | null
          vrf_request_id?: string | null
          won_at?: string | null
          crdate?: string | null
        }
        Update: {
          id?: string
          competition_id?: string
          user_id?: string
          wallet_address?: string | null
          prize_position?: number | null
          prize_amount?: number | null
          vrfulfillment_address?: string | null
          vrf_proof?: string | null
          claimed?: boolean
          claimed_at?: string | null
          created_at?: string
          uid?: string | null
          username?: string | null
          ticket_number?: number | null
          prize?: string | null
          prize_value?: number | null
          country?: string | null
          prize_claimed?: boolean | null
          tx_hash?: string | null
          is_instant_win?: boolean | null
          is_promoted?: boolean | null
          isShow?: boolean | null
          vrf_request_id?: string | null
          won_at?: string | null
          crdate?: string | null
        }
      }
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
          user_identifier?: string
          p_canonical_user_id?: string
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
      get_user_competition_entries: {
        Args: {
          p_user_identifier: string
        }
        Returns: {
          id: string
          competition_id: string
          user_id: string
          canonical_user_id: string
          wallet_address: string
          ticket_numbers: number[]
          ticket_count: number
          amount_paid: number
          currency: string
          transaction_hash: string | null
          payment_provider: string | null
          entry_status: string
          is_winner: boolean
          prize_claimed: boolean
          created_at: string
          updated_at: string
          competition_title: string
          competition_description: string
          competition_image_url: string
          competition_status: string
          competition_end_date: string | null
          competition_prize_value: number | null
          competition_is_instant_win: boolean
        }[]
      }
      get_competition_entries_public: {
        Args: {
          p_competition_id: string
        }
        Returns: {
          id: string
          competition_id: string
          user_id: string
          canonical_user_id: string
          wallet_address: string
          ticket_numbers: number[]
          ticket_count: number
          amount_paid: number
          entry_status: string
          is_winner: boolean
          created_at: string
        }[]
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
      reserve_lucky_dip: {
        Args: {
          p_competition_id: string
          p_canonical_user_id: string
          p_wallet_address: string
          p_ticket_count: number
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
          user_identifier: string
          new_avatar_url: string
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
      credit_balance_with_first_deposit_bonus: {
        Args: {
          p_canonical_user_id: string
          p_amount: number
          p_reason: string
          p_reference_id: string
        }
        Returns: Json
      }
      credit_sub_account_balance: {
        Args: {
          p_canonical_user_id: string
          p_amount: number
          p_currency: string
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

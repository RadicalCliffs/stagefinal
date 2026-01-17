export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_sessions: {
        Row: {
          admin_id: string | null
          created_at: string | null
          expires_at: string
          id: string
          ip_address: string | null
          token: string
          user_agent: string | null
        }
        Insert: {
          admin_id?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          ip_address?: string | null
          token: string
          user_agent?: string | null
        }
        Update: {
          admin_id?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          ip_address?: string | null
          token?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          password_hash: string
          role: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          password_hash: string
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          password_hash?: string
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      competitions: {
        Row: {
          chain_id: number | null
          competition_type: string | null
          competitionended: number | null
          contract_address: string | null
          crdate: string | null
          created_at: string | null
          creator_id: string | null
          description: string | null
          draw_date: string | null
          drawn_at: string | null
          end_date: string | null
          entry_fee: string | null
          font_size_override: string | null
          font_weight_override: string | null
          id: string
          image_url: string | null
          imageurl: string | null
          is_featured: boolean | null
          is_instant_win: boolean | null
          max_participants: number | null
          metadata_description: string | null
          metadata_image: string | null
          metadata_title: string | null
          prize_type: string | null
          prize_value: number | null
          start_date: string | null
          status: string | null
          ticket_price: number | null
          tickets_sold: number | null
          title: string | null
          total_tickets: number | null
          tx_hash: string | null
          uid: string | null
          vrf_request_id: string | null
          winner_address: string | null
          onchain_competition_id: number | null
          vrf_error: string | null
          vrf_draw_requested_at: string | null
          vrf_draw_completed_at: string | null
        }
        Insert: {
          chain_id?: number | null
          competition_type?: string | null
          competitionended?: number | null
          contract_address?: string | null
          crdate?: string | null
          created_at?: string | null
          creator_id?: string | null
          description?: string | null
          draw_date?: string | null
          drawn_at?: string | null
          end_date?: string | null
          entry_fee?: string | null
          font_size_override?: string | null
          font_weight_override?: string | null
          id?: string
          image_url?: string | null
          imageurl?: string | null
          is_featured?: boolean | null
          is_instant_win?: boolean | null
          max_participants?: number | null
          metadata_description?: string | null
          metadata_image?: string | null
          metadata_title?: string | null
          prize_type?: string | null
          prize_value?: number | null
          start_date?: string | null
          status?: string | null
          ticket_price?: number | null
          tickets_sold?: number | null
          title?: string | null
          total_tickets?: number | null
          tx_hash?: string | null
          uid?: string | null
          vrf_request_id?: string | null
          winner_address?: string | null
          onchain_competition_id?: number | null
          vrf_error?: string | null
          vrf_draw_requested_at?: string | null
          vrf_draw_completed_at?: string | null
        }
        Update: {
          chain_id?: number | null
          competition_type?: string | null
          competitionended?: number | null
          contract_address?: string | null
          crdate?: string | null
          created_at?: string | null
          creator_id?: string | null
          description?: string | null
          draw_date?: string | null
          drawn_at?: string | null
          end_date?: string | null
          entry_fee?: string | null
          font_size_override?: string | null
          font_weight_override?: string | null
          id?: string
          image_url?: string | null
          imageurl?: string | null
          is_featured?: boolean | null
          is_instant_win?: boolean | null
          max_participants?: number | null
          metadata_description?: string | null
          metadata_image?: string | null
          metadata_title?: string | null
          prize_type?: string | null
          prize_value?: number | null
          start_date?: string | null
          status?: string | null
          ticket_price?: number | null
          tickets_sold?: number | null
          title?: string | null
          total_tickets?: number | null
          tx_hash?: string | null
          uid?: string | null
          vrf_request_id?: string | null
          winner_address?: string | null
          onchain_competition_id?: number | null
          vrf_error?: string | null
          vrf_draw_requested_at?: string | null
          vrf_draw_completed_at?: string | null
        }
        Relationships: []
      }
      custody_transactions: {
        Row: {
          amount: number
          blockchain_tx_hash: string | null
          created_at: string | null
          currency: string
          id: string
          metadata: Json | null
          nowpayments_id: string | null
          nowpayments_order_id: string | null
          nowpayments_payment_id: string | null
          processed_at: string | null
          provider: string
          reference_id: string | null
          status: string
          transaction_type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          blockchain_tx_hash?: string | null
          created_at?: string | null
          currency?: string
          id?: string
          metadata?: Json | null
          nowpayments_id?: string | null
          nowpayments_order_id?: string | null
          nowpayments_payment_id?: string | null
          processed_at?: string | null
          provider?: string
          reference_id?: string | null
          status?: string
          transaction_type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          blockchain_tx_hash?: string | null
          created_at?: string | null
          currency?: string
          id?: string
          metadata?: Json | null
          nowpayments_id?: string | null
          nowpayments_order_id?: string | null
          nowpayments_payment_id?: string | null
          processed_at?: string | null
          provider?: string
          reference_id?: string | null
          status?: string
          transaction_type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custody_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      custody_wallet_balances: {
        Row: {
          balance_after: number
          balance_before: number
          change_amount: number
          created_at: string | null
          id: string
          reference_id: string | null
          transaction_type: string
          user_id: string | null
        }
        Insert: {
          balance_after: number
          balance_before: number
          change_amount: number
          created_at?: string | null
          id?: string
          reference_id?: string | null
          transaction_type: string
          user_id?: string | null
        }
        Update: {
          balance_after?: number
          balance_before?: number
          change_amount?: number
          created_at?: string | null
          id?: string
          reference_id?: string | null
          transaction_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custody_wallet_balances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          answer: string
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          question: string
          updated_at: string | null
        }
        Insert: {
          answer: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          question: string
          updated_at?: string | null
        }
        Update: {
          answer?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          question?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      hero_competitions: {
        Row: {
          competition_id: string | null
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
        }
        Insert: {
          competition_id?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
        }
        Update: {
          competition_id?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "hero_competitions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_transfers: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string | null
          currency: string
          description: string | null
          from_user_id: string
          id: string
          status: string | null
          to_user_id: string
          transfer_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string | null
          currency: string
          description?: string | null
          from_user_id: string
          id?: string
          status?: string | null
          to_user_id: string
          transfer_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string | null
          currency?: string
          description?: string | null
          from_user_id?: string
          id?: string
          status?: string | null
          to_user_id?: string
          transfer_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      joincompetition: {
        Row: {
          amountspent: number | null
          buytime: string | null
          chain: string | null
          competitionid: string
          created_at: string | null
          id: string
          numberoftickets: number | null
          purchasedate: string | null
          ticketnumbers: string | null
          transactionhash: string | null
          uid: string
          userid: string | null
          walletaddress: string | null
        }
        Insert: {
          amountspent?: number | null
          buytime?: string | null
          chain?: string | null
          competitionid: string
          created_at?: string | null
          id?: string
          numberoftickets?: number | null
          purchasedate?: string | null
          ticketnumbers?: string | null
          transactionhash?: string | null
          uid: string
          userid?: string | null
          walletaddress?: string | null
        }
        Update: {
          amountspent?: number | null
          buytime?: string | null
          chain?: string | null
          competitionid?: string
          created_at?: string | null
          id?: string
          numberoftickets?: number | null
          purchasedate?: string | null
          ticketnumbers?: string | null
          transactionhash?: string | null
          uid?: string
          userid?: string | null
          walletaddress?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "joincompetition_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      joined_competitions: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          join_date: string
          number_of_tickets: number
          user_uid: string | null
          wallet_address: string | null
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          join_date: string
          number_of_tickets: number
          user_uid?: string | null
          wallet_address?: string | null
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          join_date?: string
          number_of_tickets?: number
          user_uid?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "joined_competitions_user_uid_fkey"
            columns: ["user_uid"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_sub_accounts: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          nowpayments_name: string
          sub_partner_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          nowpayments_name: string
          sub_partner_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          nowpayments_name?: string
          sub_partner_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      order_tickets: {
        Row: {
          created_at: string | null
          id: string
          order_id: string | null
          ticket_number: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id?: string | null
          ticket_number: string
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string | null
          ticket_number?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount_usd: number | null
          competition_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          order_type: string | null
          payment_method: string | null
          payment_provider: string | null
          payment_session_id: string | null
          payment_status: string | null
          payment_tx_hash: string | null
          payment_url: string | null
          ticket_count: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount_usd?: number | null
          competition_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          order_type?: string | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_session_id?: string | null
          payment_status?: string | null
          payment_tx_hash?: string | null
          payment_url?: string | null
          ticket_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount_usd?: number | null
          competition_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          order_type?: string | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_session_id?: string | null
          payment_status?: string | null
          payment_tx_hash?: string | null
          payment_url?: string | null
          ticket_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          competition_id: string | null
          id: string
          joined_at: string | null
          tx_hash: string | null
          user_id: string | null
          wallet_address: string | null
        }
        Insert: {
          competition_id?: string | null
          id?: string
          joined_at?: string | null
          tx_hash?: string | null
          user_id?: string | null
          wallet_address?: string | null
        }
        Update: {
          competition_id?: string | null
          id?: string
          joined_at?: string | null
          tx_hash?: string | null
          user_id?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participants_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          website_url: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          website_url?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          website_url?: string | null
        }
        Relationships: []
      }
      payment_webhook_events: {
        Row: {
          id: string
          note: string | null
          payload: Json
          provider: string
          received_at: string
          status: number
        }
        Insert: {
          id?: string
          note?: string | null
          payload: Json
          provider: string
          received_at?: string
          status: number
        }
        Update: {
          id?: string
          note?: string | null
          payload?: Json
          provider?: string
          received_at?: string
          status?: number
        }
        Relationships: []
      }
      platform_statistics: {
        Row: {
          active_competitions: number | null
          completed_competitions: number | null
          created_at: string | null
          id: string
          stat_date: string
          total_competitions: number | null
          total_revenue_usd: number | null
          total_tickets_sold: number | null
          total_users: number | null
          updated_at: string | null
        }
        Insert: {
          active_competitions?: number | null
          completed_competitions?: number | null
          created_at?: string | null
          id?: string
          stat_date: string
          total_competitions?: number | null
          total_revenue_usd?: number | null
          total_tickets_sold?: number | null
          total_users?: number | null
          updated_at?: string | null
        }
        Update: {
          active_competitions?: number | null
          completed_competitions?: number | null
          created_at?: string | null
          id?: string
          stat_date?: string
          total_competitions?: number | null
          total_revenue_usd?: number | null
          total_tickets_sold?: number | null
          total_users?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      canonical_users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          has_used_new_user_bonus: boolean | null
          id: string
          privy_user_id: string | null
          telegram_handle: string | null
          uid: string | null
          usdc_balance: number
          username: string | null
          wallet_address: string | null
          eth_wallet_address: string | null
          base_wallet_address: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          has_used_new_user_bonus?: boolean | null
          id?: string
          privy_user_id?: string | null
          telegram_handle?: string | null
          uid?: string | null
          usdc_balance?: number
          username?: string | null
          wallet_address?: string | null
          eth_wallet_address?: string | null
          base_wallet_address?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          has_used_new_user_bonus?: boolean | null
          id?: string
          privy_user_id?: string | null
          telegram_handle?: string | null
          uid?: string | null
          usdc_balance?: number
          username?: string | null
          wallet_address?: string | null
          eth_wallet_address?: string | null
          base_wallet_address?: string | null
        }
        Relationships: []
      }
      privy_webhook_events: {
        Row: {
          event_id: string | null
          event_type: string
          id: string
          payload: Json
          received_at: string
        }
        Insert: {
          event_id?: string | null
          event_type: string
          id?: string
          payload: Json
          received_at?: string
        }
        Update: {
          event_id?: string | null
          event_type?: string
          id?: string
          payload?: Json
          received_at?: string
        }
        Relationships: []
      }
      Prize_Instantprizes: {
        Row: {
          avatarUrl: string | null
          competitionId: string | null
          description: string | null
          priority: number | null
          prize: string | null
          UID: string
          url: string | null
          winningTicket: number
          winningWalletAddress: string | null
        }
        Insert: {
          avatarUrl?: string | null
          competitionId?: string | null
          description?: string | null
          priority?: number | null
          prize?: string | null
          UID: string
          url?: string | null
          winningTicket: number
          winningWalletAddress?: string | null
        }
        Update: {
          avatarUrl?: string | null
          competitionId?: string | null
          description?: string | null
          priority?: number | null
          prize?: string | null
          UID?: string
          url?: string | null
          winningTicket?: number
          winningWalletAddress?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          id: string
          updated_at: string | null
          wallet_address: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          updated_at?: string | null
          wallet_address?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          updated_at?: string | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      raffle_competitions: {
        Row: {
          competition_id: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          entry_fee: number | null
          id: string
          max_participants: number | null
          prize_pool: number | null
          rng_random_number: string | null
          rng_tx_hash: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          winner_address: string | null
          winning_ticket_id: string | null
        }
        Insert: {
          competition_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          entry_fee?: number | null
          id?: string
          max_participants?: number | null
          prize_pool?: number | null
          rng_random_number?: string | null
          rng_tx_hash?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          winner_address?: string | null
          winning_ticket_id?: string | null
        }
        Update: {
          competition_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          entry_fee?: number | null
          id?: string
          max_participants?: number | null
          prize_pool?: number | null
          rng_random_number?: string | null
          rng_tx_hash?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          winner_address?: string | null
          winning_ticket_id?: string | null
        }
        Relationships: []
      }
      rng_triggers: {
        Row: {
          competition_id: string | null
          created_at: string | null
          id: string
          random_number: string | null
          updated_at: string | null
          vrf_request_id: string | null
          vrf_status: string | null
          vrf_tx_hash: string | null
        }
        Insert: {
          competition_id?: string | null
          created_at?: string | null
          id?: string
          random_number?: string | null
          updated_at?: string | null
          vrf_request_id?: string | null
          vrf_status?: string | null
          vrf_tx_hash?: string | null
        }
        Update: {
          competition_id?: string | null
          created_at?: string | null
          id?: string
          random_number?: string | null
          updated_at?: string | null
          vrf_request_id?: string | null
          vrf_status?: string | null
          vrf_tx_hash?: string | null
        }
        Relationships: []
      }
      site_metadata: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      site_stats: {
        Row: {
          created_at: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          label: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      sub_account_balances: {
        Row: {
          available_balance: number | null
          currency: string
          id: string
          last_updated: string | null
          pending_balance: number | null
          user_id: string
        }
        Insert: {
          available_balance?: number | null
          currency: string
          id?: string
          last_updated?: string | null
          pending_balance?: number | null
          user_id: string
        }
        Update: {
          available_balance?: number | null
          currency?: string
          id?: string
          last_updated?: string | null
          pending_balance?: number | null
          user_id?: string
        }
        Relationships: []
      }
      testimonials: {
        Row: {
          author_avatar: string | null
          author_name: string
          content: string
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          rating: number | null
        }
        Insert: {
          author_avatar?: string | null
          author_name: string
          content: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          rating?: number | null
        }
        Update: {
          author_avatar?: string | null
          author_name?: string
          content?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          rating?: number | null
        }
        Relationships: []
      }
      tickets: {
        Row: {
          competition_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_winner: boolean | null
          order_id: string | null
          purchase_price: number | null
          purchased_at: string | null
          ticket_number: number
          user_id: string | null
        }
        Insert: {
          competition_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_winner?: boolean | null
          order_id?: string | null
          purchase_price?: number | null
          purchased_at?: string | null
          ticket_number: number
          user_id?: string | null
        }
        Update: {
          competition_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_winner?: boolean | null
          order_id?: string | null
          purchase_price?: number | null
          purchased_at?: string | null
          ticket_number?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          competition_id: string | null
          confirmed_at: string | null
          created_at: string | null
          id: string
          status: string | null
          tx_hash: string | null
          tx_type: string | null
          user_id: string | null
        }
        Insert: {
          competition_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          id?: string
          status?: string | null
          tx_hash?: string | null
          tx_type?: string | null
          user_id?: string | null
        }
        Update: {
          competition_id?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          id?: string
          status?: string | null
          tx_hash?: string | null
          tx_type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      unique_users: {
        Row: {
          ARBITRUM: string | null
          AVALANCHE: string | null
          BASE: string | null
          BINANCE: string | null
          BITCOIN: string | null
          CAN_MESSAGE: number | null
          CAN_UNLIMITED_ROOMS: string | null
          CASHFLOWS_PAID_TIMESTAMP: string | null
          Code: string | null
          CREATED_DATE: string | null
          EMAIL: string | null
          EMAIL_COMPETITIONS: number | null
          ETHEREUM: string | null
          EVENT_ENTER: number | null
          FANTOM: string | null
          IMAGE_URL: string | null
          IS_ACTIVE: number | null
          IS_PAID: boolean | null
          LAST_ACTIVE: string | null
          LAST_LOGIN: string | null
          OPTIMISM: string | null
          PHONE: number | null
          POLYGON: string | null
          PRIVY_SUBSCRIPTION_ID: string
          PRIVY_WALLET_ID: string
          SOLANA: string | null
          TELEGRAM_USER: string | null
          UID: string
          USER_BALANCE: number | null
          USER_SIGNATURE: string | null
          USERNAME: string
          WALLETID: string
        }
        Insert: {
          ARBITRUM?: string | null
          AVALANCHE?: string | null
          BASE?: string | null
          BINANCE?: string | null
          BITCOIN?: string | null
          CAN_MESSAGE?: number | null
          CAN_UNLIMITED_ROOMS?: string | null
          CASHFLOWS_PAID_TIMESTAMP?: string | null
          Code?: string | null
          CREATED_DATE?: string | null
          EMAIL?: string | null
          EMAIL_COMPETITIONS?: number | null
          ETHEREUM?: string | null
          EVENT_ENTER?: number | null
          FANTOM?: string | null
          IMAGE_URL?: string | null
          IS_ACTIVE?: number | null
          IS_PAID?: boolean | null
          LAST_ACTIVE?: string | null
          LAST_LOGIN?: string | null
          OPTIMISM?: string | null
          PHONE?: number | null
          POLYGON?: string | null
          PRIVY_SUBSCRIPTION_ID: string
          PRIVY_WALLET_ID: string
          SOLANA?: string | null
          TELEGRAM_USER?: string | null
          UID: string
          USER_BALANCE?: number | null
          USER_SIGNATURE?: string | null
          USERNAME: string
          WALLETID: string
        }
        Update: {
          ARBITRUM?: string | null
          AVALANCHE?: string | null
          BASE?: string | null
          BINANCE?: string | null
          BITCOIN?: string | null
          CAN_MESSAGE?: number | null
          CAN_UNLIMITED_ROOMS?: string | null
          CASHFLOWS_PAID_TIMESTAMP?: string | null
          Code?: string | null
          CREATED_DATE?: string | null
          EMAIL?: string | null
          EMAIL_COMPETITIONS?: number | null
          ETHEREUM?: string | null
          EVENT_ENTER?: number | null
          FANTOM?: string | null
          IMAGE_URL?: string | null
          IS_ACTIVE?: number | null
          IS_PAID?: boolean | null
          LAST_ACTIVE?: string | null
          LAST_LOGIN?: string | null
          OPTIMISM?: string | null
          PHONE?: number | null
          POLYGON?: string | null
          PRIVY_SUBSCRIPTION_ID?: string
          PRIVY_WALLET_ID?: string
          SOLANA?: string | null
          TELEGRAM_USER?: string | null
          UID?: string
          USER_BALANCE?: number | null
          USER_SIGNATURE?: string | null
          USERNAME?: string
          WALLETID?: string
        }
        Relationships: []
      }
      user_entries: {
        Row: {
          action: string
          amount_usd: string | null
          competition_id: string | null
          competition_name: string | null
          created_at: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          amount_usd?: string | null
          competition_id?: string | null
          competition_name?: string | null
          created_at?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          amount_usd?: string | null
          competition_id?: string | null
          competition_name?: string | null
          created_at?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          created_at: string | null
          id: string
          message: string
          notification_type: string | null
          read: boolean | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          notification_type?: string | null
          read?: boolean | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          notification_type?: string | null
          read?: boolean | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_payouts: {
        Row: {
          address: string
          amount: number
          batch_id: string | null
          completed_at: string | null
          created_at: string | null
          currency: string
          expires_at: string | null
          fa_verified: boolean | null
          id: string
          payout_id: string
          status: string | null
          updated_at: string | null
          user_id: string
          verification_attempts: number | null
          verification_code: string | null
        }
        Insert: {
          address: string
          amount: number
          batch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          currency: string
          expires_at?: string | null
          fa_verified?: boolean | null
          id?: string
          payout_id: string
          status?: string | null
          updated_at?: string | null
          user_id: string
          verification_attempts?: number | null
          verification_code?: string | null
        }
        Update: {
          address?: string
          amount?: number
          batch_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          currency?: string
          expires_at?: string | null
          fa_verified?: boolean | null
          id?: string
          payout_id?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
          verification_attempts?: number | null
          verification_code?: string | null
        }
        Relationships: []
      }
      user_profiles_csv_lines: {
        Row: {
          line: string
          line_number: number
        }
        Insert: {
          line: string
          line_number?: never
        }
        Update: {
          line?: string
          line_number?: never
        }
        Relationships: []
      }
      user_profiles_raw: {
        Row: {
          arbitrum: string | null
          avalanche: string | null
          base: string | null
          binance: string | null
          bitcoin: string | null
          can_message: boolean | null
          can_unlimited_rooms: boolean | null
          cashflows_paid_timestamp: string | null
          code: string | null
          created_date: string | null
          email: string | null
          email_competitions: string | null
          ethereum: string | null
          event_enter: string | null
          fantom: string | null
          image_url: string | null
          is_active: boolean | null
          is_paid: number | null
          last_active: string | null
          last_login: string | null
          optimism: string | null
          phone: string | null
          polygon: string | null
          privy_subscription_id: string | null
          privy_wallet_id: string | null
          solana: string | null
          telegram_user: string | null
          uid: string | null
          user_balance: number | null
          user_signature: string | null
          username: string | null
          walletid: string | null
        }
        Insert: {
          arbitrum?: string | null
          avalanche?: string | null
          base?: string | null
          binance?: string | null
          bitcoin?: string | null
          can_message?: boolean | null
          can_unlimited_rooms?: boolean | null
          cashflows_paid_timestamp?: string | null
          code?: string | null
          created_date?: string | null
          email?: string | null
          email_competitions?: string | null
          ethereum?: string | null
          event_enter?: string | null
          fantom?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_paid?: number | null
          last_active?: string | null
          last_login?: string | null
          optimism?: string | null
          phone?: string | null
          polygon?: string | null
          privy_subscription_id?: string | null
          privy_wallet_id?: string | null
          solana?: string | null
          telegram_user?: string | null
          uid?: string | null
          user_balance?: number | null
          user_signature?: string | null
          username?: string | null
          walletid?: string | null
        }
        Update: {
          arbitrum?: string | null
          avalanche?: string | null
          base?: string | null
          binance?: string | null
          bitcoin?: string | null
          can_message?: boolean | null
          can_unlimited_rooms?: boolean | null
          cashflows_paid_timestamp?: string | null
          code?: string | null
          created_date?: string | null
          email?: string | null
          email_competitions?: string | null
          ethereum?: string | null
          event_enter?: string | null
          fantom?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_paid?: number | null
          last_active?: string | null
          last_login?: string | null
          optimism?: string | null
          phone?: string | null
          polygon?: string | null
          privy_subscription_id?: string | null
          privy_wallet_id?: string | null
          solana?: string | null
          telegram_user?: string | null
          uid?: string | null
          user_balance?: number | null
          user_signature?: string | null
          username?: string | null
          walletid?: string | null
        }
        Relationships: []
      }
      user_profiles_staging: {
        Row: {
          arbitrum: string | null
          avalanche: string | null
          base: string | null
          binance: string | null
          bitcoin: string | null
          can_message: boolean | null
          can_unlimited_rooms: boolean | null
          cashflows_paid_timestamp: string | null
          code: string | null
          created_date: string | null
          email: string | null
          email_competitions: string | null
          ethereum: string | null
          event_enter: string | null
          fantom: string | null
          image_url: string | null
          is_active: boolean | null
          is_paid: number | null
          last_active: string | null
          last_login: string | null
          optimism: string | null
          phone: string | null
          polygon: string | null
          privy_subscription_id: string | null
          privy_wallet_id: string | null
          solana: string | null
          telegram_user: string | null
          uid: string
          user_balance: number | null
          user_signature: string | null
          username: string | null
          walletid: string | null
        }
        Insert: {
          arbitrum?: string | null
          avalanche?: string | null
          base?: string | null
          binance?: string | null
          bitcoin?: string | null
          can_message?: boolean | null
          can_unlimited_rooms?: boolean | null
          cashflows_paid_timestamp?: string | null
          code?: string | null
          created_date?: string | null
          email?: string | null
          email_competitions?: string | null
          ethereum?: string | null
          event_enter?: string | null
          fantom?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_paid?: number | null
          last_active?: string | null
          last_login?: string | null
          optimism?: string | null
          phone?: string | null
          polygon?: string | null
          privy_subscription_id?: string | null
          privy_wallet_id?: string | null
          solana?: string | null
          telegram_user?: string | null
          uid: string
          user_balance?: number | null
          user_signature?: string | null
          username?: string | null
          walletid?: string | null
        }
        Update: {
          arbitrum?: string | null
          avalanche?: string | null
          base?: string | null
          binance?: string | null
          bitcoin?: string | null
          can_message?: boolean | null
          can_unlimited_rooms?: boolean | null
          cashflows_paid_timestamp?: string | null
          code?: string | null
          created_date?: string | null
          email?: string | null
          email_competitions?: string | null
          ethereum?: string | null
          event_enter?: string | null
          fantom?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_paid?: number | null
          last_active?: string | null
          last_login?: string | null
          optimism?: string | null
          phone?: string | null
          polygon?: string | null
          privy_subscription_id?: string | null
          privy_wallet_id?: string | null
          solana?: string | null
          telegram_user?: string | null
          uid?: string
          user_balance?: number | null
          user_signature?: string | null
          username?: string | null
          walletid?: string | null
        }
        Relationships: []
      }
      user_transactions: {
        Row: {
          amount: number | null
          competition_id: string | null
          completed_at: string | null
          created_at: string | null
          credit_synced: boolean | null
          currency: string | null
          id: string
          network: string | null
          order_id: string | null
          payment_status: string | null
          session_id: string | null
          status: string | null
          ticket_count: number | null
          tx_id: string | null
          updated_at: string | null
          user_id: string | null
          wallet_address: string | null
          webhook_ref: string | null
        }
        Insert: {
          amount?: number | null
          competition_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          credit_synced?: boolean | null
          currency?: string | null
          id?: string
          network?: string | null
          order_id?: string | null
          payment_status?: string | null
          session_id?: string | null
          status?: string | null
          ticket_count?: number | null
          tx_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          wallet_address?: string | null
          webhook_ref?: string | null
        }
        Update: {
          amount?: number | null
          competition_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          credit_synced?: boolean | null
          currency?: string | null
          id?: string
          network?: string | null
          order_id?: string | null
          payment_status?: string | null
          session_id?: string | null
          status?: string | null
          ticket_count?: number | null
          tx_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          wallet_address?: string | null
          webhook_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          casino_payout_total: number | null
          created_at: string | null
          custody_wallet_balance: number | null
          email: string | null
          id: string
          is_active: boolean | null
          last_balance_sync: string | null
          nowpayments_name: string | null
          nowpayments_sub_partner_id: string | null
          privy_user_id: string
          telegram_handle: string | null
          telephone_number: string | null
          total_winnings: number | null
          updated_at: string | null
          username: string | null
          wallet_address: string
        }
        Insert: {
          avatar_url?: string | null
          casino_payout_total?: number | null
          created_at?: string | null
          custody_wallet_balance?: number | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          last_balance_sync?: string | null
          nowpayments_name?: string | null
          nowpayments_sub_partner_id?: string | null
          privy_user_id: string
          telegram_handle?: string | null
          telephone_number?: string | null
          total_winnings?: number | null
          updated_at?: string | null
          username?: string | null
          wallet_address: string
        }
        Update: {
          avatar_url?: string | null
          casino_payout_total?: number | null
          created_at?: string | null
          custody_wallet_balance?: number | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          last_balance_sync?: string | null
          nowpayments_name?: string | null
          nowpayments_sub_partner_id?: string | null
          privy_user_id?: string
          telegram_handle?: string | null
          telephone_number?: string | null
          total_winnings?: number | null
          updated_at?: string | null
          username?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      winners: {
        Row: {
          claimed: boolean | null
          competition_id: string | null
          country: string | null
          crdate: string | null
          id: string
          is_instant_win: boolean | null
          is_promoted: boolean | null
          isShow: boolean | null
          prize: string | null
          prize_amount: string | null
          prize_claimed: boolean | null
          prize_value: number | null
          ticket_number: number | null
          tx_hash: string | null
          uid: string | null
          user_id: string | null
          username: string | null
          vrf_proof: string | null
          vrf_request_id: string | null
          wallet_address: string | null
          won_at: string | null
        }
        Insert: {
          claimed?: boolean | null
          competition_id?: string | null
          country?: string | null
          crdate?: string | null
          id?: string
          is_instant_win?: boolean | null
          is_promoted?: boolean | null
          isShow?: boolean | null
          prize?: string | null
          prize_amount?: string | null
          prize_claimed?: boolean | null
          prize_value?: number | null
          ticket_number?: number | null
          tx_hash?: string | null
          uid?: string | null
          user_id?: string | null
          username?: string | null
          vrf_proof?: string | null
          vrf_request_id?: string | null
          wallet_address?: string | null
          won_at?: string | null
        }
        Update: {
          claimed?: boolean | null
          competition_id?: string | null
          country?: string | null
          crdate?: string | null
          id?: string
          is_instant_win?: boolean | null
          is_promoted?: boolean | null
          isShow?: boolean | null
          prize?: string | null
          prize_amount?: string | null
          prize_claimed?: boolean | null
          prize_value?: number | null
          ticket_number?: number | null
          tx_hash?: string | null
          uid?: string | null
          user_id?: string | null
          username?: string | null
          vrf_proof?: string | null
          vrf_request_id?: string | null
          wallet_address?: string | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "winners_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      competition_entries_public: {
        Row: {
          competition_id: string | null
          last_purchase_at: string | null
          ticket_count: number | null
          wallet_address: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_balances: {
        Row: {
          canonical_user_id: string | null
          uid: string | null
          id: string | null
          wallet_address: string | null
          base_wallet_address: string | null
          balance: number
          has_used_new_user_bonus: boolean | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_joincompetition_active: {
        Row: {
          id: string | null
          uid: string | null
          userid: string | null
          walletaddress: string | null
          competitionid: string | null
          numberoftickets: number | null
          ticketnumbers: string | null
          amountspent: string | null
          purchasedate: string | null
          buytime: string | null
          transactionhash: string | null
          chain: string | null
          created_at: string | null
          competition_title: string | null
          competition_status: string | null
          competition_draw_date: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_external_usdc_balance: {
        Args: { wallet_address: string }
        Returns: number
      }
      cleanup_old_data: { Args: never; Returns: undefined }
      cleanup_stale_transactions: { Args: never; Returns: undefined }
      convert_specific_deposit: {
        Args: {
          tx_id_param: string
          usd_value_param: number
          wallet_addr_param: string
        }
        Returns: string
      }
      credit_user_balance: {
        Args: { amount: number; user_id: string }
        Returns: number
      }
      dearmor: { Args: { "": string }; Returns: string }
      debit_user_balance: {
        Args: { amount: number; user_id: string }
        Returns: number
      }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      get_custody_wallet_summary: {
        Args: { p_user_id: string }
        Returns: {
          current_balance: number
          last_transaction_at: string
          pending_transactions: number
          total_deposits: number
          total_payouts: number
          total_withdrawals: number
        }[]
      }
      get_user_active_tickets: {
        Args: { user_identifier: string }
        Returns: number
      }
      get_user_ticket_count: {
        Args: { user_identifier: string }
        Returns: number
      }
      get_user_balance: {
        Args: { p_canonical_user_id: string }
        Returns: number
      }
      get_user_wallet_balance: {
        Args: { user_identifier: string }
        Returns: number
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      process_prize_payout: {
        Args: {
          p_amount: number
          p_competition_id?: string
          p_reference_id?: string
          p_user_id: string
        }
        Returns: {
          new_balance: number
          success: boolean
          transaction_id: string
        }[]
      }
      sync_all_external_wallet_balances: {
        Args: never
        Returns: {
          difference: number
          external_balance: number
          new_internal_balance: number
          previous_internal_balance: number
          privy_user_id: string
          wallet_address: string
        }[]
      }
      sync_completed_deposits_to_usdc: {
        Args: { wallet_address_param?: string }
        Returns: {
          new_usdc_balance: number
          total_deposits_converted: number
          transactions_processed: number
          wallet_address: string
        }[]
      }
      sync_external_wallet_balances: {
        Args: { privy_user_id_param: string }
        Returns: {
          difference: number
          external_balance: number
          new_internal_balance: number
          previous_internal_balance: number
          user_wallet_address: string
        }[]
      }
      update_custody_balance: {
        Args: {
          p_amount: number
          p_reference_id?: string
          p_transaction_type: string
          p_user_id: string
        }
        Returns: {
          balance_after: number
          balance_before: number
          success: boolean
          user_id: string
        }[]
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
      get_unavailable_tickets: {
        Args: {
          competition_id: string
        }
        Returns: number[]
      }
      get_user_tickets_for_competition: {
        Args: {
          competition_id: string
          user_id: string
        }
        Returns: {
          ticket_number: number
          source: string
          purchased_at: string
          wallet_address: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

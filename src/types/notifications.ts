export interface UserTicket {
  id: string;
  user_id: string;
  competition_id: string;
  competition_uid: string;
  ticket_number: number;
  purchase_date: string;
  transaction_id: string;
  is_winner?: boolean;
  prize_won?: string;
  claimed?: boolean;
}

export interface UserNotification {
  id: string;
  user_id: string;
  type: 'win' | 'competition_ended' | 'special_offer' | 'announcement';
  title: string;
  message: string;
  competition_id?: string;
  prize_info?: string;
  read: boolean;
  created_at: string;
  expires_at?: string;
}

export interface NotificationPreferences {
  user_id: string;
  email_notifications: boolean;
  push_notifications: boolean;
}

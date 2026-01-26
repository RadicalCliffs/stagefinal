export interface TableRow {
  competition: string;
  user: {
    name: string;
    avatar: string;
  };
  action: string;
  amount: string;
  time: string;
  competitionId?: string;
  competitionImage?: string;
  competitionPrize?: string;
}

export interface Options {
  label: string;
  key: string;
  range?: number[]
}

export interface FilterTabsProps<T extends Options> {
  options: T[];
  active: T | null;
  onChange: (option: T) => void;
  containerClasses?: string;
  buttonClasses?: string;
}

export interface ProfileFormData  {
  username: string;
  email_address: string;
  telegram_handle: string;
  country?: string;
  telephone_number?: string;
  // Legacy fields - kept for backwards compatibility but not saved to database
  first_name?: string;
  last_name?: string;
};


export interface WinnerInfoField {
  label: string;
  value: string;
  copyable?: boolean;
  link?: string;
}

export interface WinnerHashCardProps {
  fields: WinnerInfoField[];
  onBack?: () => void;
  showBackgroundImage?: boolean;
  outerContainerClasses?:string
}

export interface Entry {
  entryNumber?: string | number;  // Optional for compatibility
  ticketNumber?: number;  // Added for compatibility with entry displays
  date: string;
  walletAddress: string;
  username?: string;
  transactionHash?: string;  // Crypto payment tx hash or most recent top-up tx hash
  vrfHash?: string;  // VRF hash for provably fair verification
  rngHash?: string;  // RNG hash alias
}

// Dashboard entry type returned from get_comprehensive_user_dashboard_entries
export interface DashboardEntry {
  id: string;
  competition_id: string;
  title: string;
  description: string;
  image: string;
  status: 'live' | 'drawn' | 'pending';
  entry_type: 'completed' | 'pending';
  expires_at?: string; // ISO date string for pending reservations
  is_winner: boolean;
  ticket_numbers?: string;
  number_of_tickets?: number;
  amount_spent?: string;
  purchase_date?: string;
  wallet_address?: string;
  transaction_hash?: string;
  is_instant_win: boolean;
  prize_value?: string;
  competition_status: string;
  end_date?: string;
}

export interface EntriesTableProps {
  entries: Entry[];
  itemsPerPage?: number;
}

export interface Step {
  icon: string;
  title: string;
  description?: string;
  bgImage?:string
}

export interface FairStepsProps {
  outerContainerClasses?:string
  titleDesktop: string;
  titleMobile: string;
  steps: Step[];
  linkText?: string;
  linkTo?: string;
  primaryColor?: string;
  showSteps?:boolean;
  containerClasses?:string;
  titleClasses?:string;
  descriptionClasses?:string
  cardClasses?:string;
  bgImageClasses?:string;
  showInstructionLink?:boolean;
  showSeparator?:boolean
}

export interface Tab {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: Tab[];
  onTabChange?: (id: string) => void;
  tabOuterContainerClasses?:string
  tabContainerClasses?:string
  tabClasses?:string
  activeTabClasses?:string
}

export interface PrizeHeaderProps {
  image: string;
  title: string;
  toBeWon: string;
  details: React.ReactNode; // allows you to pass PrizesDetails or any component
}

export interface EntryTicket {
  id: number;
  number: string;
  isWinner: boolean;
}

export interface PrizesDetailsProps {
  tickets: EntryTicket[];
  itemsPerPage?: number;
}

export interface CompetitionCardProps {
  id?:string;
  image: string;
  title: string;
  price: string | number;
  timeRemaining: string; // e.g. "07:12:44:23"
  entriesSold: string; // e.g. "70% Entries Sold"
  ticketsSold?: string; // Alternative to entriesSold for ticket-based competitions
  progressPercent?: number; // 0–100
  onEnter?: () => void;
  className?: string;
  isCompetitionFinished?:boolean
  isSoldOut?:boolean // When all tickets are sold
  endDate?: string;
  isLastChanceCompetition?:boolean
  isInstantWin?:boolean
  // VRF On-Chain field - indicates competition uses provably fair VRF
  onchainCompetitionId?: number | null;
}

export interface Competition {
  id: string;
  uid?: string; // Legacy UID field used for joincompetition and Prize_Instantprizes
  creator_id: string;
  title: string;
  description: string;
  contract_address: string;
  chain_id: number;
  max_participants: number;
  max_tickets?: number;  // Added for ticket-based competitions
  entry_fee: string;
  status: 'draft' | 'active' | 'drawing' | 'drawn' | 'completed' | 'cancelled' | 'expired';
  winner_address?: string | null;
  tx_hash?: string | null;
  vrf_request_id?: string | null;
  created_at?: string | null;
  drawn_at?: string | null;
  end_date?: string | null;
  draw_date?: string | null;
  start_date?: string | null;
  is_instant_win?: boolean | null;
  competition_type?: string | null;
  image_url: string;
  total_entries?: number;
  entries_sold?: number;
  prize_value?: number | null;
  entry_price?: number;
  ticket_price?: number | null;
  total_tickets?: number | null;
  tickets_sold?: number | null;
  progressPercent?: number;  // Calculated field for UI display
  category?: string | null;
  prize_type?: string | null;
  is_featured?: boolean | null;
  winning_tickets_generated?: boolean | null;
  font_size_override?: string | null;
  font_weight_override?: string | null;
  metadata_title?: string | null;
  metadata_description?: string | null;
  metadata_image?: string | null;
  competitionended?: number | null;
  crdate?: string | null;
  // VRF On-Chain fields
  onchain_competition_id?: number | null;
  vrf_error?: string | null;
  vrf_draw_requested_at?: string | null;
}

export interface CompetitionWrapper {
  competition: Competition;
}

export interface EntryCard {
  id: number;
  title: string;
  description: string;
  image: string;
  status: "win" | "loss";
}

export interface PurchaseOrder {
  id:number
  entriesBought: number;
  network: string;
  txHash: string;
  date: string;
  amount: string;
}

export interface EntryOrder {
  id:number
  competitionName: string;
  date: string;
  amount: string;
  actions?: string;
}

export interface Faq {
    question: string;
    answer: string;
}

export interface WinnerCardProps {
  prize: string;
  username: string;
  country: string;
  wallet: string;
  date: string;
  showInstantWin?: boolean;
  avatarUrl?: string;
  competitionId?: string;
  txHash?: string;
}

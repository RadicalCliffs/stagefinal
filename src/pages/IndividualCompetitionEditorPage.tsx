/**
 * Individual Competition Page Preview for Visual Editor
 * 
 * This is a wrapper page that provides a mock competition for the visual editor.
 * It allows editing of competition page text content through the editor interface.
 */

import { type CompetitionPageTextOverrides } from '../components/IndividualCompetition/IndividualCompetitionInfo';
import IndividualCompetition from '../components/IndividualCompetition/IndividualCompetition';
import type { Competition } from '../models/models';

interface IndividualCompetitionEditorPageProps {
  textOverrides?: CompetitionPageTextOverrides;
}

// Mock competition data for preview
const mockCompetition: Competition = {
  id: 'preview-competition-123',
  uid: 'preview-uid-123',
  creator_id: 'preview-creator',
  title: 'PREVIEW COMPETITION - £10,000 Cash Prize',
  description: 'This is a preview competition for the visual editor. Customize the text fields to see changes in real-time!',
  contract_address: '0x0000000000000000000000000000000000000000',
  chain_id: 8453,
  max_participants: 1000,
  entry_fee: '1.00',
  status: 'active',
  winner_address: '',
  tx_hash: '',
  vrf_request_id: '',
  created_at: new Date().toISOString(),
  drawn_at: '',
  end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
  draw_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  is_instant_win: false,
  competition_type: 'standard',
  image_url: '/assets/images/default-competition.jpg',
  total_entries: 0,
  entries_sold: 250,
  prize_value: 10000,
  entry_price: 1,
  ticket_price: 1,
  total_tickets: 1000,
  tickets_sold: 250,
  onchain_competition_id: null,
  vrf_error: null,
  vrf_draw_requested_at: null,
};

const IndividualCompetitionEditorPage = ({ textOverrides }: IndividualCompetitionEditorPageProps) => {
  return (
    <IndividualCompetition 
      competition={mockCompetition} 
      competitionPageTextOverrides={textOverrides}
    />
  );
};

export default IndividualCompetitionEditorPage;

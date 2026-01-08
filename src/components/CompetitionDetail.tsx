import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { database } from '../lib/database';
import Loader from './Loader';
import IndividualCompetition from './IndividualCompetition/IndividualCompetition';
import InstantWinCompetition from './InstantWinCompetition/InstantWinCompetition';
import FinishedCompetition from './FinishedCompetition/FinishedCompetition';
import type { Competition } from '../models/models';
import { isFinalState } from './CompetitionStatusIndicator';



const CompetitionDetail = () => {
  const { id } = useParams<{ id: string }>();
  console.log(id)
  const navigate = useNavigate();
  const [competition, setCompetition] = useState<Competition>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompetition = async () => {
      if (!id) {
        navigate('/competitions');
        return;
      }

      const comp = await database.getCompetitionByIdV2(id);
      if (!comp) {
        navigate('/competitions');
        return;
      }

      setCompetition(comp);
      setLoading(false);
    };
    fetchCompetition();
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="py-20 text-center text-white">
        <p>Competition not found.</p>
      </div>
    );
  }

  // Route to FinishedCompetition for all terminal states (drawn, completed, cancelled, expired)
  // This prevents users from interacting with ticket purchase UI for ended competitions
  if (isFinalState(competition.status)) {
    return <FinishedCompetition competition={competition}/>;
  }

  // Also show FinishedCompetition for competitions that are currently drawing
  // (winner selection in progress - no new entries allowed)
  if (competition.status === 'drawing') {
    return <FinishedCompetition competition={competition}/>;
  }

  if (competition.is_instant_win) {
    return <InstantWinCompetition competition={competition}/>;
  }

  return <IndividualCompetition competition={competition}/>;
};

export default CompetitionDetail;

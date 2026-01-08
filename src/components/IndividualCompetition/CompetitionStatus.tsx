import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Competition {
  id: string;
  status: 'active' | 'drawing' | 'completed' | 'cancelled';
  winner_address?: string;
  winner_ticket_number?: number;
  drawn_at?: string;
}

interface CompetitionStatusProps {
  competition: Competition;
}

export function CompetitionStatus({ competition }: CompetitionStatusProps) {
  const [currentStatus, setCurrentStatus] = useState(competition.status);
  const [winnerAddress, setWinnerAddress] = useState(competition.winner_address);
  const [winnerTicketNumber, setWinnerTicketNumber] = useState(competition.winner_ticket_number);

  useEffect(() => {
    // Update state when competition prop changes
    setCurrentStatus(competition.status);
    setWinnerAddress(competition.winner_address);
    setWinnerTicketNumber(competition.winner_ticket_number);
  }, [competition]);

  useEffect(() => {
    if (!competition?.id) return;

    // Set up real-time subscription for competition status changes
    const channel = supabase
      .channel(`competition-status-${competition.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'competitions',
          filter: `id=eq.${competition.id}`
        },
        (payload) => {
          console.log('Competition status updated:', payload.new);
          const updated = payload.new as any;
          if (updated.status) {
            setCurrentStatus(updated.status);
          }
          if (updated.winner_address) {
            setWinnerAddress(updated.winner_address);
          }
          if (updated.winner_ticket_number) {
            setWinnerTicketNumber(updated.winner_ticket_number);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [competition?.id]);

  const renderStatus = () => {
    switch (currentStatus) {
      case 'active':
        return (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-green-500 font-medium sequel-45">Live</span>
          </div>
        );

      case 'drawing':
        return (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
            <span className="text-yellow-500 font-medium sequel-45">Drawing Winner...</span>
          </div>
        );

      case 'completed':
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-[#DDE404] rounded-full"></div>
              <span className="text-[#DDE404] font-medium sequel-45">Drawn</span>
            </div>
            {winnerAddress && (
              <div className="text-sm text-white/70 sequel-45">
                <span className="text-white/50">Winner: </span>
                {winnerAddress.slice(0, 8)}...{winnerAddress.slice(-6)}
                {winnerTicketNumber && (
                  <span className="ml-2 text-[#DDE404]">Ticket #{winnerTicketNumber}</span>
                )}
              </div>
            )}
          </div>
        );

      case 'cancelled':
        return (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span className="text-red-500 font-medium sequel-45">Cancelled</span>
          </div>
        );

      default:
        return <span className="text-white/50 sequel-45">Unknown</span>;
    }
  };

  return (
    <div className="p-4 bg-[#1D1D1D] border border-[#333] rounded-lg">
      <h3 className="font-semibold mb-2 text-white sequel-75">Status</h3>
      {renderStatus()}
    </div>
  );
}

export default CompetitionStatus;

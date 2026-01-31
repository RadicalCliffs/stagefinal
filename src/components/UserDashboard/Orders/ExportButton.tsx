import { Download } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { exportTransactionsToCSV } from '../../../lib/export-utils';
import { toPrizePid } from '../../../utils/userId';

interface ExportButtonProps {
  userId: string;
}

/**
 * Export button for downloading transaction history as CSV
 */
export function ExportButton({ userId }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!userId) return;
    
    setIsExporting(true);
    try {
      const canonicalUserId = toPrizePid(userId);
      
      // Fetch user transactions from balance_ledger
      // Filter to show only user-relevant transaction types, avoiding internal debit/entry pairs
      const { data, error } = await supabase
        .from('balance_ledger')
        .select('*')
        .eq('canonical_user_id', canonicalUserId)
        .in('transaction_type', ['deposit', 'purchase', 'bonus', 'withdrawal', 'refund'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        alert('No transactions to export');
        return;
      }

      // Format data for CSV
      const formattedData = data.map(tx => ({
        date: new Date(tx.created_at).toLocaleString(),
        type: tx.transaction_type || 'N/A',
        amount: `$${Number(tx.amount || 0).toFixed(2)}`,
        balance_after: `$${Number(tx.balance_after || 0).toFixed(2)}`,
        description: tx.description || '',
        source: tx.source || '',
        reference_id: tx.reference_id || '',
      }));

      // Export to CSV
      exportTransactionsToCSV(formattedData, `transaction-history-${new Date().toISOString().split('T')[0]}.csv`);
    } catch (error) {
      console.error('Failed to export transactions:', error);
      alert('Failed to export transactions. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className="flex items-center gap-2 px-4 py-2 bg-[#333] text-white rounded-lg hover:bg-[#444] transition-colors sequel-45 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download size={16} />
      {isExporting ? 'Exporting...' : 'Export CSV'}
    </button>
  );
}

export default ExportButton;

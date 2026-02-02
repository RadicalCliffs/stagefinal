/**
 * Example Dashboard Component Using user_overview
 * 
 * This component demonstrates how to use the user_overview view
 * to power a complete dashboard with a single query.
 */

import { useUserOverview } from '../hooks/useUserOverview';
import { useAuthUser } from '../contexts/AuthContext';
import Loader from './Loader';

export default function ExampleUserDashboard() {
  const { canonicalUserId } = useAuthUser();
  
  // Fetch all user data with a single hook
  const {
    overview,
    loading,
    error,
    entries,
    tickets,
    transactions,
    balances,
    counts,
    totals,
    refetch
  } = useUserOverview(canonicalUserId, {
    refreshInterval: 30000 // Auto-refresh every 30 seconds
  });

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className="error">
        <p>Failed to load dashboard data</p>
        <button onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="no-data">
        <p>No data available for this user</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Header with summary stats */}
      <div className="dashboard-header">
        <h1>My Dashboard</h1>
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Total Entries</span>
            <span className="stat-value">{counts.entries}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Tickets</span>
            <span className="stat-value">{counts.tickets}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Transactions</span>
            <span className="stat-value">{counts.transactions}</span>
          </div>
        </div>
      </div>

      {/* Balance Section */}
      <div className="balance-section">
        <h2>Wallet Balances</h2>
        <div className="balances">
          {Object.entries(balances).map(([currency, balance]) => (
            <div key={currency} className="balance-card">
              <h3>{currency}</h3>
              <div className="balance-amounts">
                <div>
                  <span>Available:</span>
                  <strong>${balance.available.toFixed(2)}</strong>
                </div>
                <div>
                  <span>Pending:</span>
                  <strong>${balance.pending.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="totals">
          <p>Total Credits: ${totals.credits.toFixed(2)}</p>
          <p>Total Debits: ${totals.debits.toFixed(2)}</p>
        </div>
      </div>

      {/* Entries Section */}
      <div className="entries-section">
        <h2>My Competition Entries</h2>
        {entries.length === 0 ? (
          <p>No entries yet. Join a competition to get started!</p>
        ) : (
          <div className="entries-list">
            {entries.map(entry => (
              <div key={entry.entry_id} className="entry-card">
                <h3>{entry.competition_title || 'Unknown Competition'}</h3>
                <div className="entry-details">
                  <p>Tickets: {entry.tickets_count}</p>
                  <p>Amount Paid: ${entry.amount_paid.toFixed(2)}</p>
                  <p>Ticket Numbers: {entry.ticket_numbers_csv}</p>
                  <p>Date: {new Date(entry.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tickets Section */}
      <div className="tickets-section">
        <h2>My Tickets ({tickets.length})</h2>
        {tickets.length === 0 ? (
          <p>No tickets yet.</p>
        ) : (
          <div className="tickets-grid">
            {tickets.map(ticket => (
              <div key={ticket.ticket_id} className="ticket-card">
                <span className="ticket-number">#{ticket.ticket_number}</span>
                <span className="ticket-date">
                  {new Date(ticket.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="transactions-section">
        <h2>Recent Transactions</h2>
        {transactions.length === 0 ? (
          <p>No transactions yet.</p>
        ) : (
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 10).map(tx => (
                <tr key={tx.transaction_id}>
                  <td>{new Date(tx.created_at).toLocaleDateString()}</td>
                  <td>{tx.type}</td>
                  <td className={tx.amount >= 0 ? 'positive' : 'negative'}>
                    ${Math.abs(tx.amount).toFixed(2)}
                  </td>
                  <td>{tx.currency}</td>
                  <td>
                    <span className={`status ${tx.status.toLowerCase()}`}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {transactions.length > 10 && (
          <button className="view-all">View All Transactions</button>
        )}
      </div>

      {/* Ledger Section (optional, detailed view) */}
      {counts.ledger > 0 && (
        <div className="ledger-section">
          <h2>Account Ledger</h2>
          <p>
            View your complete transaction history with {counts.ledger} entries.
          </p>
          <button className="view-ledger">View Detailed Ledger</button>
        </div>
      )}

      {/* Refresh Button */}
      <div className="dashboard-actions">
        <button onClick={refetch} className="refresh-button">
          Refresh Data
        </button>
      </div>
    </div>
  );
}

/**
 * CSS Module or Styled Components example:
 * 
 * .dashboard {
 *   max-width: 1200px;
 *   margin: 0 auto;
 *   padding: 2rem;
 * }
 * 
 * .dashboard-header {
 *   margin-bottom: 2rem;
 * }
 * 
 * .stats {
 *   display: grid;
 *   grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
 *   gap: 1rem;
 *   margin-top: 1rem;
 * }
 * 
 * .stat {
 *   background: #f5f5f5;
 *   padding: 1rem;
 *   border-radius: 8px;
 *   display: flex;
 *   flex-direction: column;
 *   gap: 0.5rem;
 * }
 * 
 * .stat-value {
 *   font-size: 2rem;
 *   font-weight: bold;
 *   color: #333;
 * }
 * 
 * .balances {
 *   display: grid;
 *   grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
 *   gap: 1rem;
 * }
 * 
 * .balance-card {
 *   background: white;
 *   border: 1px solid #e0e0e0;
 *   border-radius: 8px;
 *   padding: 1.5rem;
 * }
 * 
 * .entries-list,
 * .tickets-grid {
 *   display: grid;
 *   grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
 *   gap: 1rem;
 * }
 * 
 * .entry-card,
 * .ticket-card {
 *   background: white;
 *   border: 1px solid #e0e0e0;
 *   border-radius: 8px;
 *   padding: 1rem;
 * }
 * 
 * .transactions-table {
 *   width: 100%;
 *   border-collapse: collapse;
 * }
 * 
 * .transactions-table th,
 * .transactions-table td {
 *   padding: 0.75rem;
 *   text-align: left;
 *   border-bottom: 1px solid #e0e0e0;
 * }
 * 
 * .positive {
 *   color: green;
 * }
 * 
 * .negative {
 *   color: red;
 * }
 * 
 * .status {
 *   padding: 0.25rem 0.5rem;
 *   border-radius: 4px;
 *   font-size: 0.875rem;
 * }
 * 
 * .status.completed {
 *   background: #d4edda;
 *   color: #155724;
 * }
 * 
 * .status.pending {
 *   background: #fff3cd;
 *   color: #856404;
 * }
 */

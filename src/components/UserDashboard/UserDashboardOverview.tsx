/**
 * UserDashboardOverview Component
 * 
 * This component demonstrates using the user_overview view to power
 * the existing dashboard components. It fetches data once and passes
 * it down to child components.
 */

import { useUserOverview } from '../../hooks/useUserOverview';
import { transformOverviewToEntries } from '../../services/userOverviewService';
import { useAuthUser } from '../../contexts/AuthContext';
import Loader from '../Loader';
import UserMiniProfile from './UserMiniProfile';
import BalanceHealthIndicator from './BalanceHealthIndicator';

/**
 * Wrapper component that fetches user overview data and provides it to dashboard tabs
 * 
 * Usage: Replace the data fetching in individual components with this centralized approach
 */
export default function UserDashboardOverview() {
  const { canonicalUserId } = useAuthUser();
  
  // Fetch all user data with a single query
  const {
    overview,
    loading,
    error,
    entries,
    balances,
    counts,
    refetch
  } = useUserOverview(canonicalUserId, {
    autoFetch: true,
    refreshInterval: 30000 // Refresh every 30 seconds
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-4">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p className="font-bold">Error Loading Dashboard</p>
          <p>{error.message}</p>
          <button 
            onClick={refetch}
            className="mt-2 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Transform overview data to format expected by existing components
  const transformedEntries = transformOverviewToEntries(overview);

  // Extract USDC and BONUS balances
  const usdcBalance = balances.USDC?.available || 0;
  const bonusBalance = balances.BONUS?.available || 0;
  const totalBalance = usdcBalance + bonusBalance;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Dashboard stats summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[#151515] rounded-lg p-6">
          <h3 className="text-sm text-gray-400 mb-2">Total Entries</h3>
          <p className="text-3xl font-bold text-white">{counts.entries}</p>
        </div>
        
        <div className="bg-[#151515] rounded-lg p-6">
          <h3 className="text-sm text-gray-400 mb-2">Total Tickets</h3>
          <p className="text-3xl font-bold text-white">{counts.tickets}</p>
        </div>
        
        <div className="bg-[#151515] rounded-lg p-6">
          <h3 className="text-sm text-gray-400 mb-2">Wallet Balance</h3>
          <p className="text-3xl font-bold text-white">${totalBalance.toFixed(2)}</p>
          <div className="text-xs text-gray-400 mt-1">
            <span>USDC: ${usdcBalance.toFixed(2)}</span>
            {bonusBalance > 0 && (
              <span className="ml-2">BONUS: ${bonusBalance.toFixed(2)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Pass data to child components */}
      <div className="space-y-6">
        {/* Example: You can pass overview data to child components */}
        <UserMiniProfile userOverview={overview} />
        
        <BalanceHealthIndicator 
          balance={totalBalance}
          usdcBalance={usdcBalance}
          bonusBalance={bonusBalance}
        />

        {/* Entries section with transformed data */}
        <div className="bg-[#151515] rounded-lg p-6">
          <h2 className="text-2xl font-bold text-white mb-4">My Entries</h2>
          {transformedEntries.length === 0 ? (
            <p className="text-gray-400">No entries yet. Join a competition to get started!</p>
          ) : (
            <div className="space-y-4">
              {transformedEntries.slice(0, 5).map(entry => (
                <div 
                  key={entry.id} 
                  className="bg-[#202020] rounded-lg p-4 hover:bg-[#2a2a2a] transition-colors"
                >
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {entry.title}
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Tickets:</span>
                      <span className="text-white ml-2">{entry.number_of_tickets}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Amount:</span>
                      <span className="text-white ml-2">${entry.amount_spent.toFixed(2)}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-400">Numbers:</span>
                      <span className="text-white ml-2">{entry.ticket_numbers}</span>
                    </div>
                  </div>
                </div>
              ))}
              
              {transformedEntries.length > 5 && (
                <p className="text-gray-400 text-sm text-center mt-4">
                  Showing 5 of {transformedEntries.length} entries
                </p>
              )}
            </div>
          )}
        </div>

        {/* Refresh indicator */}
        <div className="text-center text-sm text-gray-400">
          <p>Data refreshes automatically every 30 seconds</p>
          <button 
            onClick={refetch}
            className="text-[#DDE404] hover:text-[#c5cc04] mt-2"
          >
            Refresh Now
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Integration Notes:
 * 
 * 1. This component fetches all user data once using useUserOverview
 * 2. Data is transformed to match existing component expectations
 * 3. Child components receive pre-fetched data as props
 * 4. Auto-refresh keeps data current without manual polling
 * 
 * To integrate into the main dashboard:
 * 
 * 1. Import this component in your main dashboard route
 * 2. Replace individual data fetching in child components with props
 * 3. Pass overview data down the component tree
 * 4. Gradually migrate components to use the overview structure
 * 
 * Example migration:
 * 
 * Before:
 * function MyComponent() {
 *   const [entries, setEntries] = useState([]);
 *   useEffect(() => {
 *     fetchUserEntries().then(setEntries);
 *   }, []);
 *   return <div>{entries.map(...)}</div>;
 * }
 * 
 * After:
 * function MyComponent({ userOverview }) {
 *   const entries = transformOverviewToEntries(userOverview);
 *   return <div>{entries.map(...)}</div>;
 * }
 */

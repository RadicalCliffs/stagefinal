import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { trackPageView } from '../lib/analytics';

/**
 * Custom hook to track page views automatically when the route changes
 * 
 * Usage: Call this hook once in your main App component
 * 
 * @example
 * function App() {
 *   usePageTracking();
 *   return <div>...</div>
 * }
 */
export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    // Track page view when location changes
    trackPageView(location.pathname + location.search);
  }, [location]);
}

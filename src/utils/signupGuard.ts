/**
 * Signup Guard Utility
 * 
 * CRITICAL: This module prevents race conditions in the signup flow by coordinating
 * between localStorage/sessionStorage to ensure pendingSignupData is always respected.
 * 
 * WHY THIS EXISTS:
 * - User fills out signup form → stores pendingSignupData
 * - User creates Base wallet → CDP triggers user creation
 * - RACE CONDITION: Other code paths (create-charge, user-auth) may create user
 *   with random username BEFORE pendingSignupData is consumed
 * 
 * This guard ensures NO user is created with a random username when signup data exists.
 */

export interface PendingSignupData {
  profileData: {
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
    country?: string;
    telegram?: string;
    avatar?: string;
  };
  isReturningUser?: boolean;
  returningUserWalletAddress?: string;
  timestamp: number;
}

/**
 * Helper functions to check storage availability
 * Prevents repeated typeof checks throughout the code
 */
function isLocalStorageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

function isSessionStorageAvailable(): boolean {
  return typeof sessionStorage !== 'undefined';
}

/**
 * Check if a signup flow is currently in progress
 * Returns the pending signup data if found, null otherwise
 */
export function getSignupInProgress(): PendingSignupData | null {
  try {
    // Check both localStorage and sessionStorage for maximum reliability
    const localData = isLocalStorageAvailable() ? localStorage.getItem('pendingSignupData') : null;
    const sessionData = isSessionStorageAvailable() ? sessionStorage.getItem('pendingSignupData') : null;
    const signupFlag = isLocalStorageAvailable() ? localStorage.getItem('signupInProgress') : null;
    
    const dataStr = localData || sessionData;
    
    if (dataStr) {
      const data = JSON.parse(dataStr) as PendingSignupData;
      
      // Validate the data has required fields
      if (data.profileData?.username && data.profileData?.email) {
        console.log('[SignupGuard] Signup in progress detected:', {
          username: data.profileData.username,
          email: data.profileData.email,
          timestamp: data.timestamp,
          age: Date.now() - data.timestamp,
        });
        return data;
      }
    }
    
    // Also check the explicit flag
    if (signupFlag === 'true') {
      console.log('[SignupGuard] Signup flag is set, but no valid data found');
      // Clear stale flag
      if (isLocalStorageAvailable()) localStorage.removeItem('signupInProgress');
      if (isSessionStorageAvailable()) sessionStorage.removeItem('signupInProgress');
    }
  } catch (e) {
    console.error('[SignupGuard] Error checking signup status:', e);
  }
  
  return null;
}

/**
 * Clear all signup-related data from storage
 * Call this after successful user creation
 */
export function clearSignupData(): void {
  try {
    if (isLocalStorageAvailable()) {
      localStorage.removeItem('pendingSignupData');
      localStorage.removeItem('signupInProgress');
    }
    if (isSessionStorageAvailable()) {
      sessionStorage.removeItem('pendingSignupData');
      sessionStorage.removeItem('signupInProgress');
    }
    console.log('[SignupGuard] Cleared all signup data');
  } catch (e) {
    console.error('[SignupGuard] Error clearing signup data:', e);
  }
}

/**
 * Store signup data in both localStorage and sessionStorage
 * This ensures maximum reliability across different execution contexts
 */
export function setSignupData(data: PendingSignupData): void {
  try {
    const dataStr = JSON.stringify(data);
    if (isLocalStorageAvailable()) {
      localStorage.setItem('pendingSignupData', dataStr);
      localStorage.setItem('signupInProgress', 'true');
    }
    if (isSessionStorageAvailable()) {
      sessionStorage.setItem('pendingSignupData', dataStr);
      sessionStorage.setItem('signupInProgress', 'true');
    }
    console.log('[SignupGuard] Set signup data:', {
      username: data.profileData.username,
      email: data.profileData.email,
    });
  } catch (e) {
    console.error('[SignupGuard] Error setting signup data:', e);
  }
}

/**
 * Check if user creation should be blocked due to signup in progress
 * Returns true if user creation should be blocked
 */
export function shouldBlockUserCreation(): boolean {
  const signupData = getSignupInProgress();
  if (signupData) {
    console.log('[SignupGuard] BLOCKING user creation - signup in progress');
    return true;
  }
  return false;
}

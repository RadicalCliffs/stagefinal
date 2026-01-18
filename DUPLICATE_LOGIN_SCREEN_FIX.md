# Duplicate Login Screen Fix

## Problem

The authentication flow was showing duplicate wallet connection screens:

1. **NewAuthModal** (Step 3) - "Connect your wallet" screen with:
   - Title: "Connect your wallet"
   - Subtitle: "Login with your existing Base wallet" / "Connect an existing wallet or create a new one in seconds."
   - Two buttons: "Connect an existing Base wallet" (blue) and "Create a free Base wallet" (yellow)
   - Coinbase wallet infrastructure messaging

2. **BaseWalletAuthModal** (Immediately after) - Nearly identical "wallet-choice" screen with:
   - Title: "Connect your wallet" / "Sign in with your wallet"
   - Subtitle: "Signup with an existing Base wallet"
   - Same two buttons and messaging
   - Same Coinbase wallet infrastructure text

This caused users to see essentially the same screen twice in succession, creating confusion and a poor user experience.

## Solution

Removed the intermediate wallet connection screen from `NewAuthModal.tsx` and streamlined the flow to open `BaseWalletAuthModal` directly after email verification. This eliminates the duplicate screen while preserving all functionality.

### Changes Made

1. **Removed unused imports and hooks from NewAuthModal**:
   - Removed CDP wallet hooks (`useCurrentUser`, `useEvmAddress`, `useIsSignedIn`)
   - Removed Wagmi wallet hooks (`useAccount`, `useDisconnect`, `useConnect`)
   - Removed `toPrizePid` utility import (now handled only in BaseWalletAuthModal)

2. **Removed wallet-related state**:
   - Removed `walletProcessing` state
   - Removed `returningUserWalletAddress` state
   - Removed `effectiveWalletAddress` computed value

3. **Removed wallet connection logic**:
   - Removed `handleWalletConnected()` function (now handled in BaseWalletAuthModal)
   - Removed wallet auto-advance useEffect
   - Removed wallet connection reset logic

4. **Updated authentication flow**:
   - Modified `handleOTPVerify()` to directly open BaseWalletAuthModal after successful email verification
   - Modified `handleUsernameSubmit()` for returning users to directly open BaseWalletAuthModal
   - Both now save profile data to localStorage and dispatch `open-base-wallet-auth` event

5. **Removed duplicate UI**:
   - Removed 'wallet' case from renderStep() switch statement
   - Removed 'returning-user-wallet' case from renderStep() switch statement
   - Removed 'wallet' and 'returning-user-wallet' from AuthStep type definition

## New Flow

### For New Users:
1. Enter username → Profile creation → Email entry → Email OTP verification
2. **NewAuthModal closes, BaseWalletAuthModal opens directly** ✅
3. Choose wallet option (connect existing or create new)
4. Complete authentication

### For Returning Users with Wallet:
1. Enter username → Username recognized
2. **NewAuthModal closes, BaseWalletAuthModal opens directly** ✅
3. Connect with existing wallet
4. Complete authentication

### For Returning Users without Wallet:
1. Enter username → Profile update if needed → Email OTP verification
2. **NewAuthModal closes, BaseWalletAuthModal opens directly** ✅
3. Choose wallet option
4. Complete authentication

## Benefits

- ✅ Removes confusing duplicate screen
- ✅ Cleaner, more streamlined user experience
- ✅ Reduced code complexity (removed ~430 lines from NewAuthModal)
- ✅ Smaller bundle size for NewAuthModal component
- ✅ All functionality preserved - wallet connection still works correctly
- ✅ BaseWalletAuthModal remains the single source of truth for wallet operations

## Testing Recommendations

1. **New user signup**: Verify email OTP → directly to wallet choice screen
2. **Returning user with wallet**: Verify username → directly to wallet connection
3. **Returning user without wallet**: Verify email OTP → directly to wallet choice
4. **Create new wallet flow**: Verify CDP email wallet creation works
5. **Connect existing wallet flow**: Verify external wallet connection works
6. **Success screen**: Verify auth completion and redirect work correctly

## Files Modified

- `/src/components/NewAuthModal.tsx` - Removed duplicate wallet step and related logic

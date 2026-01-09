# Simplified Authentication Flow

## Overview
The authentication flow has been simplified to use CDP's built-in email verification instead of custom Supabase edge functions.

## Problem Fixed
- **Previous Issue**: The modal attempted custom email verification via Supabase edge functions (`email-auth-start`, `email-auth-verify`) BEFORE showing the CDP `SignIn` component
- **Root Cause**: The CDP `SignIn` component on the wallet-detection screen returned `null` and never displayed its UI
- **Impact**: Users saw "add email methods" error instead of the CDP email input

## Solution
Removed custom email verification and show CDP `SignIn` component directly, which handles:
- Email input
- OTP code generation and sending
- OTP verification
- Wallet creation

## New Flow States

### 1. `cdp-signin` (Screen 1)
**Purpose**: Initial authentication screen
**UI**: Shows CDP `SignIn` component directly
**CDP Handles**:
- Email input form
- Email validation
- OTP sending
- OTP verification
- Wallet creation

**Transition**: After CDP auth succeeds → Check if profile completion needed
- If existing user with profile → `logged-in-success`
- If new user or incomplete profile → `profile-completion`

### 2. `profile-completion` (Screen 2)
**Purpose**: Collect user profile for first-time users
**When Shown**: Only for new users or users without complete profile
**Fields**:
- Username (required)
- Full Name (required)
- Country (required)
- Mobile (optional)
- Social Profiles (optional)

**Transition**: After profile completion → `logged-in-success`

### 3. `wallet-choice` (Screen 3)
**Purpose**: Allow connection of external wallets (Base App, Coinbase Wallet)
**When Shown**: User clicks "Or connect existing wallet" from cdp-signin screen
**Options**:
- Use Base App (recommended)
- Use existing Base wallet
- Create free Prize wallet (if no wallet detected)

**Transition**: After wallet connection → `logged-in-success`

### 4. `logged-in-success` (Screen 4)
**Purpose**: Show success and final authentication
**Displays**:
- Wallet address
- Account email (if available)
- "Start Entering Competitions" button
- BaseScan link

**Action**: User clicks "Start Entering Competitions" → Dispatch auth-complete event → Close modal

## Removed Components

### Removed Flow States
- `login-signup` - Custom email input screen (replaced by CDP SignIn)
- `email-verification` - Custom OTP verification screen (replaced by CDP SignIn)
- `returning-user-wallet` - Returning user screen (CDP handles this)
- `wallet-unavailable` - Wallet unavailable screen (CDP handles this)
- `wallet-detection` - Hidden wallet detection screen (CDP handles this)
- `signature-confirm` - Signature confirmation (CDP handles this internally)

### Removed State Variables
- `emailInput` - Email input value (CDP SignIn handles this)
- `otpCode` - OTP code input value (CDP SignIn handles this)
- `otpSessionId` - OTP session ID (CDP SignIn handles this)
- `otpError` - OTP error message (CDP SignIn handles this)
- `isCheckingEmail` - Email checking loading state (CDP SignIn handles this)
- `isLoading` - Generic loading state (CDP SignIn handles this)
- `returningUserWalletAddress` - Returning user wallet (CDP handles this)
- `isReturningUser` - Returning user flag (CDP handles this)
- `walletDetectedRef` - Wallet detection ref (not needed)
- `sessionClearedRef` - Session cleared ref (not needed)

### Removed Functions
- `handleContinueWithEmail()` - Custom email submission
- `handleVerifyOTP()` - Custom OTP verification
- `handleContinueWithBaseWallet()` - Continue with existing wallet
- `handleRetryConnectWallet()` - Retry wallet connection
- `handleCreateNewAccount()` - Create new account for returning users
- `handleCreatePrizeWallet()` - Trigger wallet creation

### Removed Supabase Edge Function Calls
- `${SUPABASE_URL}/functions/v1/email-auth-start` - Send OTP email
- `${SUPABASE_URL}/functions/v1/email-auth-verify` - Verify OTP code

## Key Benefits

1. **Simpler Flow**: 4 states instead of 9
2. **Less Code**: ~510 lines removed, ~130 lines added (net -380 lines)
3. **Built-in Security**: CDP handles all email verification securely
4. **Better UX**: Users see familiar CDP email/OTP UI
5. **Less Maintenance**: No custom edge functions to maintain
6. **Works with Existing Users**: Two existing users (lukejewitt@gmail.com, maxmatthews1@gmail.com) already created via CDP will continue to work

## Testing Checklist

- [ ] New user can sign up with email
- [ ] CDP email verification works
- [ ] Profile completion shows for new users
- [ ] Existing users skip profile completion
- [ ] External wallet connection works
- [ ] Success screen displays correctly
- [ ] Auth-complete event fires
- [ ] Modal closes after authentication
- [ ] Existing users can still log in

## Reference Implementation

The working pattern is from `BaseWalletAuthModal_OLD.tsx`:

```tsx
<SignIn onSuccess={handleSignInSuccess}>
  {(state: SignInState) => {
    if (state.error) {
      // Handle specific error cases
      return <ErrorUI />;
    }
    return null; // Let SignIn render its default UI
  }}
</SignIn>
```

When the child function returns `null`, the `SignIn` component shows its default UI which includes:
- Email input field
- Email validation
- OTP sending
- OTP input field
- OTP verification
- Error handling

# Authentication Flow Documentation

## Overview
This document describes the redesigned login/authentication flow for ThePrize.io, implementing a 9-screen journey aligned with the specification.

## Flow Architecture

### Screen 1: Login / Sign Up (Entry Point)
**Component State:** `flowState === 'login-signup'`

**Purpose:** Email-first identity collection

**UI Elements:**
- Title: "Log in or create an account"
- Body: "Enter your email address to continue."
- Input: Email address field
- Primary CTA: "Continue" button
- Micro-copy: "We'll send you a one-time code to verify your email."

**Logic:**
1. User enters email address
2. Email validation (regex check)
3. Check if user exists in database via `checkExistingUser()`
4. If existing user with wallet → Route to Screen 3A (Returning User)
5. If new user or existing without wallet → Send OTP and route to Screen 2

---

### Screen 2: Email Verification (OTP)
**Component State:** `flowState === 'email-verification'`

**Purpose:** Verify email ownership via one-time password

**UI Elements:**
- Title: "Verify your email"
- Body: "Enter the code we've sent to your email address."
- Display: User's email address
- Input: 6-digit code field
- Primary CTA: "Verify & continue" button
- Micro-copy: "This is only required on your first login or when using a new device."

**Logic:**
1. User enters 6-digit OTP code
2. Submit to `/functions/v1/email-auth-verify` endpoint
3. On success, check if user has completed profile
4. If profile complete → Route to Screen 5 (Wallet Detection)
5. If profile incomplete → Route to Screen 4 (Profile Completion)

---

### Screen 3A: Returning User - Active Wallet Available
**Component State:** `flowState === 'returning-user-wallet'`

**Purpose:** Allow returning users to continue with their existing wallet

**UI Elements:**
- Title: "Continue with your wallet"
- Visual: Wallet address display (shortened, e.g., 0xA3f...9C21)
- Label: "Active wallet"
- Body: "To access your account, please continue using your Base wallet."
- Primary CTA: "Continue with Base wallet" button
- Micro-copy: "This is the wallet you used last time."
- Link: "Can't access this wallet?" → Screen 3B

**Logic:**
1. Display user's stored wallet address
2. On "Continue" → Trigger CDP sign-in flow
3. Route to Screen 5 (Wallet Detection)

---

### Screen 3B: Wallet Not Available
**Component State:** `flowState === 'wallet-unavailable'`

**Purpose:** Handle case where returning user cannot access their wallet

**UI Elements:**
- Title: "Wallet not available"
- Body: "Your account uses a different wallet. To continue, please log in the same way you did last time."
- Primary CTA: "Retry connecting wallet" → Screen 6
- Secondary CTA (destructive): "Create new account" → Screen 4
- Warning copy: "Creating a new account will not include your previous balance or entries."

**Logic:**
1. Retry → Route to Screen 6 (Wallet Choice)
2. Create New → Reset user state, route to Screen 4 (Profile Completion)

---

### Screen 4: Profile Completion (First-Time Users Only)
**Component State:** `flowState === 'profile-completion'`

**Purpose:** Collect user profile information

**When Shown:** Only if email does not have a completed Prize account

**UI Elements:**
- Title: "Complete your profile"
- Body: "Set up your account so you're ready to enter competitions."
- Fields (Required marked with *):
  - Username *
  - Full Name *
  - Country (dropdown) *
  - Avatar (optional)
  - Mobile Number (optional)
  - Social Profiles (optional)
- Primary CTA: "Continue" button
- Micro-copy: "Your email will be saved as your account login."

**Logic:**
1. Validate required fields (username, full name, country)
2. Check username uniqueness in database
3. Store profile data in state
4. Route to Screen 5 (Wallet Detection)

**Database Fields:**
- `username` → canonical_users.username
- `fullName` → canonical_users.first_name + last_name (split)
- `country` → canonical_users.country
- `mobile` → canonical_users.telephone_number
- `socialProfiles` → canonical_users.telegram_handle

---

### Screen 5: Wallet Detection (Read-Only)
**Component State:** `flowState === 'wallet-detection'`

**Purpose:** Check device for compatible Base wallets

**UI Elements:**
- Title: "Checking for wallets"
- Body: "We're checking your device for compatible Base wallets."
- Visual: Loading spinner
- Micro-copy: "No wallets will be connected automatically."
- Link: "Or choose wallet manually →" → Screen 6

**Logic:**
1. Display loading state
2. Initialize CDP SignIn component (hidden)
3. Wait for wallet detection or user manual choice
4. If CDP wallet created → Save to database and route to Screen 9
5. If timeout/no detection → Route to Screen 6

---

### Screen 6: Explicit Wallet Choice (First-Time Users)
**Component State:** `flowState === 'wallet-choice'`

**Purpose:** Let users choose wallet type

**UI Elements:**
- Title: "Choose how you want to use ThePrize"
- Body: "This wallet will be used to sign in, enter competitions, and receive tickets."

**Option 1: Use my Base App (Recommended)**
- Visual: Base App logo
- Sub-copy: "Fastest option. Connect your Base app to continue."
- Action: OnchainKit ConnectWallet component
- Conditional: "Download Base App" link (new tab, non-blocking)
- Rule: Hide download link if Base App detected

**Option 2: Use an existing Base wallet**
- Sub-copy: "Connect another wallet that supports the Base network."
- Action: OnchainKit ConnectWallet component (different connector)

**Option 3: Create a free Prize wallet (Conditional)**
- Shown only if: No Base wallet detected
- Sub-copy: "No Base wallet found. We'll create one for you automatically."
- Action: Route to Screen 5 (Wallet Detection with CDP wallet creation)

**Logic:**
1. User selects option
2. Base App/Existing Wallet → Trigger wagmi connection
3. Create Prize Wallet → Route back to Screen 5 with CDP wallet creation
4. On wallet connection → Save to database and route to Screen 9

---

### Screen 7: Network Enforcement (Conditional)
**Note:** This is handled by the existing `EnsureBaseChain` component and is not directly part of the modal flow.

**Purpose:** Ensure user is on Base network

**UI Elements:**
- Title: "Wrong network detected"
- Body: "ThePrize only works on the Base network."
- Primary CTA: "Switch to Base network"

---

### Screen 8: Signature & Login (All Users)
**Note:** This is handled internally by CDP SignIn component and is not a separate screen in the modal.

**Purpose:** Sign message to confirm wallet ownership

**UI Elements:**
- Title: "Confirm connection"
- Body: "Sign a message to confirm your wallet and finish logging in."
- Primary CTA: "Sign & continue"
- Micro-copy: "This does not trigger a transaction or cost gas."

---

### Screen 9: Logged In (Success)
**Component State:** `flowState === 'logged-in-success'`

**Purpose:** Confirm successful login and provide next steps

**UI Elements:**
- Title: "You're live."
- Body: "The Platform Players Trust."
- Display: Wallet address with copy button
- Display: Account email (if provided)
- Info: Instructions for accessing wallet via Base app
- Primary CTA: "Start Entering Competitions" button
- Link: View on BaseScan (external)

**Logic:**
1. Display success state with wallet/email information
2. On "Start Entering Competitions" → Store wallet in localStorage
3. Dispatch `auth-complete` event to notify AuthContext
4. Close modal
5. User is now authenticated and can access the platform

---

## Technical Implementation

### State Management
- `flowState`: Controls which screen is displayed
- `userEmail`: Stores verified email address
- `profileData`: Stores profile completion data
- `returningUserWalletAddress`: Stores wallet address for returning users
- `otpSessionId`: Tracks email verification session

### Database Integration
- **checkExistingUser()**: Queries `canonical_users` table for existing accounts
- **saveWalletOnlyUser()**: Creates/updates user with wallet address only
- **saveUserWithProfile()**: Creates/updates user with complete profile data

### CDP Integration
- Uses `@coinbase/cdp-react` SignIn component for wallet creation
- Integrates with `@coinbase/cdp-hooks` for auth state
- Wallet addresses stored in `cdp:wallet_address` localStorage key

### Wagmi Integration
- Uses `wagmi` hooks for external wallet connections (Base App, Coinbase Wallet)
- OnchainKit ConnectWallet component for Base-specific UI
- Smart wallet preference ensures Base/Coinbase Smart Wallet connections

### Event System
- Dispatches `auth-complete` event when authentication finishes
- AuthContext listens for this event to refresh user data
- Ensures immediate UI updates across the application

---

## User Flows

### New User Flow
1. Screen 1: Enter email
2. Screen 2: Verify OTP
3. Screen 4: Complete profile
4. Screen 5: Wallet detection
5. Screen 6: Choose wallet type
6. Screen 9: Success

### Returning User Flow (Wallet Available)
1. Screen 1: Enter email
2. Screen 3A: Continue with existing wallet
3. Screen 5: Wallet detection (CDP sign-in)
4. Screen 9: Success

### Returning User Flow (Wallet Unavailable)
1. Screen 1: Enter email
2. Screen 3A: See wallet not available
3. Screen 3B: Choose retry or create new
4. (Continue based on choice)

---

## Security Considerations

1. **Treasury Address Validation**: `validateNotTreasuryAddress()` prevents treasury wallet from being used as user wallet
2. **Email Verification**: OTP system ensures email ownership
3. **Unique Usernames**: Database check prevents duplicate usernames
4. **Canonical User IDs**: All users get `prize:pid:` format IDs for consistency
5. **No Silent Wallet Switching**: Users explicitly choose wallet, no auto-switching

---

## Styling

### Colors
- Primary Blue: `#0052FF` (Base brand color)
- Primary Yellow: `#DDE404` (ThePrize accent color)
- Background: `#101010` (dark modal background)
- Borders: `white/10` (subtle borders)

### Typography
- Font sizes follow existing patterns
- Bold for headings and CTAs
- Regular for body text
- Monospace for wallet addresses

### Spacing
- Consistent padding: `p-6` for modal
- Gap between elements: `mb-4`, `mb-6` for sections
- Full width buttons: `w-full`

---

## Testing Checklist

- [ ] Email validation works correctly
- [ ] OTP verification succeeds with valid code
- [ ] OTP verification fails with invalid code
- [ ] Profile completion validates required fields
- [ ] Username uniqueness check works
- [ ] Returning user detection works
- [ ] Wallet address display is correct
- [ ] Copy to clipboard works
- [ ] CDP wallet creation succeeds
- [ ] External wallet connection (Base App) works
- [ ] Auth-complete event dispatches correctly
- [ ] AuthContext refreshes after authentication
- [ ] Modal closes after successful authentication
- [ ] Mobile responsiveness works
- [ ] All micro-copy matches specification
- [ ] Branding is consistent throughout

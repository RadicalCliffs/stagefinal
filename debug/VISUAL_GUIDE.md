# Visual Guide - Auth Flow Changes

## Overview
This document provides a visual walkthrough of the changes made to the authentication flow.

---

## Screen 1: NewAuthModal - Wallet Step (Returning Users)

### Before
```
┌─────────────────────────────────────────┐
│              Connect your wallet        │
│                                         │
│  Connect an existing wallet or create  │
│  a new one in seconds.                 │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  [SINGLE CARD]                  │  │
│  │  Connect or Create Wallet       │  │
│  │  [Continue with Wallet] (blue)  │  │
│  └─────────────────────────────────┘  │
│                                         │
│  Powered by Coinbase                   │
└─────────────────────────────────────────┘
```

### After (Returning Users)
```
┌─────────────────────────────────────────┐
│              Connect your wallet        │
│                                         │
│  Login with your existing Base wallet  │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [Connect an existing Base wallet]│ │
│  │            (BLUE BUTTON)          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Welcome back to theprize.io           │
│                                         │
│  ──────────── OR ────────────          │
│                                         │
│  Don't have access to that account?    │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [CREATE A FREE BASE WALLET]     │ │
│  │           (YELLOW BUTTON)         │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Powered by Coinbase                   │
│  Secure wallet infrastructure...       │
│  We never store your private keys...   │
└─────────────────────────────────────────┘
```

### After (New Users)
```
┌─────────────────────────────────────────┐
│              Connect your wallet        │
│                                         │
│  Connect an existing wallet or create  │
│  a new one in seconds.                 │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [Connect an existing Base wallet]│ │
│  │            (BLUE BUTTON)          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  If you have MetaMask, Coinbase        │
│  Wallet, Base, or another supported    │
│  wallet installed, it will be          │
│  detected automatically...             │
│                                         │
│  ──────────── OR ────────────          │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [Create a free Base wallet]     │ │
│  │           (YELLOW BUTTON)         │ │
│  └───────────────────────────────────┘ │
│                                         │
│  No wallet yet? Create one now...      │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Powered by Coinbase                   │
│  Secure wallet infrastructure...       │
│  We never store your private keys...   │
└─────────────────────────────────────────┘
```

---

## Screen 2: BaseWalletAuthModal - CDP Sign-in

### Before
```
┌─────────────────────────────────────────┐
│              🔵 [Wallet Icon]          │
│                                         │
│      Log in or create an account       │
│                                         │
│  Enter your email address to continue. │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  [CDP SignIn Component]         │  │
│  │  Email input field              │  │
│  └─────────────────────────────────┘  │
│                                         │
│  We'll send you a one-time code to     │
│  verify your email.                    │
│                                         │
│  Or connect existing wallet →          │
└─────────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────────┐
│              🔵 [Wallet Icon]          │
│                                         │
│           Create an account            │
│                                         │
│  Enter your email address to continue, │
│  Base will send you an OTP to verify   │
│  your registration:                    │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  [CDP SignIn Component]         │  │
│  │  Email input field              │  │
│  └─────────────────────────────────┘  │
│                                         │
│  Base will send you a one-time code    │
│  to verify your registration.          │
│                                         │
│  (realized you've already got a Base   │
│  wallet? No problems, click here to    │
│  connect that instead→)                │
└─────────────────────────────────────────┘
```

---

## Screen 3: BaseWalletAuthModal - Wallet Choice

### Before (Complex 3-Card Layout)
```
┌─────────────────────────────────────────┐
│  Choose how you want to use ThePrize   │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  📱 Use my Base App             │  │
│  │  [Recommended]                  │  │
│  │  Fastest option...              │  │
│  │  [Connect Base Wallet]          │  │
│  │  Download Base App              │  │
│  └─────────────────────────────────┘  │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  🦊 Connect MetaMask            │  │
│  │  Use your existing MetaMask...  │  │
│  │  [Connect MetaMask]             │  │
│  └─────────────────────────────────┘  │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  🛡️ Create a free Prize wallet  │  │
│  │  No Base wallet found...        │  │
│  │  [Create wallet]                │  │
│  └─────────────────────────────────┘  │
│                                         │
│  ← Back to sign in                     │
└─────────────────────────────────────────┘
```

### After (Simple 2-Button Layout - New Users)
```
┌─────────────────────────────────────────┐
│              🔵 [Wallet Icon]          │
│                                         │
│           Connect your wallet          │
│                                         │
│  Signup with an existing Base wallet   │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [Connect an existing Base wallet]│ │
│  │            (BLUE BUTTON)          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  If you have MetaMask, Coinbase        │
│  Wallet, Base, or another supported    │
│  wallet installed, it will be          │
│  detected automatically...             │
│                                         │
│  ──────────── OR ────────────          │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [CREATE A FREE BASE WALLET]     │ │
│  │           (YELLOW BUTTON)         │ │
│  └───────────────────────────────────┘ │
│                                         │
│  No wallet yet? Create one now...      │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Powered by Coinbase                   │
│  Secure wallet infrastructure...       │
│  We never store your private keys...   │
└─────────────────────────────────────────┘
```

### After (Simple 2-Button Layout - Returning Users)
```
┌─────────────────────────────────────────┐
│              🔵 [Wallet Icon]          │
│                                         │
│           Connect your wallet          │
│                                         │
│  Login with your existing Base wallet  │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [Connect an existing Base wallet]│ │
│  │            (BLUE BUTTON)          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Base, Coinbase, Metamask, Phantom,    │
│  Rainbow, theprize.io supports many    │
│  of the major wallet providers...      │
│                                         │
│  ──────────── OR ────────────          │
│                                         │
│  Decided you would rather a free Base  │
│  native wallet instead? Click below... │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [CREATE A FREE BASE WALLET]     │ │
│  │           (YELLOW BUTTON)         │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Powered by Coinbase                   │
│  Secure wallet infrastructure...       │
│  We never store your private keys...   │
└─────────────────────────────────────────┘
```

---

## Flow Diagrams

### Returning User Flow

```
┌──────────────┐
│  Enter       │
│  Username    │
└──────┬───────┘
       │
       │ Username exists with wallet?
       │
       ▼
┌──────────────┐
│  Wallet      │  ← SKIP profile/email steps
│  Screen      │
│  (2 buttons) │
└──────┬───────┘
       │
       │ User clicks...
       │
       ├─────────────────┬──────────────────┐
       │                 │                  │
       ▼                 ▼                  ▼
  [Connect         [Create New]      [Already
   Existing]        CDP Wallet        Connected]
   (Blue)           (Yellow)
       │                 │                  │
       │                 │                  │
       ▼                 ▼                  ▼
   Wagmi           CDP Sign-in        Auto-advance
   Connector       Email OTP          to Success
       │                 │                  │
       │                 │                  │
       └─────────────────┴──────────────────┘
                         │
                         ▼
                   ┌──────────┐
                   │ Success  │
                   │ Screen   │
                   └──────────┘
```

### New User Flow

```
┌──────────────┐
│  Create      │
│  Account     │
│  (Profile)   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Email OTP   │
│  Verify      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Wallet      │
│  Screen      │
│  (2 buttons) │
└──────┬───────┘
       │
       │ User clicks...
       │
       ├─────────────────┬──────────────────┐
       │                 │                  │
       ▼                 ▼                  ▼
  [Connect         [Create New]      [Already
   Existing]        CDP Wallet        Connected]
   (Blue)           (Yellow)
       │                 │                  │
       │                 │                  │
       ▼                 ▼                  ▼
BaseWalletAuth     BaseWalletAuth     Auto-advance
wallet-choice      cdp-signin         to Success
       │                 │                  │
       │                 │                  │
       ▼                 ▼                  │
   Wagmi           CDP Email OTP           │
   Connector       (creates wallet)        │
       │                 │                  │
       │                 │                  │
       └─────────────────┴──────────────────┘
                         │
                         ▼
                   ┌──────────┐
                   │ Success  │
                   │ Screen   │
                   └──────────┘
```

---

## Button Color Legend

🔵 **Blue Buttons** - Primary Action
- "Connect an existing Base wallet"
- Opens wagmi universal wallet connector
- Supports MetaMask, Coinbase, Base, Phantom, Rainbow, etc.

🟡 **Yellow Buttons** - Secondary Action
- "CREATE A FREE BASE WALLET"
- Opens CDP email-based wallet creation flow
- Creates embedded Base wallet

---

## Key UI Improvements

### 1. Visual Hierarchy
- ✅ Clear primary action (blue)
- ✅ Clear secondary action (yellow)
- ✅ Proper spacing and dividers
- ✅ Context-aware helper text

### 2. Messaging Clarity
- ✅ Different text for returning vs new users
- ✅ Explains what each button does
- ✅ Security reassurance
- ✅ Coinbase branding

### 3. Reduced Complexity
- ✅ From 3 cards to 2 buttons
- ✅ Cleaner visual layout
- ✅ Less cognitive load
- ✅ Faster decision making

### 4. Better Flow
- ✅ Returning users skip redundant steps
- ✅ New users have clear options
- ✅ "Already have wallet?" link works
- ✅ No frozen states

---

## Data Flow

### User Data Preservation

```
Returning User Login:
┌─────────────────────────────────────────┐
│ canonical_users table                   │
├─────────────────────────────────────────┤
│ username: "johndoe"        ← PRESERVED  │
│ email: "john@example.com"  ← PRESERVED  │
│ first_name: "John"         ← PRESERVED  │
│ last_name: "Doe"           ← PRESERVED  │
│ country: "US"              ← PRESERVED  │
│ avatar_url: "..."          ← PRESERVED  │
├─────────────────────────────────────────┤
│ wallet_address: "0x..."    ← UPDATED    │
│ base_wallet_address: "0x.."← UPDATED    │
│ canonical_user_id: "..."   ← UPDATED    │
│ wallet_linked: true        ← UPDATED    │
└─────────────────────────────────────────┘
```

### Update Query (Safe)
```typescript
// Only updates wallet-related fields
await supabase
  .from('canonical_users')
  .update({
    canonical_user_id: canonicalUserId,
    wallet_address: walletAddress.toLowerCase(),
    base_wallet_address: walletAddress.toLowerCase(),
    eth_wallet_address: walletAddress.toLowerCase(),
    privy_user_id: walletAddress,
    wallet_linked: true,
    auth_provider: 'cdp',
  })
  .eq('id', existingUser.id);
```

---

## Testing Visual Checklist

### Screen Appearance
- [ ] Wallet screen shows 2 buttons (blue and yellow)
- [ ] Button colors are correct (blue for connect, yellow for create)
- [ ] Helper text is context-aware (different for returning vs new)
- [ ] "OR" divider is visible and styled correctly
- [ ] Coinbase branding footer is present and complete
- [ ] Security reassurance text is visible

### Interactions
- [ ] Blue button opens wagmi wallet connector
- [ ] Yellow button opens CDP email flow
- [ ] "Already have wallet?" link goes to wallet-choice
- [ ] Wallet connection shows success screen
- [ ] No frozen states during connection
- [ ] Modal closes properly after success

### Data Persistence
- [ ] Returning user data not overwritten
- [ ] Only wallet fields are updated
- [ ] Username, email, profile preserved
- [ ] New users created correctly
- [ ] Wallet linked to correct user

---

## Responsive Design

### Mobile View
```
┌────────────┐
│  Connect   │
│  your      │
│  wallet    │
│            │
│  Login     │
│  with...   │
│            │
│ ┌────────┐│
│ │Connect │││
│ │existing│││
│ │ (BLUE) │││
│ └────────┘│
│            │
│  Welcome   │
│  back...   │
│            │
│ ─── OR ────│
│            │
│ ┌────────┐│
│ │ CREATE │││
│ │ FREE   │││
│ │(YELLOW)│││
│ └────────┘│
│            │
│ Powered by │
│ Coinbase   │
└────────────┘
```

### Desktop View
- Buttons at comfortable width
- Proper spacing between elements
- Readable text size
- Clear visual hierarchy

---

## Conclusion

The visual changes provide:
- ✅ Clearer user interface
- ✅ Better visual hierarchy
- ✅ Context-aware messaging
- ✅ Reduced cognitive load
- ✅ Faster user decisions
- ✅ Professional appearance

All screens are now aligned with the requirements and provide a cohesive, user-friendly experience.

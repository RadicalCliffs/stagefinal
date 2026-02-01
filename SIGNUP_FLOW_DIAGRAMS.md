# Signup Flow Diagrams

## Before Fix: Race Condition Issue

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER SIGNUP FLOW                          │
└─────────────────────────────────────────────────────────────────┘

Step 1: User fills signup form
┌──────────────────┐
│  NewAuthModal    │
│  - Username      │
│  - Email OTP     │
│  - Profile data  │
└────────┬─────────┘
         │
         ▼
┌────────────────────────────┐
│ localStorage.setItem(      │
│   'pendingSignupData'      │
│ )                          │
└────────┬───────────────────┘
         │
         │
         ▼

Step 2: User proceeds to wallet auth
┌──────────────────────────┐
│  BaseWalletAuthModal     │
│  Opens CDP Sign In       │
└──────────┬───────────────┘
           │
           ├──────────────────────────────────────┐
           │                                      │
           ▼                                      ▼
    [TIMING WINDOW]                    [RACE CONDITION]
           │                                      │
    User authenticates                  Another process runs:
    with CDP/Base                       - create-charge
           │                            - user-auth.ts
           │                                      │
           ▼                                      ▼
                                        ┌────────────────────────┐
                                        │ User doesn't exist     │
                                        │ Create user with:      │
                                        │ user_19884279372  ❌   │
                                        └────────┬───────────────┘
           │                                     │
           ▼                                     │
┌──────────────────────────┐                    │
│ BaseWalletAuthModal      │◄───────────────────┘
│ Reads pendingSignupData  │
│ Tries to create user     │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ ERROR: User exists       │
│ with wrong username!  ❌ │
└──────────────────────────┘
```

## After Fix: Bulletproof Coordination

```
┌─────────────────────────────────────────────────────────────────┐
│                  FIXED SIGNUP FLOW                               │
└─────────────────────────────────────────────────────────────────┘

Step 1: User fills signup form
┌──────────────────┐
│  NewAuthModal    │
│  - Username      │
│  - Email OTP     │
│  - Profile data  │
└────────┬─────────┘
         │
         ▼
┌────────────────────────────────────────────┐
│ setSignupData() utility:                   │
│ ✓ localStorage.setItem('pendingSignupData')│
│ ✓ sessionStorage.setItem('pendingSignupData')│
│ ✓ localStorage.setItem('signupInProgress')│
│ ✓ sessionStorage.setItem('signupInProgress')│
└────────┬───────────────────────────────────┘
         │
         │
         ▼

Step 2: User proceeds to wallet auth
┌──────────────────────────┐
│  BaseWalletAuthModal     │
│  - Adds headers:         │
│    X-Signup-Username     │
│    X-Signup-Email        │
└──────────┬───────────────┘
           │
           ├──────────────────────────────────────┐
           │                                      │
           ▼                                      ▼
    User authenticates              [PROTECTED PATH]
    with CDP/Base                          │
           │                               ▼
           │                    ┌──────────────────────────┐
           │                    │ create-charge OR         │
           │                    │ user-auth.ts called      │
           │                    └──────────┬───────────────┘
           │                               │
           │                               ▼
           │                    ┌──────────────────────────┐
           │                    │ shouldBlockUserCreation()│
           │                    │ checks signup guard      │
           │                    └──────────┬───────────────┘
           │                               │
           │                               ▼
           │                    ┌──────────────────────────┐
           │                    │ Signup in progress! ✓    │
           │                    │ Block user creation      │
           │                    │ Return error             │
           │                    └──────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ BaseWalletAuthModal                  │
│ Reads pendingSignupData from:        │
│ ✓ localStorage OR sessionStorage     │
│ With retry logic (200ms × 3)         │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Creates user via upsert-user with:   │
│ ✓ Correct username from form         │
│ ✓ Wallet address                     │
│ ✓ All profile data                   │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ clearSignupData() utility:           │
│ ✓ Clears localStorage                │
│ ✓ Clears sessionStorage              │
│ ✓ Removes all flags                  │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ SUCCESS! User created with           │
│ correct username ✓                   │
└──────────────────────────────────────┘
```

## Key Improvements

### 1. Dual Storage
```
BEFORE: localStorage only
├─ Can be delayed
├─ Not visible in all contexts
└─ Race conditions possible

AFTER: localStorage + sessionStorage
├─ Redundant storage
├─ More reliable synchronization
├─ Explicit signup flag
└─ Maximum visibility
```

### 2. Centralized Guard
```
BEFORE: Manual checks scattered across code
├─ Inconsistent logic
├─ Easy to miss a path
└─ Hard to maintain

AFTER: signupGuard.ts utility
├─ Single source of truth
├─ Consistent validation
├─ Easy to test
└─ All paths protected
```

### 3. Protected Paths
```
BEFORE: Any path can create users
├─ create-charge: user_123456
├─ user-auth.ts: user_1738419282
└─ Race conditions everywhere

AFTER: All paths check signup guard
├─ create-charge: BLOCKS if signup in progress
├─ user-auth.ts: BLOCKS if signup in progress
└─ BaseWalletAuthModal: Creates with correct data
```

## Data Flow

### Signup Data Structure
```typescript
interface PendingSignupData {
  profileData: {
    username: string;      // User's chosen username
    email: string;         // Verified email
    firstName?: string;
    lastName?: string;
    country?: string;
    telegram?: string;
    avatar?: string;
  };
  isReturningUser?: boolean;
  returningUserWalletAddress?: string;
  timestamp: number;      // For cleanup/timeout
}
```

### Storage Locations
```
localStorage
├─ pendingSignupData: JSON string
└─ signupInProgress: "true"

sessionStorage
├─ pendingSignupData: JSON string
└─ signupInProgress: "true"

HTTP Headers (to edge functions)
├─ X-Signup-Username: string
└─ X-Signup-Email: string
```

## Edge Cases Handled

1. **Page Reload During Signup**
   - localStorage persists ✓
   - Flow continues correctly ✓

2. **Browser Crash During Signup**
   - localStorage persists ✓
   - User can resume ✓

3. **Network Error During Wallet Creation**
   - Fallback to direct Supabase call ✓
   - Still uses correct username ✓

4. **Concurrent Purchase Attempt**
   - create-charge blocks ✓
   - Returns clear error message ✓

5. **Multiple Tabs**
   - sessionStorage is tab-specific
   - Each tab manages its own flow
   - No interference ✓

6. **Stale Signup Data**
   - Timestamp included
   - Can implement cleanup if needed
   - Currently: explicit clearSignupData() ✓

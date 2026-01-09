# Authentication Flow Visual Guide

This document provides a visual description of each screen in the new authentication flow.

## Screen 1: Login / Sign Up
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │    [Wallet]     │              │
│         │   (Blue Icon)   │              │
│         └─────────────────┘              │
│                                          │
│     Log in or create an account          │
│                                          │
│   Enter your email address to continue.  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Email address                     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │        Continue    →               │  │
│  └────────────────────────────────────┘  │
│                                          │
│  We'll send you a one-time code to      │
│  verify your email.                     │
│                                          │
└─────────────────────────────────────────┘
```

## Screen 2: Email Verification
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │   [CheckMark]   │              │
│         │   (Blue Icon)   │              │
│         └─────────────────┘              │
│                                          │
│        Verify your email                 │
│                                          │
│   Enter the code we've sent to your     │
│   email address.                         │
│                                          │
│          user@example.com                │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │       1  2  3  4  5  6            │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      Verify & continue             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  This is only required on your first    │
│  login or when using a new device.      │
│                                          │
│         ← Back to email entry            │
│                                          │
└─────────────────────────────────────────┘
```

## Screen 3A: Returning User - Wallet Available
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │    [Wallet]     │              │
│         │   (Blue Icon)   │              │
│         └─────────────────┘              │
│                                          │
│      Continue with your wallet           │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Active wallet                     │  │
│  │  0xA3f...9C21                      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  To access your account, please continue │
│  using your Base wallet.                 │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │   Continue with Base wallet   →   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  This is the wallet you used last time.  │
│                                          │
│       Can't access this wallet?          │
│                                          │
└─────────────────────────────────────────┘
```

## Screen 3B: Wallet Not Available
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │   [Warning!]    │              │
│         │  (Orange Icon)  │              │
│         └─────────────────┘              │
│                                          │
│        Wallet not available              │
│                                          │
│  Your account uses a different wallet.   │
│  To continue, please log in the same     │
│  way you did last time.                  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │    Retry connecting wallet         │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │    Create new account (RED)        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ ⚠️  Creating a new account will    │  │
│  │ not include your previous balance  │  │
│  │ or entries.                        │  │
│  └────────────────────────────────────┘  │
│                                          │
└─────────────────────────────────────────┘
```

## Screen 4: Profile Completion
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │    [Wallet]     │              │
│         │   (Blue Icon)   │              │
│         └─────────────────┘              │
│                                          │
│      Complete your profile               │
│                                          │
│  Set up your account so you're ready to  │
│  enter competitions.                     │
│                                          │
│  Username *                              │
│  ┌────────────────────────────────────┐  │
│  │  your_username                     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Full Name *                             │
│  ┌────────────────────────────────────┐  │
│  │  John Doe                          │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Country *                               │
│  ┌────────────────────────────────────┐  │
│  │  [Select country ▼]                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Mobile Number (optional)                │
│  ┌────────────────────────────────────┐  │
│  │  +1 234 567 8900                   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Social Profiles (optional)              │
│  ┌────────────────────────────────────┐  │
│  │  Twitter/Telegram handle           │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │          Continue                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Your email will be saved as your        │
│  account login.                          │
│                                          │
└─────────────────────────────────────────┘
```

## Screen 5: Wallet Detection
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │   [Spinner]     │              │
│         │   (Animated)    │              │
│         └─────────────────┘              │
│                                          │
│       Checking for wallets               │
│                                          │
│  We're checking your device for          │
│  compatible Base wallets.                │
│                                          │
│  [CDP SignIn Component - Hidden]         │
│                                          │
│  No wallets will be connected            │
│  automatically.                          │
│                                          │
│     Or choose wallet manually →          │
│                                          │
└─────────────────────────────────────────┘
```

## Screen 6: Explicit Wallet Choice
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │    [Wallet]     │              │
│         │   (Blue Icon)   │              │
│         └─────────────────┘              │
│                                          │
│   Choose how you want to use ThePrize    │
│                                          │
│  This wallet will be used to sign in,    │
│  enter competitions, and receive tickets.│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ [📱] Use my Base App   RECOMMENDED │  │
│  │ Fastest option. Connect your Base  │  │
│  │ app to continue.                   │  │
│  │ [Connect Wallet Button]            │  │
│  │ Download Base App ↗                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ [💼] Use an existing Base wallet   │  │
│  │ Connect another wallet that        │  │
│  │ supports the Base network.         │  │
│  │ [Connect Wallet Button]            │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ [🛡️] Create a free Prize wallet    │  │
│  │ No Base wallet found. We'll create │  │
│  │ one for you automatically.         │  │
│  │ [Create wallet]                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│         ← Back to profile                │
│                                          │
└─────────────────────────────────────────┘
```

## Screen 9: Logged In Success
```
┌─────────────────────────────────────────┐
│                   [X]                    │
│                                          │
│         ┌─────────────────┐              │
│         │  [CheckMark]    │              │
│         │ (Blue/Yellow)   │              │
│         └─────────────────┘              │
│                                          │
│           You're live.                   │
│                                          │
│      The Platform Players Trust.         │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Your Wallet Address     [Copy 📋]  │  │
│  │ 0xA3f7B2c...E8d9C21                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Account Email                      │  │
│  │ user@example.com                   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │   Start Entering Competitions      │  │
│  └────────────────────────────────────┘  │
│                                          │
│        View on BaseScan ↗                │
│                                          │
└─────────────────────────────────────────┘
```

## Color Legend
- 🔵 Blue (#0052FF) - Primary actions, CDP/Base branding
- 🟡 Yellow (#DDE404) - ThePrize accent, highlights
- 🔴 Red - Destructive actions, warnings
- 🟠 Orange - Alerts, attention needed
- ⚫ Dark (#101010) - Modal background
- ⚪ White/Gray - Text, borders

## Icon Legend
- 💰 [Wallet] - Wallet/crypto icon
- ✅ [CheckMark] - Success/completion icon
- ⚠️ [Warning!] - Alert/warning icon
- 🔄 [Spinner] - Loading animation
- 📱 [Phone] - Mobile device icon
- 💼 [Briefcase] - Business/external wallet icon
- 🛡️ [Shield] - Security/protection icon
- 📋 [Copy] - Copy to clipboard icon
- ↗ [External] - Opens in new tab
- → [Arrow] - Forward/continue action

## Responsive Behavior
All screens:
- Max width: 28rem (448px)
- Padding: 1.5rem
- Rounded corners: 1rem
- Max height: 90vh with scroll
- Mobile-optimized touch targets
- Auto-focus on input fields
- Keyboard navigation support

## Accessibility
- ARIA labels on all interactive elements
- Keyboard navigation (Tab, Enter, Escape)
- Screen reader announcements for state changes
- High contrast text (WCAG AA compliant)
- Focus indicators on all interactive elements
- Error messages announced to screen readers

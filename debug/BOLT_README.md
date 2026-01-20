# ThePrize.io Front-End Package for Bolt

This package contains all the necessary front-end components to edit and work with ThePrize.io in Bolt.

## What's Included

### Core Application Files
- **src/** - Complete source code directory
  - components/ - All React components
  - pages/ - All page components
  - hooks/ - Custom React hooks
  - contexts/ - React context providers
  - services/ - API and service integrations
  - utils/ - Utility functions
  - types/ - TypeScript type definitions
  - assets/ - Images and static assets

### Configuration Files
- **package.json** - Dependencies and scripts
- **vite.config.ts** - Vite bundler configuration
- **tsconfig.json** - TypeScript configuration
- **tsconfig.app.json** - TypeScript app-specific config
- **tsconfig.node.json** - TypeScript Node-specific config
- **eslint.config.js** - ESLint linting rules
- **index.html** - Main HTML entry point

### Public Assets
- **public/** - Static files (fonts, robots.txt, headers)

### Documentation
- **.env.example** - Environment variable template

## How to Use in Bolt

### 1. Upload to Bolt
1. Upload the `theprize-frontend.zip` file to Bolt
2. Bolt will automatically extract and recognize the project structure

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
Create a `.env` file based on `.env.example`:
```bash
# Required for wallet functionality
VITE_CDP_API_KEY=your_cdp_api_key_here
VITE_CDP_PROJECT_ID=your_project_id_here

# Required for database
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Network configuration
VITE_BASE_MAINNET=true

# Treasury wallet
VITE_TREASURY_ADDRESS=your_treasury_address_here
```

### 4. Development Commands
```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

### 5. Making Changes
- Edit components in `src/components/`
- Edit pages in `src/pages/`
- Modify styles in component files (uses Tailwind CSS v4)
- Update routing in `src/main.tsx`

### 6. Key Technologies Used
- **React 19.1.1** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS v4** - Styling
- **React Router v7** - Routing
- **Wagmi & Viem** - Web3 wallet integration
- **Coinbase OnchainKit** - Coinbase wallet features
- **Supabase** - Backend database

### 7. Important Notes

#### Backend Dependencies
This front-end connects to:
- **Supabase** - PostgreSQL database
- **Netlify Functions** - Serverless API endpoints
- **Coinbase CDP** - Wallet and payment infrastructure

These backend services are NOT included in this package and need to remain connected.

#### What You Can Edit
✅ UI components and styling
✅ Page layouts and structure
✅ Client-side logic and state management
✅ Form validations
✅ Animation and interactions

#### What Requires Backend Changes
❌ Database schema changes (requires Supabase migrations)
❌ API endpoints (requires Netlify function updates)
❌ Authentication logic (tied to CDP/Supabase)
❌ Payment processing (requires backend integration)

### 8. Re-uploading to Repository

After making changes in Bolt:

1. **Download your modified files** from Bolt
2. **Test locally** to ensure everything works
3. **Commit changes** to the repository:
   ```bash
   git add src/
   git commit -m "Updated front-end from Bolt edits"
   git push origin main
   ```
4. **Deploy** - Changes will automatically deploy via Netlify

### 9. Architecture Overview

```
┌─────────────────────────────────────┐
│         Front-End (This Package)    │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   React Components           │  │
│  │   - Landing Page             │  │
│  │   - Competition Pages        │  │
│  │   - User Dashboard           │  │
│  │   - Admin Pages              │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   State Management           │  │
│  │   - Auth Context             │  │
│  │   - Wallet Integration       │  │
│  │   - Toast Notifications      │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
                 │
                 │ API Calls
                 ▼
┌─────────────────────────────────────┐
│         Backend (Separate Repo)     │
│                                     │
│  - Supabase Database                │
│  - Netlify Serverless Functions     │
│  - Coinbase CDP Integration         │
│  - Payment Processing               │
└─────────────────────────────────────┘
```

## Troubleshooting

### Build Errors
- Ensure all dependencies are installed: `npm install`
- Check Node.js version: Should be 18+.
- Clear cache: `rm -rf node_modules package-lock.json && npm install`

### Environment Variables
- Make sure `.env` file exists with all required variables
- Restart dev server after changing environment variables

### Type Errors
- Run `npm run build` to see all TypeScript errors
- Check `tsconfig.json` for configuration issues

## Support
For issues or questions:
1. Check existing issues in the repository
2. Review documentation files (*.md) in the root directory
3. Contact the development team

## Version
Package created: January 2026
Repository: https://github.com/teamstack-xyz/theprize.io

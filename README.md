# ThePrize.io

A blockchain-based competition platform with instant-win mechanics and balance payment system.

## 🎯 Project Overview

ThePrize.io is a Web3 competition platform that allows users to:
- Enter competitions using cryptocurrency or account balance
- Purchase tickets with balance payment (via Supabase RPC)
- Win prizes through VRF (Verifiable Random Function) drawings
- Manage account balances and transactions

## 🏗️ Architecture

### Frontend
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: React hooks
- **Wallet Integration**: Wagmi, OnchainKit

### Backend
- **Database**: Supabase (PostgreSQL)
- **Edge Functions**: Supabase Edge Functions (Deno)
- **Serverless**: Netlify Functions (Node.js)
- **Payments**: Coinbase Commerce, Base Account

### Key Services

#### Balance Payment System
```
Frontend (usePurchaseWithBalance.ts)
    ↓
Netlify Proxy (/api/purchase-with-balance)
    ↓
Supabase RPC (purchase_tickets_with_balance)
    ↓
Database (sub_account_balances, joincompetition, tickets)
```

**Key Files:**
- Frontend Hook: `src/hooks/usePurchaseWithBalance.ts`
- Netlify Proxy: `netlify/functions/purchase-with-balance-proxy.mts`
- RPC Migration: `supabase/migrations/20260130000000_simplified_balance_payment.sql`

## 📁 Repository Structure

```
theprize.io/
├── src/                          # Frontend React application
│   ├── components/              # React components
│   ├── hooks/                   # Custom React hooks
│   ├── lib/                     # Utility libraries
│   └── types/                   # TypeScript type definitions
├── netlify/                     # Netlify functions (serverless)
│   └── functions/              # Netlify function endpoints
├── supabase/                    # Supabase backend
│   ├── functions/              # Supabase Edge Functions (Deno)
│   └── migrations/             # Database migrations
├── scripts/                     # Deployment and utility scripts
├── docs/                        # Documentation
│   └── archive/                # Historical documentation and deprecated code
└── public/                      # Static assets
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase CLI (for backend development)
- Netlify CLI (for function development)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Start development server
npm run dev
```

### Environment Variables

Required variables (see `.env.example`):
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-side only)
- Additional keys for payment providers and integrations

## 🧪 Testing

```bash
# Run linter
npm run lint

# Run tests
npm test

# Run E2E tests
npm run test:e2e
```

## 📦 Building

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## 🔄 Recent Repository Cleanup

This repository underwent a major cleanup on 2026-02-09:

### Changes Made
1. **Moved 88+ markdown files** from root to `docs/archive/`
2. **Organized clutter**: Moved zip files, CSVs, test files to appropriate directories
3. **Moved scripts**: Consolidated deployment scripts to `scripts/` directory
4. **Removed deprecated code**: The `purchase-tickets-with-bonus` edge function was removed as it was deprecated

### Important: Purchase Tickets Architecture

⚠️ **Note**: If you're looking for the `purchase_tickets_with_bonus` function:
- The Supabase Edge Function at `supabase/functions/purchase-tickets-with-bonus/` was **DEPRECATED** and removed
- Production now uses: **Netlify Proxy → Supabase RPC** architecture
- See `DIAGNOSIS.md` for full details on why and how this works

## 📚 Documentation

- **Main Documentation**: See `docs/` directory
- **Diagnosis**: See `DIAGNOSIS.md` for purchase system architecture
- **Quick Start**: See `docs/QUICK_START_PURCHASE.md` for purchase flow guide
- **Frontend Guide**: See `docs/FRONTEND_PURCHASE_GUIDE.md` for integration examples
- **API Reference**: See `docs/CANONICAL_USER_RPC_REFERENCE.md` for RPC functions

### Archived Documentation
Historical documentation, old summaries, and deprecated code are in `docs/archive/`

## 🔐 Security

- Balance manipulation is restricted to `service_role` only
- All RPC functions use proper security definer patterns
- Idempotency keys prevent duplicate purchases
- Row-level security on database tables

## 🤝 Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Run linter and tests
4. Submit a pull request

## 📄 License

[Add your license here]

## 🆘 Troubleshooting

### Purchase with Balance Not Working

If the purchase with balance feature is failing:

1. **Check Environment Variables** (Netlify)
   - Ensure `VITE_SUPABASE_URL` is set
   - Ensure `SUPABASE_SERVICE_ROLE_KEY` is set

2. **Verify RPC Function Exists** (Supabase SQL Editor)
   ```sql
   SELECT routine_name FROM information_schema.routines 
   WHERE routine_name = 'purchase_tickets_with_balance';
   ```

3. **Check Migrations** 
   - Ensure migrations are applied: `supabase db push`
   - Key migration: `20260130000000_simplified_balance_payment.sql`

4. **Test Netlify Function Locally**
   ```bash
   netlify dev
   curl -X POST http://localhost:8888/api/purchase-with-balance \
     -H "Content-Type: application/json" \
     -d '{"userId":"test","competition_id":"...","ticketPrice":1,"ticket_count":1}'
   ```

5. **Review Logs**
   - Netlify function logs: Netlify dashboard
   - Supabase logs: Supabase dashboard

See `DIAGNOSIS.md` for more detailed troubleshooting.

## 📞 Support

For issues or questions:
- Check `DIAGNOSIS.md` first
- Review documentation in `docs/`
- Check archived summaries in `docs/archive/`
- Open an issue on GitHub

# ThePrize.io

> *"Not just another raffle app—a blockchain-powered competition platform architected for scale from day one."*

## 🎯 What is ThePrize.io?

ThePrize.io is a Web3 competition platform that combines:
- 🎲 **Provably-fair drawings** via Chainlink VRF
- 💰 **Multi-provider payments** (Balance, Crypto, Coinbase Commerce, Base Account)
- ⚡ **Real-time updates** via WebSocket subscriptions
- 🔒 **Enterprise security** with row-level security and ACID transactions
- 📈 **Scalable architecture** with serverless backend and CDN delivery

## 📚 Documentation

### Essential Reading
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Comprehensive technical documentation
  - Executive summary for decision-makers
  - Deep dive into Netlify vs Supabase vs RPC layers
  - Real-time APIs, Triggers, and RPCs explained
  - Security and scalability architecture
  - Why this is not "just another raffle app"

- **[QUICK_START.md](./QUICK_START.md)** - Get started quickly
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - API reference
- **[DEPLOYMENT_INSTRUCTIONS.md](./DEPLOYMENT_INSTRUCTIONS.md)** - Deployment guide

### For Technical Details
See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for:
- Complete technology stack
- Request flow diagrams
- Database schema and migrations
- Performance optimizations
- Index strategy
- Security patterns

## 📁 Repository Structure

```
theprize.io/
├── src/                          # React frontend (TypeScript + Vite)
│   ├── components/              # UI components (competition, wallet, payment)
│   ├── hooks/                   # Custom hooks (balance, real-time, CDP)
│   ├── lib/                     # Business logic & services
│   └── types/                   # TypeScript definitions
├── netlify/functions/           # Serverless functions (Node.js, 30+)
│   ├── purchase-with-balance-proxy.mts
│   ├── cdp-transfer.mts
│   └── [instant-topup, webhooks, admin functions]
├── supabase/
│   ├── functions/              # Edge functions (Deno, 50+)
│   │   ├── commerce-webhook/
│   │   ├── onramp-init/
│   │   └── [VRF, payments, status updates]
│   └── migrations/             # Database migrations (70+)
│       ├── 00000000000000_new_baseline.sql
│       └── [incremental migrations by date]
├── debug/                       # Archived docs, test files, hotfixes
└── docs/                        # Legacy documentation
```

**Clean Repository:** Historical summaries, fix documents, and test files have been moved to `debug/` directory.

## 🏗️ Architecture Overview

ThePrize.io uses a **three-layer serverless architecture**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                      │
│  - Deployed to Netlify CDN (150+ edge locations)                │
│  - Wagmi for wallet integration                                 │
│  - Real-time WebSocket subscriptions                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┬────────────────┐
          │                             │                │
          ▼                             ▼                ▼
┌─────────────────┐         ┌─────────────────┐  ┌─────────────┐
│ Netlify         │         │ Supabase        │  │ Supabase    │
│ Functions       │────────▶│ Edge Functions  │  │ RPC         │
│ (Node.js)       │         │ (Deno)          │  │ (PostgreSQL)│
└─────────────────┘         └─────────────────┘  └─────────────┘
         │                           │                   │
         └───────────────────────────┴───────────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │  Supabase Database      │
                        │  (PostgreSQL 15)        │
                        │  - 25+ tables           │
                        │  - 40+ indexes          │
                        │  - 30+ triggers         │
                        │  - 70+ migrations       │
                        └─────────────────────────┘
```

### Why Three Layers?

- **Netlify Functions**: Protect service role keys, handle CORS, add retry logic
- **Edge Functions**: Handle webhooks, external APIs, co-located with database
- **RPC Functions**: Atomic DB operations, ACID transactions, sub-millisecond performance

**See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete details.**

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

## 🔄 Repository Cleanup (February 2026)

The repository has been cleaned and organized:

### Cleanup Actions
- ✅ Moved 79 files to `debug/` (fix summaries, visual guides, test files, hotfixes)
- ✅ Moved 8 test migrations to `supabase/migrations/debug_tests/`
- ✅ Fixed incorrect Supabase URL in cron job configuration
- ✅ Removed CSV exports, diagnostic scripts, and temporary SQL files from production paths
- ✅ Kept only essential docs in root: README, ARCHITECTURE, QUICK_START, QUICK_REFERENCE, DEPLOYMENT_INSTRUCTIONS

### What's in `debug/`?
Historical documentation including:
- Fix summaries and implementation guides
- Visual proof screenshots
- Test SQL files and migrations
- Hotfix SQL scripts
- CSV exports and diagnostic tools
- Archived SQL fixes

**These files are preserved for reference but are not part of the active codebase.**

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

### Common Issues

1. **Purchase with Balance Not Working**
   - Check `SUPABASE_SERVICE_ROLE_KEY` is set in Netlify environment
   - Verify RPC function exists: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'purchase_tickets_with_balance';`
   - Check Netlify function logs for errors

2. **Real-time Updates Not Working**
   - Ensure WebSocket connections aren't blocked by firewall
   - Check browser console for subscription errors
   - Verify Supabase Realtime is enabled

3. **Wallet Connection Issues**
   - Check `VITE_WALLET_CONNECTOR_PROJECT_ID` is set
   - Ensure user is on Base network (chain ID 8453)
   - Try clearing wallet cache

**For detailed troubleshooting, see [ARCHITECTURE.md](./ARCHITECTURE.md).**

## 📞 Support & Contributing

### Getting Help
- 📖 Read [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
- 🔍 Check `debug/` directory for historical context
- 🐛 Open an issue on GitHub with detailed reproduction steps

### Contributing
1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the system
2. Create a feature branch from `main`
3. Make your changes (follow existing patterns)
4. Run linter and tests: `npm run lint && npm test`
5. Submit a pull request with clear description

### Code Standards
- TypeScript strict mode enabled
- React 19 best practices (hooks, suspense)
- Atomic database operations via RPCs
- Real-time subscriptions for UI updates
- Comprehensive error handling

---

*For the complete story of how this application is architected, read [ARCHITECTURE.md](./ARCHITECTURE.md).*

# VRF Integration Summary

## Overview

This integration provides complete VRF (Verifiable Random Function) functionality for The Prize platform. All competition winners are selected using Chainlink VRF on the Base blockchain, ensuring provably fair and transparent draws.

## What's Included

### 🔧 Services

**VRF Monitor Service** (`src/lib/vrf-monitor.ts`)
- Central entry point for all VRF operations
- Real-time status monitoring via Supabase
- BaseScan URL generation
- Admin actions (trigger draws, check queue)

**Admin Service** (`src/services/adminService.ts`)
- Get competition winners with user details
- Check if specific user won
- Get total winners count
- Get winners by competition with stats

### 🎨 Components

**VRF Status Components** (`src/components/VRFStatusComponents.tsx`)
- `VRFStatusBadge` - Real-time status indicator
- `VRFTransactionDetails` - Detailed transaction information
- `useVRFStatus` - Custom React hook

**Winner Widgets**
- `RecentWinnersWidget` - Shows recent VRF-verified winners
- `CompetitionStats` - Displays winner count for competitions

**Dashboard Components**
- `VRFDashboardSection` - Full dashboard with stats and winners
- `VRFStatsCard` - Contract info and draw statistics

### 📜 Scripts

**VRF Sync Script** (`scripts/vrf-sync-blockchain.mjs`)
```bash
npm run vrf:sync-blockchain              # Sync all competitions
npm run vrf:sync-blockchain -- --competition-id=abc-123  # Sync specific
npm run vrf:sync-blockchain -- --dry-run --verbose       # Test mode
```

### 📚 Documentation

**VRF Integration Guide** (`docs/VRF_INTEGRATION.md`)
- Complete API reference
- Code examples
- Common patterns
- Production checklist

### 🔗 Contract Information

**Network:** Base Mainnet (Chain ID: 8453)
**Contract:** `0x8ce54644e3313934D663c43Aea29641DFD8BcA1A`
**Explorer:** https://basescan.org

## Quick Start

### 1. Import VRF Utilities

```typescript
// Option 1: Import from central export
import { vrfMonitor, VRFStatusBadge, RecentWinnersWidget } from '@/vrf';

// Option 2: Import directly
import vrfMonitor from '@/lib/vrf-monitor';
import { VRFStatusBadge } from '@/components/VRFStatusComponents';
```

### 2. Get VRF Status

```typescript
const status = await vrfMonitor.getVRFStatus(competitionId);
console.log(status.status); // 'completed', 'processing', 'pending', etc.
```

### 3. Subscribe to Real-time Updates

```typescript
useEffect(() => {
  const unsubscribe = vrfMonitor.subscribeToVRFStatus(competitionId, (status) => {
    console.log('Status updated:', status);
  });
  return () => unsubscribe();
}, [competitionId]);
```

### 4. Display VRF Status

```tsx
<VRFStatusBadge competitionId={competitionId} />
```

### 5. Show Recent Winners

```tsx
<RecentWinnersWidget limit={10} />
```

## Already Integrated

✅ **Entries Page** - VRF winner badges with BaseScan links
✅ **Orders Page** - Winner status and transaction links  
✅ **Winner Section** - VRF verification with gradient styling
✅ **Database** - Winner tracking columns (is_winner, won_at, ticket_number)

## Integration Points

### User Dashboard

Add VRF stats to the dashboard:

```tsx
import { VRFDashboardSection } from '@/components/UserDashboard/VRFDashboardSection';

function Dashboard() {
  return (
    <div>
      {/* ... other dashboard content ... */}
      <VRFDashboardSection />
    </div>
  );
}
```

### Competition Details

Show VRF status on competition pages:

```tsx
import { VRFStatusBadge, VRFTransactionDetails } from '@/components/VRFStatusComponents';

function CompetitionPage({ competition }) {
  return (
    <div>
      <h1>{competition.title}</h1>
      <VRFStatusBadge competitionId={competition.id} />
      <VRFTransactionDetails competitionId={competition.id} />
    </div>
  );
}
```

### Admin Panel

Display VRF queue and trigger draws:

```tsx
import vrfMonitor from '@/lib/vrf-monitor';
import adminService from '@/services/adminService';

function AdminVRFPanel() {
  const [queue, setQueue] = useState([]);
  
  useEffect(() => {
    vrfMonitor.getVRFQueue().then(setQueue);
  }, []);
  
  const handleTrigger = async (competitionId) => {
    const result = await vrfMonitor.triggerVRF(competitionId);
    if (result.success) {
      alert(`Draw triggered! TX: ${result.txHash}`);
    }
  };
  
  return (
    <div>
      {queue.map(item => (
        <div key={item.competitionId}>
          {item.competitionId} - {item.status}
          <button onClick={() => handleTrigger(item.competitionId)}>
            Trigger Draw
          </button>
        </div>
      ))}
    </div>
  );
}
```

## Database Schema

The VRF integration uses these tables:

**winners**
- `is_winner` (boolean)
- `won_at` (timestamp)
- `ticket_number` (integer)
- `competition_id` (uuid)

**competitions**
- `vrf_status` (text)
- `vrf_tx_hash` (text)
- `vrf_draw_completed_at` (timestamp)
- `onchain_competition_id` (integer)

## VRF Status States

| Status | Meaning | User Action |
|--------|---------|-------------|
| `pending` | Not yet drawn | Wait for draw |
| `requested` | VRF requested | Wait ~1-2 min |
| `processing` | Transaction submitted | Wait ~30-60 sec |
| `completed` | Winners selected ✓ | View results |
| `failed` | Processing failed | Contact admin |

## Testing

```bash
# Sync VRF data from blockchain
npm run vrf:sync-blockchain

# Test specific competition
npm run vrf:sync-blockchain -- --competition-id=abc-123

# Dry run (no changes)
npm run vrf:sync-blockchain -- --dry-run --verbose
```

## Links

- Contract: https://basescan.org/address/0x8ce54644e3313934D663c43Aea29641DFD8BcA1A
- Documentation: [docs/VRF_INTEGRATION.md](./docs/VRF_INTEGRATION.md)
- Base Network: https://base.org
- Chainlink VRF: https://docs.chain.link/vrf

## Support

For issues or questions about VRF integration:
1. Check the documentation in `docs/VRF_INTEGRATION.md`
2. Verify contract on BaseScan
3. Check Supabase for database issues
4. Review VRF status in admin panel

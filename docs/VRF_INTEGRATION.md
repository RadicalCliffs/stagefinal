# VRF Integration Documentation

This document provides examples and best practices for integrating VRF (Verifiable Random Function) functionality into your components.

## Table of Contents

1. [Basic Imports](#basic-imports)
2. [Using the VRF Monitor Service](#using-the-vrf-monitor-service)
3. [Real-time Subscriptions](#real-time-subscriptions)
4. [React Components](#react-components)
5. [Admin Operations](#admin-operations)
6. [Common Patterns](#common-patterns)

---

## Basic Imports

```typescript
// VRF Monitor Service (main entry point)
import vrfMonitor, { type VRFStatus } from '@/lib/vrf-monitor';

// React Components
import { VRFStatusBadge, VRFTransactionDetails, useVRFStatus } from '@/components/VRFStatusComponents';
import RecentWinnersWidget from '@/components/RecentWinnersWidget';
import CompetitionStats from '@/components/CompetitionStats';
import { VRFDashboardSection } from '@/components/UserDashboard/VRFDashboardSection';

// Admin Service
import adminService from '@/services/adminService';

// Icons (lucide-react)
import { Zap, ExternalLink, CheckCircle2, Trophy } from 'lucide-react';
```

---

## Using the VRF Monitor Service

### Get VRF Status

```typescript
const status = await vrfMonitor.getVRFStatus(competitionId);

console.log(status);
// {
//   competitionId: "abc-123",
//   status: "completed",
//   vrfTxHash: "0x1234567890abcdef...",
//   vrfVerified: true,
//   explorerUrl: "https://basescan.org/tx/0x1234567890abcdef...",
//   winnersCount: 3
// }
```

### Generate BaseScan URLs

```typescript
// Transaction URL
const txUrl = vrfMonitor.getTransactionUrl('0x1234567890abcdef...');
// Returns: "https://basescan.org/tx/0x1234567890abcdef..."

// Contract URL
const contractUrl = vrfMonitor.getContractUrl();
// Returns: "https://basescan.org/address/0x8ce54644e3313934D663c43Aea29641DFD8BcA1A"

// On-chain competition URL (for reading contract state)
const compUrl = vrfMonitor.getOnchainCompetitionUrl(12345);
// Returns: "https://basescan.org/address/0x8ce54644e3313934D663c43Aea29641DFD8BcA1A#readContract"
```

---

## Real-time Subscriptions

### Subscribe to Single Competition

```typescript
import { useEffect } from 'react';
import vrfMonitor from '@/lib/vrf-monitor';

function MyComponent({ competitionId }) {
  useEffect(() => {
    const unsubscribe = vrfMonitor.subscribeToVRFStatus(competitionId, (status) => {
      console.log('VRF status updated:', status);
      // Update UI with new status
      if (status.status === 'completed') {
        // Show winner notification
      }
    });

    return () => unsubscribe();
  }, [competitionId]);

  return <div>...</div>;
}
```

### Subscribe to All VRF Updates (Admin)

```typescript
import { useEffect, useState } from 'react';
import vrfMonitor from '@/lib/vrf-monitor';

function AdminDashboard() {
  const [competitions, setCompetitions] = useState(new Map());

  useEffect(() => {
    const unsubscribe = vrfMonitor.subscribeToAllVRFUpdates((competitionId, status) => {
      console.log(`Competition ${competitionId} updated:`, status);
      
      setCompetitions(prev => {
        const next = new Map(prev);
        next.set(competitionId, status);
        return next;
      });
    });

    return () => unsubscribe();
  }, []);

  return (
    <div>
      <h2>All VRF Status Updates</h2>
      {Array.from(competitions).map(([id, status]) => (
        <div key={id}>{id}: {status.status}</div>
      ))}
    </div>
  );
}
```

---

## React Components

### VRF Status Badge

```typescript
import { VRFStatusBadge } from '@/components/VRFStatusComponents';

// Basic usage
<VRFStatusBadge competitionId="abc-123" />

// With admin trigger button
<VRFStatusBadge 
  competitionId="abc-123" 
  showTriggerButton={true}  // Admin only
/>
```

### VRF Transaction Details

```typescript
import { VRFTransactionDetails } from '@/components/VRFStatusComponents';

<VRFTransactionDetails competitionId="abc-123" />
```

### Custom Hook

```typescript
import { useVRFStatus } from '@/components/VRFStatusComponents';

function MyComponent({ competitionId }) {
  const { status, loading } = useVRFStatus(competitionId);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      Status: {status?.status}
      {status?.explorerUrl && (
        <a href={status.explorerUrl} target="_blank">
          View on BaseScan →
        </a>
      )}
    </div>
  );
}
```

### Recent Winners Widget

```typescript
import RecentWinnersWidget from '@/components/RecentWinnersWidget';

// Show 10 recent winners
<RecentWinnersWidget limit={10} />
```

### Competition Stats

```typescript
import CompetitionStats from '@/components/CompetitionStats';

// Show winner count for a competition
<CompetitionStats competitionId="abc-123" />
```

### VRF Dashboard Section

```typescript
import { VRFDashboardSection } from '@/components/UserDashboard/VRFDashboardSection';

// Full dashboard section with stats and recent winners
<VRFDashboardSection />
```

---

## Admin Operations

### Trigger VRF Draw

```typescript
import vrfMonitor from '@/lib/vrf-monitor';

async function handleTriggerDraw(competitionId: string) {
  const result = await vrfMonitor.triggerVRF(competitionId);
  
  if (result.success) {
    alert(`VRF draw triggered! TX: ${result.txHash}`);
  } else {
    alert(`Failed: ${result.message}`);
  }
}
```

### Get VRF Processing Queue

```typescript
const queue = await vrfMonitor.getVRFQueue();

queue.forEach(item => {
  console.log(`${item.competitionId}: ${item.status}`);
  if (item.explorerUrl) {
    console.log(`  TX: ${item.explorerUrl}`);
  }
});
```

### Get Competition Winners (Admin Service)

```typescript
import adminService from '@/services/adminService';

const winners = await adminService.getCompetitionWinners(competitionId);

winners.forEach(winner => {
  console.log(`Ticket #${winner.ticket_number} - ${winner.canonical_users?.username}`);
  console.log(`Won at: ${winner.won_at}`);
});
```

### Check If User Won

```typescript
import adminService from '@/services/adminService';

const result = await adminService.checkUserWinner(userId, competitionId);

if (result && result.is_winner) {
  console.log(`User won with ticket #${result.ticket_number}!`);
  console.log(`Won at: ${result.won_at}`);
} else {
  console.log('User did not win');
}
```

---

## Common Patterns

### Display Winner Badge on Entry

```typescript
{entry.is_winner && (
  <div className="flex items-center gap-1 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 text-yellow-300 text-xs font-semibold px-2 py-0.5 rounded">
    <Zap className="w-3 h-3" />
    🏆 VRF Winner
  </div>
)}
```

### Display VRF Link for Winners

```typescript
{entry.competitions?.vrf_tx_hash && entry.is_winner && (
  <a
    href={vrfMonitor.getTransactionUrl(entry.competitions.vrf_tx_hash)}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-1 text-purple-400 hover:text-purple-300"
  >
    <Zap className="w-3 h-3" />
    <span>VRF Draw</span>
    <ExternalLink className="w-3 h-3" />
  </a>
)}
```

### Display Won Timestamp

```typescript
{entry.won_at && (
  <div className="text-green-400 text-xs">
    Won {formatDistanceToNow(new Date(entry.won_at), { addSuffix: true })}
  </div>
)}
```

### Real-time Winner Notification

```typescript
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'react-toastify'; // or your toast library

useEffect(() => {
  const subscription = supabase
    .channel('winners')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'winners',
      },
      (payload) => {
        const newWinner = payload.new;
        if (newWinner.is_winner) {
          toast.success(`🏆 New winner: Ticket #${newWinner.ticket_number}`);
        }
      }
    )
    .subscribe();

  return () => subscription.unsubscribe();
}, []);
```

### Query Winners from Database

```typescript
import { supabase } from '@/lib/supabase';

// Get all winners for a competition
const { data: winners } = await supabase
  .from('winners')
  .select(`
    *,
    canonical_users (username, email, wallet_address),
    competitions (title, vrf_tx_hash)
  `)
  .eq('competition_id', competitionId)
  .eq('is_winner', true)
  .order('won_at', { ascending: false });

console.log(`${winners.length} winners found`);
```

---

## TypeScript Interfaces

```typescript
// VRF Status
interface VRFStatus {
  competitionId: string;
  status: 'pending' | 'requested' | 'processing' | 'completed' | 'failed';
  vrfTxHash: string | null;
  vrfVerified: boolean;
  explorerUrl: string | null;
  blockNumber: number | null;
  timestamp: string | null;
  errorMessage?: string;
  onchainCompetitionId?: number | null;
  winnersCount?: number;
}

// Winner Entry
interface WinnerEntry {
  id: string;
  ticket_number: number;
  is_winner: boolean;
  won_at: string | null;
  competition_id: string;
  canonical_users: {
    privy_user_id: string;
    username: string;
    email: string;
    wallet_address: string;
  } | null;
}

// Competition Entry with VRF Data
interface CompetitionEntry {
  id: string;
  competition_id: string;
  is_winner: boolean;
  won_at: string | null;
  ticket_numbers: string | null;
  competitions: {
    title: string;
    vrf_tx_hash: string | null;
    vrf_verified: boolean;
  };
}
```

---

## Performance Tips

1. **Use Real-time Subscriptions** - Don't poll, use Supabase Realtime
2. **Unsubscribe on Cleanup** - Always return cleanup function from `useEffect`
3. **Batch Queries** - Use `getVRFQueue()` instead of individual fetches
4. **Cache URLs** - BaseScan URLs don't change, cache them
5. **Debounce Updates** - If showing many competitions, debounce UI updates

---

## Production Checklist

- [ ] VRF Monitor service imported where needed
- [ ] Real-time subscriptions implemented with cleanup
- [ ] BaseScan links displayed for all VRF transactions
- [ ] Error states handled and displayed
- [ ] Admin trigger button properly secured
- [ ] Mobile-responsive VRF status displays
- [ ] Loading states for async operations
- [ ] Unsubscribe cleanup in all components
- [ ] Contract address matches production (0x8ce54644e3313934D663c43Aea29641DFD8BcA1A)
- [ ] Base Mainnet chain ID verified (8453)

---

## Support

For issues or questions:
- Check BaseScan: https://basescan.org
- Contract: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A
- Network: Base Mainnet (Chain ID: 8453)

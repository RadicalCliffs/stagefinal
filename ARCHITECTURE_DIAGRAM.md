# System Architecture Diagram

## Reliability Rules Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATION                           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                ┌───────────────────┴───────────────────┐
                │                                       │
    ┌───────────▼──────────┐              ┌───────────▼──────────┐
    │  React Components    │              │   React Hooks        │
    │  ──────────────────  │              │  ─────────────       │
    │  - ReservationButton │              │  - useEnhanced       │
    │  - PaymentModal      │              │    Reservation       │
    │  - BalanceDisplay    │              │  - useRealtime       │
    └──────────┬───────────┘              │    WithGuards        │
               │                          │  - useReconnect      │
               │                          │    Resilience        │
               └──────────┬───────────────┴──────────┐
                          │                          │
              ┌───────────▼──────────────────────────▼──────────┐
              │        State Management Layer                   │
              │  ───────────────────────────────────────────    │
              │  ┌────────────────┐  ┌─────────────────────┐   │
              │  │ State Machine  │  │  Idempotency Keys   │   │
              │  │  - idle        │  │  - Generate         │   │
              │  │  - reserving   │  │  - Persist          │   │
              │  │  - reserved    │  │  - Reuse on retry   │   │
              │  │  - paying      │  └─────────────────────┘   │
              │  │  - confirmed   │                            │
              │  └────────────────┘                            │
              └─────────────────────┬──────────────────────────┘
                                    │
              ┌─────────────────────▼──────────────────────────┐
              │            Guards Layer                         │
              │  ─────────────────────────────────────────     │
              │  ┌──────────────┐    ┌──────────────────┐     │
              │  │BalanceGuard  │    │ ReservationGuard │     │
              │  │- requireAvail│    │- awaitCreated    │     │
              │  │- requirePend │    │- assertPending   │     │
              │  │- waitForChng │    │- verifyDB        │     │
              │  └──────────────┘    └──────────────────┘     │
              └─────────────────────┬──────────────────────────┘
                                    │
              ┌─────────────────────▼──────────────────────────┐
              │       Realtime Service Layer                    │
              │  ─────────────────────────────────────────     │
              │  ┌────────────────────────────────────────┐    │
              │  │  Channel State Tracking                │    │
              │  │  - IDLE → CONNECTING → SUBSCRIBED      │    │
              │  │  - Ready state per channel             │    │
              │  └────────────────────────────────────────┘    │
              │                                                 │
              │  ┌────────────────────────────────────────┐    │
              │  │  Event Versioning                      │    │
              │  │  - Track last version per topic        │    │
              │  │  - Reject out-of-order events          │    │
              │  └────────────────────────────────────────┘    │
              │                                                 │
              │  ┌────────────────────────────────────────┐    │
              │  │  Broadcast Subscriptions               │    │
              │  │  - user:{id}:balances                  │    │
              │  │  - user:{id}:purchases                 │    │
              │  └────────────────────────────────────────┘    │
              └─────────────────────┬──────────────────────────┘
                                    │
                      ┌─────────────┴─────────────┐
                      │                           │
          ┌───────────▼─────────┐     ┌──────────▼──────────┐
          │  WebSocket (Live)   │     │  HTTP API (Verify)  │
          │  - Real-time events │     │  - DB verification  │
          │  - Broadcasts       │     │  - Fetch latest     │
          └───────────┬─────────┘     └──────────┬──────────┘
                      │                           │
                      └─────────────┬─────────────┘
                                    │
┌───────────────────────────────────▼───────────────────────────────┐
│                        SUPABASE SERVER                             │
│  ────────────────────────────────────────────────────────────     │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  Database       │  │  Realtime    │  │  Edge Functions  │    │
│  │  - Postgres     │  │  - Broadcasts│  │  - Reserve       │    │
│  │  - RLS          │  │  - Postgres  │  │  - Finalize      │    │
│  │  - Triggers     │  │    Changes   │  │  - Payment       │    │
│  └─────────────────┘  └──────────────┘  └──────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

## Data Flow: Reserve → Pay → Confirm

```
USER ACTION          STATE MACHINE       GUARDS              REALTIME           SERVER
    │                    │                 │                    │                 │
    │ Click Reserve      │                 │                    │                 │
    ├────────────────────►                 │                    │                 │
    │                    │ idle→reserving  │                    │                 │
    │                    ├─────────────────►                    │                 │
    │                    │                 │ requireAvailable() │                 │
    │                    │                 │     ✓ Pass         │                 │
    │                    │                 ├────────────────────┼────────────────►│
    │                    │                 │                    │    RPC: reserve │
    │                    │                 │                    │                 │
    │                    │                 │                    │◄────────────────┤
    │                    │                 │                    │  reservation_id │
    │                    │                 │                    │                 │
    │                    │                 │                    │◄────────────────┤
    │                    │                 │                    │ reservation_    │
    │                    │                 │                    │   created       │
    │                    │                 │                    │                 │
    │                    │                 │◄───────────────────┤                 │
    │                    │                 │ awaitCreated()     │                 │
    │                    │                 │   ✓ Event received │                 │
    │                    │                 │   ✓ DB verified    │                 │
    │                    │                 │   ✓ Balance pending│                 │
    │                    │◄────────────────┤                    │                 │
    │                    │ reserving→      │                    │                 │
    │                    │   reserved      │                    │                 │
    │◄───────────────────┤                 │                    │                 │
    │ Show "Pay" button  │                 │                    │                 │
    │                    │                 │                    │                 │
    │ Click Pay          │                 │                    │                 │
    ├────────────────────►                 │                    │                 │
    │                    │ reserved→paying │                    │                 │
    │                    ├─────────────────►                    │                 │
    │                    │                 │ requirePending()   │                 │
    │                    │                 │     ✓ Pass         │                 │
    │                    │                 ├────────────────────┼────────────────►│
    │                    │                 │ (idempotency key)  │  RPC: finalize  │
    │                    │                 │                    │                 │
    │                    │                 │                    │◄────────────────┤
    │                    │                 │                    │  payment_       │
    │                    │                 │                    │  authorized     │
    │                    │                 │                    │                 │
    │                    │◄────────────────┼────────────────────┤                 │
    │                    │ paying→         │                    │                 │
    │                    │   finalizing    │                    │                 │
    │                    │                 │                    │                 │
    │                    │                 │                    │◄────────────────┤
    │                    │                 │                    │  purchase_      │
    │                    │                 │                    │  confirmed      │
    │                    │                 │                    │                 │
    │                    │◄────────────────┼────────────────────┤                 │
    │                    │ finalizing→     │                    │                 │
    │                    │   confirmed     │                    │                 │
    │◄───────────────────┤                 │                    │                 │
    │ Show success! ✓    │                 │                    │                 │
    │                    │                 │                    │                 │
```

## Channel State Lifecycle

```
┌─────────┐
│  IDLE   │  Initial state, no subscription
└────┬────┘
     │
     │ subscribe()
     ▼
┌──────────────┐
│ CONNECTING   │  Attempting to connect to Supabase
└──────┬───────┘
       │
       │ success
       ▼
┌──────────────┐         ┌────────────────┐
│ SUBSCRIBED   │─────────►  CHANNEL_ERROR │  Failed to subscribe
└──────┬───────┘  error  └────────────────┘
       │
       │ unsubscribe()
       ▼
┌──────────────┐
│   CLOSED     │  Channel cleaned up
└──────────────┘
```

## Guard Decision Flow

```
                     ┌─────────────────┐
                     │  User Action    │
                     └────────┬────────┘
                              │
                     ┌────────▼────────┐
                     │ Check isReady?  │
                     └────────┬────────┘
                              │
                   ┌──────────┴──────────┐
                   │                     │
                NO │                     │ YES
                   ▼                     ▼
        ┌──────────────────┐   ┌────────────────┐
        │ Show Loading UI  │   │ Call guard     │
        └──────────────────┘   └────────┬───────┘
                                        │
                              ┌─────────┴─────────┐
                              │                   │
                          PASS│                   │FAIL
                              ▼                   ▼
                   ┌──────────────────┐   ┌──────────────────┐
                   │ Proceed with     │   │ Show error       │
                   │ operation        │   │ Block action     │
                   └──────────────────┘   └──────────────────┘
```

## Reconnection Flow

```
┌─────────────┐
│ Connected   │
└──────┬──────┘
       │
       │ Network loss
       ▼
┌──────────────┐
│ Disconnected │
└──────┬───────┘
       │
       │ Auto-detect
       ▼
┌──────────────┐
│ Reconnecting │
└──────┬───────┘
       │
       │ Connection restored
       ▼
┌─────────────────────────────────┐
│ Wait for channels SUBSCRIBED    │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ Refetch latest data             │
│ - Balance reconciliation        │
│ - Reservation verification      │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ Verify state consistency        │
│ - If mismatch, mark failed      │
│ - If expired, clear reservation │
│ - If valid, resume              │
└──────┬──────────────────────────┘
       │
       ▼
┌──────────────┐
│ Connected ✓  │
└──────────────┘
```

## Idempotency Key Usage

```
FIRST ATTEMPT                           RETRY ATTEMPT
     │                                       │
     │ getOrCreateKey(reservationId)        │ getOrCreateKey(reservationId)
     ▼                                       ▼
┌─────────────────┐                    ┌─────────────────┐
│ Generate new key│                    │ Return same key │
│ idem_abc123xyz  │                    │ idem_abc123xyz  │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │ Store in sessionStorage              │ Read from sessionStorage
         ▼                                      ▼
┌─────────────────┐                    ┌─────────────────┐
│ Send to server  │                    │ Send to server  │
│ with key        │                    │ with same key   │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │ Transient error                     │ Server recognizes key
         ▼                                      ▼
┌─────────────────┐                    ┌─────────────────┐
│ Keep key valid  │                    │ Returns cached  │
│ for retry       │                    │ result (no dup) │
└─────────────────┘                    └─────────────────┘
```

## Event Versioning

```
EVENT 1 (v1)          EVENT 2 (v2)          EVENT 3 (v1) - OUT OF ORDER!
     │                     │                       │
     ▼                     ▼                       ▼
┌─────────────┐      ┌─────────────┐       ┌─────────────┐
│ Process     │      │ Process     │       │ Reject!     │
│ lastVer=v1  │      │ lastVer=v2  │       │ v1 < v2     │
└─────────────┘      └─────────────┘       └─────────────┘
```

## Legend

```
┌──────┐
│ Box  │  = Component/System
└──────┘

   │
   ▼      = Data/Control Flow

   ✓      = Success/Pass
   ✗      = Failure/Reject

RPC       = Remote Procedure Call
DB        = Database
```

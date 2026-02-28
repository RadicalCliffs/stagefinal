# On-Chain Competition Mechanics

## Overview

ThePrize.io uses a hybrid on-chain/off-chain architecture for competition management. Critical operations like winner selection (VRF) happen on-chain for transparency and provable fairness, while operational data is stored off-chain in Supabase for performance.

## Smart Contract Architecture

### Contract Address

- **Base Mainnet**: Configured in `VITE_CONTRACT_ADDRESS` environment variable
- **Base Testnet**: Separate contract for testing

### Core Contract Functions

#### 1. createCompetition

Creates a new competition on-chain.

```solidity
function createCompetition(
    uint256 totalTickets,
    uint256 ticketPrice,
    uint256 endTimestamp,
    bool useVRF
) external returns (uint256 competitionId)
```

**Parameters:**
- `totalTickets`: Maximum number of tickets available
- `ticketPrice`: Price per ticket in wei (USDC)
- `endTimestamp`: Unix timestamp when competition ends
- `useVRF`: Whether to use Chainlink VRF for winner selection

**Returns:**
- `competitionId`: Unique on-chain competition ID

**Usage:**
```javascript
const tx = await contract.createCompetition(
    1000,              // 1000 tickets
    1000000,           // 1 USDC (6 decimals)
    1735689600,        // End timestamp
    true               // Use VRF
);
```

#### 2. purchaseTickets

Purchase tickets for a competition.

```solidity
function purchaseTickets(
    uint256 competitionId,
    uint256 numberOfTickets
) external payable
```

**Parameters:**
- `competitionId`: On-chain competition ID
- `numberOfTickets`: Number of tickets to purchase

**Requirements:**
- Competition must be active
- Must send exact payment amount
- Cannot exceed available tickets

#### 3. requestVRFDraw

Initiates Chainlink VRF winner selection.

```solidity
function requestVRFDraw(
    uint256 competitionId,
    bool useVRF
) external returns (uint256 requestId)
```

**Parameters:**
- `competitionId`: On-chain competition ID
- `useVRF`: Whether to use VRF (true) or fallback (false)

**Returns:**
- `requestId`: Chainlink VRF request ID

**Flow:**
1. Validates competition is ended
2. Requests random number from Chainlink VRF
3. VRF callback selects winner(s)
4. Emits `WinnerDrawn` event

#### 4. getWinners

Retrieves winner information for a competition.

```solidity
function getWinners(uint256 competitionId) 
    external view 
    returns (
        uint256[] memory winningNumbers,
        address[] memory winnerAddresses
    )
```

**Returns:**
- `winningNumbers`: Array of winning ticket numbers
- `winnerAddresses`: Array of winner wallet addresses

## Chainlink VRF Integration

### VRF Configuration

- **Coordinator**: Chainlink VRF Coordinator for Base
- **Key Hash**: VRF key hash for gas lane
- **Subscription ID**: Chainlink subscription ID
- **Callback Gas Limit**: Gas limit for VRF callback (typically 200,000)

### VRF Process Flow

```
1. Competition Ends
   ↓
2. Admin/System calls requestVRFDraw()
   ↓
3. Contract requests random number from Chainlink
   ↓
4. Chainlink VRF generates provably random number
   ↓
5. Chainlink calls fulfillRandomWords() callback
   ↓
6. Contract selects winner(s) using random number
   ↓
7. WinnerDrawn event emitted
   ↓
8. Backend syncs winner data to database
```

### Verifying VRF Results

All VRF draws are verifiable on-chain:

```javascript
// Get transaction receipt
const receipt = await provider.getTransactionReceipt(vrfTxHash);

// Find RandomWordsRequested event
const requestEvent = receipt.logs.find(
    log => log.topics[0] === RandomWordsRequestedEventTopic
);

// Extract VRF request ID
const requestId = ethers.BigNumber.from(requestEvent.topics[1]);

// Verify winner selection
const winners = await contract.getWinners(competitionId);
```

## Competition Lifecycle

### 1. Creation Phase

```javascript
// Off-chain: Create competition in database
const { data: competition } = await supabase
    .from('competitions')
    .insert({
        title: 'Bitcoin Giveaway',
        total_tickets: 1000,
        ticket_price: 1.00,
        end_date: '2024-12-31T23:59:59Z',
        status: 'active'
    })
    .select()
    .single();

// On-chain: Create competition on blockchain
const tx = await contract.createCompetition(
    1000,                           // total tickets
    ethers.utils.parseUnits('1', 6), // 1 USDC
    Math.floor(new Date('2024-12-31T23:59:59Z').getTime() / 1000),
    true                            // use VRF
);

const receipt = await tx.wait();
const onchainCompetitionId = receipt.events[0].args.competitionId;

// Update database with on-chain ID
await supabase
    .from('competitions')
    .update({ onchain_competition_id: onchainCompetitionId })
    .eq('id', competition.id);
```

### 2. Active Phase

Users purchase tickets:

```javascript
// Off-chain: Reserve tickets in database
const { data: reservation } = await supabase
    .from('pending_tickets')
    .insert({
        competition_id: competitionId,
        canonical_user_id: userId,
        ticket_numbers: '1,2,3',
        status: 'pending'
    });

// User pays with balance or crypto
// ...

// Off-chain: Confirm reservation
await supabase.rpc('confirm_pending_tickets', {
    p_reservation_id: reservation.id
});

// Tickets are now confirmed in database
// On-chain purchase happens via treasury
```

### 3. Drawing Phase

```javascript
// Competition ends (automatic or manual trigger)
await supabase
    .from('competitions')
    .update({ status: 'drawing' })
    .eq('id', competitionId);

// Initiate VRF draw
const tx = await contract.requestVRFDraw(
    onchainCompetitionId,
    true // use VRF
);

const receipt = await tx.wait();
const vrfRequestId = receipt.events[0].args.requestId;

// Store VRF request info
await supabase
    .from('competitions')
    .update({
        vrf_request_id: vrfRequestId.toString(),
        vrf_tx_hash: tx.hash
    })
    .eq('id', competitionId);
```

### 4. Completion Phase

```javascript
// VRF callback completes (automatic via Chainlink)
// ...

// Backend sync winners from blockchain
const winners = await contract.getWinners(onchainCompetitionId);

// Store winners in database
for (let i = 0; i < winners.winnerAddresses.length; i++) {
    await supabase.from('winners').insert({
        competition_id: competitionId,
        user_id: winnerswinnerAddresses[i],
        ticket_number: winners.winningNumbers[i].toString(),
        vrf_tx_hash: tx.hash
    });
}

// Mark competition as completed
await supabase
    .from('competitions')
    .update({
        status: 'completed',
        vrf_draw_completed_at: new Date().toISOString()
    })
    .eq('id', competitionId);
```

## Database Schema

### competitions Table

```sql
CREATE TABLE competitions (
    id UUID PRIMARY KEY,
    onchain_competition_id INTEGER UNIQUE,
    title TEXT NOT NULL,
    total_tickets INTEGER NOT NULL,
    tickets_sold INTEGER DEFAULT 0,
    ticket_price NUMERIC NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'active',
    vrf_request_id TEXT,
    vrf_tx_hash TEXT,
    vrf_draw_completed_at TIMESTAMPTZ,
    winner_address TEXT,
    winner_ticket_number INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### tickets Table

```sql
CREATE TABLE tickets (
    id UUID PRIMARY KEY,
    competition_id UUID REFERENCES competitions(id),
    ticket_number INTEGER NOT NULL,
    canonical_user_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    purchased_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(competition_id, ticket_number)
);
```

### winners Table

```sql
CREATE TABLE winners (
    id UUID PRIMARY KEY,
    competition_id UUID REFERENCES competitions(id),
    canonical_user_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ticket_number INTEGER NOT NULL,
    vrf_tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

## Event Handling

### Smart Contract Events

```solidity
event CompetitionCreated(
    uint256 indexed competitionId,
    uint256 totalTickets,
    uint256 endTimestamp
);

event TicketsPurchased(
    uint256 indexed competitionId,
    address indexed buyer,
    uint256[] ticketNumbers,
    uint256 amount
);

event VRFRequested(
    uint256 indexed competitionId,
    uint256 indexed requestId
);

event WinnerDrawn(
    uint256 indexed competitionId,
    uint256 indexed requestId,
    uint256[] winningNumbers,
    address[] winners
);
```

### Backend Event Listeners

Backend listens for these events to sync blockchain state with database:

```javascript
// Listen for WinnerDrawn events
contract.on('WinnerDrawn', async (competitionId, requestId, winningNumbers, winners) => {
    // Sync winners to database
    await syncWinnersToDatabase(competitionId, winningNumbers, winners);
    
    // Send winner notifications
    await notifyWinners(winners);
    
    // Update competition status
    await updateCompetitionStatus(competitionId, 'completed');
});
```

## VRF Scheduler

The `vrf-scheduler` Netlify function runs every 5 minutes to:

1. Check for competitions in "drawing" status
2. Verify if VRF callback has completed
3. Sync winner data from blockchain
4. Update competition status
5. Send winner notifications

```typescript
// netlify/functions/vrf-scheduler.mts
export const config: Config = {
    schedule: "*/5 * * * *" // Every 5 minutes
};

export default async () => {
    // Get competitions in drawing status
    const { data: competitions } = await supabase
        .from('competitions')
        .select('*')
        .eq('status', 'drawing')
        .not('onchain_competition_id', 'is', null);
    
    for (const comp of competitions) {
        // Check if winners exist on-chain
        const winners = await contract.getWinners(comp.onchain_competition_id);
        
        if (winners.winnerAddresses.length > 0) {
            // Sync winners to database
            await syncWinners(comp, winners);
        }
    }
};
```

## Verification & Transparency

### On-Chain Verification

All competition data and winner selections are verifiable on-chain:

1. **Competition Creation**: View `CompetitionCreated` event
2. **Ticket Sales**: View `TicketsPurchased` events
3. **VRF Request**: View `VRFRequested` event with request ID
4. **Winner Selection**: View `WinnerDrawn` event with:
   - Random number used
   - Winning ticket numbers
   - Winner addresses

### Blockchain Explorer

Users can verify all transactions on Base blockchain explorer:

```
https://basescan.org/tx/{transaction_hash}
https://basescan.org/address/{contract_address}
```

### VRF Verification

Chainlink VRF results are cryptographically verifiable:

```
https://vrf.chain.link/base/{request_id}
```

## Testing

### Testnet Testing

1. Deploy contract to Base Testnet
2. Configure testnet environment variables
3. Test VRF with testnet LINK tokens
4. Verify events on testnet explorer

### Local Testing

```bash
# Start local blockchain
npx hardhat node

# Deploy contracts
npx hardhat run scripts/deploy.js --network localhost

# Run tests
npx hardhat test
```

## Troubleshooting

### VRF Draw Not Completing

1. Check Chainlink subscription has sufficient LINK
2. Verify callback gas limit is sufficient
3. Check VRF coordinator address is correct
4. Review transaction for revert reasons

### Winner Sync Issues

1. Check `vrf-scheduler` function logs
2. Verify contract getWinners() returns data
3. Check database permissions
4. Review Supabase RPC function errors

### Transaction Failures

1. Check gas limits
2. Verify wallet has sufficient ETH for gas
3. Check contract is not paused
4. Verify competition state allows operation

## Security Considerations

1. **VRF Security**: Chainlink VRF provides cryptographically secure randomness
2. **Reentrancy Protection**: Contract uses OpenZeppelin's ReentrancyGuard
3. **Access Control**: Admin functions restricted to authorized addresses
4. **Pausable**: Contract can be paused in emergency
5. **Audit**: Contract should be audited before mainnet deployment

## Gas Optimization

1. **Batch Operations**: Batch ticket purchases when possible
2. **Storage**: Minimize storage writes
3. **Events**: Use indexed parameters efficiently
4. **Callback Gas**: Set appropriate VRF callback gas limit

## Future Enhancements

1. **Multi-Winner Support**: Support for multiple winners per competition
2. **Prize Distribution**: On-chain prize distribution mechanism
3. **NFT Prizes**: NFT minting and transfer for winners
4. **Layer 2**: Optimize for L2 gas costs
5. **Cross-Chain**: Support for multiple blockchains

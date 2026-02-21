// Script to create test competitions via Supabase API
import { createClient } from '@supabase/supabase-js';

// Supabase Config - get from environment or hardcode for testing
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY environment variable');
  console.error('Get it from: Supabase Dashboard > Settings > API > service_role key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Crypto-themed image URLs from Supabase storage
const IMAGES = {
  bitcoin: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/bitcoin-image.webp',
  ethereum: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/Eth%20Tier%201.png',
  solana: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/soltier1.jpg',
  nft: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/nft.webp',
  bundle: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/Tier%201%20(1).jpg',
};

// Helper to get end date 14 days from now
const getEndDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString();
};

// Regular competitions (6)
const regularCompetitions = [
  {
    title: 'Bitcoin Bonanza',
    description: 'Enter for a chance to win Bitcoin! Experience the thrill of crypto with this epic draw. Each ticket brings you closer to the ultimate crypto prize. VRF-verified for provably fair results.',
    image_url: IMAGES.bitcoin,
    ticket_price: 0.10,
    total_tickets: 2500,
    num_winners: 1,
    prize_description: '0.25 BTC Grand Prize',
    prize_type: 'crypto',
    prize_value: 1500.00,
    is_featured: true,
    category: 'crypto',
  },
  {
    title: 'Ethereum Mega Draw',
    description: 'The ultimate Ethereum giveaway! Stack your ETH with this mega competition. Every ticket purchased increases your chances of winning big. Secured by VRF for guaranteed fairness.',
    image_url: IMAGES.ethereum,
    ticket_price: 0.25,
    total_tickets: 2700,
    num_winners: 1,
    prize_description: '2 ETH Grand Prize',
    prize_type: 'crypto',
    prize_value: 3000.00,
    is_featured: true,
    category: 'crypto',
  },
  {
    title: 'Solana Slam',
    description: 'Fast transactions, fast wins! Join the Solana revolution with this exciting draw. The speed of Solana meets the thrill of winning. VRF-powered randomness ensures fair play.',
    image_url: IMAGES.solana,
    ticket_price: 0.50,
    total_tickets: 2600,
    num_winners: 2,
    prize_description: '50 SOL + 25 SOL Runner-up',
    prize_type: 'crypto',
    prize_value: 2500.00,
    is_featured: false,
    category: 'crypto',
  },
  {
    title: 'NFT Extravaganza',
    description: 'Win exclusive digital art! This NFT collection includes rare pieces from top artists. Your chance to own a piece of digital history. Verified fair selection via VRF.',
    image_url: IMAGES.nft,
    ticket_price: 0.75,
    total_tickets: 2800,
    num_winners: 3,
    prize_description: 'Rare NFT Collection (3 Winners)',
    prize_type: 'nft',
    prize_value: 5000.00,
    is_featured: true,
    category: 'nft',
  },
  {
    title: 'Crypto Bundle Supreme',
    description: 'The ultimate crypto portfolio starter! Win a diversified bundle of BTC, ETH, SOL, and more. Perfect for building your dream portfolio. Provably fair with blockchain-verified randomness.',
    image_url: IMAGES.bundle,
    ticket_price: 1.00,
    total_tickets: 3000,
    num_winners: 1,
    prize_description: 'Mixed Crypto Bundle Worth $5000',
    prize_type: 'crypto',
    prize_value: 5000.00,
    is_featured: true,
    category: 'crypto',
  },
  {
    title: 'Altcoin Adventure',
    description: 'Discover the next big thing! Win a curated selection of promising altcoins. From DeFi to Layer 2s, this bundle has it all. Fair winner selection powered by VRF.',
    image_url: IMAGES.bitcoin,
    ticket_price: 0.25,
    total_tickets: 2550,
    num_winners: 5,
    prize_description: 'Altcoin Package (5 Winners)',
    prize_type: 'crypto',
    prize_value: 2000.00,
    is_featured: false,
    category: 'crypto',
  },
];

// Instant win competitions (6)
const instantWinCompetitions = [
  {
    title: 'Instant Bitcoin Blitz',
    description: 'Instant wins, instant thrills! Buy a ticket and instantly find out if you\'ve won Bitcoin. Multiple prize tiers from micro-sats to major BTC prizes. VRF-verified instant reveal.',
    image_url: IMAGES.bitcoin,
    ticket_price: 0.10,
    total_tickets: 2500,
    num_winners: 25,
    winning_ticket_count: 25,
    prize_description: 'Instant Bitcoin Prizes - Multiple Tiers!',
    prize_type: 'crypto',
    prize_value: 1000.00,
    is_featured: true,
    category: 'crypto',
    max_tickets_per_user_percentage: 15,
  },
  {
    title: 'Instant Ethereum Rush',
    description: 'Feel the rush of instant ETH wins! Every ticket is a chance for immediate rewards. From gas money to full ETH prizes. Blockchain-verified fairness guaranteed.',
    image_url: IMAGES.ethereum,
    ticket_price: 0.25,
    total_tickets: 2700,
    num_winners: 30,
    winning_ticket_count: 30,
    prize_description: 'Instant ETH Prizes - Check & Win!',
    prize_type: 'crypto',
    prize_value: 2000.00,
    is_featured: true,
    category: 'crypto',
    max_tickets_per_user_percentage: 15,
  },
  {
    title: 'Instant Solana Speed',
    description: 'Lightning fast wins on the Solana network! Experience the speed of instant rewards. Multiple SOL prizes available across all tiers. VRF-powered instant validation.',
    image_url: IMAGES.solana,
    ticket_price: 0.50,
    total_tickets: 2600,
    num_winners: 20,
    winning_ticket_count: 20,
    prize_description: 'Instant SOL Rewards - Fast Wins!',
    prize_type: 'crypto',
    prize_value: 1500.00,
    is_featured: false,
    category: 'crypto',
    max_tickets_per_user_percentage: 15,
  },
  {
    title: 'Instant NFT Reveal',
    description: 'Scratch and reveal your NFT prize! Instant gratification meets digital art. Win exclusive NFTs the moment you purchase. Provably fair with on-chain verification.',
    image_url: IMAGES.nft,
    ticket_price: 0.75,
    total_tickets: 2800,
    num_winners: 35,
    winning_ticket_count: 35,
    prize_description: 'Instant NFT Drops - Reveal & Win!',
    prize_type: 'nft',
    prize_value: 3500.00,
    is_featured: true,
    category: 'nft',
    max_tickets_per_user_percentage: 15,
  },
  {
    title: 'Instant Crypto Jackpot',
    description: 'The biggest instant win prizes! Premium tickets for premium rewards. Multiple jackpot tiers from small wins to life-changing amounts. VRF ensures every reveal is fair.',
    image_url: IMAGES.bundle,
    ticket_price: 1.00,
    total_tickets: 3000,
    num_winners: 40,
    winning_ticket_count: 40,
    prize_description: 'Instant Jackpot - Mega Prizes!',
    prize_type: 'crypto',
    prize_value: 6000.00,
    is_featured: true,
    category: 'crypto',
    max_tickets_per_user_percentage: 15,
  },
  {
    title: 'Instant Altcoin Scratch',
    description: 'Scratch your way to altcoin riches! Instant reveal of diverse crypto prizes. Win tokens from the hottest projects in DeFi, gaming, and more. Fair randomness via VRF.',
    image_url: IMAGES.bitcoin,
    ticket_price: 0.25,
    total_tickets: 2550,
    num_winners: 28,
    winning_ticket_count: 28,
    prize_description: 'Instant Altcoin Prizes - Scratch & Win!',
    prize_type: 'crypto',
    prize_value: 1800.00,
    is_featured: false,
    category: 'crypto',
    max_tickets_per_user_percentage: 15,
  },
];

async function createCompetition(comp, isInstantWin) {
  const now = new Date().toISOString();
  const endDate = getEndDate();
  
  const data = {
    title: comp.title,
    description: comp.description,
    image_url: comp.image_url,
    ticket_price: comp.ticket_price,
    total_tickets: comp.total_tickets,
    sold_tickets: 0,
    tickets_sold: 0,
    status: 'active',
    start_time: now,
    start_date: now.split('T')[0],
    end_time: endDate,
    end_date: endDate.split('T')[0],
    winner_count: comp.num_winners,
    num_winners: comp.num_winners,
    prize_description: comp.prize_description,
    prize_type: comp.prize_type,
    prize_value: comp.prize_value,
    is_instant_win: isInstantWin,
    is_featured: comp.is_featured,
    vrf_status: 'pending',
    category: comp.category,
    max_tickets_per_user_percentage: comp.max_tickets_per_user_percentage || 10,
    deleted: false,
  };
  
  if (isInstantWin && comp.winning_ticket_count) {
    data.winning_ticket_count = comp.winning_ticket_count;
  }
  
  const { data: result, error } = await supabase
    .from('competitions')
    .insert(data)
    .select('id, title, ticket_price, total_tickets, is_instant_win, is_featured, prize_value')
    .single();
    
  if (error) {
    console.error(`  ✗ ${comp.title}: ${error.message}`);
    return null;
  }
  
  return result;
}

async function main() {
  console.log('Creating 12 test competitions...\n');
  
  console.log('=== REGULAR COMPETITIONS (6) ===');
  for (const comp of regularCompetitions) {
    const result = await createCompetition(comp, false);
    if (result) {
      console.log(`  ✓ ${result.title} (ID: ${result.id.substring(0, 8)}..., $${result.ticket_price}/ticket, ${result.total_tickets} tickets)`);
    }
  }
  
  console.log('\n=== INSTANT WIN COMPETITIONS (6) ===');
  for (const comp of instantWinCompetitions) {
    const result = await createCompetition(comp, true);
    if (result) {
      console.log(`  ✓ ${result.title} (ID: ${result.id.substring(0, 8)}..., $${result.ticket_price}/ticket, ${result.total_tickets} tickets)`);
    }
  }
  
  console.log('\n✓ Done! Created 12 test competitions.');
  console.log('\nVerifying...');
  
  const { data: verify, error: verifyError } = await supabase
    .from('competitions')
    .select('id, title, ticket_price, total_tickets, is_instant_win, is_featured, prize_value, status')
    .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .order('is_instant_win')
    .order('title');
    
  if (verifyError) {
    console.error('Verification error:', verifyError.message);
  } else {
    console.log(`\nFound ${verify.length} competitions created in the last 5 minutes:`);
    console.table(verify.map(r => ({
      id: r.id.substring(0, 8) + '...',
      title: r.title.substring(0, 25) + (r.title.length > 25 ? '...' : ''),
      price: `$${r.ticket_price.toFixed(2)}`,
      tickets: r.total_tickets,
      instant: r.is_instant_win ? 'YES' : 'NO',
      featured: r.is_featured ? 'YES' : 'NO',
      prize: `$${r.prize_value}`,
      status: r.status
    })));
  }
}

main().catch(console.error);

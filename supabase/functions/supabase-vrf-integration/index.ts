import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther } from "npm:viem@2";
import { privateKeyToAccount } from "npm:viem/accounts";
import { base } from "npm:viem/chains";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// REAL WORKING VRF CONTRACT
const VRF_CONTRACT_ADDRESS = "0x8ce54644e3313934d663c43aea29641dfd8bca1a";
const VRF_SUBSCRIPTION_ID = "40016523493752259025618720390878595579900340174747129204280165685361210628809";

// Real Competition VRF Contract ABI
const COMPETITION_VRF_ABI = [
  {
    name: "createCompetition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "totalTickets", type: "uint256" },
      { name: "pricePerTicketWei", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "numWinners", type: "uint8" },
      { name: "maxTicketsPerTx", type: "uint32" }
    ],
    outputs: [{ name: "competitionId", type: "uint256" }]
  },
  {
    name: "buyTickets",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "competitionId", type: "uint256" },
      { name: "count", type: "uint32" }
    ],
    outputs: []
  },
  {
    name: "drawWinners",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "competitionId", type: "uint256" },
      { name: "useVRF", type: "bool" }
    ],
    outputs: [{ name: "requestId", type: "uint256" }]
  },
  {
    name: "getWinners",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "competitionId", type: "uint256" }],
    outputs: [
      { name: "winningNumbers", type: "uint256[]" },
      { name: "winners", type: "address[]" }
    ]
  },
  {
    name: "competitions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "competitionId", type: "uint256" }],
    outputs: [
      { name: "totalTickets", type: "uint256" },
      { name: "ticketsSold", type: "uint256" },
      { name: "pricePerTicketWei", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "active", type: "bool" },
      { name: "drawn", type: "bool" },
      { name: "numWinners", type: "uint8" },
      { name: "maxTicketsPerTx", type: "uint32" },
      { name: "drawSeed", type: "uint256" }
    ]
  },
  {
    name: "setActive",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "competitionId", type: "uint256" },
      { name: "active", type: "bool" }
    ],
    outputs: []
  },
  {
    name: "nextCompetitionId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  }
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RPC = Deno.env.get("BASE_MAINNET_RPC")!;
    const PK = Deno.env.get("ADMIN_WALLET_PRIVATE_KEY")!;
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res(500, { ok: false, error: "Missing Supabase credentials" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Initialize blockchain clients if credentials available
    let publicClient: any = null;
    let walletClient: any = null;
    
    if (RPC && PK) {
      try {
        publicClient = createPublicClient({ chain: base, transport: http(RPC) });
        
        let privateKey = PK;
        if (!privateKey.startsWith('0x')) {
          privateKey = '0x' + privateKey;
        }
        
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        walletClient = createWalletClient({ chain: base, transport: http(RPC), account });
        
        const chainId = await publicClient.getChainId();
        console.log(`🔗 Connected to Base (Chain ID: ${chainId})`);
      } catch (error) {
        console.log('⚠️ Blockchain connection failed:', error.message);
      }
    }

    const requestData = await req.json();
    const { action, ...params } = requestData;

    console.log('🚀 REAL VRF Integration Action:', { action, contract: VRF_CONTRACT_ADDRESS });

    switch (action) {
      case 'list_pending_competitions':
        return await listPendingCompetitions(supabase);
      
      case 'get_competition_details':
        return await getCompetitionDetails(supabase, params.competitionId);
      
      case 'auto_sync_competitions':
        return await autoSyncCompetitions(supabase, walletClient, publicClient, params);
      
      case 'create_from_database':
        return await createFromDatabase(supabase, walletClient, publicClient, params);
      
      case 'trigger_vrf_draw':
        return await triggerVRFDraw(supabase, walletClient, publicClient, params);
      
      case 'get_competition_status':
        return await getCompetitionStatus(publicClient, params.competitionId);
      
      default:
        return res(400, { ok: false, error: 'Invalid action. Use: list_pending_competitions, get_competition_details, auto_sync_competitions, create_from_database, trigger_vrf_draw, get_competition_status' });
    }

  } catch (e) {
    console.log('💥 Error:', e.message);
    return res(500, { ok: false, error: (e as Error).message });
  }

  // REAL ON-CHAIN SYNC: Create competitions on actual blockchain
  async function autoSyncCompetitions(supabase, walletClient, publicClient, params) {
    if (!walletClient || !publicClient) {
      return res(503, { ok: false, error: 'Blockchain connection not available. Set BASE_MAINNET_RPC and ADMIN_WALLET_PRIVATE_KEY.' });
    }

    console.log('🚀 REAL ON-CHAIN SYNC: Creating competitions on blockchain...');

    const { data: dbCompetitions, error: dbError } = await supabase
      .from("competitions")
      .select("*")
      .eq("status", "active")
      .is("onchain_competition_id", null)
      .order("created_at", { ascending: true })
      .limit(5); // Process up to 5 at a time for safety

    if (dbError) {
      return res(500, { ok: false, error: `Database query failed: ${dbError.message}` });
    }

    if (!dbCompetitions || dbCompetitions.length === 0) {
      return res(200, { ok: true, message: 'No pending competitions to sync', synced: 0 });
    }

    console.log(`📊 Found ${dbCompetitions.length} competitions to create on-chain`);

    const results = [];
    
    for (const comp of dbCompetitions) {
      try {
        console.log(`🚀 Creating REAL on-chain competition: ${comp.title}`);
        
        // Calculate blockchain parameters
        const totalTickets = BigInt(comp.total_tickets || 100);
        const priceInWei = BigInt(Math.floor((comp.ticket_price || 0.01) * 1e18));
        const endTime = BigInt(Math.floor(new Date(comp.end_date).getTime() / 1000));
        const numWinners = BigInt(comp.num_winners || 1);
        const maxTicketsPerTx = BigInt(comp.max_participants ? Math.min(comp.max_participants, 100) : 10);
        
        // Create REAL on-chain competition
        const hash = await walletClient.writeContract({
          address: VRF_CONTRACT_ADDRESS as `0x${string}`,
          abi: COMPETITION_VRF_ABI,
          functionName: 'createCompetition',
          args: [
            totalTickets,
            priceInWei,
            endTime,
            numWinners,
            maxTicketsPerTx
          ]
        });

        console.log(`📤 Transaction submitted: ${hash}`);

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        
        if (receipt.status === 'success') {
          // Extract competition ID from the event logs
          const competitionCreatedEvent = receipt.logs.find(log => 
            log.address.toLowerCase() === VRF_CONTRACT_ADDRESS.toLowerCase()
          );
          
          // Get the next competition ID to determine what was created
          const nextId = await publicClient.readContract({
            address: VRF_CONTRACT_ADDRESS as `0x${string}`,
            abi: COMPETITION_VRF_ABI,
            functionName: 'nextCompetitionId',
            args: []
          });
          
          const competitionId = Number(nextId) - 1; // Subtract 1 to get the ID that was just created
          
          // Update database with REAL on-chain ID
          const { error: updateError } = await supabase
            .from("competitions")
            .update({ 
              onchain_competition_id: competitionId,
              vrf_draw_tx: hash,
              updated_at: new Date().toISOString()
            })
            .eq("id", comp.id);

          if (updateError) {
            console.error('Failed to update database:', updateError);
          }

          results.push({
            id: comp.id,
            title: comp.title,
            onchain_competition_id: competitionId,
            tx_hash: hash,
            status: 'deployed',
            blockchain_url: `https://basescan.org/tx/${hash}`,
            competition_url: `https://basescan.org/address/${VRF_CONTRACT_ADDRESS}`
          });

          console.log(`✅ REAL competition created on-chain: ${comp.title} (ID: ${competitionId})`);
        } else {
          throw new Error('Transaction failed');
        }

      } catch (error) {
        console.error(`Failed to create competition ${comp.id}:`, error);
        results.push({
          id: comp.id,
          title: comp.title,
          status: 'error',
          error: error.message
        });
      }
    }

    return res(200, { 
      ok: true, 
      message: `Created ${results.filter(r => r.status === 'deployed').length} competitions on real blockchain`,
      contract_address: VRF_CONTRACT_ADDRESS,
      subscription_id: VRF_SUBSCRIPTION_ID,
      results: results,
      deployed: results.filter(r => r.status === 'deployed').length,
      errors: results.filter(r => r.status === 'error').length
    });
  }

  // REAL ON-CHAIN: Create single competition
  async function createFromDatabase(supabase, walletClient, publicClient, params) {
    const { competitionId } = params;

    if (!walletClient || !publicClient) {
      return res(503, { ok: false, error: 'Blockchain connection not available. Set BASE_MAINNET_RPC and ADMIN_WALLET_PRIVATE_KEY.' });
    }

    const { data: comp, error } = await supabase
      .from("competitions")
      .select("*")
      .eq("id", competitionId)
      .single();

    if (error || !comp) {
      return res(404, { ok: false, error: 'Competition not found' });
    }

    if (comp.onchain_competition_id) {
      return res(400, { ok: false, error: 'Competition already has on-chain ID' });
    }

    // Calculate blockchain parameters
    const totalTickets = BigInt(comp.total_tickets || 100);
    const priceInWei = BigInt(Math.floor((comp.ticket_price || 0.01) * 1e18));
    const endTime = BigInt(Math.floor(new Date(comp.end_date).getTime() / 1000));
    const numWinners = BigInt(comp.num_winners || 1);
    const maxTicketsPerTx = BigInt(comp.max_participants ? Math.min(comp.max_participants, 100) : 10);

    const hash = await walletClient.writeContract({
      address: VRF_CONTRACT_ADDRESS as `0x${string}`,
      abi: COMPETITION_VRF_ABI,
      functionName: 'createCompetition',
      args: [
        totalTickets,
        priceInWei,
        endTime,
        numWinners,
        maxTicketsPerTx
      ]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'success') {
      const nextId = await publicClient.readContract({
        address: VRF_CONTRACT_ADDRESS as `0x${string}`,
        abi: COMPETITION_VRF_ABI,
        functionName: 'nextCompetitionId',
        args: []
      });
      
      const competitionId = Number(nextId) - 1;

      await supabase
        .from("competitions")
        .update({ 
          onchain_competition_id: competitionId,
          vrf_draw_tx: hash,
          updated_at: new Date().toISOString()
        })
        .eq("id", comp.id);

      return res(200, { 
        ok: true, 
        message: 'REAL competition created on blockchain',
        competition_id: comp.id,
        onchain_competition_id: competitionId,
        tx_hash: hash,
        blockchain_url: `https://basescan.org/tx/${hash}`,
        competition_url: `https://basescan.org/address/${VRF_CONTRACT_ADDRESS}`
      });
    } else {
      throw new Error('Transaction failed');
    }
  }

  // REAL ON-CHAIN: Trigger VRF draw
  async function triggerVRFDraw(supabase, walletClient, publicClient, params) {
    const { competitionId, useVRF = true } = params;

    if (!walletClient || !publicClient) {
      return res(503, { ok: false, error: 'Blockchain connection not available' });
    }

    const hash = await walletClient.writeContract({
      address: VRF_CONTRACT_ADDRESS as `0x${string}`,
      abi: COMPETITION_VRF_ABI,
      functionName: 'drawWinners',
      args: [BigInt(competitionId), useVRF]
    });

    await supabase
      .from("competitions")
      .update({ 
        vrf_requested_at: new Date().toISOString(),
        vrf_draw_tx: hash
      })
      .eq("onchain_competition_id", competitionId);

    return res(200, { 
      ok: true, 
      message: 'REAL VRF draw triggered on blockchain',
      competition_id: competitionId,
      tx_hash: hash,
      blockchain_url: `https://basescan.org/tx/${hash}`,
      vrf_subscription_id: VRF_SUBSCRIPTION_ID,
      use_vrf: useVRF
    });
  }

  // REAL ON-CHAIN: Get competition status from blockchain
  async function getCompetitionStatus(publicClient, competitionId) {
    if (!publicClient) {
      return res(503, { ok: false, error: 'Blockchain connection not available' });
    }

    try {
      const status = await publicClient.readContract({
        address: VRF_CONTRACT_ADDRESS as `0x${string}`,
        abi: COMPETITION_VRF_ABI,
        functionName: 'competitions',
        args: [BigInt(competitionId)]
      });

      return res(200, { 
        ok: true, 
        competition_id: competitionId,
        contract_address: VRF_CONTRACT_ADDRESS,
        status: {
          totalTickets: status[0].toString(),
          ticketsSold: status[1].toString(),
          pricePerTicketWei: status[2].toString(),
          pricePerTicketEth: (Number(status[2]) / 1e18).toString(),
          endTime: status[3].toString(),
          endTimeFormatted: new Date(Number(status[3]) * 1000).toISOString(),
          active: status[4],
          drawn: status[5],
          numWinners: Number(status[6]),
          maxTicketsPerTx: Number(status[7]),
          drawSeed: status[8].toString()
        },
        blockchain_url: `https://basescan.org/address/${VRF_CONTRACT_ADDRESS}`
      });
    } catch (error) {
      return res(404, { ok: false, error: 'Competition not found on blockchain' });
    }
  }

  // List pending competitions from database
  async function listPendingCompetitions(supabase) {
    const { data, error } = await supabase
      .from("competitions")
      .select("id, title, total_tickets, ticket_price, end_date, status, onchain_competition_id, created_at")
      .eq("status", "active")
      .is("onchain_competition_id", null)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) {
      return res(500, { ok: false, error: error.message });
    }

    const competitions = (data || []).map(comp => ({
      ...comp,
      blockchain_ready: true,
      estimated_gas_cost: '0.001-0.005 ETH',
      vrf_enabled: true,
      contract_address: VRF_CONTRACT_ADDRESS,
      subscription_id: VRF_SUBSCRIPTION_ID,
      end_date_formatted: comp.end_date ? new Date(comp.end_date).toLocaleString() : 'No end date',
      created_at_formatted: new Date(comp.created_at).toLocaleString()
    }));

    return res(200, { 
      ok: true, 
      competitions,
      total_count: competitions.length,
      contract_info: {
        address: VRF_CONTRACT_ADDRESS,
        subscription_id: VRF_SUBSCRIPTION_ID,
        network: 'base-mainnet'
      },
      blockchain_integration: 'active',
      next_steps: [
        '✅ Real VRF contract deployed',
        '✅ Supabase integration ready',
        '🔄 Call auto_sync_competitions to create on-chain competitions',
        '⚡ Test VRF draws for winner selection'
      ]
    });
  }

  // Get detailed competition information
  async function getCompetitionDetails(supabase, competitionId) {
    const { data, error } = await supabase
      .from("competitions")
      .select("*")
      .eq("id", competitionId)
      .single();

    if (error || !data) {
      return res(404, { ok: false, error: 'Competition not found' });
    }

    // Calculate blockchain deployment info
    const blockchainParams = {
      totalTickets: data.total_tickets || 100,
      pricePerTicketWei: Math.floor((data.ticket_price || 0.01) * 1e18),
      endTime: Math.floor(new Date(data.end_date).getTime() / 1000),
      numWinners: data.num_winners || 1,
      maxTicketsPerTx: data.max_participants ? Math.min(data.max_participants, 100) : 10,
      title: data.title,
      description: data.description || '',
      imageUrl: data.image_url || ''
    };

    const isOnChain = !!data.onchain_competition_id;
    const isEnded = data.end_date ? new Date(data.end_date) < new Date() : false;
    const canDrawVRF = isOnChain && isEnded;

    return res(200, {
      ok: true,
      competition: {
        ...data,
        blockchain_params: blockchainParams,
        blockchain_ready: !isOnChain,
        vrf_ready: canDrawVRF,
        can_trigger_draw: canDrawVRF,
        blockchain_status: isOnChain ? 'deployed' : 'pending',
        contract_info: {
          address: VRF_CONTRACT_ADDRESS,
          subscription_id: VRF_SUBSCRIPTION_ID,
          network: 'base-mainnet'
        },
        blockchain_integration_steps: isOnChain ? [
          '✅ Deployed to real blockchain',
          '✅ Database updated with on-chain ID',
          canDrawVRF ? '⚡ Can trigger REAL VRF draw' : '⏳ Waiting for competition end'
        ] : [
          '🔄 Ready for blockchain deployment',
          '⚡ Will enable REAL VRF draws after deployment',
          '💰 Estimated cost: 0.001-0.005 ETH'
        ]
      }
    });
  }
});
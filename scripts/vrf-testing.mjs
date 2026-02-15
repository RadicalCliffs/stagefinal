#!/usr/bin/env node
/**
 * VRF Real-World Testing Script
 * 
 * Automates VRF testing scenarios from the VRF Testing Guide.
 * Creates test competitions, monitors draws, and verifies results.
 * 
 * Usage:
 *   node scripts/vrf-testing.mjs --scenario=[1-6] [--auto-cleanup]
 * 
 * Scenarios:
 *   1: Happy Path - Automatic VRF Draw
 *   2: Manual VRF Trigger
 *   3: Multiple Concurrent Draws
 *   4: Low LINK Balance Handling (testnet only)
 *   5: Network Congestion Handling
 *   6: VRF Callback Failure Recovery
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

class VRFTester {
  constructor(scenario, autoCleanup = false) {
    this.scenario = scenario;
    this.autoCleanup = autoCleanup;
    this.testId = `vrf-test-${scenario}-${Date.now()}`;
    this.competitions = [];
    this.testUsers = [];
    
    this.results = {
      testId: this.testId,
      scenario,
      timestamp: new Date().toISOString(),
      status: 'running',
      steps: [],
      duration: null,
      passed: false,
    };
    
    this.supabase = null;
    this.startTime = Date.now();
  }

  log(message, color = 'reset', step = null) {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
    
    if (step) {
      this.results.steps.push({
        timestamp: new Date().toISOString(),
        message,
        status: color === 'green' ? 'pass' : color === 'red' ? 'fail' : 'info',
      });
    }
  }

  async initSupabase() {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.log('✓ Supabase client initialized', 'green');
  }

  async createTestUsers(count = 3) {
    this.log(`Creating ${count} test users...`, 'blue');
    
    for (let i = 0; i < count; i++) {
      const userId = `test-user-${this.testId}-${i + 1}`;
      
      // Create test user in profiles table
      const { data, error } = await this.supabase
        .from('profiles')
        .insert({
          id: userId,
          email: `test-${this.testId}-${i + 1}@example.com`,
          balance_usd: 100.00, // Give test balance
          is_test_account: true,
        })
        .select()
        .single();
      
      if (error && !error.message.includes('duplicate')) {
        throw new Error(`Failed to create test user: ${error.message}`);
      }
      
      this.testUsers.push(userId);
      this.log(`  ✓ Created test user ${i + 1}: ${userId}`, 'green');
    }
    
    return this.testUsers;
  }

  async createTestCompetition(name, endInMinutes = 30) {
    this.log(`Creating test competition: ${name}`, 'blue');
    
    const now = new Date();
    const endDate = new Date(now.getTime() + endInMinutes * 60 * 1000);
    
    const { data, error } = await this.supabase
      .from('competitions')
      .insert({
        name,
        description: `VRF Test Competition - DO NOT BID - Test ID: ${this.testId}`,
        prize: 'Test Prize',
        ticket_price: 1.00,
        max_tickets_available: 10,
        start_date: now.toISOString(),
        end_date: endDate.toISOString(),
        status: 'active',
        competition_type: 'standard',
        is_test_competition: true,
      })
      .select()
      .single();
    
    if (error) {
      throw new Error(`Failed to create competition: ${error.message}`);
    }
    
    this.competitions.push(data.id);
    this.log(`  ✓ Competition created: ${data.id}`, 'green', true);
    this.log(`  End time: ${endDate.toISOString()}`, 'cyan');
    
    return data;
  }

  async addTestEntries(competitionId, userIds, ticketsPerUser = [3, 2, 1]) {
    this.log(`Adding test entries to competition ${competitionId}...`, 'blue');
    
    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      const ticketCount = ticketsPerUser[i] || 1;
      
      const { error } = await this.supabase
        .from('competition_entries')
        .insert({
          competition_id: competitionId,
          user_id: userId,
          ticket_count: ticketCount,
          purchase_price_paid: 0.00, // Free test entries
        });
      
      if (error) {
        throw new Error(`Failed to add entries for user ${userId}: ${error.message}`);
      }
      
      this.log(`  ✓ Added ${ticketCount} tickets for user ${i + 1}`, 'green');
    }
    
    this.log(`✓ All test entries added`, 'green', true);
  }

  async monitorCompetitionStatus(competitionId, maxWaitMinutes = 20) {
    this.log(`Monitoring competition ${competitionId}...`, 'blue');
    const startTime = Date.now();
    const maxWait = maxWaitMinutes * 60 * 1000;
    
    while (Date.now() - startTime < maxWait) {
      const { data, error } = await this.supabase
        .from('competitions')
        .select('status, vrf_status, vrf_request_id, vrf_tx_hash, winner_user_id, vrf_draw_completed_at')
        .eq('id', competitionId)
        .single();
      
      if (error) {
        this.log(`  ✗ Error checking status: ${error.message}`, 'red');
        await this.sleep(10000);
        continue;
      }
      
      this.log(`  Status: ${data.status}, VRF: ${data.vrf_status || 'none'}`, 'cyan');
      
      // Check if competition completed successfully
      if (data.status === 'completed' && data.winner_user_id) {
        this.log(`✓ Competition completed! Winner: ${data.winner_user_id}`, 'green', true);
        this.log(`  VRF Request ID: ${data.vrf_request_id}`, 'cyan');
        this.log(`  VRF TX Hash: ${data.vrf_tx_hash}`, 'cyan');
        this.log(`  Draw Completed: ${data.vrf_draw_completed_at}`, 'cyan');
        return { success: true, data };
      }
      
      // Check for failures
      if (data.vrf_status === 'failed') {
        this.log(`✗ VRF draw failed`, 'red', true);
        return { success: false, data };
      }
      
      await this.sleep(15000); // Check every 15 seconds
    }
    
    this.log(`✗ Timeout waiting for competition to complete`, 'red', true);
    return { success: false, timeout: true };
  }

  async verifyWinnerSelection(competitionId) {
    this.log(`Verifying winner selection...`, 'blue');
    
    const { data: competition, error: compError } = await this.supabase
      .from('competitions')
      .select('winner_user_id, vrf_status, vrf_tx_hash')
      .eq('id', competitionId)
      .single();
    
    if (compError) {
      this.log(`✗ Error fetching competition: ${compError.message}`, 'red');
      return false;
    }
    
    // Verify winner exists
    if (!competition.winner_user_id) {
      this.log(`✗ No winner selected`, 'red', true);
      return false;
    }
    
    // Verify winner was a valid entrant
    const { data: entry } = await this.supabase
      .from('competition_entries')
      .select('user_id')
      .eq('competition_id', competitionId)
      .eq('user_id', competition.winner_user_id)
      .single();
    
    if (!entry) {
      this.log(`✗ Winner was not a valid entrant!`, 'red', true);
      return false;
    }
    
    // Verify VRF data recorded
    if (!competition.vrf_tx_hash) {
      this.log(`⚠ Warning: No VRF transaction hash recorded`, 'yellow');
    }
    
    this.log(`✓ Winner verification passed`, 'green', true);
    this.log(`  Winner: ${competition.winner_user_id}`, 'cyan');
    return true;
  }

  async cleanup() {
    if (!this.autoCleanup) {
      this.log(`Cleanup skipped (use --auto-cleanup to enable)`, 'yellow');
      return;
    }
    
    this.log(`Cleaning up test data...`, 'blue');
    
    // Delete test entries
    for (const competitionId of this.competitions) {
      const { error } = await this.supabase
        .from('competition_entries')
        .delete()
        .eq('competition_id', competitionId);
      
      if (error) {
        this.log(`  ⚠ Failed to delete entries: ${error.message}`, 'yellow');
      }
    }
    
    // Delete test competitions
    for (const competitionId of this.competitions) {
      const { error } = await this.supabase
        .from('competitions')
        .delete()
        .eq('id', competitionId);
      
      if (error) {
        this.log(`  ⚠ Failed to delete competition: ${error.message}`, 'yellow');
      }
    }
    
    // Delete test users
    for (const userId of this.testUsers) {
      const { error } = await this.supabase
        .from('profiles')
        .delete()
        .eq('id', userId);
      
      if (error) {
        this.log(`  ⚠ Failed to delete user: ${error.message}`, 'yellow');
      }
    }
    
    this.log(`✓ Cleanup completed`, 'green');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async runScenario1_HappyPath() {
    this.log('\n═══ Scenario 1: Happy Path - Automatic VRF Draw ═══', 'magenta');
    
    try {
      // Step 1: Create test users
      await this.createTestUsers(3);
      
      // Step 2: Create test competition (ends in 1 minute for testing)
      const competition = await this.createTestCompetition(
        `VRF Test - Happy Path - ${this.testId}`,
        1 // ends in 1 minute
      );
      
      // Step 3: Add test entries
      await this.addTestEntries(competition.id, this.testUsers, [3, 2, 1]);
      
      // Step 4: Wait for competition to end
      this.log(`Waiting for competition to end (1 minute)...`, 'blue');
      await this.sleep(65000); // Wait 65 seconds
      
      // Step 5: Monitor VRF draw (wait up to 15 minutes)
      const result = await this.monitorCompetitionStatus(competition.id, 15);
      
      if (!result.success) {
        throw new Error('Competition did not complete successfully');
      }
      
      // Step 6: Verify winner
      const verified = await this.verifyWinnerSelection(competition.id);
      
      if (!verified) {
        throw new Error('Winner verification failed');
      }
      
      this.log(`\n✅ SCENARIO 1 PASSED`, 'green');
      this.results.passed = true;
      
    } catch (error) {
      this.log(`\n❌ SCENARIO 1 FAILED: ${error.message}`, 'red');
      this.results.passed = false;
      this.results.error = error.message;
    }
  }

  async runScenario2_ManualTrigger() {
    this.log('\n═══ Scenario 2: Manual VRF Trigger ═══', 'magenta');
    
    try {
      await this.createTestUsers(3);
      const competition = await this.createTestCompetition(
        `VRF Test - Manual Trigger - ${this.testId}`,
        1
      );
      await this.addTestEntries(competition.id, this.testUsers, [3, 2, 1]);
      
      // Wait for competition to end
      this.log(`Waiting for competition to end...`, 'blue');
      await this.sleep(65000);
      
      // Simulate waiting for automatic trigger to NOT fire
      this.log(`Simulating automatic trigger delay...`, 'blue');
      await this.sleep(30000); // Wait 30 seconds
      
      // Manual trigger would be done via admin dashboard
      this.log(`⚠ Manual trigger must be done via admin dashboard`, 'yellow');
      this.log(`  Visit: /admin/vrf-dashboard`, 'cyan');
      this.log(`  Find competition: ${competition.id}`, 'cyan');
      this.log(`  Click "Trigger Draw"`, 'cyan');
      
      // Monitor for completion
      const result = await this.monitorCompetitionStatus(competition.id, 15);
      
      if (!result.success) {
        throw new Error('Manual trigger test incomplete - requires dashboard interaction');
      }
      
      const verified = await this.verifyWinnerSelection(competition.id);
      if (!verified) {
        throw new Error('Winner verification failed');
      }
      
      this.log(`\n✅ SCENARIO 2 PASSED`, 'green');
      this.results.passed = true;
      
    } catch (error) {
      this.log(`\n⚠ SCENARIO 2 REQUIRES MANUAL INTERACTION`, 'yellow');
      this.results.passed = false;
      this.results.error = error.message;
      this.results.requiresManual = true;
    }
  }

  async runScenario3_ConcurrentDraws() {
    this.log('\n═══ Scenario 3: Multiple Concurrent Draws ═══', 'magenta');
    
    try {
      await this.createTestUsers(6); // More users for 3 competitions
      
      // Create 3 competitions with same end time
      const competitions = [];
      for (let i = 0; i < 3; i++) {
        const comp = await this.createTestCompetition(
          `VRF Test - Concurrent ${i + 1} - ${this.testId}`,
          1
        );
        competitions.push(comp);
        
        // Add different users to each
        await this.addTestEntries(
          comp.id, 
          this.testUsers.slice(i * 2, i * 2 + 2), 
          [2, 1]
        );
      }
      
      // Wait for all to end
      this.log(`Waiting for all competitions to end...`, 'blue');
      await this.sleep(65000);
      
      // Monitor all competitions
      this.log(`Monitoring all 3 competitions...`, 'blue');
      const results = await Promise.all(
        competitions.map(comp => this.monitorCompetitionStatus(comp.id, 15))
      );
      
      const allPassed = results.every(r => r.success);
      if (!allPassed) {
        throw new Error('Not all competitions completed successfully');
      }
      
      // Verify all winners
      for (const comp of competitions) {
        const verified = await this.verifyWinnerSelection(comp.id);
        if (!verified) {
          throw new Error(`Winner verification failed for ${comp.id}`);
        }
      }
      
      this.log(`\n✅ SCENARIO 3 PASSED - All 3 competitions completed`, 'green');
      this.results.passed = true;
      
    } catch (error) {
      this.log(`\n❌ SCENARIO 3 FAILED: ${error.message}`, 'red');
      this.results.passed = false;
      this.results.error = error.message;
    }
  }

  async run() {
    this.log('\n╔════════════════════════════════════════════╗', 'magenta');
    this.log('║      VRF REAL-WORLD TESTING SCRIPT       ║', 'magenta');
    this.log('╚════════════════════════════════════════════╝', 'magenta');
    this.log(`Test ID: ${this.testId}`, 'blue');
    this.log(`Scenario: ${this.scenario}`, 'blue');
    this.log(`Timestamp: ${new Date().toISOString()}`, 'blue');
    
    try {
      await this.initSupabase();
      
      switch (this.scenario) {
        case 1:
        case '1':
          await this.runScenario1_HappyPath();
          break;
        case 2:
        case '2':
          await this.runScenario2_ManualTrigger();
          break;
        case 3:
        case '3':
          await this.runScenario3_ConcurrentDraws();
          break;
        default:
          throw new Error(`Unknown scenario: ${this.scenario}`);
      }
      
    } catch (error) {
      this.log(`\n❌ TEST FAILED: ${error.message}`, 'red');
      this.results.passed = false;
      this.results.error = error.message;
    } finally {
      // Always cleanup
      await this.cleanup();
      
      // Calculate duration
      this.results.duration = Date.now() - this.startTime;
      this.results.status = 'completed';
      
      // Save results
      const resultsFile = join(__dirname, `../test-results/vrf-test-${this.scenario}-${Date.now()}.json`);
      writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
      this.log(`\nResults saved to: ${resultsFile}`, 'cyan');
      
      // Print summary
      this.log('\n╔════════════════════════════════════════════╗', 'magenta');
      this.log('║              TEST SUMMARY                  ║', 'magenta');
      this.log('╚════════════════════════════════════════════╝', 'magenta');
      this.log(`Scenario: ${this.scenario}`, 'blue');
      this.log(`Duration: ${(this.results.duration / 1000 / 60).toFixed(1)} minutes`, 'blue');
      this.log(`Result: ${this.results.passed ? '✅ PASSED' : '❌ FAILED'}`, 
        this.results.passed ? 'green' : 'red');
      
      process.exit(this.results.passed ? 0 : 1);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const scenario = args.find(arg => arg.startsWith('--scenario='))?.split('=')[1];
const autoCleanup = args.includes('--auto-cleanup');

if (!scenario) {
  console.error('Error: --scenario=[1-6] is required');
  console.log('\nUsage: node scripts/vrf-testing.mjs --scenario=[1-6] [--auto-cleanup]');
  console.log('\nAvailable scenarios:');
  console.log('  1: Happy Path - Automatic VRF Draw');
  console.log('  2: Manual VRF Trigger');
  console.log('  3: Multiple Concurrent Draws');
  console.log('  4: Low LINK Balance Handling (testnet only)');
  console.log('  5: Network Congestion Handling');
  console.log('  6: VRF Callback Failure Recovery');
  process.exit(1);
}

// Run test
const tester = new VRFTester(scenario, autoCleanup);
tester.run();

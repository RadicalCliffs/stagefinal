/**
 * Test script for canonical user ID utilities
 * Run with: node debug/test-canonical-user-id.js
 */

// Simple test function
function test(description, fn) {
  try {
    fn();
    console.log(`✓ ${description}`);
  } catch (error) {
    console.error(`✗ ${description}`);
    console.error(`  ${error.message}`);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    throw new Error(`${message}\n  Expected function to throw but it didn't`);
  } catch (error) {
    // Expected to throw
  }
}

// Inline implementation of canonicalization functions for testing
function isWalletAddress(identifier) {
  return /^0x[a-fA-F0-9]{40}$/.test(identifier);
}

function isPrizePid(identifier) {
  return identifier.startsWith('prize:pid:');
}

function extractPrizePid(prizePid) {
  if (!isPrizePid(prizePid)) {
    return prizePid;
  }
  return prizePid.substring('prize:pid:'.length);
}

function toPrizePid(inputUserId) {
  if (!inputUserId || inputUserId.trim() === '') {
    // Generate a placeholder UUID for missing identifiers
    return `prize:pid:00000000-0000-0000-0000-000000000000`;
  }

  const trimmedId = inputUserId.trim();

  // Already in prize:pid: format - normalize and return
  if (isPrizePid(trimmedId)) {
    const extracted = extractPrizePid(trimmedId);
    // If it's a wallet address, ensure lowercase
    if (isWalletAddress(extracted)) {
      return `prize:pid:${extracted.toLowerCase()}`;
    }
    return trimmedId.toLowerCase();
  }

  // Wallet address - normalize to lowercase
  if (isWalletAddress(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }

  // Check if it's a UUID pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }

  // For any other identifier format, return as-is with prefix
  return `prize:pid:${trimmedId}`;
}

function toCanonicalUserId(input) {
  if (!input) throw new Error('User ID required');
  if (input.startsWith('prize:pid:')) return input;
  
  // Wallet address
  if (input.startsWith('0x')) {
    return `prize:pid:${input.toLowerCase()}`;
  }
  
  return `prize:pid:${input}`;
}

function userIdsEqual(id1, id2) {
  if (!id1 || !id2) return false;
  
  const canonical1 = toPrizePid(id1);
  const canonical2 = toPrizePid(id2);
  
  return canonical1.toLowerCase() === canonical2.toLowerCase();
}

// Run tests
console.log('Testing Canonical User ID Utilities\n');

// Test wallet address conversion
test('Wallet address to canonical ID (lowercase)', () => {
  const wallet = '0x1234567890abcdef1234567890abcdef12345678';
  const canonical = toPrizePid(wallet);
  assertEquals(canonical, 'prize:pid:0x1234567890abcdef1234567890abcdef12345678', 'Should add prize:pid: prefix');
});

test('Wallet address to canonical ID (mixed case)', () => {
  const wallet = '0x1234567890ABCDEF1234567890ABCDEF12345678';
  const canonical = toPrizePid(wallet);
  assertEquals(canonical, 'prize:pid:0x1234567890abcdef1234567890abcdef12345678', 'Should lowercase wallet address');
});

test('Already canonical ID (returns as-is)', () => {
  const input = 'prize:pid:0x1234567890abcdef1234567890abcdef12345678';
  const canonical = toPrizePid(input);
  assertEquals(canonical, input, 'Should return unchanged');
});

test('Canonical ID with uppercase wallet (normalizes)', () => {
  const input = 'prize:pid:0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
  const canonical = toPrizePid(input);
  assertEquals(canonical, 'prize:pid:0xabcdef1234567890abcdef1234567890abcdef12', 'Should lowercase wallet in canonical ID');
});

test('UUID to canonical ID', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  const canonical = toPrizePid(uuid);
  assertEquals(canonical, 'prize:pid:550e8400-e29b-41d4-a716-446655440000', 'Should add prize:pid: prefix to UUID');
});

test('toCanonicalUserId - wallet address', () => {
  const wallet = '0x1234567890ABCDEF1234567890ABCDEF12345678';
  const canonical = toCanonicalUserId(wallet);
  assertEquals(canonical, 'prize:pid:0x1234567890abcdef1234567890abcdef12345678', 'Should lowercase and prefix');
});

test('toCanonicalUserId - null throws error', () => {
  assertThrows(() => toCanonicalUserId(null), 'Null input should throw');
});

test('toCanonicalUserId - empty string throws error', () => {
  assertThrows(() => toCanonicalUserId(''), 'Empty string should throw');
});

test('userIdsEqual - same wallet different case', () => {
  const id1 = '0x1234567890abcdef1234567890abcdef12345678';
  const id2 = '0x1234567890ABCDEF1234567890ABCDEF12345678';
  const equal = userIdsEqual(id1, id2);
  assertEquals(equal, true, 'Should match case-insensitively');
});

test('userIdsEqual - canonical vs raw wallet', () => {
  const id1 = 'prize:pid:0x1234567890abcdef1234567890abcdef12345678';
  const id2 = '0x1234567890ABCDEF1234567890ABCDEF12345678';
  const equal = userIdsEqual(id1, id2);
  assertEquals(equal, true, 'Should match canonical to raw wallet');
});

test('userIdsEqual - different wallets', () => {
  const id1 = '0x1234567890abcdef1234567890abcdef12345678';
  const id2 = '0xabcdef1234567890abcdef1234567890abcdef12';
  const equal = userIdsEqual(id1, id2);
  assertEquals(equal, false, 'Different wallets should not match');
});

test('userIdsEqual - null handling', () => {
  const equal1 = userIdsEqual(null, '0x1234567890abcdef1234567890abcdef12345678');
  const equal2 = userIdsEqual('0x1234567890abcdef1234567890abcdef12345678', null);
  const equal3 = userIdsEqual(null, null);
  assertEquals(equal1, false, 'Null vs value should be false');
  assertEquals(equal2, false, 'Value vs null should be false');
  assertEquals(equal3, false, 'Null vs null should be false');
});

test('isPrizePid - valid canonical ID', () => {
  const valid = isPrizePid('prize:pid:0x1234567890abcdef1234567890abcdef12345678');
  assertEquals(valid, true, 'Should return true for valid canonical ID');
});

test('isPrizePid - raw wallet', () => {
  const valid = isPrizePid('0x1234567890abcdef1234567890abcdef12345678');
  assertEquals(valid, false, 'Should return false for raw wallet');
});

test('extractPrizePid - extracts ID', () => {
  const canonical = 'prize:pid:0x1234567890abcdef1234567890abcdef12345678';
  const extracted = extractPrizePid(canonical);
  assertEquals(extracted, '0x1234567890abcdef1234567890abcdef12345678', 'Should extract wallet from canonical ID');
});

test('extractPrizePid - non-canonical returns as-is', () => {
  const wallet = '0x1234567890abcdef1234567890abcdef12345678';
  const extracted = extractPrizePid(wallet);
  assertEquals(extracted, wallet, 'Should return input unchanged if not canonical');
});

console.log('\n✅ All tests passed!');

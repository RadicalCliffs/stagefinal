/**
 * Standalone test runner for shouldShowUnavailableBanner
 * Can be run with: node ticketAvailabilityLogic.standalone.test.js
 */

// Copy of the helper function for standalone testing
function shouldShowUnavailableBanner(params) {
  const { availableCount, isSoldOut, availabilityError, isAuthoritative } = params;
  
  // Never show unavailable banner if sold out (sold out banner takes precedence)
  if (isSoldOut) {
    return false;
  }
  
  // Show banner only when the COMPUTED availableCount is 0
  // This uses fallback when authoritative fails, so we only show the banner
  // when tickets are truly unavailable according to best available data
  return availableCount === 0 && availabilityError !== null;
}

// Simple test framework
let testsPassed = 0;
let testsFailed = 0;

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
    console.error(`  Expected: ${expected}, Got: ${actual}`);
    testsFailed++;
  }
}

console.log('\n🧪 Testing shouldShowUnavailableBanner logic\n');

// Test 1: Should NOT show banner when sold out (sold out banner takes precedence)
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 0,
    isSoldOut: true,
    availabilityError: 'RPC failed',
    isAuthoritative: false,
  }),
  false,
  'Should NOT show banner when sold out (sold out banner takes precedence)'
);

// Test 2: Should NOT show banner when tickets available and no error
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 2000,
    isSoldOut: false,
    availabilityError: null,
    isAuthoritative: true,
  }),
  false,
  'Should NOT show banner when tickets available (authoritative)'
);

// Test 3: Should NOT show banner when RPC fails but fallback shows tickets available
// This is the KEY fix - the main bug case
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 2000, // Fallback shows 2000 available
    isSoldOut: false,
    availabilityError: 'HTTP 400',
    isAuthoritative: false, // Using fallback data
  }),
  false,
  'Should NOT show banner when RPC fails but fallback shows tickets available (KEY BUG FIX)'
);

// Test 4: Should show banner when authoritative RPC succeeds but shows 0 available
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 0,
    isSoldOut: false,
    availabilityError: 'Some error', // There's an error
    isAuthoritative: true,
  }),
  true,
  'Should show banner when error exists and availableCount is 0 (authoritative)'
);

// Test 5: Should show banner when fallback also shows 0 available with error
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 0,
    isSoldOut: false,
    availabilityError: 'RPC failed',
    isAuthoritative: false,
  }),
  true,
  'Should show banner when fallback shows 0 available with error'
);

// Test 6: Should NOT show banner when no error even if 0 available
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 0,
    isSoldOut: false,
    availabilityError: null, // No error
    isAuthoritative: true,
  }),
  false,
  'Should NOT show banner when no error even if 0 available'
);

// Test 7: Should NOT show banner when tickets available (fallback case)
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 1500,
    isSoldOut: false,
    availabilityError: 'Failed to fetch',
    isAuthoritative: false,
  }),
  false,
  'Should NOT show banner when tickets available via fallback'
);

// Test 8: Edge case - availableCount is 1, not sold out, has error
assertEqual(
  shouldShowUnavailableBanner({
    availableCount: 1,
    isSoldOut: false,
    availabilityError: 'Some network issue',
    isAuthoritative: false,
  }),
  false,
  'Should NOT show banner when even 1 ticket is available'
);

console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}

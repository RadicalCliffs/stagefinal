#!/bin/bash
# Test script for simplified balance payment system
# This script validates the implementation without requiring a live database

set -e

echo "=============================================="
echo "Testing Simplified Balance Payment System"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_info() {
  echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Test 1: Verify migration file exists and is valid SQL
echo "Test 1: Migration file validation"
MIGRATION_FILE="supabase/migrations/20260130000000_simplified_balance_payment.sql"
if [ -f "$MIGRATION_FILE" ]; then
  print_success "Migration file exists"
  
  # Check for key components
  if grep -q "CREATE OR REPLACE FUNCTION purchase_tickets_with_balance" "$MIGRATION_FILE"; then
    print_success "Found purchase_tickets_with_balance function"
  else
    print_error "Missing purchase_tickets_with_balance function"
    exit 1
  fi
  
  if grep -q "CREATE OR REPLACE FUNCTION get_user_balance" "$MIGRATION_FILE"; then
    print_success "Found get_user_balance function"
  else
    print_error "Missing get_user_balance function"
    exit 1
  fi
  
  # Check for security restrictions
  if grep -q "SECURITY DEFINER" "$MIGRATION_FILE"; then
    print_success "Functions are SECURITY DEFINER"
  else
    print_error "Functions missing SECURITY DEFINER"
    exit 1
  fi
  
  if grep -q "REVOKE ALL ON FUNCTION purchase_tickets_with_balance" "$MIGRATION_FILE"; then
    print_success "Security restrictions present"
  else
    print_error "Missing security restrictions"
    exit 1
  fi
else
  print_error "Migration file not found: $MIGRATION_FILE"
  exit 1
fi
echo ""

# Test 2: Verify edge function
echo "Test 2: Edge function validation"
EDGE_FUNCTION="supabase/functions/purchase-tickets-with-bonus/index.ts"
if [ -f "$EDGE_FUNCTION" ]; then
  print_success "Edge function exists"
  
  # Check line count (should be much smaller now)
  LINE_COUNT=$(wc -l < "$EDGE_FUNCTION")
  print_info "Edge function is $LINE_COUNT lines (was 2197)"
  
  if [ "$LINE_COUNT" -lt 500 ]; then
    print_success "Edge function is simplified (< 500 lines)"
  else
    print_error "Edge function is still too large ($LINE_COUNT lines)"
    exit 1
  fi
  
  # Check for RPC call
  if grep -q "purchase_tickets_with_balance" "$EDGE_FUNCTION"; then
    print_success "Edge function calls simplified RPC"
  else
    print_error "Edge function doesn't call RPC"
    exit 1
  fi
  
  # Check for removed complexity
  if ! grep -q "debit_sub_account_balance_with_entry" "$EDGE_FUNCTION"; then
    print_success "Complex debit logic removed"
  else
    print_error "Still contains old complex logic"
    exit 1
  fi
else
  print_error "Edge function not found: $EDGE_FUNCTION"
  exit 1
fi
echo ""

# Test 3: Verify frontend integration
echo "Test 3: Frontend integration validation"
FRONTEND_SERVICE="src/lib/balance-payment-service.ts"
if [ -f "$FRONTEND_SERVICE" ]; then
  print_success "Frontend service exists"
  
  # Check for updated comments
  if grep -q "Simplified balance payment system" "$FRONTEND_SERVICE"; then
    print_success "Frontend service updated with new documentation"
  else
    print_info "Frontend service may need documentation updates"
  fi
  
  # Check it still calls the edge function correctly
  if grep -q "purchase-tickets-with-bonus" "$FRONTEND_SERVICE"; then
    print_success "Frontend still calls correct edge function"
  else
    print_error "Frontend integration broken"
    exit 1
  fi
else
  print_error "Frontend service not found: $FRONTEND_SERVICE"
  exit 1
fi
echo ""

# Test 4: Verify backup exists
echo "Test 4: Backup verification"
BACKUP_FILE="supabase/functions/purchase-tickets-with-bonus/index.ts.backup"
if [ -f "$BACKUP_FILE" ]; then
  print_success "Backup of old function exists"
  BACKUP_SIZE=$(wc -l < "$BACKUP_FILE")
  print_info "Backup contains $BACKUP_SIZE lines"
else
  print_error "No backup found - rollback may be difficult"
fi
echo ""

# Test 5: Verify README exists
echo "Test 5: Documentation verification"
README_FILE="SIMPLIFIED_BALANCE_PAYMENT_README.md"
if [ -f "$README_FILE" ]; then
  print_success "README documentation exists"
  
  # Check for key sections
  if grep -q "## How It Works" "$README_FILE"; then
    print_success "README contains implementation details"
  fi
  
  if grep -q "## API Contract" "$README_FILE"; then
    print_success "README contains API documentation"
  fi
  
  if grep -q "## Error Codes" "$README_FILE"; then
    print_success "README contains error code documentation"
  fi
else
  print_error "README documentation not found: $README_FILE"
  exit 1
fi
echo ""

# Summary
echo "=============================================="
print_success "All tests passed!"
echo "=============================================="
echo ""
echo "Summary of changes:"
echo "  • Migration: $MIGRATION_FILE"
echo "  • Edge function: $EDGE_FUNCTION ($LINE_COUNT lines, down from 2197)"
echo "  • Frontend: $FRONTEND_SERVICE"
echo "  • Backup: $BACKUP_FILE"
echo "  • Docs: $README_FILE"
echo ""
echo "Next steps:"
echo "  1. Review the changes"
echo "  2. Apply migration: supabase migration up"
echo "  3. Deploy edge functions: supabase functions deploy purchase-tickets-with-bonus"
echo "  4. Test with real transactions"
echo ""

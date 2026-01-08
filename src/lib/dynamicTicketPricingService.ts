// Dynamic Ticket Pricing Service
// Validates ticket prices within the $0.10 - $100 range

interface Competition {
  id: string;
  ticket_price?: number;
  total_tickets: number;
  tickets_sold: number;
  prize_value: number;
  is_featured?: boolean;
  is_instant_win?: boolean;
}

interface PricingResult {
  price: number;
  reason: string;
}

/**
 * Calculate dynamic ticket price for a competition
 * Enforces price range: $0.10 - $100
 */
export function calculateDynamicTicketPrice(competition: Competition): PricingResult {
  const basePrice = competition.ticket_price || 1.0;
  
  // Validate and enforce price limits
  if (basePrice < 0.10) {
    return {
      price: 0.10,
      reason: 'Minimum price enforced ($0.10)'
    };
  }
  
  if (basePrice > 100) {
    return {
      price: 100,
      reason: 'Maximum price enforced ($100)'
    };
  }
  
  // Apply dynamic pricing based on demand
  const soldPercentage = (competition.tickets_sold / competition.total_tickets) * 100;
  let dynamicPrice = basePrice;
  let reason = 'Base price';
  
  // High demand pricing (>75% sold)
  if (soldPercentage > 75) {
    dynamicPrice = Math.min(basePrice * 1.2, 100); // Max 20% increase, cap at $100
    reason = 'High demand pricing (+20%)';
  }
  // Early bird pricing (<25% sold)
  else if (soldPercentage < 25) {
    dynamicPrice = Math.max(basePrice * 0.9, 0.10); // 10% discount, min $0.10
    reason = 'Early bird discount (-10%)';
  }
  
  // Featured competition premium
  if (competition.is_featured) {
    dynamicPrice = Math.min(dynamicPrice * 1.1, 100);
    reason += ' + Featured premium (+10%)';
  }
  
  // Instant win discount
  if (competition.is_instant_win) {
    dynamicPrice = Math.max(dynamicPrice * 0.95, 0.10);
    reason += ' + Instant win discount (-5%)';
  }
  
  // Ensure final price is within bounds
  dynamicPrice = Math.max(0.10, Math.min(100, dynamicPrice));
  
  // Round to 2 decimal places
  dynamicPrice = Math.round(dynamicPrice * 100) / 100;
  
  return {
    price: dynamicPrice,
    reason
  };
}

/**
 * Validate ticket price is within allowed range
 */
export function validateTicketPrice(price: number): boolean {
  return price >= 0.10 && price <= 100;
}

/**
 * Get price range limits
 */
export function getPriceRange() {
  return {
    min: 0.10,
    max: 100
  };
}

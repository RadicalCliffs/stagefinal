-- Create user_overview view that returns one row per canonical user with aggregated data as JSON
-- This view provides a single source of truth for dashboard data

CREATE OR REPLACE VIEW public.user_overview AS
SELECT
    cu.id AS canonical_user_uuid,
    cu.canonical_user_id,
    
    -- Aggregate entries data as JSON array
    -- Note: Using json_agg without DISTINCT to preserve all entries
    -- Duplicates should be handled at application level if needed
    COALESCE(
        json_agg(jsonb_build_object(
            'entry_id', ce.id,
            'competition_id', ce.competition_id,
            'competition_title', ce.competition_title,
            'amount_paid', ce.amount_paid,
            'tickets_count', ce.ticket_count,
            'ticket_numbers_joined', array_to_string(ce.ticket_numbers, ','),
            'created_at', ce.created_at
        )) FILTER (WHERE ce.id IS NOT NULL),
        '[]'::json
    ) AS entries_json,
    
    -- Aggregate tickets data as JSON array
    COALESCE(
        json_agg(jsonb_build_object(
            'ticket_id', t.id,
            'competition_id', t.competition_id,
            'ticket_number', t.ticket_number,
            'created_at', COALESCE(t.purchased_at, t.created_at)
        )) FILTER (WHERE t.id IS NOT NULL),
        '[]'::json
    ) AS tickets_json,
    
    -- Aggregate transactions data as JSON array
    COALESCE(
        json_agg(jsonb_build_object(
            'transaction_id', ut.id,
            'type', ut.transaction_type,
            'amount', ut.amount,
            'currency', ut.currency,
            'status', ut.status,
            'created_at', ut.created_at
        )) FILTER (WHERE ut.id IS NOT NULL),
        '[]'::json
    ) AS transactions_json,
    
    -- Aggregate balances as JSON object (currency -> {available, pending})
    COALESCE(
        jsonb_object_agg(
            wb.currency,
            jsonb_build_object(
                'available', COALESCE(wb.available_balance, 0),
                'pending', COALESCE(wb.pending_balance, 0)
            )
        ) FILTER (WHERE wb.currency IS NOT NULL),
        '{}'::jsonb
    ) AS balances_json,
    
    -- Aggregate ledger data as JSON array
    COALESCE(
        json_agg(jsonb_build_object(
            'ledger_id', wl.id,
            'reference_id', wl.reference_id,
            'transaction_type', wl.transaction_type,
            'amount', wl.amount,
            'currency', wl.currency,
            'balance_before', wl.balance_before,
            'balance_after', wl.balance_after,
            'description', wl.description,
            'created_at', wl.created_at
        )) FILTER (WHERE wl.id IS NOT NULL),
        '[]'::json
    ) AS ledger_json,
    
    -- Counts
    COUNT(DISTINCT ce.id) AS entries_count,
    COUNT(DISTINCT t.id) AS tickets_count,
    COUNT(DISTINCT ut.id) AS transactions_count,
    COUNT(DISTINCT wl.id) AS ledger_count,
    
    -- Totals from ledger
    COALESCE(SUM(wl.amount) FILTER (WHERE wl.amount > 0), 0) AS total_credits,
    COALESCE(ABS(SUM(wl.amount)) FILTER (WHERE wl.amount < 0), 0) AS total_debits

FROM public.canonical_users cu

-- Join competition_entries using canonical_user_id (text)
LEFT JOIN public.competition_entries ce 
    ON ce.canonical_user_id = cu.canonical_user_id
    AND ce.entry_status != 'cancelled'

-- Join tickets using canonical_user_id (text)
LEFT JOIN public.tickets t 
    ON t.canonical_user_id = cu.canonical_user_id
    AND t.status IN ('sold', 'purchased', 'reserved')

-- Join user_transactions using canonical_user_id (text)
LEFT JOIN public.user_transactions ut 
    ON ut.canonical_user_id = cu.canonical_user_id

-- Join wallet_balances using canonical_user_id (text)
LEFT JOIN public.wallet_balances wb 
    ON wb.canonical_user_id = cu.canonical_user_id

-- Join wallet_ledger using canonical_user_id (text)
LEFT JOIN public.wallet_ledger wl 
    ON wl.canonical_user_id = cu.canonical_user_id

GROUP BY cu.id, cu.canonical_user_id;

-- Grant access to authenticated users
GRANT SELECT ON public.user_overview TO authenticated;
GRANT SELECT ON public.user_overview TO anon;

-- Add comment explaining the view
COMMENT ON VIEW public.user_overview IS 'Aggregated user data view - returns one row per canonical user with all related data as JSON. Use canonical_user_id (text) to filter for a specific user.';

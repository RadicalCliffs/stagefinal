# Check what get_comprehensive_user_dashboard_entries RPC actually looks like in production

$SUPABASE_URL = (Get-Content .env | Select-String "VITE_SUPABASE_URL").Line.Split('=')[1]
$SUPABASE_KEY = (Get-Content .env | Select-String "VITE_SUPABASE_ANON_KEY").Line.Split('=')[1]

$headers = @{
    "apikey" = $SUPABASE_KEY
    "Authorization" = "Bearer $SUPABASE_KEY"
    "Content-Type" = "application/json"
}

Write-Host "`n========== Checking RPC function definition ==========" -ForegroundColor Cyan
try {
    # Query to get the function definition
    $sql = "SELECT pg_get_functiondef(oid) as definition FROM pg_proc WHERE proname = 'get_comprehensive_user_dashboard_entries';"
    
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/rpc/query" -Headers $headers -Method Post -Body (@{query=$sql} | ConvertTo-Json)
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error querying function: $_" -ForegroundColor Red
    
    # Try direct query instead
    Write-Host "`nTrying SQL Editor approach..." -ForegroundColor Yellow
    $query = @"
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as return_type,
    SUBSTRING(pg_get_functiondef(p.oid) FROM 1 FOR 500) as definition_preview
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
    AND p.proname = 'get_comprehensive_user_dashboard_entries';
"@
    
    Write-Host $query
}

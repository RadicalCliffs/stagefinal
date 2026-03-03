# Check what get_comprehensive_user_dashboard_entries RPC returns

$SUPABASE_URL = (Get-Content .env | Select-String "VITE_SUPABASE_URL").Line.Split('=')[1]
$SUPABASE_KEY = (Get-Content .env | Select-String "VITE_SUPABASE_ANON_KEY").Line.Split('=')[1]

$headers = @{
    "apikey" = $SUPABASE_KEY
    "Authorization" = "Bearer $SUPABASE_KEY"
    "Content-Type" = "application/json"
}

$userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363"
$compId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95"

Write-Host "`n========== RPC: get_comprehensive_user_dashboard_entries ==========" -ForegroundColor Cyan
try {
    $body = @{
        p_canonical_user_id = $userId
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/rpc/get_comprehensive_user_dashboard_entries" -Headers $headers -Method Post -Body $body
    
    # Filter for this competition
    $filtered = $response | Where-Object { $_.competition_id -eq $compId }
    
    Write-Host "`nFiltered for competition $compId`:" -ForegroundColor Yellow
    $filtered | ConvertTo-Json -Depth 10
    
    Write-Host "`nAll entries:" -ForegroundColor Yellow
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

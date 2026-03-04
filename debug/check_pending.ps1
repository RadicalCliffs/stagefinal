# Check pending_tickets for stuck purchases

$SUPABASE_URL = (Get-Content .env | Select-String "VITE_SUPABASE_URL").Line.Split('=')[1]
$SUPABASE_KEY = (Get-Content .env | Select-String "VITE_SUPABASE_ANON_KEY").Line.Split('=')[1]

$headers = @{
    "apikey" = $SUPABASE_KEY
    "Authorization" = "Bearer $SUPABASE_KEY"
    "Content-Type" = "application/json"
}

$compId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95"
$userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363"

Write-Host "`n========== Pending Tickets ==========" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/pending_tickets?competition_id=eq.$compId&canonical_user_id=eq.$userId&select=*&order=created_at.desc&limit=10" -Headers $headers -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`n========== All recent pending_tickets ==========" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/pending_tickets?competition_id=eq.$compId&select=*&order=created_at.desc&limit=5" -Headers $headers -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

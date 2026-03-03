# Run diagnostic queries against Supabase production database
# Competition ID: 98ea9cbc-5d9b-409b-b757-acb9d0292a95

$SUPABASE_URL = (Get-Content .env | Select-String "VITE_SUPABASE_URL").Line.Split('=')[1]
$SUPABASE_KEY = (Get-Content .env | Select-String "VITE_SUPABASE_ANON_KEY").Line.Split('=')[1]

$headers = @{
    "apikey" = $SUPABASE_KEY
    "Authorization" = "Bearer $SUPABASE_KEY"
    "Content-Type" = "application/json"
}

$compId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95"

Write-Host "`n========== 1. Competition ticket_price ==========" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/competitions?id=eq.$compId&select=id,title,ticket_price,status" -Headers $headers -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`n========== 2. Joincompetition entries ==========" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/joincompetition?competitionid=eq.$compId&select=id,canonical_user_id,numberoftickets,amount_spent,ticketnumbers,created_at&order=created_at.desc&limit=10" -Headers $headers -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`n========== 3. Tickets entries ==========" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/tickets?competition_id=eq.$compId&select=id,canonical_user_id,user_id,ticket_number,purchase_price,created_at&order=created_at.desc&limit=20" -Headers $headers -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`n========== 4. Purchase_events view ==========" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/purchase_events?competition_id=eq.$compId&select=source_table,source_row_id,user_id,amount,occurred_at,purchase_key&order=occurred_at.desc&limit=20" -Headers $headers -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`n========== 5. Purchase_groups view ==========" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/purchase_groups?competition_id=eq.$compId&select=user_id,competition_id,purchase_group_number,group_start_at,events_in_group,total_amount,any_purchase_key&order=group_start_at.desc&limit=10" -Headers $headers -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`n========== Done ==========" -ForegroundColor Green

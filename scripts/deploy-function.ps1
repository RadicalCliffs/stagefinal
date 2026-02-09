# PowerShell script to deploy the Edge Function

# Navigate to project directory
Set-Location -Path "c:\Users\maxmi\GitHub\theprize.io"

# Deploy the function
npx supabase functions deploy purchase-tickets-with-bonus --project-ref mthwfldcjvpxjtmrqkqm

Write-Host "Deployment complete!" -ForegroundColor Green

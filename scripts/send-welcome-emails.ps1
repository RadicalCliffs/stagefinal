# Send welcome emails to all users
Write-Host "=== Getting Netlify Environment Variables ===" -ForegroundColor Yellow

$SUPABASE_KEY = (npx netlify env:get SUPABASE_SERVICE_ROLE_KEY 2>$null | Select-Object -Last 1)
$SENDGRID_KEY = (npx netlify env:get SENDGRID_API_KEY 2>$null | Select-Object -Last 1)
$FROM_EMAIL = (npx netlify env:get SENDGRID_FROM_EMAIL 2>$null | Select-Object -Last 1)
$ TEMPLATE_ID = (npx netlify env:get SENDGRID_TEMPLATE_WELCOME 2>$null | Select-Object -Last 1)

if (-not $FROM_EMAIL) {
    $FROM_EMAIL = "contact@theprize.io"
}

Write-Host "`n=== Configuration ===" -ForegroundColor Cyan
Write-Host "Supabase Key: $(if($SUPABASE_KEY){'✓'}else{'✗'})" -ForegroundColor $(if($SUPABASE_KEY){'Green'}else{'Red'})
Write-Host "SendGrid Key: $(if($SENDGRID_KEY){'✓'}else{'✗'})" -ForegroundColor $(if($SENDGRID_KEY){'Green'}else{'Red'})
Write-Host "From Email: $FROM_EMAIL"
Write-Host "Template ID: $(if($TEMPLATE_ID){'✓'}else{'✗'})" -ForegroundColor $(if($TEMPLATE_ID){'Green'}else{'Red'})

if (-not $SUPABASE_KEY -or -not $SENDGRID_KEY -or -not $TEMPLATE_ID) {
    Write-Host "`n❌ Missing required environment variables!" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Running Script ===" -ForegroundColor Yellow
$env:SUPABASE_SERVICE_ROLE_KEY = $SUPABASE_KEY
$env:SENDGRID_API_KEY = $SENDGRID_KEY
$env:SENDGRID_FROM_EMAIL = $FROM_EMAIL
$env:SENDGRID_TEMPLATE_WELCOME = $TEMPLATE_ID

node scripts/send-welcome-emails-to-all.mjs

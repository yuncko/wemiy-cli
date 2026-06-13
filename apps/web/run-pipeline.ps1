Set-Location 'c:\Users\dell\orbital-cli\apps\web'
$report = Join-Path (Get-Location) 'pipeline-report.txt'
function Run-Step([string]$name, [scriptblock]$action) {
  Add-Content $report " 
===== $name =====\
 & $action 2>&1 | ForEach-Object { Add-Content $report $_; Write-Output $_ }
 $c = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
 Add-Content $report \EXIT_CODE: $c\
 return $c
}
'' | Set-Content $report
$r = @{}
$r.install = Run-Step '1 npm install --legacy-peer-deps' { npm install --legacy-peer-deps }
$env:DATABASE_URL = 'file:./dev.db'
$r.migrate = Run-Step '2 npx prisma migrate deploy' { npx prisma migrate deploy }
$r.seed = Run-Step '3 npm run db:seed' { npm run db:seed }
$r.test = Run-Step '4 npm run test' { npm run test }
$r.typecheck = Run-Step '5 npm run typecheck' { npm run typecheck }
$env:DATABASE_URL = 'file:./dev.db'
$env:BETTER_AUTH_SECRET = 'dev-secret-change-me-in-production-32chars'
$env:BETTER_AUTH_URL = 'http://localhost:3010'
$env:NEXT_PUBLIC_APP_URL = 'http://localhost:3010'
$r.build = Run-Step '6 npm run build' { npm run build }
Add-Content $report ('SUMMARY_JSON: ' + ($r | ConvertTo-Json -Compress))

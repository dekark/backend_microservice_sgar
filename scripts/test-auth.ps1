$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$containerName = 'auth-test-pg-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$created = $false
$previousDatabase = $env:AUTH_TEST_DATABASE_URL
$testExit = 1
try {
  docker run --detach --rm --name $containerName --env POSTGRES_PASSWORD=auth-local-test-only --env POSTGRES_DB=auth_test --publish 127.0.0.1::5432 postgres:17-alpine
  if ($LASTEXITCODE -ne 0) { throw 'Could not start test PostgreSQL' }
  $created = $true
  $binding = docker port $containerName 5432
  if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected PostgreSQL binding' }
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    docker exec $containerName pg_isready -U postgres -d auth_test *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Test PostgreSQL did not become ready' }
  $env:AUTH_TEST_DATABASE_URL = 'postgresql://postgres:auth-local-test-only@127.0.0.1:' + $Matches[1] + '/auth_test'
  Set-Location -LiteralPath $workspaceRoot
  npm --prefix auth-service run test:integration
  $testExit = $LASTEXITCODE
} finally {
  if ($created) { docker stop $containerName | Out-Null }
  $env:AUTH_TEST_DATABASE_URL = $previousDatabase
}
exit $testExit

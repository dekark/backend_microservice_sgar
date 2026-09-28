$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$containerName = 'crud-test-pg-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$created = $false
$previousDatabase = $env:CRUD_TEST_DATABASE_URL
$testExit = 1
try {
  docker run --detach --rm --name $containerName --env POSTGRES_PASSWORD=crud-local-test-only --env POSTGRES_DB=crud_test --publish 127.0.0.1::5432 postgres:17-alpine
  if ($LASTEXITCODE -ne 0) { throw 'Could not start test PostgreSQL' }
  $created = $true
  $binding = docker port $containerName 5432
  if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected PostgreSQL binding' }
  $env:CRUD_TEST_DATABASE_URL = 'postgresql://postgres:crud-local-test-only@127.0.0.1:' + $Matches[1] + '/crud_test'
  Set-Location -LiteralPath $workspaceRoot
  node scripts/test-crud.cjs
  $testExit = $LASTEXITCODE
} finally {
  if ($created) { docker stop $containerName | Out-Null }
  $env:CRUD_TEST_DATABASE_URL = $previousDatabase
}
exit $testExit

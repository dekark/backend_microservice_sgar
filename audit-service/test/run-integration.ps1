$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $serviceRoot
$testSuffix = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$postgresName = 'audit-test-pg-' + $testSuffix
$rabbitName = 'audit-test-rmq-' + $testSuffix
$postgresCreated = $false
$rabbitCreated = $false
$previousDatabase = $env:AUDIT_TEST_DATABASE_URL
$previousRabbit = $env:AUDIT_TEST_RABBITMQ_URL
$testExit = 1
try {
  docker run --detach --rm --name $postgresName --env POSTGRES_PASSWORD=audit-local-test-only --env POSTGRES_DB=audit_test --publish 127.0.0.1::5432 postgres:17-alpine
  if ($LASTEXITCODE -ne 0) { throw 'Could not start test PostgreSQL' }
  $postgresCreated = $true
  docker run --detach --rm --name $rabbitName --env RABBITMQ_DEFAULT_USER=audit-test --env RABBITMQ_DEFAULT_PASS=audit-local-test-only --publish 127.0.0.1::5672 rabbitmq:3-alpine
  if ($LASTEXITCODE -ne 0) { throw 'Could not start test RabbitMQ' }
  $rabbitCreated = $true
  $pgBinding = docker port $postgresName 5432
  if ($pgBinding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected PostgreSQL binding' }
  $env:AUDIT_TEST_DATABASE_URL = 'postgresql://postgres:audit-local-test-only@127.0.0.1:' + $Matches[1] + '/audit_test'
  $rmqBinding = docker port $rabbitName 5672
  if ($rmqBinding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected RabbitMQ binding' }
  $env:AUDIT_TEST_RABBITMQ_URL = 'amqp://audit-test:audit-local-test-only@127.0.0.1:' + $Matches[1]
  Set-Location -LiteralPath (Join-Path $workspaceRoot 'database')
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Database build failed' }
  Set-Location -LiteralPath (Join-Path $workspaceRoot 'auth-service')
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Auth build failed' }
  Set-Location -LiteralPath $serviceRoot
  npm run test:integration
  $testExit = $LASTEXITCODE
} finally {
  if ($rabbitCreated) { docker stop $rabbitName | Out-Null }
  if ($postgresCreated) { docker stop $postgresName | Out-Null }
  $env:AUDIT_TEST_DATABASE_URL = $previousDatabase
  $env:AUDIT_TEST_RABBITMQ_URL = $previousRabbit
}
exit $testExit

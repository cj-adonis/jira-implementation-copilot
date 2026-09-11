$ErrorActionPreference = 'SilentlyContinue'
$urls = @('http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5175', 'http://localhost:5175', 'http://127.0.0.1:5176', 'http://localhost:5176', 'http://127.0.0.1:5177', 'http://localhost:5177', 'http://127.0.0.1:5178', 'http://localhost:5178')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  foreach ($url in $urls) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Start-Process $url
        exit 0
      }
    } catch { }
  }
  Start-Sleep -Seconds 1
}
Write-Host 'The app did not start within 30 seconds. Check the Jira Implementation Copilot terminal window for details.'

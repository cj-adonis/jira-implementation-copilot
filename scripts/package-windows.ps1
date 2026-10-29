$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if ($env:OS -ne 'Windows_NT') { throw 'Build the Windows package on Windows.' }
    $nodeInfo = (& node -p 'JSON.stringify({path:process.execPath,version:process.version,arch:process.arch,major:parseInt(process.versions.node)})') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $nodeInfo.major -lt 20) { throw 'Install Node.js 20 or newer first.' }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (!(Test-Path -LiteralPath $compiler)) {
        $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
    }
    if (!(Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }

    # A fresh staging folder avoids mixing old releases or deleting an open app.
    $releaseRoot = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
    $buildId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stage = Join-Path $releaseRoot "build-$buildId"
    $app = Join-Path $stage 'Jira MX Workspace'
    New-Item -ItemType Directory -Path $app | Out-Null
    foreach ($relative in @('apps\api', 'apps\web', 'packages\shared', 'scripts', 'runtime')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $app $relative) | Out-Null
    }
    # npm ci uses the repository lockfile and installs just the API production graph.
    foreach ($relative in @('package.json', 'package-lock.json', 'apps\api\package.json', 'apps\web\package.json', 'packages\shared\package.json')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $relative) -Destination (Join-Path $app $relative)
    }
    Push-Location $app
    try {
        & npm.cmd ci --omit=dev --ignore-scripts --workspace=@jira-copilot/api --include-workspace-root=false --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
    } finally { Pop-Location }

    & node scripts/build-windows-app.mjs $app
    if ($LASTEXITCODE -ne 0) { throw 'API packaging failed.' }
    Copy-Item -LiteralPath 'apps\web\dist' -Destination (Join-Path $app 'apps\web') -Recurse
    foreach ($name in @('jira-login.py', 'jira-workspace.py')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $app 'scripts')
    }
    Copy-Item -LiteralPath $nodeInfo.path -Destination (Join-Path $app 'runtime\node.exe')
    # Node's LICENSE includes notices for components embedded in its executable.
    $nodeLicense = Join-Path $app 'runtime\LICENSE.txt'
    Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/$($nodeInfo.version)/LICENSE" -OutFile $nodeLicense
    Copy-Item -LiteralPath '.env.example' -Destination (Join-Path $app '.env.example')
    Copy-Item -LiteralPath 'docs\WINDOWS-QUICKSTART.txt' -Destination (Join-Path $app 'START-HERE.txt')
    @{ node = $nodeInfo.version; architecture = $nodeInfo.arch; builtAt = (Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'build-info.json') -Encoding UTF8

    $exe = Join-Path $app 'Jira MX Workspace.exe'
    & $compiler /nologo /target:winexe /optimize+ /platform:anycpu "/out:$exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $PSScriptRoot 'windows\Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Windows launcher compilation failed.' }

    & node scripts/test-windows-package.mjs $app
    if ($LASTEXITCODE -ne 0) { throw 'Packaged runtime smoke test failed.' }

    $zip = Join-Path $releaseRoot "Jira-MX-Workspace-win-$($nodeInfo.arch)-$buildId.zip"
    Compress-Archive -LiteralPath $app -DestinationPath $zip -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $zip)" | Set-Content -LiteralPath "$zip.sha256" -Encoding ASCII
    Write-Output "Ready to share: $zip"
    Write-Output "Extracted app: $exe"
} finally { Pop-Location }

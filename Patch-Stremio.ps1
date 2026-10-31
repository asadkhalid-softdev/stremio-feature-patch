[CmdletBinding()]
param([switch]$Restore, [switch]$Check, [string]$StremioPath)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:LOCALAPPDATA 'StremioFilters'
$backupDir = Join-Path $installDir 'patch-backups'
$manifestPath = Join-Path $backupDir 'manifest.json'
$ws = New-Object -ComObject WScript.Shell

function Stop-FilterHelper {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains((Join-Path $installDir 'launcher.cjs'))
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}

try {
    if ($Restore) {
        if (!(Test-Path -LiteralPath $manifestPath)) { throw 'No patch backup found. Run Apply patch.cmd first.' }
        foreach ($entry in @(Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)) {
            if ($entry.created) {
                if (Test-Path -LiteralPath $entry.path) { Remove-Item -LiteralPath $entry.path }
            } else {
                Copy-Item -LiteralPath $entry.backup -Destination $entry.path -Force
            }
        }
        Stop-FilterHelper
        Write-Host 'Original shortcuts restored. Fully exit and reopen Stremio.' -ForegroundColor Green
        exit 0
    }

    $roots = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('CommonDesktopDirectory'),
        [Environment]::GetFolderPath('Programs'),
        [Environment]::GetFolderPath('CommonPrograms'),
        (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
    $shortcuts = @(foreach ($root in $roots) {
        foreach ($file in Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue) {
            try {
                $link = $ws.CreateShortcut($file.FullName)
                if ($link.TargetPath -like '*stremio*' -or $link.Arguments -like '*StremioFilters*') {
                    [pscustomobject]@{path=$file.FullName; target=$link.TargetPath; arguments=$link.Arguments}
                }
            } catch { }
        }
    })

    $candidates = @()
    if ($StremioPath) {
        if (Test-Path -LiteralPath $StremioPath -PathType Container) { $StremioPath = Join-Path $StremioPath 'stremio-shell-ng.exe' }
        $candidates += $StremioPath
    } else {
        $candidates += @(Get-Process -Name stremio-shell-ng -ErrorAction SilentlyContinue | ForEach-Object { $_.Path })
        $candidates += @($shortcuts | ForEach-Object { $_.target })
        $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
        foreach ($app in Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Stremio*' }) {
            if ($app.InstallLocation) { $candidates += Join-Path $app.InstallLocation 'stremio-shell-ng.exe' }
            if ($app.DisplayIcon) { $candidates += ($app.DisplayIcon -replace ',\s*-?\d+$','').Trim('"') }
        }
        $configPath = Join-Path $installDir 'config.json'
        if (Test-Path -LiteralPath $configPath) {
            $candidates += (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).stremioExe
        }
        foreach ($root in @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if ($root) { $candidates += Join-Path $root 'Stremio\stremio-shell-ng.exe' }
        }
    }
    $matches = @($candidates | Where-Object {
        $_ -and (Split-Path -Leaf $_) -eq 'stremio-shell-ng.exe' -and (Test-Path -LiteralPath $_ -PathType Leaf)
    } | ForEach-Object { (Resolve-Path -LiteralPath $_).Path } | Select-Object -Unique)
    if (!$matches.Count) { throw 'Stremio 5 was not found. Run with -StremioPath "D:\path\to\Stremio" if installed elsewhere. Older Stremio 4 is not supported.' }
    if ($matches.Count -gt 1) { throw ("Multiple Stremio installations found. Select one using -StremioPath:`n" + ($matches -join "`n")) }
    $exe = $matches[0]

    $nodeCandidates = @()
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCmd) { $nodeCandidates += $nodeCmd.Source }
    foreach ($root in @($env:NVM_SYMLINK, (Join-Path $env:ProgramFiles 'nodejs'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs'))) {
        if ($root) { $nodeCandidates += Join-Path $root 'node.exe' }
    }
    $node = $null
    foreach ($candidate in $nodeCandidates | Select-Object -Unique) {
        if (!(Test-Path -LiteralPath $candidate)) { continue }
        $capable = & $candidate -e "process.exit(typeof WebSocket==='function' && typeof fetch==='function' && typeof AbortSignal.timeout==='function' ? 0 : 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { $node=$candidate; break }
    }
    if (!$node) { throw 'A compatible Node.js runtime was not found. Install Node.js 22 or newer, then run this tool again.' }
    foreach ($name in @('hide-watched.js','launcher.cjs')) {
        $payload = Join-Path $PSScriptRoot "payload\$name"
        if (!(Test-Path -LiteralPath $payload)) { throw "Missing payload: $payload. Keep the patch folder together." }
        & $node --check $payload
        if ($LASTEXITCODE -ne 0) { throw "JavaScript validation failed: $name" }
    }
    Write-Host "Stremio: $exe"
    Write-Host "Node.js: $node"
    if ($Check) { Write-Host 'Detection and payload checks passed. No changes made.' -ForegroundColor Green; exit 0 }

    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $manifest = @()
    if (Test-Path -LiteralPath $manifestPath) { $manifest = @(Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json) }
    $legacyManifest = Join-Path $installDir 'shortcut-backups\manifest.json'
    $legacy = @()
    if (Test-Path -LiteralPath $legacyManifest) { $legacy = @(Get-Content -LiteralPath $legacyManifest -Raw | ConvertFrom-Json) }
    $userStartMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Stremio.lnk'
    $paths = @(@($shortcuts | ForEach-Object { $_.path }) + $userStartMenu | Select-Object -Unique)
    foreach ($shortcutPath in $paths) {
        if ($manifest | Where-Object { $_.path -eq $shortcutPath }) { continue }
        $created = !(Test-Path -LiteralPath $shortcutPath)
        $backup = Join-Path $backupDir (([guid]::NewGuid().ToString()) + '.lnk')
        if (!$created) {
            $old = $legacy | Where-Object { $_.path -eq $shortcutPath } | Select-Object -First 1
            if ($old -and (Test-Path -LiteralPath $old.backup)) { Copy-Item -LiteralPath $old.backup -Destination $backup }
            else { Copy-Item -LiteralPath $shortcutPath -Destination $backup }
        }
        $manifest += [pscustomobject]@{path=$shortcutPath; backup=$backup; created=$created}
    }
    ConvertTo-Json -InputObject @($manifest) | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Stop-FilterHelper
    foreach ($name in @('hide-watched.js','launcher.cjs')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload\$name") -Destination (Join-Path $installDir $name) -Force
    }
    @{stremioExe=$exe; nodeExe=$node} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installDir 'config.json') -Encoding UTF8
    $escapedNode = $node.Replace("'", "''")
    $escapedLauncher = (Join-Path $installDir 'launcher.cjs').Replace("'", "''")
    "Start-Process -FilePath '$escapedNode' -ArgumentList '`"$escapedLauncher`"' -WindowStyle Hidden" | Set-Content -LiteralPath (Join-Path $installDir 'Launch Stremio.ps1') -Encoding UTF8
    foreach ($shortcutPath in $paths) {
        $link=$ws.CreateShortcut($shortcutPath)
        $link.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $link.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $installDir 'Launch Stremio.ps1') + '"'
        $link.WorkingDirectory=$installDir
        $link.IconLocation="$exe,0"
        $link.Description='Stremio with Discover filters and sorting'
        $link.Save()
        Write-Host "Updated shortcut: $shortcutPath"
    }
    Write-Host 'Patch applied. Fully exit Stremio (including its tray icon), then open it using a Desktop or Start menu shortcut.' -ForegroundColor Green
    Write-Host 'If a future website change breaks the filter selectors, reapplying this same patch may not fix it.'
} catch {
    Write-Host ("Patch failed: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

param([Parameter(Mandatory=$true)][string]$Exe)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
$previousLocal = $env:LOCALAPPDATA
$temporary = Join-Path $env:RUNNER_TEMP ("findhub-rust-smoke-" + [guid]::NewGuid().ToString('N'))
$policies = @('HKCU:\Software\Policies\Google\Chrome','HKCU:\Software\Policies\Microsoft\Edge')
$before = $policies | ForEach-Object { if(Test-Path $_){Get-ItemProperty $_ | ConvertTo-Json -Compress}else{'absent'} }
function Invoke-Assistant([string]$Argument, [int]$Expected=0) {
    $process = Start-Process -FilePath $Exe -ArgumentList $Argument -PassThru -Wait
    if ($process.ExitCode -ne $Expected) { throw "Rust assistant: $Argument exit=$($process.ExitCode), expected=$Expected" }
}
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $env:LOCALAPPDATA = $temporary
    $root = Join-Path $temporary 'ARGWS\ConnectFindHubAuth'
    Invoke-Assistant '--verify-files' 1
    Invoke-Assistant '--install-files'
    Invoke-Assistant '--verify-files'
    $manifestPath = Join-Path $root 'extension\manifest.json'
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.version -ne '0.1.5') { throw 'Incorrect Rust embedded payload version' }
    $key = $manifest.key
    Set-Content (Join-Path $root 'keep-user-file.txt') 'preserve'
    Set-Content (Join-Path $root 'extension\background.js') 'corrupted'
    Invoke-Assistant '--verify-files' 1
    Invoke-Assistant '--install-files'
    Invoke-Assistant '--verify-files'
    if ((Get-Content (Join-Path $root 'keep-user-file.txt') -Raw).Trim() -ne 'preserve') { throw 'Unrelated data changed' }
    if ((Get-Content $manifestPath -Raw | ConvertFrom-Json).key -ne $key) { throw 'Extension ID changed' }
    if (!(Get-ChildItem (Join-Path $root 'backups') -Directory)) { throw 'Previous payload not retained' }
    # Exercise the actual GUI without automating browsers or bypassing activation consent.
    $gui = Start-Process -FilePath $Exe -PassThru
    for ($i=0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        $gui.Refresh()
        if ($gui.HasExited) { throw 'Rust GUI terminated unexpectedly' }
        if ($gui.MainWindowHandle -ne 0) { break }
    }
    if ($gui.MainWindowHandle -eq 0) { throw 'Rust GUI did not create a real Windows window' }
    Invoke-Assistant '--install-files' 2 # A second writer must respect the shared installation mutex.
    if (!$gui.CloseMainWindow()) { throw 'GUI close request failed' }
    if (!$gui.WaitForExit(10000) -or $gui.ExitCode -ne 0) { throw 'GUI did not exit cleanly' }
    $after = $policies | ForEach-Object { if(Test-Path $_){Get-ItemProperty $_ | ConvertTo-Json -Compress}else{'absent'} }
    if (($before -join '|') -ne ($after -join '|')) { throw 'Browser policies changed' }
    Write-Host 'PASS Rust: install, repair/update, exact embedded files, ID, backup, real window, single writer, unchanged browser policies'
} finally {
    if ($gui -and !$gui.HasExited) { $gui.Kill(); $gui.WaitForExit() }
    $env:LOCALAPPDATA = $previousLocal
    if (Test-Path $temporary) { Remove-Item -LiteralPath $temporary -Force -Recurse }
}

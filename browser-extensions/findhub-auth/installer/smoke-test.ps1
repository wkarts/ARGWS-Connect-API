param([Parameter(Mandatory=$true)][string]$Exe)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'ARGWS\ConnectFindHubAuth'
if (Test-Path $root) { throw 'Refusing to test over an existing installation.' }
$policies = @('HKCU:\Software\Policies\Google\Chrome','HKCU:\Software\Policies\Microsoft\Edge')
$before = $policies | ForEach-Object { if(Test-Path $_){Get-ItemProperty $_ | ConvertTo-Json -Compress}else{'absent'} }
function Run-Setup {
  $p = Start-Process -FilePath $Exe -ArgumentList '/S' -PassThru -Wait
  if($p.ExitCode -ne 0) { throw "Installer exit $($p.ExitCode)" }
}
try {
  Run-Setup
  $manifest = Get-Content (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json
  if($manifest.version -ne '0.1.2') { throw 'Wrong installed version' }
  $identity = $manifest.key
  Set-Content (Join-Path $root 'keep-user-file.txt') 'preserve'
  Set-Content (Join-Path $root 'extension\stale.js') 'obsolete'
  Run-Setup
  $again = Get-Content (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json
  if($again.key -ne $identity) { throw 'Extension identity changed' }
  if(Test-Path (Join-Path $root 'extension\stale.js')) { throw 'Stale payload survived update' }
  if((Get-Content (Join-Path $root 'keep-user-file.txt') -Raw).Trim() -ne 'preserve') { throw 'Unrelated file changed' }
  $after = $policies | ForEach-Object { if(Test-Path $_){Get-ItemProperty $_ | ConvertTo-Json -Compress}else{'absent'} }
  if(($before -join '|') -ne ($after -join '|')) { throw 'Browser policies changed' }
  $uninstaller = Join-Path $root 'Uninstall.exe'
  $p = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$root" -PassThru -Wait
  if($p.ExitCode -ne 0 -or (Test-Path (Join-Path $root 'extension'))) { throw 'Uninstall did not remove owned payload' }
  if(!(Test-Path (Join-Path $root 'keep-user-file.txt'))) { throw 'Uninstall removed unrelated file' }
  Write-Host 'PASS: install, update, stable extension ID, stale-file cleanup, user-file preservation, unchanged browser policies, uninstall'
} finally {
  # Only the disposable installer-owned CI directory; never browser profiles.
  if(Test-Path $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}

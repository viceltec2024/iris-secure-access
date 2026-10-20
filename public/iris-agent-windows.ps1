# IRIS Agent for Windows — read-only security telemetry + encrypted check-in.
# Usage: iris-agent-windows.ps1 [install|reconnect|run|status|uninstall]
# Requires: PowerShell 5.1+ (Windows 10/11). Run in an elevated or normal user PowerShell.

param(
  [Parameter(Position = 0)]
  [ValidateSet("install", "reconnect", "run", "status", "uninstall")]
  [string]$Action = "install"
)

$ErrorActionPreference = "Stop"
$AgentDir = Join-Path $env:LOCALAPPDATA "IRIS Agent"
$AgentPath = Join-Path $AgentDir "iris-agent-windows.ps1"
$TokenPath = Join-Path $AgentDir "agent-token"
$ApiUrlPath = Join-Path $AgentDir "api-url"
$LogPath = Join-Path $AgentDir "agent.log"
$TaskName = "IRIS Security Agent"
$DefaultApi = if ($env:IRIS_API_URL) { $env:IRIS_API_URL } else { "https://iris-secure-access.taylor-667.chatgpt.site/api/agent/check-in" }

function Write-Log([string]$Message) {
  New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
  Add-Content -Path $LogPath -Value ("{0:o} {1}" -f (Get-Date).ToUniversalTime(), $Message)
  if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 1MB)) {
    Get-Content $LogPath -Tail 1000 | Set-Content "$LogPath.tmp"
    Move-Item -Force "$LogPath.tmp" $LogPath
  }
}

function Resolve-ApiUrl {
  New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
  if ($env:IRIS_API_URL) {
    $script:ApiUrl = $env:IRIS_API_URL.Trim()
    Set-Content -Path $ApiUrlPath -Value $script:ApiUrl -Encoding ascii
  } elseif (Test-Path $ApiUrlPath) {
    $stored = (Get-Content -Raw $ApiUrlPath).Trim()
    $script:ApiUrl = if ($stored) { $stored } else { $DefaultApi }
  } else {
    $script:ApiUrl = $DefaultApi
    Set-Content -Path $ApiUrlPath -Value $script:ApiUrl -Encoding ascii
  }
}

function Get-HmacSha256Hex([string]$Key, [string]$Data) {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Key))
  try {
    return (($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Data)) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally { $hmac.Dispose() }
}

function ConvertFrom-Hex([string]$Hex) {
  if ($Hex.Length % 2) { throw "Invalid hex" }
  $bytes = New-Object byte[] ($Hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($Hex.Substring($i * 2, 2), 16)
  }
  return $bytes
}

function Protect-AesCbcBase64([string]$PlainText, [string]$KeyHex, [string]$IvHex) {
  $aes = [System.Security.Cryptography.Aes]::Create()
  try {
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = ConvertFrom-Hex $KeyHex
    $aes.IV = ConvertFrom-Hex $IvHex
    $encryptor = $aes.CreateEncryptor()
    try {
      $plain = [Text.Encoding]::UTF8.GetBytes($PlainText)
      $cipher = $encryptor.TransformFinalBlock($plain, 0, $plain.Length)
      return [Convert]::ToBase64String($cipher)
    } finally { $encryptor.Dispose() }
  } finally { $aes.Dispose() }
}

function Get-TelemetryJson {
  $hostname = $env:COMPUTERNAME
  $os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue)
  $osVersion = if ($os) { "Windows {0}" -f $os.Caption.Replace("Microsoft Windows ", "").Trim() } else { "Windows" }
  if ($os -and $os.Version) { $osVersion = "$osVersion ($($os.Version))" }
  $arch = $env:PROCESSOR_ARCHITECTURE
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue
  $diskUsed = if ($disk -and $disk.Size -gt 0) { [int]((($disk.Size - $disk.FreeSpace) / $disk.Size) * 100) } else { 0 }
  $cs = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  $memUsed = if ($cs -and $cs.TotalVisibleMemorySize -gt 0) {
    [int]((($cs.TotalVisibleMemorySize - $cs.FreePhysicalMemory) / $cs.TotalVisibleMemorySize) * 100)
  } else { 0 }

  $firewall = $false
  try {
    $profiles = Get-NetFirewallProfile -ErrorAction Stop
    $firewall = @($profiles | Where-Object { $_.Enabled }).Count -gt 0
  } catch { $firewall = $false }

  $defenderPresent = $false
  $defenderRealtime = $null
  try {
    $status = Get-MpComputerStatus -ErrorAction Stop
    $defenderPresent = $true
    $defenderRealtime = [bool]$status.RealTimeProtectionEnabled
  } catch {
    $defenderPresent = Test-Path "$env:ProgramFiles\Windows Defender\MsMpEng.exe"
  }

  $smartScreen = $null
  try {
    $ss = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer" -Name "SmartScreenEnabled" -ErrorAction SilentlyContinue
    if ($ss -and $ss.SmartScreenEnabled) {
      $smartScreen = $ss.SmartScreenEnabled -notin @("Off", "0")
    }
  } catch { }

  $bitlocker = $null
  try {
    $bl = Get-BitLockerVolume -MountPoint "C:" -ErrorAction Stop
    $bitlocker = $bl.ProtectionStatus -eq "On"
  } catch {
    try {
      $manage = & manage-bde.exe -status C: 2>$null | Out-String
      if ($manage -match "Protection Status:\s+Protection On") { $bitlocker = $true }
      elseif ($manage -match "Protection Status:") { $bitlocker = $false }
    } catch { }
  }

  $autoUpdates = $null
  try {
    $au = (New-Object -ComObject Microsoft.Update.AutoUpdate).Settings
    $autoUpdates = $au.NotificationLevel -ge 3
  } catch { }

  $appCount = 0
  try {
    $appCount = @(Get-ChildItem "$env:ProgramFiles","${env:ProgramFiles(x86)}" -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 500).Count
  } catch { $appCount = 0 }

  $startupCount = 0
  $unsigned = New-Object System.Collections.Generic.List[string]
  $threats = New-Object System.Collections.Generic.List[string]
  try {
    $runKeys = @(
      "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
      "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
    )
    foreach ($key in $runKeys) {
      if (-not (Test-Path $key)) { continue }
      $props = Get-ItemProperty $key -ErrorAction SilentlyContinue
      if (-not $props) { continue }
      foreach ($name in $props.PSObject.Properties.Name) {
        if ($name -in @("PSPath","PSParentPath","PSChildName","PSDrive","PSProvider")) { continue }
        $startupCount++
        $cmd = [string]$props.$name
        if ($cmd -match '"([^"]+\.exe)"' -or $cmd -match '([A-Za-z]:\\[^\s]+\.exe)') {
          $exe = $Matches[1]
          if ((Test-Path $exe) -and $unsigned.Count -lt 20) {
            try {
              $sig = Get-AuthenticodeSignature -FilePath $exe -ErrorAction SilentlyContinue
              if ($sig -and $sig.Status -ne "Valid") {
                $unsigned.Add([IO.Path]::GetFileNameWithoutExtension($exe)) | Out-Null
                $threats.Add($exe) | Out-Null
              }
            } catch { }
          }
        }
      }
    }
  } catch { }

  $risky = @()
  $payload = [ordered]@{
    hostname = $hostname
    osVersion = $osVersion
    architecture = "$arch"
    diskUsedPercent = $diskUsed
    memoryUsedPercent = $memUsed
    firewallEnabled = $firewall
    gatekeeperEnabled = if ($null -ne $smartScreen) { [bool]$smartScreen } elseif ($null -ne $defenderRealtime) { [bool]$defenderRealtime } else { $null }
    fileVaultEnabled = $bitlocker
    # SIP is macOS-only — omit so IRIS does not raise SIP_DISABLED on Windows.
    automaticUpdatesEnabled = $autoUpdates
    installedApplicationCount = $appCount
    riskyApplications = $risky
    xProtectPresent = $defenderPresent
    xProtectVersion = if ($defenderPresent) { "Windows Defender" } else { "unknown" }
    malwareRemovalToolPresent = $defenderPresent
    persistenceItemCount = $startupCount
    unsignedPersistenceItems = @($unsigned)
    threatLocations = @($threats)
  }
  # Remove nulls so cleanTelemetry leaves flags undefined
  foreach ($k in @($payload.Keys)) {
    if ($null -eq $payload[$k]) { $payload.Remove($k) }
  }
  return ($payload | ConvertTo-Json -Compress -Depth 5)
}

function Register-AgentTask {
  Resolve-ApiUrl
  Copy-Item -Force -LiteralPath $PSCommandPath -Destination $AgentPath
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentPath`" run"
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration ([TimeSpan]::MaxValue)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
}

function Install-Agent {
  Write-Host "IRIS Agent for Windows"
  Write-Host "Reports firewall, Defender, BitLocker, updates, and startup items. Does not invent ONLINE status."
  Resolve-ApiUrl
  $code = Read-Host "Enter a NEW IRIS enrollment code"
  $code = ($code.ToUpper() -replace "\s", "")
  if ($code.Length -ne 16) { throw "The enrollment code must contain 16 characters." }
  New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
  $telemetry = Get-TelemetryJson
  $body = "{`"enrollmentCode`":`"$code`",`"telemetry`":$telemetry}"
  try {
    $response = Invoke-RestMethod -Method Post -Uri $script:ApiUrl -ContentType "application/json" -Body $body -TimeoutSec 45
  } catch {
    throw "Enrollment failed. Generate a new code in IRIS and try again. $($_.Exception.Message)"
  }
  if (-not $response.agentToken) { throw "IRIS did not return an agent token." }
  Set-Content -Path $TokenPath -Value ([string]$response.agentToken) -Encoding ascii
  Register-AgentTask
  Write-Log "enrolled"
  Write-Host "IRIS Agent installed. Your device should show ONLINE within two minutes."
}

function Invoke-CheckIn {
  Resolve-ApiUrl
  if (-not (Test-Path $TokenPath)) { throw "IRIS Agent is not enrolled." }
  $token = (Get-Content -Raw $TokenPath).Trim()
  if (-not $token) { throw "IRIS Agent is not enrolled." }
  $payload = Get-TelemetryJson
  $encryptionKey = Get-HmacSha256Hex $token "iris-report-encryption-v1"
  $authenticationKey = Get-HmacSha256Hex $token "iris-report-authentication-v1"
  $ivBytes = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($ivBytes)
  $iv = (($ivBytes | ForEach-Object { $_.ToString("x2") }) -join "")
  $ciphertext = Protect-AesCbcBase64 $payload $encryptionKey $iv
  $tag = Get-HmacSha256Hex $authenticationKey "$iv.$ciphertext"
  $requestBody = "{`"encryptedTelemetry`":{`"version`":1,`"algorithm`":`"AES-256-CBC+HMAC-SHA256`",`"iv`":`"$iv`",`"ciphertext`":`"$ciphertext`",`"tag`":`"$tag`"}}"
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $nonce = ([guid]::NewGuid().ToString("N"))
  $signature = Get-HmacSha256Hex $token "$timestamp.$nonce.$requestBody"
  $headers = @{
    Authorization = "Bearer $token"
    "X-IRIS-Timestamp" = $timestamp
    "X-IRIS-Nonce" = $nonce
    "X-IRIS-Signature" = $signature
  }
  try {
    Invoke-RestMethod -Method Post -Uri $script:ApiUrl -ContentType "application/json" -Headers $headers -Body $requestBody -TimeoutSec 45 | Out-Null
    Write-Log "encrypted check-in succeeded"
  } catch {
    Write-Log ("check-in failed: " + $_.Exception.Message)
    throw
  }
}

function Reconnect-Agent {
  Resolve-ApiUrl
  if (-not (Test-Path $TokenPath)) { throw "IRIS Agent is not enrolled. Use install with the enrollment code from IRIS." }
  Register-AgentTask
  try { Invoke-CheckIn } catch { Write-Log ("reconnect kickstart failed: " + $_.Exception.Message) }
  Write-Host "IRIS Agent reconnecting to $script:ApiUrl. Your device should show ONLINE within two minutes."
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) { Write-Host "IRIS Agent task is registered ($($task.State))." }
  else { Write-Host "IRIS Agent is not running." }
}

function Uninstall-Agent {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $AgentDir -ErrorAction SilentlyContinue
  Write-Host "IRIS Agent removed from this Windows PC."
}

switch ($Action) {
  "install" { Install-Agent }
  "reconnect" { Reconnect-Agent }
  "run" { Invoke-CheckIn }
  "status" { Show-Status }
  "uninstall" { Uninstall-Agent }
}

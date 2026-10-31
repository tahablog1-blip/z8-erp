# Installs the Z8 agent on Windows: requirements + auto-start at boot (scheduled task, SYSTEM)
# Run in PowerShell as Administrator:  powershell -ExecutionPolicy Bypass -File install-windows.ps1
# (ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 files without BOM)
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Write-Error "Install Python 3.10+ from python.org first (tick 'Add python.exe to PATH')"; exit 1 }
if (-not (Test-Path "$dir\agent.env")) {
  Copy-Item "$dir\agent.env.example" "$dir\agent.env"
  Write-Host "Created agent.env - put your Z8_AGENT_KEY in it, save, then run this script again."
  notepad "$dir\agent.env"
  exit 0
}
python -m pip install --upgrade pip
python -m pip install -r "$dir\requirements.txt"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\start-agent.bat`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName "Z8 Camera Agent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Z8 Camera Agent"
Write-Host "Done: the agent is running and will start at every boot. Check the site: Settings > Station cameras > Agents (should show online)."

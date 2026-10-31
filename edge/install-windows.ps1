# يثبّت وكيل Z8 على ويندوز: المتطلبات + تشغيل تلقائي عند إقلاع الجهاز (مهمة مجدولة بصلاحية النظام)
# التشغيل: PowerShell كمسؤول:   powershell -ExecutionPolicy Bypass -File install-windows.ps1
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Write-Error "ثبّت Python 3.10+ أولاً من python.org (فعّل خيار Add to PATH)"; exit 1 }
if (-not (Test-Path "$dir\agent.env")) { Copy-Item "$dir\agent.env.example" "$dir\agent.env"; Write-Host "أنشأت agent.env — افتحه وضع Z8_AGENT_KEY ثم أعد تشغيل هذا السكربت"; notepad "$dir\agent.env"; exit 0 }
python -m pip install --upgrade pip
python -m pip install -r "$dir\requirements.txt"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$dir\start-agent.bat`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName "Z8 Camera Agent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Z8 Camera Agent"
Write-Host "تم: الوكيل يعمل الآن ويبدأ تلقائياً مع كل إقلاع. افحص الموقع: الإعدادات ← كاميرات المحطات ← وكلاء المحطات (يجب أن يظهر متصلاً)."

# Windows Görev Zamanlayıcısı (Task Scheduler) ile UKEY Otomatik Senkronizasyon Kurulumu
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = (Resolve-Path "$ScriptDir\..").Path
$RunnerScript = "$ProjectDir\scripts\run-ukey-sync.ps1"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Bursa Uludağ Üniversitesi UKEY Sürekli Senkronizasyon Kurulumu " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$TaskName = "BUU_UKEY_AutoSync"
$TaskCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerScript`""

try {
    # Görev zaten varsa önce kaldır
    schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
} catch {}

# Her 15 dakikada bir arka planda sessizce çalışacak görev oluştur
$createCmd = "schtasks.exe /Create /SC MINUTE /MO 15 /TN `"$TaskName`" /TR `"$TaskCommand`" /F"
Invoke-Expression $createCmd

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Windows Görev Zamanlayıcısı görevi başarıyla kuruldu: $TaskName" -ForegroundColor Green
    Write-Host "-> Görev her 15 dakikada bir otomatik olarak UKEY'i tarayacak ve GitHub'a yükleyecek." -ForegroundColor Green
} else {
    Write-Host "[UYARI] Standart schtasks oluşturulamadı, alternatif kayıt yöntemi deneniyor..." -ForegroundColor Yellow
    try {
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerScript`""
        $trigger1 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
        $trigger2 = New-ScheduledTaskTrigger -AtLogOn
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigger1, $trigger2) -Force | Out-Null
        Write-Host "[OK] Register-ScheduledTask ile başarıyla kaydedildi!" -ForegroundColor Green
    } catch {
        Write-Host "[HATA] Görev kaydedilemedi: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# İlk testi hemen arka planda koştur
Write-Host "İlk test senkronizasyonu başlatılıyor..." -ForegroundColor Cyan
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerScript`"" -WindowStyle Hidden
Write-Host "Tamamlandı! Senkronizasyon durumu 'scripts/sync.log' dosyasından izlenebilir." -ForegroundColor Cyan

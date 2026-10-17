# Bursa Uludağ Üniversitesi UKEY Otomatik Senkronizasyon Çalıştırıcısı
$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Resolve-Path "$ScriptDir\.."
Set-Location $ProjectDir

$LogFile = "$ScriptDir\sync.log"
$Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

function Log-Message ($msg) {
    $line = "[$Timestamp] $msg"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Output $line
}

# Log dosyasını 1000 satırdan fazla büyümesin diye kırp
if (Test-Path $LogFile) {
    $logLines = Get-Content $LogFile
    if ($logLines.Count -gt 1000) {
        $logLines | Select-Object -Last 500 | Set-Content $LogFile -Encoding UTF8
    }
}

Log-Message "UKEY Arka Plan Senkronizasyonu Başlatıldı..."

try {
    # 1. Uzak depodaki en son değişiklikleri çek
    git fetch origin main 2>&1 | Out-Null
    git rebase --strategy-option=theirs origin/main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { git rebase --abort 2>&1 | Out-Null }

    # 2. Canlı UKEY senkronizasyon motorunu çalıştır ve varsa değişiklikleri push et
    $nodeOutput = & node "$ProjectDir\scripts\ukey-auto-sync.js" --push 2>&1
    foreach ($outLine in $nodeOutput) {
        Log-Message $outLine
    }

    Log-Message "UKEY Senkronizasyonu başarıyla tamamlandı."
} catch {
    Log-Message "HATA: $($_.Exception.Message)"
}

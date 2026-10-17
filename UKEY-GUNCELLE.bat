@echo off
chcp 65001 >nul
title UKEY Otomatik Senkronizasyon
echo ==========================================================
echo   Bursa Uludağ Üniversitesi UKEY Senkronizasyon Motoru
echo ==========================================================
echo.
echo UKEY verileri ve indirilebilir dosyalar taranıyor...
echo.

cd /d "%~dp0"
node scripts\ukey-auto-sync.js --push

echo.
echo ==========================================================
echo Senkronizasyon işlemi tamamlandı!
echo ==========================================================
pause

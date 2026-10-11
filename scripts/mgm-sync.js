#!/usr/bin/env node
/**
 * MGM Bursa / Nilüfer Canlı Hava Durumu Senkronizasyon Motoru
 * Kaynak: https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=Bursa&ilce=Nil%C3%BCfer
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MGM_JSON_PATH = path.join(ROOT_DIR, 'mgm.json');

const MGM_HEADERS = {
    'Origin': 'https://www.mgm.gov.tr',
    'Referer': 'https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=Bursa&ilce=Nil%C3%BCfer',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
};

async function syncMgmWeather() {
    console.log('[MGM Sync] Bursa / Nilüfer anlık hava durumu verisi çekiliyor...');
    const [rSon, rSaat, rGun] = await Promise.all([
        fetch('https://servis.mgm.gov.tr/web/sondurumlar?merkezid=91617', { headers: MGM_HEADERS }),
        fetch('https://servis.mgm.gov.tr/web/tahminler/saatlik?istno=17116', { headers: MGM_HEADERS }).catch(() => null),
        fetch('https://servis.mgm.gov.tr/web/tahminler/gunluk?istno=91617', { headers: MGM_HEADERS }).catch(() => null)
    ]);

    if (!rSon || !rSon.ok) {
        throw new Error('MGM sondurumlar servisi yanıt vermedi: ' + (rSon ? rSon.status : 'NO_RESPONSE'));
    }

    const sonArr = await rSon.json();
    const son = (Array.isArray(sonArr) && sonArr[0]) ? sonArr[0] : null;
    if (!son) {
        throw new Error('MGM sondurumlar boş veri döndürdü.');
    }

    let saatlikTahmin = [];
    if (rSaat && rSaat.ok) {
        const sArr = await rSaat.json();
        if (Array.isArray(sArr) && sArr[0] && Array.isArray(sArr[0].tahmin)) {
            saatlikTahmin = sArr[0].tahmin.slice(0, 6);
        }
    }

    let gunlukTahmin = null;
    if (rGun && rGun.ok) {
        const gArr = await rGun.json();
        if (Array.isArray(gArr) && gArr[0]) {
            gunlukTahmin = gArr[0];
        }
    }

    const payload = {
        location: 'Bursa / Nilüfer',
        sourceUrl: 'https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=Bursa&ilce=Nil%C3%BCfer',
        merkezId: 91617,
        istNo: son.istNo || 18386,
        updatedAt: new Date().toISOString(),
        sondurum: {
            sicaklik: son.sicaklik !== -9999 ? son.sicaklik : null,
            hissedilenSicaklik: son.hissedilenSicaklik !== -9999 ? son.hissedilenSicaklik : null,
            hadiseKodu: (son.hadiseKodu && son.hadiseKodu !== '-9999') ? String(son.hadiseKodu).trim().toUpperCase() : 'A',
            yagis00Now: (son.yagis00Now !== -9999 && son.yagis00Now !== undefined) ? son.yagis00Now : 0,
            yagis1Saat: (son.yagis1Saat !== -9999 && son.yagis1Saat !== undefined) ? son.yagis1Saat : 0,
            yagis24Saat: (son.yagis24Saat !== -9999 && son.yagis24Saat !== undefined) ? son.yagis24Saat : 0,
            nem: son.nem !== -9999 ? son.nem : null,
            ruzgarHiz: son.ruzgarHiz !== -9999 ? son.ruzgarHiz : 0,
            ruzgarYon: son.ruzgarYon !== -9999 ? son.ruzgarYon : 0,
            veriZamani: son.veriZamani || new Date().toISOString()
        },
        saatlik: saatlikTahmin,
        gunluk: gunlukTahmin ? {
            tarihGun1: gunlukTahmin.tarihGun1,
            hadiseGun1: gunlukTahmin.hadiseGun1,
            enDusukGun1: gunlukTahmin.enDusukGun1,
            enYuksekGun1: gunlukTahmin.enYuksekGun1
        } : null
    };

    fs.writeFileSync(MGM_JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[MGM Sync] mgm.json güncellendi -> ${payload.sondurum.sicaklik}°C, Hadise: ${payload.sondurum.hadiseKodu}, Nem: %${payload.sondurum.nem}, Rüzgar: ${Math.round(payload.sondurum.ruzgarHiz)} km/sa (${payload.sondurum.ruzgarYon}°)`);
    return payload;
}

if (require.main === module) {
    syncMgmWeather().catch(err => {
        console.error('[MGM Sync Hata]:', err.message);
        process.exit(1);
    });
}

module.exports = { syncMgmWeather };

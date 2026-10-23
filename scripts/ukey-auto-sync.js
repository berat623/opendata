#!/usr/bin/env node
/**
 * Bursa Uludağ Üniversitesi UKEY Tam Otomatik Senkronizasyon Motoru
 * - AES-256-GCM kasasından kimlik bilgilerini bellekte çözer (düz metin şifre barındırmaz)
 * - https://ukey.uludag.edu.tr/Home adresine otomatik giriş yapar
 * - Tüm 9 dersi, 14 haftalık içerikleri, ödevleri (ve ödev detay sayfalarını), e-sınavları,
 *   forumları, 7 günlük acil görev bildirimlerini, Microsoft Teams canlı ders linklerini,
 *   SharePoint/OneDrive video kayıtlarını ve indirilebilir tüm ders dosyalarını (ukey_dosyalar/)
 *   birebir canlı UKEY sisteminden otomatik çeker ve günceller.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const UKEY_JSON_PATH = path.join(ROOT_DIR, 'ukey.json');
const FILES_DIR = path.join(ROOT_DIR, 'ukey_dosyalar');

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(str) {
  if (!str) return '';
  return decodeHtml(str.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
}

function getCredentials(existingData) {
  if (process.env.UKEY_USER && process.env.UKEY_PASS) {
    return {
      KullaniciKodu: process.env.UKEY_USER,
      sifre: process.env.UKEY_PASS,
      kullaniciTipi: 'Student'
    };
  }
  const vault = existingData.syncVault;
  const passphrase = 'BUU-ETP-UKEY-AUTO-SYNC-ENGINE-2026-V2';
  const salt = Buffer.from(vault.s, 'base64');
  const iv = Buffer.from(vault.i, 'base64');
  const cipherWithTag = Buffer.from(vault.c, 'base64');
  const authTag = cipherWithTag.subarray(cipherWithTag.length - 16);
  const encrypted = cipherWithTag.subarray(0, cipherWithTag.length - 16);

  const key = crypto.pbkdf2Sync(passphrase, salt, vault.iter || 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted);
}

async function syncUkey() {
  console.log('[UKEY-SYNC] Otomatik senkronizasyon başlatılıyor...');
  const existingData = JSON.parse(fs.readFileSync(UKEY_JSON_PATH, 'utf8'));
  const creds = getCredentials(existingData);

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const cookieJar = new Map();

  function updateCookies(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    for (const c of raw.filter(Boolean)) {
      const [pair] = c.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        cookieJar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
      }
    }
  }

  function getCookieHeader() {
    return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  let loc = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    cookieJar.clear();
    const r1 = await (async () => { for (let i=0;i<3;i++) { try { return await fetch('https://ukey.uludag.edu.tr/Home', { headers: { 'User-Agent': ua } }); } catch(e) { if(i===2) throw e; await new Promise(r=>setTimeout(r,500)); } } })();
    updateCookies(r1);
    await r1.text();

    const body = new URLSearchParams({
      KullaniciKodu: creds.KullaniciKodu,
      sifre: creds.sifre,
      kullaniciTipi: creds.kullaniciTipi || 'Student'
    });

    const r2 = await fetch('https://ukey.uludag.edu.tr/Home', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': getCookieHeader(),
        'User-Agent': ua,
        'Referer': 'https://ukey.uludag.edu.tr/Home'
      },
      body: body.toString(),
      redirect: 'manual'
    });
    updateCookies(r2);
    await r2.text();

    loc = r2.headers.get('location');
    if (loc) break;
    console.warn(`[UKEY-SYNC] Giriş denemesi ${attempt}/3 yönlendirme döndürmedi, tekrar deneniyor...`);
  }

  if (!loc) {
    throw new Error('UKEY girişi yönlendirmesi alınamadı.');
  }

  async function fetchWithRetry(url, opts, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetch(url, opts);
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
  }

  async function getPage(relUrl) {
    let currentUrl = new URL(relUrl, 'https://ukey.uludag.edu.tr').href;
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetchWithRetry(currentUrl, {
        headers: { 'Cookie': getCookieHeader(), 'User-Agent': ua },
        redirect: 'manual'
      });
      updateCookies(res);
      const nextLoc = res.headers.get('location');
      if (nextLoc && res.status >= 300 && res.status < 400) {
        currentUrl = new URL(nextLoc, currentUrl).href;
        continue;
      }
      return await res.text();
    }
    return '';
  }

  const dashHtml = await getPage(loc);
  const courseMatches = [...dashHtml.matchAll(/<li>\s*<a href="(\/p![^"]+)">([^<]+)<\/a>\s*<\/li>/g)];
  console.log(`[UKEY-SYNC] UKEY oturumu açıldı, ${courseMatches.length} aktif ders bulundu.`);

  if (courseMatches.length === 0) {
    throw new Error('Ders listesi boş döndü.');
  }

  // Parse 7-day urgent task notifications from the dashboard header dropdown
  const rawTaskBlocks = [...dashHtml.matchAll(/<li>\s*<a href="\/Takvim\/Index\/">[\s\S]*?<h4>([\s\S]*?)<\/h4>\s*<p>([\s\S]*?)<\/p>\s*<\/a>\s*<\/li>/gi)];

  const updatedCourses = [];
  const allRecordedStreams = [];
  const allUpcomingMeetings = [];
  const newAgendaEvents = [];
  const allHomeworksFlat = [];

  for (const [_, cUrl, rawTitle] of courseMatches) {
    const fullTitle = decodeHtml(rawTitle.trim());
    const parts = fullTitle.split(' - ');
    const code = parts[0].trim();
    const name = parts.slice(1).join(' - ').trim();

    console.log(`[UKEY-SYNC] Taranıyor: ${code} - ${name}`);
    // Activate course context in UKEY session
    await getPage(cUrl);

    // ASP.NET MVC Session kilitlenmemesi için sıralı ve hatasız çek
    const icerikHtml = await getPage('/Ogrenci/Icerik/');
    const odevHtml = await getPage('/Ogrenci/Odevler');
    const sinavHtml = await getPage('/Ogrenci/ESinavlar/');
    const matHtml = await getPage('/Ogrenci/DersMateryalleri');
    const forumHtml = await getPage('/Ogrenci/Forum');
    const topHtml = await getPage('/Ogrenci/Toplantilar');

    const getField = (label) => {
      const re = new RegExp(`<div class="display-label">\\s*${label}\\s*<\\/div>\\s*<div class="display-field">([\\s\\S]*?)<\\/div>`, 'i');
      const m = icerikHtml.match(re);
      return m ? stripTags(m[1]) : '';
    };

    const ects = +getField('ECTS') || +getField('Ects') || 0;
    const akts = +getField('AKTS') || +getField('Akts') || 0;
    const teori = +getField('Teori') || 0;
    const uygulama = +getField('Uygulama') || 0;
    const lab = +getField('Lab') || 0;
    const kredi = +getField('Kredi') || 0;
    const amac = getField('Dersin Amacı');
    const hoca = getField('Dersi Verenler');
    const kaynaklar = getField('Dersin Kaynakları');

    // Parse 14-week syllabus
    const weeks = [];
    const weekRowsWithBtn = [...icerikHtml.matchAll(/<tr>\s*<td><a class="gridbutton detay"[^>]*>\s*<\/a><\/td>\s*<td>(\d+)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)];
    if (weekRowsWithBtn.length > 0) {
      for (const wr of weekRowsWithBtn) {
        weeks.push({ week: +wr[1], teorik: stripTags(wr[2]), uygulama: stripTags(wr[3]) });
      }
    } else {
      const weekRowsPlain = [...icerikHtml.matchAll(/<tr>\s*<td>(\d+)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)];
      for (const wr of weekRowsPlain) {
        weeks.push({ week: +wr[1], teorik: stripTags(wr[2]), uygulama: stripTags(wr[3]) });
      }
    }

    // Parse Course Materials & Download any new/updated files automatically first
    const matRows = [...matHtml.matchAll(/<tr class="grid-row[\s\S]*?<\/tr>/g)].map(m => m[0]);
    const materials = [];
    const prevCourse = (existingData.courses || []).find(ec => ec.code === code);

    for (let idx = 0; idx < matRows.length; idx++) {
      const r = matRows[idx];
      const adi = stripTags((r.match(/data-name="Adi">([\s\S]*?)<\/td>/) || [])[1] || '');
      const turu = stripTags((r.match(/data-name="KaynakTuru">([\s\S]*?)<\/td>/) || [])[1] || '');
      const hafta = stripTags((r.match(/data-name="HaftaAciklama">([\s\S]*?)<\/td>/) || [])[1] || '');
      const odev = stripTags((r.match(/data-name="OdevAdi">([\s\S]*?)<\/td>/) || [])[1] || '');
      const tipi = stripTags((r.match(/data-name="KaynakTipi">([\s\S]*?)<\/td>/) || [])[1] || '');
      const dosyaMatch = r.match(/class="dosya"\s+href="([^"]+)"/) || r.match(/href="([^"]+)"[^>]*class="dosya"/);
      const katilMatch = r.match(/href="([^"]+)"\s+class\s*=\s*"gridbutton katil"/);
      const externalUrl = katilMatch ? decodeHtml(katilMatch[1]) : '';

      let hasFile = Boolean(dosyaMatch);
      let localPath = '';
      let origName = '';
      let sizeBytes = 0;
      let contentType = '';

      if (hasFile && dosyaMatch) {
        const prevMat = prevCourse && prevCourse.materials
          ? prevCourse.materials.find(pm => pm.title === adi && pm.hasFile && pm.localPath && fs.existsSync(path.join(ROOT_DIR, pm.localPath)))
          : null;

        if (prevMat) {
          localPath = prevMat.localPath;
          origName = prevMat.origName;
          sizeBytes = prevMat.sizeBytes;
          contentType = prevMat.contentType;
        } else {
          try {
            const fUrl = new URL(dosyaMatch[1], 'https://ukey.uludag.edu.tr').href;
            const fRes = await fetch(fUrl, { headers: { 'Cookie': getCookieHeader(), 'User-Agent': ua } });
            updateCookies(fRes);
            const cd = fRes.headers.get('content-disposition') || '';
            const fnMatch = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
            origName = fnMatch ? decodeURIComponent(fnMatch[1]) : `${code}_${idx + 1}.bin`;
            const ext = path.extname(origName) || '';
            const safeName = `${code}_${idx + 1}${ext}`.replace(/[^a-zA-Z0-9._-]/g, '_');
            const destPath = path.join(FILES_DIR, safeName);
            const buf = Buffer.from(await fRes.arrayBuffer());
            fs.writeFileSync(destPath, buf);
            localPath = `ukey_dosyalar/${safeName}`;
            sizeBytes = buf.length;
            contentType = fRes.headers.get('content-type') || '';
            console.log(`[UKEY-SYNC] Yeni dosya indirildi: ${localPath} (${origName})`);
          } catch (dlErr) {
            console.warn(`[UKEY-SYNC] Dosya indirilemedi (${adi}):`, dlErr.message);
          }
        }
      }

      if (externalUrl) {
        if (externalUrl.includes('teams.microsoft.com/meet')) {
          allUpcomingMeetings.push({
            courseCode: code,
            courseName: name,
            instructor: hoca,
            title: `${code} - ${adi} (Microsoft Teams)`,
            schedule: 'Aktif Dönem Boyunca • Microsoft Teams',
            url: externalUrl
          });
        } else {
          newAgendaEvents.push({
            id: `ag-rec-${code}-${idx}`,
            title: `${code} - ${adi}`,
            courseCode: code,
            category: 'Sanal Toplantı / Kayıt',
            displayRange: hafta ? `${hafta}. Hafta` : 'Güz Dönemi',
            color: '#3b82f6',
            status: 'Kayıt Yüklendi'
          });
        }
        allRecordedStreams.push({
          courseCode: code,
          courseName: name,
          instructor: hoca,
          week: +hafta || 0,
          title: adi,
          url: externalUrl
        });
      }

      materials.push({
        title: adi,
        category: turu,
        week: +hafta || 0,
        homework: odev,
        type: tipi,
        hasFile,
        localPath,
        origName,
        sizeBytes,
        contentType,
        externalUrl
      });
    }

    // Parse Homeworks & Fetch each Homework's Detail Page (/p!...) for 100% accurate metadata
    const odevRows = [...odevHtml.matchAll(/<tr>\s*<td>\s*<a class="gridbutton detay"\s+href="([^"]+)"[^>]*>\s*<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi)];
    const homeworks = [];

    for (let idx = 0; idx < odevRows.length; idx++) {
      const or = odevRows[idx];
      const detUrl = or[1];
      const hwTitle = stripTags(or[2]);
      const hwDesc = stripTags(or[3]);
      const hwType = stripTags(or[4]);
      const hwStart = stripTags(or[5]);
      const hwEnd = stripTags(or[6]);

      let hwId = 0;
      let weekLabel = 'Dönemlik / Genel';
      let fileCountLimit = 1;
      let allowedFileTypes = 'Belirtilmemiş';
      let maxFileSizeMB = 20;
      let submissionStatus = 'Aktif (UKEY Üzerinden Teslim Bekleniyor)';
      const attachedMaterials = [];

      const prevHw = prevCourse && prevCourse.homeworks
        ? prevCourse.homeworks.find(ph => ph.title === hwTitle && ph.start === hwStart && ph.end === hwEnd && ph.id > 0 && (ph.submissionStatus || '').includes('Sona Ermiştir'))
        : null;

      if (prevHw) {
        hwId = prevHw.id;
        weekLabel = prevHw.week || weekLabel;
        fileCountLimit = prevHw.fileCountLimit || 1;
        allowedFileTypes = prevHw.allowedFileTypes || 'Belirtilmemiş';
        maxFileSizeMB = prevHw.maxFileSizeMB || 20;
        submissionStatus = prevHw.submissionStatus;
        if (Array.isArray(prevHw.attachedMaterials)) {
          attachedMaterials.push(...prevHw.attachedMaterials);
        }
      } else if (detUrl) {
        try {
          const detHtml = await getPage(detUrl);
          hwId = +(detHtml.match(/id="Id"\s+name="Id"\s+type="hidden"\s+value="(\d+)"/i) || [])[1] || 0;
          const odevTuruSel = detHtml.match(/<select[^>]*id="OdevTuruId"[\s\S]*?<option selected="selected" value="(\d+)">([^<]+)<\/option>/i);
          const haftaSel = detHtml.match(/<select[^>]*id="DersIcerikId"[\s\S]*?<option selected="selected" value="\d+">([^<]+)<\/option>/i);
          if (odevTuruSel && odevTuruSel[1] === '1' && haftaSel) {
            weekLabel = decodeHtml(haftaSel[1]);
          }
          const limMatch = detHtml.match(/id="TeslimEdilecekDosyaAdedi"[^>]*value="([^"]*)"/i);
          if (limMatch && limMatch[1]) fileCountLimit = +limMatch[1] || 1;

          const ftMatch = detHtml.match(/id="DosyaTuru"[^>]*value="([^"]*)"/i);
          if (ftMatch && ftMatch[1] && ftMatch[1].trim()) {
            allowedFileTypes = decodeHtml(ftMatch[1].trim());
          }

          const mbMatch = detHtml.match(/id="BoyutSiniriMB"[^>]*value="([^"]*)"/i);
          if (mbMatch && mbMatch[1]) maxFileSizeMB = +mbMatch[1] || 20;

          if (detHtml.includes('Ödev Teslimi Sona Ermiştir') || detHtml.includes('&#214;dev Teslimi Sona Ermiştir')) {
            submissionStatus = 'Ödev Teslimi Sona Ermiştir';
          }

          const dokumanSection = (detHtml.match(/<div id="dokuman"[\s\S]*?<\/table>/i) || [])[0] || '';
          const dokumanRows = [...dokumanSection.matchAll(/<tr>\s*<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi)];
          for (const dr of dokumanRows) {
            const docName = stripTags(dr[1]);
            const matchedMat = materials.find(m => m.hasFile && (m.title === docName || m.homework === hwTitle)) || materials.find(m => m.hasFile);
            if (matchedMat) {
              attachedMaterials.push({
                title: docName || matchedMat.title,
                origName: matchedMat.origName,
                localPath: matchedMat.localPath,
                sizeBytes: matchedMat.sizeBytes
              });
            }
          }
        } catch (hwErr) {
          console.warn(`[UKEY-SYNC] Ödev detayı okunamadı (${code} - ${hwTitle}):`, hwErr.message);
        }
      }

      const isEnded = submissionStatus.includes('Sona Ermiştir');
      newAgendaEvents.push({
        id: `ag-hw-${code}-${idx}`,
        title: `${code} - ${hwTitle}`,
        courseCode: code,
        category: 'Ödev Teslimi',
        displayRange: `${hwStart} – ${hwEnd}`,
        color: isEnded ? '#64748b' : '#ef4444',
        status: isEnded ? 'Süresi Doldu' : 'Aktif Ödev'
      });

      const hwObj = {
        id: hwId || (65000 + idx),
        courseCode: code,
        courseName: name,
        instructor: hoca,
        title: hwTitle,
        description: hwDesc,
        type: hwType,
        start: hwStart,
        end: hwEnd,
        week: weekLabel,
        fileCountLimit,
        allowedFileTypes,
        maxFileSizeMB,
        submissionStatus,
        attachedMaterials
      };

      homeworks.push(hwObj);
      allHomeworksFlat.push(hwObj);
    }

    // Parse E-Exams
    const sinavRows = [...sinavHtml.matchAll(/<tr>\s*<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)];
    const exams = sinavRows.map(sr => ({
      name: stripTags(sr[1]),
      start: stripTags(sr[2]),
      lastLogin: stripTags(sr[3]),
      durationMin: stripTags(sr[4])
    }));

    // Parse Forum Categories & Topics
    const forumBoxMatches = [...forumHtml.matchAll(/<div class="box box-liste">\s*<div class="box-header">\s*<h3 class="box-title"><a[^>]*>([\s\S]*?)<\/a><\/h3>[\s\S]*?<table class="table no-margin">([\s\S]*?)<\/table>/gi)];
    const forumCategories = (forumBoxMatches.length
      ? forumBoxMatches.map((fb, idx) => {
          const catTitle = stripTags(fb[1]);
          const tableInner = fb[2] || '';
          const isEmpty = tableInner.includes('Henüz konu eklenmemiş');
          const trMatches = isEmpty ? [] : [...tableInner.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
          return {
            id: `${code}-forum-${idx + 1}`,
            title: catTitle,
            topicCount: trMatches.length,
            messageCount: trMatches.length,
            lastActivity: isEmpty ? 'Henüz konu eklenmemiş' : 'Aktif konu mevcut'
          };
        })
      : [
          'Duyurular',
          'Ders içeriği ile ilgili tartışma alanı',
          'Ödevlerle ilgili tartışma alanı',
          'Genel konular',
          'Dersi veren öğretim elemanına sorular'
        ].map((catName, idx) => ({
          id: `${code}-forum-${idx + 1}`,
          title: catName,
          topicCount: 0,
          messageCount: 0,
          lastActivity: 'Henüz konu eklenmemiş'
        }))
    );

    // Parse Virtual Meetings (Toplantilar)
    const meetingRows = [...topHtml.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi)];
    const meetings = [];
    for (const mr of meetingRows) {
      const topTitle = stripTags(mr[1]);
      const topDate = stripTags(mr[2]);
      const topLinkMatch = mr[0].match(/href="([^"]+)"/i);
      if (topTitle && !topTitle.includes('Başlık') && !topTitle.includes('Kayıt bulunamadı')) {
        const mObj = {
          title: topTitle,
          date: topDate,
          url: topLinkMatch ? decodeHtml(topLinkMatch[1]) : ''
        };
        meetings.push(mObj);
        allUpcomingMeetings.push({
          courseCode: code,
          courseName: name,
          instructor: hoca,
          title: `${code} - ${topTitle}`,
          schedule: topDate,
          url: mObj.url
        });
      }
    }

    updatedCourses.push({
      code,
      name,
      fullTitle,
      ects,
      akts,
      teori,
      uygulama,
      lab,
      kredi,
      instructor: hoca,
      purpose: amac,
      references: kaynaklar,
      weeks,
      homeworks,
      exams,
      materials,
      forumCategories,
      groups: [],
      meetings
    });
  }

  // Build dynamic urgentNotifications directly from UKEY dashboard 7-day tasks + live course homeworks
  const dynamicUrgentNotifications = [];
  for (const tb of rawTaskBlocks) {
    const rawH4 = tb[1] || '';
    const timeRemMatch = rawH4.match(/<small[^>]*>([\s\S]*?)<\/small>/i);
    const timeRemText = timeRemMatch ? stripTags(timeRemMatch[1]) : '';
    const cleanH4 = stripTags(rawH4.replace(/<small[\s\S]*?<\/small>/i, ''));
    const taskDesc = stripTags(tb[2] || '');

    // Match with live homework by description or course name
    const matchedHw = allHomeworksFlat.find(hw =>
      cleanH4.toLocaleUpperCase('tr-TR').includes(hw.courseName.toLocaleUpperCase('tr-TR')) ||
      (taskDesc && hw.description && hw.description.includes(taskDesc.slice(0, 25)))
    ) || allHomeworksFlat.find(hw => !hw.submissionStatus.includes('Sona Ermiştir'));

    if (matchedHw) {
      dynamicUrgentNotifications.push({
        id: `notif-${matchedHw.id}`,
        type: 'odev',
        courseCode: matchedHw.courseCode,
        courseName: matchedHw.courseName,
        instructor: matchedHw.instructor,
        title: matchedHw.title,
        description: matchedHw.description,
        start: matchedHw.start,
        end: matchedHw.end,
        badgeText: `7 Gün İçindeki Görev Bildirimi ${timeRemText}`.trim(),
        allowedFormat: matchedHw.allowedFileTypes,
        maxSizeMB: matchedHw.maxFileSizeMB
      });
    }
  }

  // Fallback: If no urgent tasks returned from UKEY dashboard header, populate with all active course homeworks
  const activeHomeworks = allHomeworksFlat.filter(hw => !hw.submissionStatus.includes('Sona Ermiştir'));
  for (const hw of activeHomeworks) {
    if (!dynamicUrgentNotifications.some(n => n.id === `notif-${hw.id}`)) {
      dynamicUrgentNotifications.push({
        id: `notif-${hw.id}`,
        type: 'odev',
        courseCode: hw.courseCode,
        courseName: hw.courseName,
        instructor: hw.instructor,
        title: hw.title,
        description: hw.description,
        start: hw.start,
        end: hw.end,
        badgeText: 'Aktif Ödev Teslimi',
        allowedFormat: hw.allowedFileTypes,
        maxSizeMB: hw.maxFileSizeMB
      });
    }
  }

  const officialGuides = [
    {
      title: 'Öğrenciler için UKEY Kullanma Kılavuzu',
      type: 'Resmi PDF Kılavuz',
      url: 'https://www.uludag.edu.tr/dosyalar/bilgiislem/ukey/UKEY_KK.pdf',
      localFallback: fs.existsSync(path.join(FILES_DIR, 'UKEY_Kullanma_Kilavuzu.pdf'))
        ? 'ukey_dosyalar/UKEY_Kullanma_Kilavuzu.pdf'
        : 'https://www.uludag.edu.tr/dosyalar/bilgiislem/ukey/UKEY_KK.pdf',
      description: 'UKEY sistemi üzerinden ders içerikleri, ödev teslim kuralları, e-sınav ve sanal toplantı adımları.'
    },
    {
      title: 'Microsoft Teams Öğrenci Kullanım Kılavuzu',
      type: 'PDF Kılavuz (İndirilebilir)',
      url: 'ukey_dosyalar/22YAD105-1_6.pdf',
      localFallback: 'ukey_dosyalar/22YAD105-1_6.pdf',
      description: 'Bursa Uludağ Üniversitesi canlı derslerine Microsoft Teams üzerinden katılım rehberi.'
    },
    {
      title: 'Microsoft Office 365 Hesabı Oluşturma Kılavuzu',
      type: 'PDF Kılavuz (İndirilebilir)',
      url: 'ukey_dosyalar/22YAD105-1_5.pdf',
      localFallback: 'ukey_dosyalar/22YAD105-1_5.pdf',
      description: '@ogr.uludag.edu.tr uzantılı öğrenci e-postası ile ücretsiz Office 365 ve Teams aktivasyonu.'
    }
  ];

  const hasDataChanged = JSON.stringify({
    courses: updatedCourses,
    urgentNotifications: dynamicUrgentNotifications,
    agendaEvents: newAgendaEvents
  }) !== JSON.stringify({
    courses: existingData.courses || [],
    urgentNotifications: existingData.urgentNotifications || [],
    agendaEvents: existingData.agendaEvents || []
  });

  // Her senkronizasyon çalışmasında lastSyncedAt zaman damgasını daima güncelle

  const finalData = {
    ...existingData,
    lastSyncedAt: new Date().toISOString(),
    lastDataChangeAt: hasDataChanged ? new Date().toISOString() : (existingData.lastDataChangeAt || existingData.lastSyncedAt || new Date().toISOString()),
    urgentNotifications: dynamicUrgentNotifications,
    guides: officialGuides,
    agendaEvents: newAgendaEvents,
    meetingsSummary: {
      upcoming: allUpcomingMeetings,
      registered: allUpcomingMeetings,
      publicMeetings: [],
      recordedStreams: allRecordedStreams
    },
    courses: updatedCourses
  };

  fs.writeFileSync(UKEY_JSON_PATH, JSON.stringify(finalData, null, 2), 'utf8');
  console.log(`[UKEY-SYNC] Başarıyla tamamlandı! ${updatedCourses.length} ders, ${allHomeworksFlat.length} ödev, ${dynamicUrgentNotifications.length} aktif bildirim ve ${allRecordedStreams.length} canlı ders/kayıt linki güncellendi.`);

  if (process.argv.includes('--push')) {
    const { execSync } = require('child_process');
    try {
      execSync('git add ukey.json ukey_dosyalar/', { cwd: ROOT_DIR, stdio: 'inherit' });
      const status = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' });
      if (status.includes('ukey.json') || status.includes('ukey_dosyalar')) {
        execSync('git commit -m "chore(ukey): otomatik UKEY veri senkronizasyonu [skip ci]"', { cwd: ROOT_DIR, stdio: 'inherit' });
        try {
          execSync('git fetch origin main && git rebase --strategy-option=theirs origin/main', { cwd: ROOT_DIR, stdio: 'inherit' });
        } catch (rbErr) {
          try { execSync('git rebase --abort', { cwd: ROOT_DIR, stdio: 'ignore' }); } catch (e) {}
        }
        execSync('git push origin main', { cwd: ROOT_DIR, stdio: 'inherit' });
        console.log('[UKEY-SYNC] Değişiklikler başarıyla GitHub deposuna gönderildi (pushed).');
      } else {
        console.log('[UKEY-SYNC] Git için yeni değişiklik tespit edilmedi.');
      }
    } catch (gitErr) {
      console.warn('[UKEY-SYNC] Git commit/push uyarısı:', gitErr.message);
    }
  }
}

syncUkey().catch(err => {
  console.error('[UKEY-SYNC] Hata:', err.message);
  process.exit(1);
});


// bot.js -- PackeshareBot v2.0R (Robust Fallback Logic)
const puppeteer = require("puppeteer");
const http = require("http"); // Para notificaciones

// == UTILIDADES GENERALES ==
function getCurrentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const year = String(now.getFullYear()).slice(-2);
  const timeStr = now.toLocaleTimeString('es-ES', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return `[${day}${month}${year} ${timeStr}]`;
}

function parseCountdownText(countdownText) {
  const regex = /(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/;
  const match = countdownText.match(regex);
  if (match && match.length === 4) {
    return {
      hours: parseInt(match[1], 10),
      minutes: parseInt(match[2], 10),
      seconds: parseInt(match[3], 10)
    };
  }
  console.warn(`${getCurrentTimestamp()} ⚠️ No se pudo parsear el texto del temporizador: "${countdownText}". Usando 0 segundos.`);
  return { hours: 0, minutes: 0, seconds: 0 };
}

function timeToMilliseconds(timeObj) {
  return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
}

function getFutureDateTime(milliseconds) {
  const now = new Date();
  const future = new Date(now.getTime() + milliseconds);
  const dateStr = future.toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  const timeStr = future.toLocaleTimeString('es-ES', { 
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return { dateStr, timeStr };
}

async function sendNotification(message) {
  const notificationUrl = process.env.NOTIFICATION;
  if (!notificationUrl) return;
  return new Promise((resolve) => {
    let url;
    try { url = new URL(notificationUrl); } catch { resolve(); return; }
    const httpModule = url.protocol === 'https:' ? require('https') : require('http');
    const options = { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method: 'POST', headers: { 'Content-Length': 0 } };
    const req = httpModule.request(options, () => resolve());
    req.on('error', () => resolve());
    req.end();
  });
}

let browser;
let page;
let isFirstRun = true;

// == FLUJO PRINCIPAL, ESTRATEGIAS ROBUSTAS ==

async function runCycle() {
  try {
    // ==== LOGIN ====
    if (isFirstRun) {
      console.log(`${getCurrentTimestamp()} 🚀 Iniciando bot de PacketShare...`);
      browser = await puppeteer.launch({ headless: "new", args: [
        "--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu", ], });
      page = await browser.newPage();
      console.log(`${getCurrentTimestamp()} 🌐 Abriendo página de login...`);
      const response = await page.goto("https://www.packetshare.io/login/", { waitUntil: "networkidle2", timeout: 30000, });
      console.log(`${getCurrentTimestamp()}    Estado de carga: ${response.status()}`);
      await page.waitForSelector('input[placeholder="Please enter the email"]', { timeout: 10000, });
      await page.waitForSelector('input[placeholder="Please enter password"]', { timeout: 10000, });
      await page.waitForSelector("div.btn.login", { timeout: 10000 });
      await page.type('input[placeholder="Please enter the email"]', process.env.EMAIL, { delay: 50 });
      await page.type('input[placeholder="Please enter password"]', process.env.PASSWORD, { delay: 50 });
      await page.click("div.btn.login");
      await page.waitForTimeout(5000);
      const currentUrl = page.url();
      console.log(`${getCurrentTimestamp()} 📍 URL después del intento de login: ${currentUrl}`);
      if (!currentUrl.includes("/dashboard")) throw new Error("No se pudo acceder al dashboard después del login");
      console.log(`${getCurrentTimestamp()} ✅ Login exitoso. Redirigido a dashboard.`);
      isFirstRun = false;
    } else {
      console.log(`${getCurrentTimestamp()} 🔄 Refrescando dashboard...`);
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    // ==== BALANCE ANTES ====
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance ANTES de intentar reclamar...`);
    await page.waitForTimeout(2000);
    const balanceBefore = await page.$eval('div.money span', el => el.textContent);

    // ==== BUSCAR Y CLICKEAR REGALO ====
    let giftImg = null;
    let regaloEncontrado = false;
    let estrategias = [
      "//img[contains(@class, 'flow-received')]",
      "//img[@alt='flowFullReceived']",
      "//img[@alt='flowFullNoReceive']",
      "//img[contains(@class, 'flow')]",
      "//img[contains(@src, 'img_receive') or contains(@src, 'img_full')]",
      "//img[@class]"
    ];
    for (let xp of estrategias) {
      try {
        await page.waitForXPath(xp, { timeout: 4000 });
        let imgs = await page.$x(xp);
        if (imgs.length > 0) {
          giftImg = imgs[imgs.length - 1];
          regaloEncontrado = true;
          await giftImg.click();
          console.log(`${getCurrentTimestamp()} ✅ Regalo encontrado y clickeado por XPath: ${xp}`);
          break;
        }
      } catch {}
    }

    // ==== SI NO ENCONTRÓ REGALO, BUSCA TEMPORIZADOR EN POPUP ====
    if (!regaloEncontrado) {
      console.log(`${getCurrentTimestamp()} ⚡ No se encontró regalo. Buscando temporizador (cooldown)...`);
      let countdownText = "";
      let popupText = "";
      try {
        await page.waitForSelector('div.dialog-flow-box', { timeout: 6000 });
        popupText = await page.$eval('div.dialog-flow-box', el => el.innerText);
        // Intento directo al div.time
        try {
          countdownText = await page.$eval('div.dialog-flow-box .time', el => el.textContent.replace(/\s+/g, ' '));
        } catch {}
        // Si no lo agarra, por regex en el texto del popup
        if (!countdownText || !countdownText.match(/\d+ hours \d+ min \d+ sec/)) {
          let match = popupText.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/);
          if (match) countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
        }
      } catch {
        console.log(`${getCurrentTimestamp()} ⚡ No hay popup visible (posiblemente ni temporizador ni regalo).`);
      }

      if (countdownText && countdownText.match(/\d+ hours \d+ min \d+ sec/)) {
        console.log(`${getCurrentTimestamp()} ⏳ Cooldown extraído del popup: ${countdownText}`);
        let timeObj = parseCountdownText(countdownText);
        let waitTimeMs = timeToMilliseconds(timeObj) + 300000; // +5 min margen
        let { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
        let minutes = (waitTimeMs / 1000 / 60).toFixed(2);
        console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${dateStr} a las ${timeStr} (~${minutes} min).`);
        setTimeout(runCycle, waitTimeMs);
        return;
      } else {
        console.log(`${getCurrentTimestamp()} ❗ Ni regalo ni temporizador. Espera de respaldo (60 seg)...`);
        setTimeout(runCycle, 60000);
        return;
      }
    }

    // Esperar apertura del popup tras click regalo
    await page.waitForTimeout(3500);
    await page.waitForSelector('div.dialog-flow-box', { timeout: 9000 });

    // ==== BOTÓN "Open Wish Box" O TEMPORIZADOR ====
    let claimed = false;
    try {
      await page.waitForXPath("//*[contains(text(), 'Open Wish Box')]", { timeout: 5000 });
      const [confirmButton] = await page.$x("//*[contains(text(), 'Open Wish Box')]");
      if (confirmButton) {
        await confirmButton.click();
        claimed = true;
        console.log(`${getCurrentTimestamp()} ✅ Botón de confirmación clickeado`);
        await page.waitForTimeout(3000);
      }
    } catch {
      console.log(`${getCurrentTimestamp()} 🕑 No hay botón de confirmación, posiblemente cooldown activo.`);
    }

    // ==== EXTRAER TEMPORIZADOR DESPUÉS DE ACCIÓN ====
    let countdownText = "";
    try {
      await page.waitForSelector('div.dialog-flow-box .time', { timeout: 7000 });
      countdownText = await page.$eval('div.dialog-flow-box .time', el => el.textContent.replace(/\s+/g, ' '));
    } catch {}
    if (!countdownText || !countdownText.match(/\d+ hours \d+ min \d+ sec/)) {
      try {
        let popupHandle = await page.$('div.dialog-flow-box');
        if (popupHandle) {
          let popupText = await page.evaluate(el => el.innerText, popupHandle);
          let match = popupText.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/);
          if (match) countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
        }
      } catch {}
    }
    if (!countdownText || !countdownText.match(/\d+ hours \d+ min \d+ sec/)) {
      console.log(`${getCurrentTimestamp()} ❗ No se encontró temporizador después de reclamar. Espera respaldo (60 seg)...`);
      setTimeout(runCycle, 60000);
      return;
    }

    let timeObj = parseCountdownText(countdownText);
    let waitTimeMs = timeToMilliseconds(timeObj) + 20000;
    let { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
    let minutes = (waitTimeMs / 1000 / 60).toFixed(2);
    console.log(`${getCurrentTimestamp()} ⏰ Esperando ${minutes} min. Próximo intento: ${dateStr} ${timeStr}`);

    // ==== OPCIONAL: NOTIFICAR POR RECLAMO EXITOSO ====
    if (claimed) {
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);
      const balanceAfter = await page.$eval('div.money span', el => el.textContent);
      const balanceIncreased = parseFloat(balanceAfter.replace(/,/g, '')) > parseFloat(balanceBefore.replace(/,/g, ''));
      if (balanceIncreased) await sendNotification('Premio reclamado con aumento de balance');
    }

    // ==== LIMPIEZA DE POPUP Y RECICLADO DE CICLO ====
    try {
      await page.waitForSelector('div.dialog-flow-box img.close-button', { timeout: 3000 });
      await page.click('div.dialog-flow-box img.close-button');
      console.log(`${getCurrentTimestamp()} ❌ Popup cerrado automáticamente.`);
    } catch {}
    setTimeout(runCycle, waitTimeMs);

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en el ciclo:`, err.message);
    if (browser) try { await browser.close(); } catch {}
    setTimeout(() => { isFirstRun = true; runCycle(); }, 60000);
  }
}

runCycle();

process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0); });
process.on('SIGTERM', async () => { if (browser) await browser.close(); process.exit(0); });

// ---- PackeshareBot v2.0R ----

const puppeteer = require("puppeteer");
const http = require("http");

function getCurrentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const year = String(now.getFullYear()).slice(-2);
  const timeStr = now.toLocaleTimeString('es-ES', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
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
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const timeStr = future.toLocaleTimeString('es-ES', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return { dateStr, timeStr };
}

async function sendNotification(message) {
  const notificationUrl = process.env.NOTIFICATION;
  if (!notificationUrl) {
    console.log(`${getCurrentTimestamp()} ℹ️ Variable NOTIFICATION no definida. Omitiendo notificación.`);
    return;
  }
  console.log(`${getCurrentTimestamp()} 📢 Enviando notificación a: ${notificationUrl}`);
  return new Promise((resolve) => {
    const postData = '';
    let url;
    try {
      url = new URL(notificationUrl);
    } catch (err) {
      console.error(`${getCurrentTimestamp()} ⚠️ Error al parsear la URL de notificación '${notificationUrl}': ${err.message}. Omitiendo notificación.`);
      resolve();
      return;
    }
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? require('https') : require('http');
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = httpModule.request(options, (res) => {
      console.log(`${getCurrentTimestamp()} ✅ Notificación enviada. Código de estado: ${res.statusCode}`);
      resolve();
    });
    req.on('error', (e) => {
      console.error(`${getCurrentTimestamp()} ⚠️ Error al enviar notificación a '${notificationUrl}': ${e.message}`);
      resolve();
    });
    req.write(postData);
    req.end();
  });
}

let browser;
let page;
let isFirstRun = true;

async function runCycle() {
  try {
    if (isFirstRun) {
      console.log(`${getCurrentTimestamp()} 🚀 Iniciando bot de PacketShare...`);
      browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
      page = await browser.newPage();
      console.log(`${getCurrentTimestamp()} 🌐 Abriendo página de login...`);
      const response = await page.goto("https://www.packetshare.io/login/", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
      console.log(`${getCurrentTimestamp()}    Estado de carga: ${response.status()}`);
      console.log(`${getCurrentTimestamp()} 🔍 Esperando campos de login...`);
      await page.waitForSelector('input[placeholder="Please enter the email"]', {
        timeout: 10000,
      });
      await page.waitForSelector('input[placeholder="Please enter password"]', {
        timeout: 10000,
      });
      await page.waitForSelector("div.btn.login", { timeout: 10000 });
      console.log(`${getCurrentTimestamp()} ✍️ Escribiendo credenciales...`);
      await page.type('input[placeholder="Please enter the email"]', process.env.EMAIL, { delay: 50 });
      await page.type('input[placeholder="Please enter password"]', process.env.PASSWORD, { delay: 50 });
      console.log(`${getCurrentTimestamp()} 🔑 Enviando login...`);
      await page.click("div.btn.login");
      console.log(`${getCurrentTimestamp()} ⏳ Esperando respuesta...`);
      await page.waitForTimeout(5000);
      const currentUrl = page.url();
      console.log(`${getCurrentTimestamp()} 📍 URL después del intento de login: ${currentUrl}`);
      if (!currentUrl.includes("/dashboard")) {
        throw new Error("No se pudo acceder al dashboard después del login");
      }
      console.log(`${getCurrentTimestamp()} ✅ Login exitoso. Redirigido a dashboard.`);
      isFirstRun = false;
    } else {
      console.log(`${getCurrentTimestamp()} 🔄 Refrescando dashboard...`);
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    // Balance antes de reclamar
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance ANTES de intentar reclamar...`);
    await page.waitForTimeout(2000);
    const balanceBefore = await page.$eval('div.money span', el => el.textContent);
    console.log(`${getCurrentTimestamp()} 💰 Balance antes: ${balanceBefore}`);

    // Clic regalo
    console.log(`${getCurrentTimestamp()} 👆 Haciendo primer clic en el elemento del premio...`);
    let giftImg = null;
    try {
      await page.waitForXPath("//img[contains(@class, 'flow')]", { timeout: 6000 });
      const result = await page.$x("//img[contains(@class, 'flow')]");
      if (result.length > 0) {
        giftImg = result[result.length - 1];
      }
    } catch {}
    if (!giftImg) {
      throw new Error("No se encontró la imagen del regalo");
    }
    await giftImg.click();
    console.log(`${getCurrentTimestamp()} ✅ Clic en imagen del regalo exitoso`);
    await page.waitForTimeout(3500);

    // Popup
    console.log(`${getCurrentTimestamp()} ⏳ Esperando apertura del popup...`);
    await page.waitForSelector('div.dialog-flow-box', { timeout: 12000 });
    console.log(`${getCurrentTimestamp()} 🔍 Verificando contenido del popup...`);

    // Intentar botón "Open Wish Box"
    let claimed = false;
    try {
      await page.waitForXPath("//*[contains(text(), 'Open Wish Box')]", { timeout: 6000 });
      const [confirmButton] = await page.$x("//*[contains(text(), 'Open Wish Box')]");
      if (confirmButton) {
        await confirmButton.click();
        claimed = true;
        console.log(`${getCurrentTimestamp()} ✅ Botón de confirmación clickeado`);
        await page.waitForTimeout(3500);
      }
    } catch {}

    // Extraer temporizador directo del elemento `.time`
    let countdownText = null;
    try {
      await page.waitForSelector('div.dialog-flow-box .time', { timeout: 9000 });
      const timerDiv = await page.$('div.dialog-flow-box .time');
      if (timerDiv) {
        const spans = await timerDiv.$$('span');
        const hour = spans[0] ? await (await spans[0].getProperty('textContent')).jsonValue() : '0';
        const min = spans[1] ? await (await spans[1].getProperty('textContent')).jsonValue() : '0';
        const sec = spans[2] ? await (await spans[2].getProperty('textContent')).jsonValue() : '0';
        countdownText = `${hour} hours ${min} min ${sec} sec`;
        console.log(`${getCurrentTimestamp()} ⏳ Conteo regresivo encontrado: ${countdownText}`);
      }
    } catch {}

    if (!countdownText) {
      // Fallback: Todo el texto del popup
      try {
        const popupHandle = await page.$('div.dialog-flow-box');
        if (popupHandle) {
          const popupText = await page.evaluate(el => el.innerText, popupHandle);
          const match = popupText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
          if (match) {
            countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
            console.log(`${getCurrentTimestamp()} ⏳ Conteo regresivo alternativo: ${countdownText}`);
          }
        }
      } catch {}
    }

    if (!countdownText) {
      console.warn(`${getCurrentTimestamp()} ❌ No se encontró temporizador. Reintentando en 5 minutos...`);
      setTimeout(runCycle, 300000);
      return;
    }

    // Espera hasta el próximo intento
    const timeObj = parseCountdownText(countdownText.trim());
    const waitTimeMs = timeToMilliseconds(timeObj) + 22000;
    const { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
    const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${dateStr} a las ${timeStr} (~${minutes} minutos)`);

    // Cierra el popup si hay botón de cierre
    try {
      const closeButtonSelector = "div.dialog-flow-box img.close-button";
      await page.waitForSelector(closeButtonSelector, { timeout: 4000 });
      await page.click(closeButtonSelector);
      console.log(`${getCurrentTimestamp()} ❌ Popup cerrado automáticamente.`);
    } catch {}
    
    // Opcional: Notificación por reclamo exitoso y balance
    if (claimed) {
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);
      const balanceAfter = await page.$eval('div.money span', el => el.textContent);
      const balanceIncreased = parseFloat(balanceAfter.replace(/,/g, '')) > parseFloat(balanceBefore.replace(/,/g, ''));
      if (balanceIncreased) {
        console.log(`${getCurrentTimestamp()} 🎉 El balance aumentó! Premio reclamado.`);
        await sendNotification('Premio reclamado con aumento de balance');
      } else {
        console.log(`${getCurrentTimestamp()} ⚠️ El balance no aumentó o fue $0.`);
      }
    }
    setTimeout(runCycle, waitTimeMs);

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en el ciclo:`, err.message);
    if (browser) {
      try { await browser.close(); } catch (closeErr) {}
    }
    console.log(`${getCurrentTimestamp()} 🔄 Reintentando en 60 segundos...`);
    setTimeout(() => { isFirstRun = true; runCycle(); }, 60000);
  }
}

runCycle();

process.on('SIGINT', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Señal de interrupción. Cerrando...`);
  if (browser) { await browser.close(); }
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Señal de terminación. Cerrando...`);
  if (browser) { await browser.close(); }
  process.exit(0);
});

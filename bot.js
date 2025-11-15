// bot.js -- PackeshareBot v2.1R (Fixed Selector Logic & Robust Fallback)
const puppeteer = require("puppeteer");
const http = require("http");

// == UTILIDADES ==
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
      headers: { 'Content-Length': Buffer.byteLength(postData) }
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

// == CICLO PRINCIPAL ==
async function runCycle() {
  try {
    // === LOGIN ===
    if (isFirstRun) {
      console.log(`${getCurrentTimestamp()} 🚀 Iniciando bot de PacketShare...`);
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      page = await browser.newPage();
      console.log(`${getCurrentTimestamp()} 🌐 Abriendo página de login...`);
      const response = await page.goto("https://www.packetshare.io/login/", {
        waitUntil: "networkidle2", timeout: 30000,
      });
      console.log(`${getCurrentTimestamp()}    Estado de carga: ${response.status()}`);
      console.log(`${getCurrentTimestamp()} 🔍 Esperando campos de login...`);
      await page.waitForSelector('input[placeholder="Please enter the email"]', { timeout: 10000 });
      await page.waitForSelector('input[placeholder="Please enter password"]', { timeout: 10000 });
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

    // === BALANCE ANTES ===
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance ANTES de intentar reclamar...`);
    await page.waitForTimeout(2000);
    const balanceBefore = await page.$eval('div.money span', el => el.textContent);
    console.log(`${getCurrentTimestamp()} 💰 Balance antes: ${balanceBefore}`);

    // === BUSCAR Y CLICKEAR REGALO (ESTRATEGIAS ESPECÍFICAS) ===
    console.log(`${getCurrentTimestamp()} 👆 Haciendo primer clic en el elemento del premio...`);
    let giftImg = null;

    try {
      console.log(`${getCurrentTimestamp()} 🔍 Intentando buscar por clase 'flow-received'...`);
      await page.waitForXPath("//img[@class='flow-received']", { timeout: 5000 });
      const result = await page.$x("//img[@class='flow-received']");
      if (result.length > 0) {
        giftImg = result[0];
        console.log(`${getCurrentTimestamp()} ✅ Encontrado por clase 'flow-received'`);
      }
    } catch (e1) {
      console.log(`${getCurrentTimestamp()} ℹ️ No encontrado por clase 'flow-received', probando alternativa...`);
      
      try {
        console.log(`${getCurrentTimestamp()} 🔍 Intentando buscar por alt 'flowFullReceived'...`);
        await page.waitForXPath("//img[@alt='flowFullReceived']", { timeout: 5000 });
        const result = await page.$x("//img[@alt='flowFullReceived']");
        if (result.length > 0) {
          giftImg = result[0];
          console.log(`${getCurrentTimestamp()} ✅ Encontrado por alt 'flowFullReceived'`);
        }
      } catch (e2) {
        console.log(`${getCurrentTimestamp()} ℹ️ No encontrado por alt, probando 'flowFullNoReceive'...`);
        
        try {
          console.log(`${getCurrentTimestamp()} 🔍 Intentando buscar por alt 'flowFullNoReceive'...`);
          await page.waitForXPath("//img[@alt='flowFullNoReceive']", { timeout: 5000 });
          const result = await page.$x("//img[@alt='flowFullNoReceive']");
          if (result.length > 0) {
            giftImg = result[0];
            console.log(`${getCurrentTimestamp()} ✅ Encontrado por alt 'flowFullNoReceive'`);
          }
        } catch (e3) {
          console.log(`${getCurrentTimestamp()} ℹ️ No encontrado por alt, probando última alternativa...`);
          
          // ÚLTIMA ESTRATEGIA ESPECÍFICA - Removido //img[@class] genérico
          try {
            console.log(`${getCurrentTimestamp()} 🔍 Intentando búsqueda por src...`);
            await page.waitForXPath("//img[contains(@src, 'img_receive') or contains(@src, 'img_full')]", { timeout: 5000 });
            const result = await page.$x("//img[contains(@src, 'img_receive') or contains(@src, 'img_full')]");
            if (result.length > 0) {
              giftImg = result[result.length - 1];
              console.log(`${getCurrentTimestamp()} ✅ Encontrado por src`);
            }
          } catch (e4) {
            throw new Error("No se pudo encontrar la imagen del regalo con ningún método");
          }
        }
      }
    }

    if (giftImg) {
      await giftImg.click();
      console.log(`${getCurrentTimestamp()} ✅ Clic en imagen del regalo exitoso`);
    } else {
      throw new Error("No se encontró la imagen del regalo");
    }

    // === ESPERAR POPUP ===
    console.log(`${getCurrentTimestamp()} ⏳ Esperando apertura del popup...`);
    await page.waitForTimeout(3000);

    // === VERIFICAR CONTENIDO DEL POPUP ===
    console.log(`${getCurrentTimestamp()} 🔍 Verificando contenido del popup...`);
    let prizeClaimAttempted = false;

    try {
      console.log(`${getCurrentTimestamp()} 🔍 Buscando botón "Open Wish Box"...`);
      await page.waitForXPath("//*[contains(text(), 'Open Wish Box')]", { timeout: 5000 });
      const [confirmButton] = await page.$x("//*[contains(text(), 'Open Wish Box')]");
      if (confirmButton) {
        console.log(`${getCurrentTimestamp()} ✅ Botón de confirmación encontrado. Haciendo segundo clic para reclamar el premio...`);
        await confirmButton.click();
        prizeClaimAttempted = true;
        console.log(`${getCurrentTimestamp()} ⏳ Esperando después de reclamar el premio...`);
        await page.waitForTimeout(5000);
      }
    } catch (confirmButtonError) {
      console.log(`${getCurrentTimestamp()} ℹ️ No se encontró botón de confirmación. Verificando si hay conteo regresivo...`);
      
      try {
        console.log(`${getCurrentTimestamp()} 🔍 Buscando temporizador...`);
        let countdownText = null;
        
        try {
          const [timerElement] = await page.$x("//*[contains(text(), 'hours')]");
          if (timerElement) {
            const parentText = await page.evaluate(el => {
              let text = '';
              let parent = el.parentElement;
              for (let child of parent.children) {
                text += child.textContent + ' ';
              }
              return text;
            }, timerElement);
            const match = parentText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
            if (match) {
              countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
            }
          }
        } catch (e) {
          console.log(`${getCurrentTimestamp()} 🔍 Intentando búsqueda alternativa del temporizador...`);
        }

        if (!countdownText) {
          const allText = await page.evaluate(() => document.body.innerText);
          const match = allText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
          if (match) {
            countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          }
        }

        if (countdownText) {
          console.log(`${getCurrentTimestamp()} ⏳ Conteo regresivo encontrado (sin necesidad de confirmar): ${countdownText.trim()}`);
          const timeObj = parseCountdownText(countdownText.trim());
          const waitTimeMs = timeToMilliseconds(timeObj) + 20000;
          const { dateStr: futureDateTimeDate, timeStr: futureDateTimeTime } = getFutureDateTime(waitTimeMs);
          const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
          console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${futureDateTimeDate} a las ${futureDateTimeTime} que son aproximadamente en ${minutes} minutos...`);
          
          try {
            const closeButtonSelector = "body > div.dialog-flow-box > div > img.close-button";
            await page.waitForSelector(closeButtonSelector, { timeout: 3000 });
            await page.click(closeButtonSelector);
            console.log(`${getCurrentTimestamp()} ❌ Ventana emergente cerrada automáticamente.`);
          } catch (e) {
            console.log(`${getCurrentTimestamp()} ℹ️ No se encontró ventana emergente para cerrar (esto es normal).`);
          }
          
          setTimeout(runCycle, waitTimeMs);
          return;
        }
      } catch (countdownError) {
        console.log(`${getCurrentTimestamp()} ⚠️ No se encontró ni botón de confirmación ni conteo regresivo. Reintentando en 5 minutos...`);
        setTimeout(runCycle, 300000);
        return;
      }

// bot.js -- PackeshareBot v2.3.4R (Fixed Click + Timer Detection) - PARTE 1/3
const puppeteer = require("puppeteer");
const http = require("http");

// == VARIABLES GLOBALES ==
let browser;
let page;
let isFirstRun = true;
let failedAttempts = 0;

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
  console.warn(`${getCurrentTimestamp()} ⚠️ No se pudo parsear: "${countdownText}". Usando 0.`);
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

function getRetryDelay(attempts) {
  if (attempts === 0) return 0;
  if (attempts === 1) return 5 * 60 * 1000;
  if (attempts === 2) return 15 * 60 * 1000;
  if (attempts === 3) return 30 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
}

function getRetryDelayText(attempts) {
  if (attempts === 1) return "5 minutos";
  if (attempts === 2) return "15 minutos";
  if (attempts === 3) return "30 minutos";
  return "2 horas";
}

async function sendNotification(message) {
  const notificationUrl = process.env.NOTIFICATION;
  if (!notificationUrl) return;
  return new Promise((resolve) => {
    const postData = '';
    let url;
    try {
      url = new URL(notificationUrl);
    } catch {
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
      headers: { 'Content-Length': 0 }
    };
    const req = httpModule.request(options, () => resolve());
    req.on('error', () => resolve());
    req.end();
  });
}

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
      await page.waitForSelector('input[placeholder="Please enter the email"]', { timeout: 10000 });
      await page.waitForSelector('input[placeholder="Please enter password"]', { timeout: 10000 });
      await page.waitForSelector("div.btn.login", { timeout: 10000 });
      await page.type('input[placeholder="Please enter the email"]', process.env.EMAIL, { delay: 50 });
      await page.type('input[placeholder="Please enter password"]', process.env.PASSWORD, { delay: 50 });
      console.log(`${getCurrentTimestamp()} 🔑 Enviando login...`);
      await page.click("div.btn.login");
      await page.waitForTimeout(5000);
      const currentUrl = page.url();
      console.log(`${getCurrentTimestamp()} 📍 URL: ${currentUrl}`);
      if (!currentUrl.includes("/dashboard")) {
        throw new Error("No se pudo acceder al dashboard");
      }
      console.log(`${getCurrentTimestamp()} ✅ Login exitoso`);
      isFirstRun = false;
    } else {
      console.log(`${getCurrentTimestamp()} 🔄 Refrescando dashboard...`);
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    // === BALANCE ===
    await page.waitForTimeout(2000);
    const balanceBefore = await page.$eval('div.money span', el => el.textContent);
    console.log(`${getCurrentTimestamp()} 💰 Balance: ${balanceBefore}`);

    // === BUSCAR REGALO ===
    console.log(`${getCurrentTimestamp()} 👆 Buscando regalo...`);
    let giftImg = null;

    try {
      await page.waitForXPath("//img[@alt='gift']", { timeout: 5000 });
      const result = await page.$x("//img[@alt='gift']");
      if (result.length > 0) {
        giftImg = result[0];
        console.log(`${getCurrentTimestamp()} ✅ Encontrado por alt='gift'`);
      }
    } catch {
      try {
        await page.waitForXPath("//img[contains(@src, 'gift')]", { timeout: 5000 });
        const result = await page.$x("//img[contains(@src, 'gift')]");
        if (result.length > 0) {
          giftImg = result[0];
          console.log(`${getCurrentTimestamp()} ✅ Encontrado por src`);
        }
      } catch {
        throw new Error("No se encontró imagen del regalo");
      }
    }

    if (!giftImg) throw new Error("No se encontró la imagen del regalo");
    
    await giftImg.click();
    console.log(`${getCurrentTimestamp()} ✅ Clic en regalo exitoso`);
    await page.waitForTimeout(3000);

    // CONTINÚA EN PARTE 2...
    // === BUSCAR Y CLICKEAR "OPEN WISH BOX" CON MÉTODO MEJORADO ===
    console.log(`${getCurrentTimestamp()} 🔍 Buscando botón "Open Wish Box"...`);
    let prizeClaimAttempted = false;

    // Verificar si el botón existe en la página
    const buttonExists = await page.evaluate(() => {
      const allText = document.body.innerText;
      return allText.includes('Open Wish Box');
    });

    if (buttonExists) {
      console.log(`${getCurrentTimestamp()} ✅ Botón "Open Wish Box" encontrado`);
      
      // MÉTODO MEJORADO: Click con JavaScript directo
      const buttonClicked = await page.evaluate(() => {
        const allElements = document.querySelectorAll('*');
        for (let el of allElements) {
          if (el.textContent && el.textContent.trim().includes('Open Wish Box')) {
            el.click();
            return true;
          }
        }
        return false;
      });

      if (buttonClicked) {
        prizeClaimAttempted = true;
        console.log(`${getCurrentTimestamp()} ✅ Clic en "Open Wish Box" exitoso (JS)`);
        await page.waitForTimeout(3000);
        
      // === CERRAR POPUP "CONGRATULATIONS" CON BOTÓN "OK" ===
      console.log(`${getCurrentTimestamp()} 🔍 Buscando botón "OK" del popup...`);
      try {
        // Esperar a que aparezca el popup de congratulaciones
        await page.waitForTimeout(2000);
        
        // Buscar y hacer clic en el botón "OK"
        const okButtonClicked = await page.evaluate(() => {
          const allElements = document.querySelectorAll('*');
          for (let el of allElements) {
            if (el.textContent && el.textContent.trim() === 'OK' && 
                el.tagName !== 'BODY' && el.tagName !== 'HTML') {
              el.click();
              return true;
            }
          }
          return false;
        });
        
        if (okButtonClicked) {
          console.log(`${getCurrentTimestamp()} ✅ Clic en "OK" exitoso`);
          await page.waitForTimeout(2000); // Esperar a que se cierre el popup
        } else {
          console.log(`${getCurrentTimestamp()} ⚠️ No se encontró el botón "OK"`);
        }
      } catch (e) {
        console.log(`${getCurrentTimestamp()} ℹ️ Error al buscar "OK": ${e.message}`);
      }
      } else {
        console.log(`${getCurrentTimestamp()} ⚠️ No se pudo clickear "Open Wish Box"`);
      }
    } else {
      console.log(`${getCurrentTimestamp()} ℹ️ No hay botón. Ya en cooldown.`);
    }

    // === BUSCAR TEMPORIZADOR ===
    console.log(`${getCurrentTimestamp()} 🔍 Buscando temporizador...`);
    let countdownText = null;

    // MÉTODO 1: Buscar "Next box available in" (después de reclamar)
    try {
      const bodyText = await page.evaluate(() => document.body.innerText);
      
      if (bodyText.includes('Next box available in')) {
        console.log(`${getCurrentTimestamp()} 🔍 Detectado "Next box available in"`);
        const match = bodyText.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (match) {
          countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          console.log(`${getCurrentTimestamp()} ⏳ Temporizador (Next box): ${countdownText}`);
        }
      }
    } catch (e) {
      console.log(`${getCurrentTimestamp()} ℹ️ Método "Next box" falló`);
    }

    // MÉTODO 2: Buscar "Time left to collect" (cooldown sin reclamar)
    if (!countdownText) {
      try {
        const bodyText = await page.evaluate(() => document.body.innerText);
        
        if (bodyText.includes('Time left to collect')) {
          console.log(`${getCurrentTimestamp()} 🔍 Detectado "Time left to collect"`);
          const match = bodyText.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
          if (match) {
            countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
            console.log(`${getCurrentTimestamp()} ⏳ Temporizador (Time left): ${countdownText}`);
          }
        }
      } catch (e) {
        console.log(`${getCurrentTimestamp()} ℹ️ Método "Time left" falló`);
      }
    }

    // MÉTODO 3: Regex genérico en todo el body (fallback)
    if (!countdownText) {
      try {
        const bodyText = await page.evaluate(() => document.body.innerText);
        const match = bodyText.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (match) {
          countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          console.log(`${getCurrentTimestamp()} ⏳ Temporizador (genérico): ${countdownText}`);
        }
      } catch (e) {
        console.log(`${getCurrentTimestamp()} ℹ️ Método genérico falló`);
      }
    }

    // === VALIDAR TEMPORIZADOR ===
    if (!countdownText) {
      console.log(`${getCurrentTimestamp()} ⚠️ No se pudo obtener temporizador`);
      failedAttempts++;
      const retryDelay = getRetryDelay(failedAttempts);
      const retryText = getRetryDelayText(failedAttempts);
      console.log(`${getCurrentTimestamp()} 🔄 Intento #${failedAttempts}. Reintento en ${retryText}...`);
      
      // Cerrar popup si existe
      try {
        await page.evaluate(() => {
          const closeBtn = Array.from(document.querySelectorAll('*')).find(el => 
            el.alt === 'closeButton' || el.textContent === 'OK'
          );
          if (closeBtn) closeBtn.click();
        });
      } catch {}
      
      setTimeout(runCycle, retryDelay);
      return;
    }

    // === ÉXITO: TEMPORIZADOR ENCONTRADO ===
    failedAttempts = 0;
    const timeObj = parseCountdownText(countdownText.trim());
    const waitTimeMs = timeToMilliseconds(timeObj) + 20000;
    const { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
    const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento: ${dateStr} ${timeStr} (~${minutes} min)`);

    // === VERIFICAR BALANCE SI RECLAMÓ ===
    if (prizeClaimAttempted) {
      // Cerrar popup con "OK" o botón de cierre
      try {
        await page.evaluate(() => {
          const okBtn = Array.from(document.querySelectorAll('*')).find(el => 
            el.textContent && el.textContent.trim() === 'OK'
          );
          if (okBtn) okBtn.click();
        });
        await page.waitForTimeout(1000);
      } catch {}
      
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);
      const balanceAfter = await page.$eval('div.money span', el => el.textContent);
      console.log(`${getCurrentTimestamp()} 💰 Balance después: ${balanceAfter}`);
      
      const increased = parseFloat(balanceAfter.replace(/,/g, '')) > parseFloat(balanceBefore.replace(/,/g, ''));
      if (increased) {
        console.log(`${getCurrentTimestamp()} 🎉 Balance aumentó!`);
        await sendNotification("Premio reclamado");
      } else {
        console.log(`${getCurrentTimestamp()} ℹ️ Balance sin cambios`);
      }
    } else {
      // Cerrar popup sin reclamar
      try {
        await page.evaluate(() => {
          const closeBtn = Array.from(document.querySelectorAll('*')).find(el => 
            el.alt === 'closeButton'
          );
          if (closeBtn) closeBtn.click();
        });
      } catch {}
    }

    setTimeout(runCycle, waitTimeMs);

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error: ${err.message}`);
    failedAttempts++;
    const retryDelay = getRetryDelay(failedAttempts);
    const retryText = getRetryDelayText(failedAttempts);
    console.log(`${getCurrentTimestamp()} 🔄 Intento #${failedAttempts}. Reintento en ${retryText}...`);
    
    if (err.message.includes("Session closed") || err.message.includes("Target closed")) {
      if (browser) {
        try { await browser.close(); } catch {}
      }
      isFirstRun = true;
    }
    
    setTimeout(runCycle, retryDelay);
  }
}

// CONTINÚA EN PARTE 3...


// Iniciar el primer ciclo
runCycle();

// Manejar señales de cierre limpiamente
process.on('SIGINT', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Recibida señal de interrupción. Cerrando...`);
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(`${getCurrentTimestamp()} \n🛑 Recibida señal de terminación. Cerrando...`);
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

// ---- FIN PackeshareBot v2.3.4R ----

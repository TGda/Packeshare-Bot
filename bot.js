// bot.js -- PackeshareBot v2.3R (Fixed Loop + Progressive Retries) - PARTE 1/2
const puppeteer = require("puppeteer");
const http = require("http");

// == VARIABLES GLOBALES ==
let browser;
let page;
let isFirstRun = true;
let failedAttempts = 0; // Contador de intentos fallidos

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

// Función para calcular tiempo de espera según intentos fallidos
function getRetryDelay(attempts) {
  if (attempts === 0) return 0;
  if (attempts === 1) return 5 * 60 * 1000;      // 5 minutos
  if (attempts === 2) return 15 * 60 * 1000;     // 15 minutos
  if (attempts === 3) return 30 * 60 * 1000;     // 30 minutos
  return 2 * 60 * 60 * 1000;                     // 2 horas para 4+ intentos
}

function getRetryDelayText(attempts) {
  if (attempts === 1) return "5 minutos";
  if (attempts === 2) return "15 minutos";
  if (attempts === 3) return "30 minutos";
  return "2 horas";
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

    // === BUSCAR Y CLICKEAR REGALO ===
    console.log(`${getCurrentTimestamp()} 👆 Buscando elemento del regalo...`);
    let giftImg = null;

    // ESTRATEGIA PRINCIPAL: Buscar por alt="gift"
    try {
      console.log(`${getCurrentTimestamp()} 🔍 Intentando buscar por alt='gift'...`);
      await page.waitForXPath("//img[@alt='gift']", { timeout: 5000 });
      const result = await page.$x("//img[@alt='gift']");
      if (result.length > 0) {
        giftImg = result[0];
        console.log(`${getCurrentTimestamp()} ✅ Encontrado por alt='gift'`);
      }
    } catch (e1) {
      console.log(`${getCurrentTimestamp()} ℹ️ No encontrado por alt='gift', probando alternativas...`);
      
      // Fallback a selectores anteriores
      try {
        console.log(`${getCurrentTimestamp()} 🔍 Intentando buscar por clase 'flow-received'...`);
        await page.waitForXPath("//img[@class='flow-received']", { timeout: 5000 });
        const result = await page.$x("//img[@class='flow-received']");
        if (result.length > 0) {
          giftImg = result[0];
          console.log(`${getCurrentTimestamp()} ✅ Encontrado por clase 'flow-received'`);
        }
      } catch (e2) {
        console.log(`${getCurrentTimestamp()} ℹ️ No encontrado por clase, probando por src...`);
        
        try {
          console.log(`${getCurrentTimestamp()} 🔍 Intentando búsqueda por src...`);
          await page.waitForXPath("//img[contains(@src, 'img_receive') or contains(@src, 'img_full') or contains(@src, 'gift')]", { timeout: 5000 });
          const result = await page.$x("//img[contains(@src, 'img_receive') or contains(@src, 'img_full') or contains(@src, 'gift')]");
          if (result.length > 0) {
            giftImg = result[result.length - 1];
            console.log(`${getCurrentTimestamp()} ✅ Encontrado por src`);
          }
        } catch (e3) {
          throw new Error("No se pudo encontrar la imagen del regalo con ningún método");
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

    // === VERIFICAR CONTENIDO DEL POPUP (DENTRO DEL POPUP SOLAMENTE) ===
    console.log(`${getCurrentTimestamp()} 🔍 Verificando contenido del popup...`);
    
    // Primero buscar el temporizador (siempre debe estar)
    let countdownText = null;
    
    try {
      console.log(`${getCurrentTimestamp()} 🔍 Buscando temporizador en el popup...`);
      
      // Buscar elementos que contengan "hours" DENTRO del popup
      const popupHandle = await page.$('div.dialog-flow-box');
      if (popupHandle) {
        const popupText = await page.evaluate(el => el.innerText, popupHandle);
        const match = popupText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
        if (match) {
          countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          console.log(`${getCurrentTimestamp()} ⏳ Temporizador encontrado: ${countdownText}`);
        }
      }
    } catch (e) {
      console.log(`${getCurrentTimestamp()} ⚠️ Error al buscar temporizador: ${e.message}`);
    }

    // CONTINÚA EN LA PARTE 2...
    // Ahora buscar botón "Open Wish Box" SOLO dentro del popup
    let prizeClaimAttempted = false;
    
    try {
      console.log(`${getCurrentTimestamp()} 🔍 Buscando botón "Open Wish Box" dentro del popup...`);
      
      // Buscar SOLO dentro del popup usando page.evaluate
      const buttonExists = await page.evaluate(() => {
        const popup = document.querySelector('div.dialog-flow-box');
        if (!popup) return false;
        
        const allElements = popup.querySelectorAll('*');
        for (let el of allElements) {
          if (el.textContent && el.textContent.includes('Open Wish Box')) {
            return true;
          }
        }
        return false;
      });
      
      if (buttonExists) {
        console.log(`${getCurrentTimestamp()} ✅ Botón "Open Wish Box" encontrado en el popup. Intentando reclamar...`);
        
        // Buscar y clickear el botón dentro del popup
        const popupHandle = await page.$('div.dialog-flow-box');
        const [confirmButton] = await page.$x("//div[@class='dialog-flow-box']//*[contains(text(), 'Open Wish Box')]");
        
        if (confirmButton) {
          await confirmButton.click();
          prizeClaimAttempted = true;
          console.log(`${getCurrentTimestamp()} ✅ Clic en botón "Open Wish Box" exitoso`);
          
          // Esperar un momento para que aparezca el temporizador tras reclamar
          console.log(`${getCurrentTimestamp()} ⏳ Esperando actualización del popup después de reclamar...`);
          await page.waitForTimeout(3000);
          
          // Buscar el temporizador NUEVAMENTE en el mismo popup (sin cerrarlo)
          const popupHandle2 = await page.$('div.dialog-flow-box');
          if (popupHandle2) {
            const popupText2 = await page.evaluate(el => el.innerText, popupHandle2);
            const match2 = popupText2.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
            if (match2) {
              countdownText = `${match2[1]} hours ${match2[2]} min ${match2[3]} sec`;
              console.log(`${getCurrentTimestamp()} ⏳ Temporizador actualizado después de reclamar: ${countdownText}`);
            }
          }
        }
      } else {
        console.log(`${getCurrentTimestamp()} ℹ️ No se encontró botón "Open Wish Box". Ya está en cooldown.`);
      }
    } catch (buttonError) {
      console.log(`${getCurrentTimestamp()} ℹ️ Error al buscar botón: ${buttonError.message}`);
    }

    // === VALIDAR QUE TENEMOS EL TEMPORIZADOR ===
    if (!countdownText) {
      console.log(`${getCurrentTimestamp()} ⚠️ No se pudo obtener el temporizador del popup.`);
      
      // Tomar screenshot para debugging
      try {
        await page.screenshot({ path: `/tmp/packetshare_error_${Date.now()}.png` });
        console.log(`${getCurrentTimestamp()} 📸 Screenshot guardado para debugging`);
      } catch {}
      
      // Incrementar contador de fallos
      failedAttempts++;
      const retryDelay = getRetryDelay(failedAttempts);
      const retryText = getRetryDelayText(failedAttempts);
      
      console.log(`${getCurrentTimestamp()} 🔄 Intento fallido #${failedAttempts}. Reintentando en ${retryText}...`);
      
      // Cerrar popup si existe
      try {
        const closeButton = await page.$('div.dialog-flow-box img[alt="closeButton"]');
        if (closeButton) await closeButton.click();
      } catch {}
      
      setTimeout(runCycle, retryDelay);
      return;
    }

    // === ÉXITO: Tenemos el temporizador ===
    failedAttempts = 0; // Resetear contador de fallos
    
    const timeObj = parseCountdownText(countdownText.trim());
    const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos de margen
    const { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
    const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
    
    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${dateStr} a las ${timeStr} (~${minutes} minutos)`);

    // === VERIFICAR BALANCE SI SE RECLAMÓ ===
    if (prizeClaimAttempted) {
      console.log(`${getCurrentTimestamp()} 🔄 Refrescando página para verificar balance...`);
      
      // Cerrar popup primero
      try {
        const closeButton = await page.$('div.dialog-flow-box img[alt="closeButton"]');
        if (closeButton) {
          await closeButton.click();
          await page.waitForTimeout(1000);
        }
      } catch {}
      
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);
      
      console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance DESPUÉS de reclamar...`);
      await page.waitForTimeout(2000);
      const balanceAfter = await page.$eval('div.money span', el => el.textContent);
      console.log(`${getCurrentTimestamp()} 💰 Balance después: ${balanceAfter}`);
      
      const balanceIncreased = parseFloat(balanceAfter.replace(/,/g, '')) > parseFloat(balanceBefore.replace(/,/g, ''));
      
      if (balanceIncreased) {
        console.log(`${getCurrentTimestamp()} 🎉 Éxito: El balance aumentó. Premio reclamado.`);
        await sendNotification("Premio reclamado con aumento de balance");
      } else {
        console.log(`${getCurrentTimestamp()} ℹ️ El balance no aumentó. El premio pudo haber sido $0.`);
      }
    } else {
      // Solo cerrar el popup si no se reclamó nada
      try {
        const closeButton = await page.$('div.dialog-flow-box img[alt="closeButton"]');
        if (closeButton) {
          await closeButton.click();
          console.log(`${getCurrentTimestamp()} ❌ Popup cerrado.`);
        }
      } catch (e) {
        console.log(`${getCurrentTimestamp()} ℹ️ No se pudo cerrar popup (puede haberse cerrado automáticamente).`);
      }
    }

    // === ESPERAR Y REPETIR CICLO ===
    setTimeout(runCycle, waitTimeMs);

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en el ciclo:`, err.message);
    
    // Incrementar contador de fallos
    failedAttempts++;
    const retryDelay = getRetryDelay(failedAttempts);
    const retryText = getRetryDelayText(failedAttempts);
    
    console.log(`${getCurrentTimestamp()} 🔄 Intento fallido #${failedAttempts}. Reintentando en ${retryText}...`);
    
    // Intentar cerrar browser si hay error crítico
    if (err.message.includes("Session closed") || err.message.includes("Target closed")) {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.error(`${getCurrentTimestamp()} ⚠️ Error al cerrar el navegador:`, closeErr.message);
        }
      }
      
      // Forzar relogin
      isFirstRun = true;
    }
    
    setTimeout(runCycle, retryDelay);
  }
}

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

// ---- FIN PackeshareBot v2.3R ----


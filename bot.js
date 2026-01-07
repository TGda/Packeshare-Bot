// bot.js -- PackeshareBot v3.1.0 (Fixed: Balance, Timer, Retry Logic) - PARTE 1/3
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
      
      console.log(`${getCurrentTimestamp()} Estado de carga: ${response.status()}`);

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

    // === LEER BALANCE Y TEMPORIZADOR DE LA PÁGINA PRINCIPAL ===
    await page.waitForTimeout(2000);
    
    const mainPageInfo = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      // Leer balance - SELECTOR MEJORADO
      let balance = '0';
      const balanceMatch = bodyText.match(/Your balance[\s\S]*?([\d,]+\.\d+)/);
      if (balanceMatch) {
        balance = balanceMatch[1];
      }
      
      // Buscar temporizador en sección "Consumption today"
      let timerText = null;
      let timerType = null;
      
      if (bodyText.includes('Time left to collect')) {
        const match = bodyText.match(/Time left to collect.*?(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (match) {
          timerText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          timerType = 'collecting';
        }
      }
      
      if (!timerText && bodyText.includes('Next box available in')) {
        const match = bodyText.match(/Next box available in.*?(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (match) {
          timerText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          timerType = 'cooldown';
        }
      }
      
      return { balance, timerText, timerType };
    });
    
    const balanceBefore = mainPageInfo.balance;
    console.log(`${getCurrentTimestamp()} 💰 Balance actual: ${balanceBefore}`);
    
    // Si hay temporizador en la página principal, úsalo directamente
    if (mainPageInfo.timerText) {
      console.log(`${getCurrentTimestamp()} ⏱️ Temporizador detectado (${mainPageInfo.timerType}): ${mainPageInfo.timerText}`);
      
      failedAttempts = 0;
      const timeObj = parseCountdownText(mainPageInfo.timerText.trim());
      const waitTimeMs = timeToMilliseconds(timeObj) + 30000;
      const { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
      const minutes = (waitTimeMs / 1000 / 60).toFixed(2);

      console.log(`${getCurrentTimestamp()} ⏰ Próximo intento: ${dateStr} ${timeStr} (~${minutes} min)`);
      setTimeout(runCycle, waitTimeMs);
      return;
    }

// CONTINÚA DESDE PARTE 1/3...

    // === SI NO HAY TEMPORIZADOR, BUSCAR ICONO DEL REGALO Y ABRIR POPUP ===
    console.log(`${getCurrentTimestamp()} 🎁 No hay temporizador. Buscando icono del regalo...`);
    
    let giftIcon = null;
    try {
      await page.waitForTimeout(2000);
      
      giftIcon = await page.$('img[alt="flowFullNoReceive"]') || 
                 await page.$('img[alt="flowFullReceived"]') ||
                 await page.$('img[class*="box-full"]') ||
                 await page.$('img[src*="flow"]');
      
      if (!giftIcon) {
        throw new Error("No se encontró el icono del regalo");
      }
      
      console.log(`${getCurrentTimestamp()} ✅ Icono del regalo encontrado`);
    } catch (err) {
      throw new Error("No se encontró el icono del regalo en la página");
    }

    // === CLICK EN EL REGALO ===
    await giftIcon.click();
    console.log(`${getCurrentTimestamp()} 👆 Clic en regalo exitoso`);
    await page.waitForTimeout(4000);

    // === VERIFICAR PROGRESO EN EL POPUP ===
    console.log(`${getCurrentTimestamp()} 🔍 Verificando progreso en popup...`);
    
    const popupInfo = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      const progressMatch = bodyText.match(/(\d+)%/);
      const progress = progressMatch ? parseInt(progressMatch[1], 10) : 0;
      
      const hasOpenButton = bodyText.includes('Open Wish Box');
      const hasCongratulations = bodyText.includes('Congratulations');
      const hasError = bodyText.includes('Request Failed') || bodyText.includes('failed');
      
      // Buscar temporizador DENTRO del popup (solo si progreso < 100%)
      let popupTimerText = null;
      if (bodyText.includes('Time left to collect')) {
        const match = bodyText.match(/(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (match) {
          popupTimerText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
        }
      }
      
      return { 
        progress, 
        hasOpenButton, 
        hasCongratulations,
        hasError,
        popupTimerText
      };
    });

    console.log(`${getCurrentTimestamp()} 📊 Progreso: ${popupInfo.progress}%`);

    let prizeClaimAttempted = false;
    let claimWasSuccessful = false;

    // === LÓGICA DE DECISIÓN ===
    if (popupInfo.hasCongratulations) {
      // CASO 1: Popup ya muestra Congratulations
      console.log(`${getCurrentTimestamp()} 🎊 ¡Congratulations! Premio ya reclamado`);
      claimWasSuccessful = true;
      prizeClaimAttempted = true;
      
    } else if (popupInfo.progress === 100 && popupInfo.hasOpenButton) {
      // CASO 2: 100% y botón disponible - INTENTAR RECLAMAR
      console.log(`${getCurrentTimestamp()} 🎉 ¡Progreso al 100%! Intentando reclamar...`);
      
      // Método 1: Buscar elemento clickeable
      const claimResult = await page.evaluate(() => {
        const allElements = document.querySelectorAll('*');
        for (let el of allElements) {
          const text = el.textContent ? el.textContent.trim() : '';
          if (text === 'Open Wish Box' && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
            el.click();
            return { clicked: true, method: 'element', tag: el.tagName };
          }
        }
        return { clicked: false };
      });

      if (claimResult.clicked) {
        console.log(`${getCurrentTimestamp()} ✅ Clic en "Open Wish Box" exitoso (${claimResult.method})`);
        prizeClaimAttempted = true;
        
        await page.waitForTimeout(6000);

        const afterClickInfo = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          const hasError = bodyText.includes('Request Failed') || bodyText.includes('failed');
          const hasCongratulations = bodyText.includes('Congratulations');
          
          return { hasError, hasCongratulations };
        });

        if (afterClickInfo.hasError) {
          console.log(`${getCurrentTimestamp()} ⚠️ Error: Request Failed`);
          claimWasSuccessful = false;
        } else if (afterClickInfo.hasCongratulations) {
          console.log(`${getCurrentTimestamp()} 🎊 ¡Reclamo exitoso!`);
          claimWasSuccessful = true;
        } else {
          console.log(`${getCurrentTimestamp()} ℹ️ Respuesta ambigua, verificando balance...`);
          claimWasSuccessful = false;
        }
      } else {
        console.log(`${getCurrentTimestamp()} ⚠️ No se pudo clickear "Open Wish Box" con selector`);
        // Método 2: Click por coordenadas (fallback)
        try {
          await page.mouse.click(537, 433);
          console.log(`${getCurrentTimestamp()} 🖱️ Click por coordenadas ejecutado`);
          prizeClaimAttempted = true;
          await page.waitForTimeout(6000);
          
          const afterClickInfo = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const hasError = bodyText.includes('Request Failed') || bodyText.includes('failed');
            const hasCongratulations = bodyText.includes('Congratulations');
            return { hasError, hasCongratulations };
          });
          
          if (afterClickInfo.hasCongratulations) {
            console.log(`${getCurrentTimestamp()} 🎊 ¡Reclamo exitoso! (click por coordenadas)`);
            claimWasSuccessful = true;
          }
        } catch (coordErr) {
          console.log(`${getCurrentTimestamp()} ⚠️ Error en click por coordenadas: ${coordErr.message}`);
        }
      }

    } else if (popupInfo.progress < 100) {
      // CASO 3: Progreso < 100% - Esperando alcanzar 100%
      console.log(`${getCurrentTimestamp()} 📈 Progreso ${popupInfo.progress}%. Aún no alcanza 100%`);
      
      // Si hay temporizador en el popup, úsalo
      if (popupInfo.popupTimerText) {
        console.log(`${getCurrentTimestamp()} ⏱️ Temporizador en popup: ${popupInfo.popupTimerText}`);
        
        // Cerrar popup
        await page.evaluate(() => {
          const closeBtn = Array.from(document.querySelectorAll('*')).find(el => 
            el.alt === 'closeButton' || el.getAttribute('alt') === 'closeButton'
          );
          if (closeBtn) closeBtn.click();
        });
        await page.waitForTimeout(2000);
        
        failedAttempts = 0;
        const timeObj = parseCountdownText(popupInfo.popupTimerText.trim());
        const waitTimeMs = timeToMilliseconds(timeObj) + 30000;
        const { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
        const minutes = (waitTimeMs / 1000 / 60).toFixed(2);

        console.log(`${getCurrentTimestamp()} ⏰ Próximo intento: ${dateStr} ${timeStr} (~${minutes} min)`);
        setTimeout(runCycle, waitTimeMs);
        return;
      }
    }

    // === CERRAR POPUP ===
    await page.evaluate(() => {
      const closeBtn = Array.from(document.querySelectorAll('*')).find(el => 
        el.alt === 'closeButton' || el.getAttribute('alt') === 'closeButton'
      );
      if (closeBtn) closeBtn.click();
    });
    await page.waitForTimeout(2000);

// CONTINÚA DESDE PARTE 2/3...

    // === BUSCAR TEMPORIZADOR DESPUÉS DE CERRAR POPUP ===
    // Volver a leer la página principal para buscar el temporizador
    const afterCloseInfo = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      let timerText = null;
      let timerType = null;
      
      if (bodyText.includes('Time left to collect')) {
        const match = bodyText.match(/Time left to collect.*?(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (match) {
          timerText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          timerType = 'collecting';
        }
      }
      
      if (!timerText && bodyText.includes('Next box available in')) {
        const match = bodyText.match(/Next box available in.*?(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i);
        if (match) {
          timerText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          timerType = 'cooldown';
        }
      }
      
      return { timerText, timerType };
    });

    if (!afterCloseInfo.timerText) {
      // NO HAY TEMPORIZADOR - Aplicar backoff solo si progreso < 100%
      if (popupInfo.progress < 100) {
        console.log(`${getCurrentTimestamp()} ⚠️ No se encontró temporizador y progreso < 100%`);
        failedAttempts++;
        const retryDelay = getRetryDelay(failedAttempts);
        const retryText = getRetryDelayText(failedAttempts);
        console.log(`${getCurrentTimestamp()} 🔄 Intento #${failedAttempts}. Reintento en ${retryText}...`);

        setTimeout(runCycle, retryDelay);
        return;
      } else {
        // Progreso al 100% pero sin temporizador - reintentar en 5 min
        console.log(`${getCurrentTimestamp()} ⚠️ Progreso 100% sin temporizador. Reintento en 5 min...`);
        setTimeout(runCycle, 5 * 60 * 1000);
        return;
      }
    }

    // === ÉXITO: TEMPORIZADOR ENCONTRADO ===
    failedAttempts = 0;
    const timeObj = parseCountdownText(afterCloseInfo.timerText.trim());
    const waitTimeMs = timeToMilliseconds(timeObj) + 30000;
    const { dateStr, timeStr } = getFutureDateTime(waitTimeMs);
    const minutes = (waitTimeMs / 1000 / 60).toFixed(2);

    console.log(`${getCurrentTimestamp()} ⏰ Próximo intento: ${dateStr} ${timeStr} (~${minutes} min)`);

    // === VERIFICAR BALANCE SI RECLAMÓ ===
    if (prizeClaimAttempted || claimWasSuccessful) {
      console.log(`${getCurrentTimestamp()} 🔍 Verificando cambio en balance...`);
      
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000);

      const balanceAfter = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        let balance = '0';
        const balanceMatch = bodyText.match(/Your balance[\s\S]*?([\d,]+\.\d+)/);
        if (balanceMatch) {
          balance = balanceMatch[1];
        }
        return balance;
      });

      console.log(`${getCurrentTimestamp()} 💰 Balance después: ${balanceAfter}`);

      const balanceBeforeNum = parseFloat(balanceBefore.replace(/,/g, ''));
      const balanceAfterNum = parseFloat(balanceAfter.replace(/,/g, ''));
      
      if (balanceAfterNum > balanceBeforeNum) {
        const diff = (balanceAfterNum - balanceBeforeNum).toFixed(2);
        console.log(`${getCurrentTimestamp()} 🎉 ¡Balance aumentó! +${diff} puntos`);
        await sendNotification(`Premio reclamado: +${diff} puntos. Nuevo balance: ${balanceAfter}`);
      } else {
        console.log(`${getCurrentTimestamp()} ℹ️ Balance sin cambios`);
      }
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



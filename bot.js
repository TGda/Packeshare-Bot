// bot.js
const puppeteer = require("puppeteer");

// Función para obtener la hora actual formateada
function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString('es-ES', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

(async () => {
  const email = process.env.PACKET_EMAIL;
  const password = process.env.PACKET_PASSWORD;

  if (!email || !password) {
    console.error("❌ Variables de entorno PACKET_EMAIL y PACKET_PASSWORD requeridas.");
    process.exit(1);
  }

  // Función para extraer segundos del texto del temporizador
  function parseCountdownText(countdownText) {
    // Ejemplo: "06 hours 23 min 28 sec" -> { hours: 6, minutes: 23, seconds: 28 }
    const regex = /(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/;
    const match = countdownText.match(regex);
    
    if (match) {
      return {
        hours: parseInt(match[1], 10),
        minutes: parseInt(match[2], 10),
        seconds: parseInt(match[3], 10)
      };
    }
    // Si no coincide el formato, asumir 0 segundos para evitar errores
    console.warn(`⚠️ No se pudo parsear el texto del temporizador: "${countdownText}". Usando 0 segundos.`);
    return { hours: 0, minutes: 0, seconds: 0 };
  }

  // Función para convertir tiempo a milisegundos
  function timeToMilliseconds(timeObj) {
    return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
  }

  // Función para calcular la hora futura
  function getFutureTime(milliseconds) {
    const now = new Date();
    const future = new Date(now.getTime() + milliseconds);
    return future.toLocaleTimeString('es-ES', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  let browser;
  let page;
  let isFirstRun = true;

  // Función principal del ciclo
  async function runCycle() {
    try {
      if (isFirstRun) {
        console.log("🚀 Iniciando bot de PacketShare...");
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
        
        console.log("🌐 Abriendo página de login...");
        const response = await page.goto("https://www.packetshare.io/login/", {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        console.log(`   Estado de carga: ${response.status()}`);

        // Esperar a que los campos de entrada estén disponibles
        console.log("🔍 Esperando campos de login...");
        await page.waitForSelector('input[placeholder="Please enter the email"]', {
          timeout: 10000,
        });
        await page.waitForSelector('input[placeholder="Please enter password"]', {
          timeout: 10000,
        });
        await page.waitForSelector("div.btn.login", { timeout: 10000 });

        console.log("✍️ Escribiendo credenciales...");
        await page.type('input[placeholder="Please enter the email"]', email, {
          delay: 50,
        });
        await page.type('input[placeholder="Please enter password"]', password, {
          delay: 50,
        });

        console.log("🔑 Enviando login...");
        await page.click("div.btn.login");

        // Esperar un poco después del clic o la posible redirección
        console.log("⏳ Esperando respuesta...");
        await page.waitForTimeout(5000);

        const currentUrl = page.url();
        console.log(`📍 URL después del intento de login: ${currentUrl}`);

        if (!currentUrl.includes("/dashboard")) {
          throw new Error("No se pudo acceder al dashboard después del login");
        }

        console.log("✅ Login exitoso. Redirigido a dashboard.");
        isFirstRun = false;
      } else {
        // En ciclos posteriores, solo refrescamos la página
        console.log("🔄 Refrescando dashboard...");
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(3000); // Esperar un poco después de refrescar
      }

      // Obtener balance actual con hora
      console.log("🔍 Obteniendo balance actual...");
      await page.waitForSelector('div.money span', { timeout: 15000 });
      const balance = await page.$eval('div.money span', el => el.textContent);
      const currentTime = getCurrentTime();
      console.log(`💰 Balance actual a las ${currentTime} : ${balance}`);

      // Primer clic: Hacer clic en el elemento del premio
      console.log("👆 Haciendo primer clic en el elemento del premio...");
      const selectorGift = "#__nuxt > div.ucenter-header > div.header > div > div.flow-box > img";
      
      try {
        await page.waitForSelector(selectorGift, { timeout: 10000 });
        await page.click(selectorGift);
      } catch (e) {
        throw new Error(`No se pudo hacer clic en el elemento del premio: ${e.message}`);
      }

      // Esperar un momento para que se abra el popup
      console.log("⏳ Esperando apertura del popup...");
      await page.waitForTimeout(3000);

      // Verificar si aparece el botón de confirmación o el conteo regresivo
      console.log("🔍 Verificando contenido del popup...");

      // Intentar encontrar el botón de confirmación
      const confirmButtonSelector = "body > div.dialog-flow-box > div > div.button";
      let prizeClaimed = false;
      
      try {
        await page.waitForSelector(confirmButtonSelector, { timeout: 5000 });
        console.log("✅ Botón de confirmación encontrado. Haciendo segundo clic para reclamar el premio...");
        await page.click(confirmButtonSelector);
        prizeClaimed = true;
        
        // Esperar un momento después de reclamar el premio
        console.log("⏳ Esperando después de reclamar el premio...");
        await page.waitForTimeout(5000);
        
        // Refrescar la página para obtener el balance actualizado
        console.log("🔄 Refrescando página para obtener balance actualizado...");
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(3000);
        
        // Verificar si el balance cambió
        console.log("🔍 Verificando si el balance cambió...");
        await page.waitForSelector('div.money span', { timeout: 15000 });
        const newBalance = await page.$eval('div.money span', el => el.textContent);
        
        const newTime = getCurrentTime();
        if (newBalance !== balance) {
          console.log(`🎉 Balance incrementado a las ${newTime} : ${balance} → ${newBalance}`);
        } else {
          console.log(`ℹ️ Balance sin cambios a las ${newTime} : ${balance} → ${newBalance}`);
        }
        
        // Ahora verificar el nuevo conteo regresivo
        console.log("🔍 Verificando nuevo conteo regresivo...");
        try {
          // Hacer clic nuevamente en el elemento del premio para ver el nuevo conteo
          console.log("👆 Haciendo clic para verificar nuevo conteo regresivo...");
          await page.waitForSelector(selectorGift, { timeout: 10000 });
          await page.click(selectorGift);
          
          // Esperar un momento para que se abra el popup
          await page.waitForTimeout(3000);
          
          // Verificar si aparece el conteo regresivo
          await page.waitForSelector('div.time', { timeout: 5000 });
          const countdownText = await page.$eval('div.time', el => el.textContent);
          console.log(`⏱️ Nuevo conteo regresivo encontrado: ${countdownText.trim()}`);
          
          // Parsear el tiempo y calcular espera
          const timeObj = parseCountdownText(countdownText.trim());
          const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos
          
          // Programar el próximo ciclo
          const futureTime = getFutureTime(waitTimeMs);
          const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
          console.log(`⏰ Próximo intento en a las ${futureTime} que son aproximadamente ${minutes} minutos...`);
          
          // Cerrar la posible ventana emergente si existe
          try {
            const closeButtonSelector = "body > div.dialog-flow-box > div > img.close-button";
            await page.waitForSelector(closeButtonSelector, { timeout: 3000 });
            await page.click(closeButtonSelector);
            console.log("❌ Ventana emergente cerrada automáticamente.");
          } catch (e) {
            console.log("ℹ️ No se encontró ventana emergente para cerrar (esto es normal).");
          }
          
          // Esperar el tiempo calculado antes de repetir
          setTimeout(runCycle, waitTimeMs);
          
        } catch (countdownError) {
          console.log("⚠️ No se pudo obtener el nuevo conteo regresivo. Reintentando en 5 minutos...");
          setTimeout(runCycle, 300000); // 5 minutos
        }
        
      } catch (confirmButtonError) {
        // Si no se encuentra el botón de confirmación, verificar si hay conteo regresivo
        console.log("ℹ️ No se encontró botón de confirmación. Verificando si hay conteo regresivo...");
        
        try {
          await page.waitForSelector('div.time', { timeout: 5000 });
          const countdownText = await page.$eval('div.time', el => el.textContent);
          console.log(`⏳ Conteo regresivo encontrado: ${countdownText.trim()}`);
          
          // Parsear el tiempo y calcular espera
          const timeObj = parseCountdownText(countdownText.trim());
          const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos
          
          // Programar el próximo ciclo
          const futureTime = getFutureTime(waitTimeMs);
          const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
          console.log(`⏰ Próximo intento en a las ${futureTime} que son aproximadamente ${minutes} minutos...`);
          
          // Cerrar la posible ventana emergente si existe
          try {
            const closeButtonSelector = "body > div.dialog-flow-box > div > img.close-button";
            await page.waitForSelector(closeButtonSelector, { timeout: 3000 });
            await page.click(closeButtonSelector);
            console.log("❌ Ventana emergente cerrada automáticamente.");
          } catch (e) {
            console.log("ℹ️ No se encontró ventana emergente para cerrar (esto es normal).");
          }
          
          // Esperar el tiempo calculado antes de repetir
          setTimeout(runCycle, waitTimeMs);
          
        } catch (countdownError) {
          console.log("⚠️ No se encontró ni botón de confirmación ni conteo regresivo. Reintentando en 5 minutos...");
          setTimeout(runCycle, 300000); // 5 minutos
        }
      }

    } catch (err) {
      console.error("⚠️ Error en el ciclo:", err.message);
      
      // Intentar reconectar en caso de error
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.error("⚠️ Error al cerrar el navegador:", closeErr.message);
        }
      }
      
      // Reiniciar después de 60 segundos
      console.log("🔄 Intentando reconectar en 60 segundos...");
      setTimeout(() => {
        isFirstRun = true; // Forzar relogin
        runCycle();
      }, 60000);
    }
  }

  // Iniciar el primer ciclo
  runCycle();

  // Manejar señales de cierre limpiamente
  process.on('SIGINT', async () => {
    console.log("\n🛑 Recibida señal de interrupción. Cerrando...");
    if (browser) {
      await browser.close();
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log("\n🛑 Recibida señal de terminación. Cerrando...");
    if (browser) {
      await browser.close();
    }
    process.exit(0);
  });

})();

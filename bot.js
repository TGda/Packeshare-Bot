// bot.js
const puppeteer = require("puppeteer");
const http = require("http"); // Para enviar notificaciones HTTP/HTTPS

// Función para obtener la fecha y hora actual formateada [DDMMMYY HH:MM:SS]
function getCurrentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-US', { month: 'short' }); // Ej: Oct
  const year = String(now.getFullYear()).slice(-2); // Últimos 2 dígitos del año
  const timeStr = now.toLocaleTimeString('es-ES', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return `[${day}${month}${year} ${timeStr}]`;
}

// Función para extraer segundos del texto del temporizador
function parseCountdownText(countdownText) {
  // Ejemplo: "06 hours 23 min 28 sec" -> { hours: 6, minutes: 23, seconds: 28 }
  const regex = /(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/;
  const match = countdownText.match(regex);
  
  if (match && match.length === 4) {
    return {
      hours: parseInt(match[1], 10),
      minutes: parseInt(match[2], 10),
      seconds: parseInt(match[3], 10)
    };
  }
  
  // Si no coincide el formato, asumir 0 segundos para evitar errores
  console.warn(`${getCurrentTimestamp()} ⚠️ No se pudo parsear el texto del temporizador: "${countdownText}". Usando 0 segundos.`);
  return { hours: 0, minutes: 0, seconds: 0 };
}

// Función para convertir tiempo a milisegundos
function timeToMilliseconds(timeObj) {
  return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
}

// Función para calcular la hora futura
function getFutureDateTime(milliseconds) {
  const now = new Date();
  const future = new Date(now.getTime() + milliseconds);
  // Formatear la fecha como "DD MMM YYYY"
  const dateStr = future.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  // Formatear la hora como "HH:MM:SS"
  const timeStr = future.toLocaleTimeString('es-ES', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return { dateStr, timeStr };
}

// Función para enviar una notificación POST condicional
async function sendNotification(message) { // 'message' se mantiene por si se desea en el futuro
    const notificationUrl = process.env.NOTIFICATION;
    
    // Solo enviar si la variable NOTIFICATION está definida y no está vacía
    if (!notificationUrl) {
        console.log(`${getCurrentTimestamp()} ℹ️ Variable NOTIFICATION no definida. Omitiendo notificación.`);
        return;
    }

    console.log(`${getCurrentTimestamp()} 📢 Enviando notificación a: ${notificationUrl}`);
    
    return new Promise((resolve) => {
        const postData = ''; // Sin datos en el cuerpo del POST
        
        // Usar 'new URL()' para parsear correctamente el protocolo (http o https), hostname, puerto y path
        let url;
        try {
           url = new URL(notificationUrl);
        } catch (err) {
            console.error(`${getCurrentTimestamp()} ⚠️ Error al parsear la URL de notificación '${notificationUrl}': ${err.message}. Omitiendo notificación.`);
            resolve(); // Resolver para no romper el flujo principal
            return;
        }
        
        // Determinar si usar 'http' o 'https' basado en el protocolo de la URL
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? require('https') : require('http');

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80), // Puerto por defecto si no se especifica
            path: url.pathname + url.search, // Incluye ruta y parámetros de consulta
            method: 'POST',
            headers: {
                // 'Content-Type': 'application/json', // Opcional: Puedes eliminarlo si no es requerido por el endpoint
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        // Crear la solicitud usando el módulo apropiado (http o https)
        const req = httpModule.request(options, (res) => {
            console.log(`${getCurrentTimestamp()} ✅ Notificación enviada. Código de estado: ${res.statusCode}`);
            resolve(); // Resolvemos la promesa independientemente del código de estado
        });

        req.on('error', (e) => {
            console.error(`${getCurrentTimestamp()} ⚠️ Error al enviar notificación a '${notificationUrl}': ${e.message}`);
            // No resolvemos con error para no romper el flujo principal
            resolve(); 
        });

        // Escribir datos al cuerpo de la solicitud (vacío en este caso)
        req.write(postData);
        req.end();
    });
}

let browser;
let page;
let isFirstRun = true;

// Función principal del ciclo
async function runCycle() {
  try {
    if (isFirstRun) {
      console.log(`${getCurrentTimestamp()} 🚀 Iniciando bot de PacketShare...`);
      browser = await puppeteer.launch({
        headless: "new", // Usar el nuevo modo headless
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

      // Esperar a que los campos de entrada estén disponibles
      console.log(`${getCurrentTimestamp()} 🔍 Esperando campos de login...`);
      await page.waitForSelector('input[placeholder="Please enter the email"]', {
        timeout: 10000,
      });
      await page.waitForSelector('input[placeholder="Please enter password"]', {
        timeout: 10000,
      });
      await page.waitForSelector("div.btn.login", { timeout: 10000 });

      console.log(`${getCurrentTimestamp()} ✍️ Escribiendo credenciales...`);
      await page.type('input[placeholder="Please enter the email"]', process.env.EMAIL, {
        delay: 50,
      });
      await page.type('input[placeholder="Please enter password"]', process.env.PASSWORD, {
        delay: 50,
      });

      console.log(`${getCurrentTimestamp()} 🔑 Enviando login...`);
      await page.click("div.btn.login");

      // Esperar un poco después del clic o la posible redirección
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
      // En ciclos posteriores, solo refrescamos la página
      console.log(`${getCurrentTimestamp()} 🔄 Refrescando dashboard...`);
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(3000); // Esperar un poco más después de refrescar
    }

    // --- LÓGICA MEJORADA: Verificar balance antes de reclamar ---
    console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance ANTES de intentar reclamar...`);
    await page.waitForTimeout(2000);
    const balanceBefore = await page.$eval('div.money span', el => el.textContent);
    console.log(`${getCurrentTimestamp()} 💰 Balance antes: ${balanceBefore}`);

    // Primer clic: Hacer clic en el elemento del premio
    console.log(`${getCurrentTimestamp()} 👆 Haciendo primer clic en el elemento del premio...`);
    const selectorGift = "img[class*='flow']";

    try {
      // Buscar la imagen del regalo de forma más simple
      await page.waitForXPath("//img[contains(@class, 'flow')]", { timeout: 10000 });
      
      const [giftImg] = await page.$x("//img[contains(@class, 'flow')]");
      if (giftImg) {
        await giftImg.click();
      } else {
        throw new Error("No se encontró la imagen del regalo");
      }
    } catch (e) {
      throw new Error(`No se pudo hacer clic en el elemento del premio: ${e.message}`);
    }



    // Esperar un momento para que se abra el popup
    console.log(`${getCurrentTimestamp()} ⏳ Esperando apertura del popup...`);
    await page.waitForTimeout(3000);

    // Verificar si aparece el botón de confirmación o el conteo regresivo
    console.log(`${getCurrentTimestamp()} 🔍 Verificando contenido del popup...`);

    // Intentar encontrar el botón de confirmación usando XPath
    let prizeClaimAttempted = false;
    
    try {
      // Buscar el botón "Open Wish Box" usando XPath (más robusto que CSS selector)
      console.log(`${getCurrentTimestamp()} 🔍 Buscando botón "Open Wish Box"...`);
      await page.waitForXPath("//*[contains(text(), 'Open Wish Box')]", { timeout: 5000 });
      
      const [confirmButton] = await page.$x("//*[contains(text(), 'Open Wish Box')]");
      
      if (confirmButton) {
        console.log(`${getCurrentTimestamp()} ✅ Botón de confirmación encontrado. Haciendo segundo clic para reclamar el premio...`);
        await confirmButton.click();
        prizeClaimAttempted = true;
        
        // Esperar un momento después de reclamar el premio
        console.log(`${getCurrentTimestamp()} ⏳ Esperando después de reclamar el premio...`);
        await page.waitForTimeout(5000);
      }
      
    } catch (confirmButtonError) {
      // Si no se encuentra el botón de confirmación, podría ser que ya esté en conteo regresivo
      console.log(`${getCurrentTimestamp()} ℹ️ No se encontró botón de confirmación. Verificando si hay conteo regresivo...`);
      
      try {
        // Buscar el temporizador de forma más robusta
        console.log(`${getCurrentTimestamp()} 🔍 Buscando temporizador...`);
        
        let countdownText = null;
        try {
          // Intentar primero con XPath
          const [timerElement] = await page.$x("//*[contains(text(), 'hours')]");
          if (timerElement) {
            const parentText = await page.evaluate(el => {
              let text = '';
              // Obtener el texto de este elemento y sus hermanos
              let parent = el.parentElement;
              for (let child of parent.children) {
                text += child.textContent + ' ';
              }
              return text;
            }, timerElement);
            
            // Extraer el patrón "X hours Y min Z sec"
            const match = parentText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
            if (match) {
              countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
            }
          }
        } catch (e) {
          console.log(`${getCurrentTimestamp()} 🔍 Intentando búsqueda alternativa del temporizador...`);
        }
        
        // Si no encontró con XPath, intentar obtener todo el contenido del popup
        if (!countdownText) {
          const allText = await page.evaluate(() => document.body.innerText);
          const match = allText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
          if (match) {
            countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          }
        }
        
        if (countdownText) {
          console.log(`${getCurrentTimestamp()} ⏳ Conteo regresivo encontrado (sin necesidad de confirmar): ${countdownText.trim()}`);
          
          // Parsear el tiempo y calcular espera
          const timeObj = parseCountdownText(countdownText.trim());
          const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos
          
          // Programar el próximo ciclo
          const { dateStr: futureDateTimeDate, timeStr: futureDateTimeTime } = getFutureDateTime(waitTimeMs);
          const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
          console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${futureDateTimeDate} a las ${futureDateTimeTime} que son aproximadamente en ${minutes} minutos...`);
          
          // Cerrar la posible ventana emergente si existe
          try {
            const closeButtonSelector = "body > div.dialog-flow-box > div > img.close-button";
            await page.waitForSelector(closeButtonSelector, { timeout: 3000 });
            await page.click(closeButtonSelector);
            console.log(`${getCurrentTimestamp()} ❌ Ventana emergente cerrada automáticamente.`);
          } catch (e) {
            console.log(`${getCurrentTimestamp()} ℹ️ No se encontró ventana emergente para cerrar (esto es normal).`);
          }
          
          // Esperar el tiempo calculado antes de repetir
          setTimeout(runCycle, waitTimeMs);
          return; // Salir de la función
        }
        
      } catch (countdownError) {
        console.log(`${getCurrentTimestamp()} ⚠️ No se encontró ni botón de confirmación ni conteo regresivo. Reintentando en 5 minutos...`);
        setTimeout(runCycle, 300000); // 5 minutos
        return; // Salir de la función
      }
    }

    // --- LÓGICA MEJORADA: Verificar balance DESPUÉS de reclamar ---
    if (prizeClaimAttempted) {
        // Refrescar la página para obtener el balance actualizado
        console.log(`${getCurrentTimestamp()} 🔄 Refrescando página para obtener balance DESPUÉS de reclamar...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(3000);
        
        console.log(`${getCurrentTimestamp()} 🔍 Obteniendo balance DESPUÉS de intentar reclamar...`);
        await page.waitForTimeout(2000);
        const balanceAfter = await page.$eval('div.money span', el => el.textContent);
        console.log(`${getCurrentTimestamp()} 💰 Balance después: ${balanceAfter}`);
        
        const balanceIncreased = parseFloat(balanceAfter.replace(/,/g, '')) > parseFloat(balanceBefore.replace(/,/g, ''));
        
        if (balanceIncreased) {
            console.log(`${getCurrentTimestamp()} 🎉 Éxito: El balance aumentó. Premio reclamado.`);
            // Enviar notificación de éxito
            await sendNotification("Premio reclamado con aumento de balance");
        } else {
            console.log(`${getCurrentTimestamp()} ⚠️ Advertencia: El balance NO aumentó después de reclamar. Puede que el premio haya sido $0 o haya un retraso en la actualización.`);
            // NO se envía notificación si el balance no aumenta
        }
    }

    // Ahora verificar el nuevo conteo regresivo
    console.log(`${getCurrentTimestamp()} 🔍 Verificando nuevo conteo regresivo...`);
    try {
      // Hacer clic nuevamente en el elemento del premio para ver el nuevo conteo
      console.log(`${getCurrentTimestamp()} 👆 Haciendo clic para verificar nuevo conteo regresivo...`);
      
      try {
        // Buscar cualquier imagen cuyo src contenga "img_receive" o "img_full"
        await page.waitForXPath("//img[contains(@src, 'img_receive') or contains(@src, 'img_full')]", { timeout: 10000 });
        
        const [giftImg] = await page.$x("//img[contains(@src, 'img_receive') or contains(@src, 'img_full')]");
        if (giftImg) {
          await giftImg.click();
        } else {
          throw new Error("No se encontró la imagen del regalo");
        }
      } catch (e) {
        throw new Error(`No se pudo hacer clic en el elemento del premio: ${e.message}`);
      }

      
      // Esperar un momento para que se abra el popup
      await page.waitForTimeout(3000);
      
      // Buscar el temporizador de forma más robusta
      console.log(`${getCurrentTimestamp()} 🔍 Buscando temporizador...`);
      
      let countdownText = null;
      try {
        // Intentar primero con XPath
        const [timerElement] = await page.$x("//*[contains(text(), 'hours')]");
        if (timerElement) {
          const parentText = await page.evaluate(el => {
            let text = '';
            // Obtener el texto de este elemento y sus hermanos
            let parent = el.parentElement;
            for (let child of parent.children) {
              text += child.textContent + ' ';
            }
            return text;
          }, timerElement);
          
          // Extraer el patrón "X hours Y min Z sec"
          const match = parentText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
          if (match) {
            countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          }
        }
      } catch (e) {
        console.log(`${getCurrentTimestamp()} 🔍 Intentando búsqueda alternativa del temporizador...`);
      }
      
      // Si no encontró con XPath, intentar obtener todo el contenido del popup
      if (!countdownText) {
        const allText = await page.evaluate(() => document.body.innerText);
        const match = allText.match(/(\d+)\s*hours?\s+(\d+)\s*min\s+(\d+)\s*sec/);
        if (match) {
          countdownText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
        }
      }
      
      if (countdownText) {
        console.log(`${getCurrentTimestamp()} ⏱️ Nuevo conteo regresivo encontrado: ${countdownText.trim()}`);
        
        // Parsear el tiempo y calcular espera
        const timeObj = parseCountdownText(countdownText.trim());
        const waitTimeMs = timeToMilliseconds(timeObj) + 20000; // +20 segundos
        
        // Programar el próximo ciclo
        const { dateStr: futureDateTimeDate, timeStr: futureDateTimeTime } = getFutureDateTime(waitTimeMs);
        const minutes = (waitTimeMs / 1000 / 60).toFixed(2);
        console.log(`${getCurrentTimestamp()} ⏰ Próximo intento el ${futureDateTimeDate} a las ${futureDateTimeTime} que son aproximadamente en ${minutes} minutos...`);
        
        // Cerrar la posible ventana emergente si existe
        try {
          const closeButtonSelector = "body > div.dialog-flow-box > div > img.close-button";
          await page.waitForSelector(closeButtonSelector, { timeout: 3000 });
          await page.click(closeButtonSelector);
          console.log(`${getCurrentTimestamp()} ❌ Ventana emergente cerrada automáticamente.`);
        } catch (e) {
          console.log(`${getCurrentTimestamp()} ℹ️ No se encontró ventana emergente para cerrar (esto es normal).`);
        }
        
        // Esperar el tiempo calculado antes de repetir
        setTimeout(runCycle, waitTimeMs);
      }
      
    } catch (countdownError) {
      console.log(`${getCurrentTimestamp()} ⚠️ No se pudo obtener el nuevo conteo regresivo. Reintentando en 5 minutos...`);
      setTimeout(runCycle, 300000); // 5 minutos
    }

  } catch (err) {
    console.error(`${getCurrentTimestamp()} ⚠️ Error en el ciclo:`, err.message);
    
    // Intentar reconectar en caso de error
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error(`${getCurrentTimestamp()} ⚠️ Error al cerrar el navegador:`, closeErr.message);
      }
    }
    
    // Reiniciar después de 60 segundos
    console.log(`${getCurrentTimestamp()} 🔄 Intentando reconectar en 60 segundos...`);
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

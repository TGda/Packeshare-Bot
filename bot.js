// bot.js -- PacketshareBot v4.2.0 (CORREGIDO: Sin click en icono, solo verifica balance)
const puppeteer = require("puppeteer");
const http = require("http");

// == UTILIDADES ==
function getCurrentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleDateString("en-US", { month: "short" });
  const year = String(now.getFullYear()).slice(-2);
  const timeStr = now.toLocaleTimeString("es-ES", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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
      seconds: parseInt(match[3], 10),
    };
  }
  console.warn(
    `${getCurrentTimestamp()} ⚠️ No se pudo parsear: "${countdownText}". Usando 0.`
  );
  return { hours: 0, minutes: 0, seconds: 0 };
}

function timeToMilliseconds(timeObj) {
  return (timeObj.hours * 3600 + timeObj.minutes * 60 + timeObj.seconds) * 1000;
}

async function sendNotification(message) {
  const notificationUrl = process.env.NOTIFICATION;
  if (!notificationUrl) return;

  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(notificationUrl);
    } catch {
      resolve();
      return;
    }

    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? require("https") : require("http");

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Length": Buffer.byteLength(message || "", "utf8"),
        "Content-Type": "text/plain",
      },
    };

    const req = httpModule.request(options, () => resolve());
    req.on("error", () => resolve());
    req.write(message || "");
    req.end();
  });
}

// == LÓGICA PRINCIPAL DE UN CICLO ==
async function runOnce(label = "ejecución") {
  let browser;
  let page;
  let summary = {
    label,
    status: "ERROR",
    error: null,
    balanceBefore: null,
    balanceAfter: null,
    progress: null,
    claimAttempted: false,
    claimSuccessful: false,
    timerText: null,
  };

  console.log(`${getCurrentTimestamp()} 🚀 Iniciando ${label} de PacketShare...`);

  try {
    // Lanzar navegador NUEVO para este ciclo
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

    console.log(
      `${getCurrentTimestamp()} Estado de carga login: ${
        response && response.status ? response.status() : "desconocido"
      }`
    );

    await page.waitForSelector('input[placeholder="Please enter the email"]', {
      timeout: 10000,
    });
    await page.waitForSelector('input[placeholder="Please enter password"]', {
      timeout: 10000,
    });
    await page.waitForSelector("div.btn.login", { timeout: 10000 });

    await page.type(
      'input[placeholder="Please enter the email"]',
      process.env.EMAIL,
      { delay: 50 }
    );
    await page.type(
      'input[placeholder="Please enter password"]',
      process.env.PASSWORD,
      { delay: 50 }
    );

    console.log(`${getCurrentTimestamp()} 🔑 Enviando login...`);
    await page.click("div.btn.login");
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    console.log(`${getCurrentTimestamp()} 📍 URL tras login: ${currentUrl}`);

    if (!currentUrl.includes("/dashboard")) {
      throw new Error("No se pudo acceder al dashboard después de login");
    }

    console.log(`${getCurrentTimestamp()} ✅ Login exitoso`);

    // === ESPERA DE 30 SEGUNDOS PARA QUE EL GAUGE CARGUE ===
    console.log(`${getCurrentTimestamp()} ⏳ Esperando 30 segundos para que el gauge cargue...`);
    await page.waitForTimeout(30000);

    // === LEER BALANCE Y TEMPORIZADOR DE LA PÁGINA PRINCIPAL ===
    const mainPageInfo = await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // Balance
      let balance = "0";
      const balanceMatch = bodyText.match(/Your balance[\s\S]*?([\d,]+\.\d+)/);
      if (balanceMatch) {
        balance = balanceMatch[1];
      }

      // Temporizadores en dashboard
      let timerText = null;
      let timerType = null;

      if (bodyText.includes("Time left to collect")) {
        const match = bodyText.match(
          /Time left to collect.*?(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i
        );
        if (match) {
          timerText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          timerType = "collecting";
        }
      }

      if (!timerText && bodyText.includes("Next box available in")) {
        const match = bodyText.match(
          /Next box available in.*?(\d+)\s*hours?\s*(\d+)\s*min\s*(\d+)\s*sec/i
        );
        if (match) {
          timerText = `${match[1]} hours ${match[2]} min ${match[3]} sec`;
          timerType = "cooldown";
        }
      }

      return { balance, timerText, timerType };
    });

    const balanceBefore = mainPageInfo.balance;
    summary.balanceBefore = balanceBefore;
    summary.timerText = mainPageInfo.timerText || null;

    console.log(`${getCurrentTimestamp()} 💰 Balance actual: ${balanceBefore}`);

    if (mainPageInfo.timerText) {
      console.log(
        `${getCurrentTimestamp()} ⏱️ Temporizador en dashboard (${mainPageInfo.timerType}): ${mainPageInfo.timerText}`
      );
      summary.status = "OK_NO_CLAIM_TIMER";
      summary.progress = null;
      console.log(
        `${getCurrentTimestamp()} ℹ️ Temporizador activo. No se intenta reclamar en esta ejecución.`
      );
    } else {
      // === SIN TEMPORIZADOR => BUSCAR BOTÓN "Open Wish Box" DIRECTAMENTE ===
      console.log(
        `${getCurrentTimestamp()} 🎁 No hay temporizador en dashboard. Buscando botón "Open Wish Box"...`
      );

      await page.waitForTimeout(2000);

      // Leer progreso directamente del dashboard (sin hacer click en icono)
      const dashboardInfo = await page.evaluate(() => {
        const bodyText = document.body.innerText;

        const progressMatch = bodyText.match(/(\d+)%/);
        const progress = progressMatch ? parseInt(progressMatch[1], 10) : 0;

        const hasOpenButton = bodyText.includes("Open Wish Box");
        const hasError =
          bodyText.includes("Request Failed") || bodyText.includes("failed");

        return {
          progress,
          hasOpenButton,
          hasError,
        };
      });

      summary.progress = dashboardInfo.progress;
      console.log(
        `${getCurrentTimestamp()} 📊 Progreso detectado en dashboard: ${dashboardInfo.progress}%`
      );

      let claimAttempted = false;
      let claimSuccessful = false;

      if (
        dashboardInfo.progress === 100 &&
        dashboardInfo.hasOpenButton &&
        !dashboardInfo.hasError
      ) {
        console.log(
          `${getCurrentTimestamp()} 🎉 Progreso 100% y botón disponible. Intentando reclamar...`
        );

        // PRIMER CLICK en "Open Wish Box" (en el dashboard)
        const firstClick = await page.evaluate(() => {
          const allElements = document.querySelectorAll("*");
          for (let el of allElements) {
            const text = el.textContent ? el.textContent.trim() : "";
            if (
              text === "Open Wish Box" &&
              el.tagName !== "BODY" &&
              el.tagName !== "HTML"
            ) {
              el.click();
              return { clicked: true, method: "element", tag: el.tagName };
            }
          }
          return { clicked: false };
        });

        claimAttempted = true;

        if (firstClick.clicked) {
          console.log(
            `${getCurrentTimestamp()} ✅ Primer click en "Open Wish Box" exitoso (${firstClick.tag})`
          );
          await page.waitForTimeout(3000);

          // SEGUNDO CLICK en el botón del modal
          console.log(
            `${getCurrentTimestamp()} 🔄 Buscando botón "Open Wish Box" en modal...`
          );

          const modalClick = await page.evaluate(() => {
            const allElements = document.querySelectorAll("*");
            for (let el of allElements) {
              const text = el.textContent ? el.textContent.trim() : "";
              if (
                text === "Open Wish Box" &&
                (el.tagName === "BUTTON" || el.tagName === "DIV")
              ) {
                el.click();
                return { clicked: true, tag: el.tagName };
              }
            }
            return { clicked: false };
          });

          if (modalClick.clicked) {
            console.log(
              `${getCurrentTimestamp()} ✅ Segundo click en modal exitoso (${modalClick.tag})`
            );
            await page.waitForTimeout(6000);
          } else {
            console.log(
              `${getCurrentTimestamp()} ⚠️ No se encontró botón en modal, continuando...`
            );
            await page.waitForTimeout(4000);
          }

          // Verificar si aparece mensaje de error
          const afterClickInfo = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const hasError =
              bodyText.includes("Request Failed") ||
              bodyText.includes("failed");
            const hasCongratulations =
              bodyText.includes("Congratulations");
            return { hasError, hasCongratulations };
          });

          if (afterClickInfo.hasError) {
            console.log(
              `${getCurrentTimestamp()} ⚠️ Error tras intentar reclamar (Request Failed).`
            );
          } else if (afterClickInfo.hasCongratulations) {
            console.log(
              `${getCurrentTimestamp()} 🎊 Mensaje "Congratulations" detectado. Verificando balance...`
            );
          } else {
            console.log(
              `${getCurrentTimestamp()} ℹ️ Estado tras clicks. Se verificará balance.`
            );
          }
        } else {
          console.log(
            `${getCurrentTimestamp()} ⚠️ No se pudo clickear "Open Wish Box"; se omite reclamo.`
          );
        }
      } else if (dashboardInfo.progress < 100) {
        console.log(
          `${getCurrentTimestamp()} 📈 Progreso ${dashboardInfo.progress}%. No alcanza 100%; no se intenta reclamar.`
        );
      } else if (!dashboardInfo.hasOpenButton) {
        console.log(
          `${getCurrentTimestamp()} ℹ️ No se encontró botón "Open Wish Box" en dashboard.`
        );
      }

      // Cerrar cualquier popup que pueda estar abierto
      await page.evaluate(() => {
        const closeBtn = Array.from(document.querySelectorAll("*")).find(
          (el) =>
            el.alt === "closeButton" || 
            el.getAttribute("alt") === "closeButton" ||
            (el.textContent && el.textContent.trim() === "OK")
        );
        if (closeBtn) closeBtn.click();
      });
      await page.waitForTimeout(2000);

      summary.claimAttempted = claimAttempted;

      // === VERIFICACIÓN DE BALANCE (ÚNICA FUENTE DE VERDAD) ===
      if (claimAttempted) {
        console.log(
          `${getCurrentTimestamp()} 🔍 Verificando balance para confirmar reclamo...`
        );

        await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForTimeout(3000);

        const balanceAfter = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          let balance = "0";
          const balanceMatch = bodyText.match(/Your balance[\s\S]*?([\d,]+\.\d+)/);
          if (balanceMatch) {
            balance = balanceMatch[1];
          }
          return balance;
        });

        summary.balanceAfter = balanceAfter;
        console.log(`${getCurrentTimestamp()} 💰 Balance después: ${balanceAfter}`);

        const balanceBeforeNum = parseFloat(
          (balanceBefore || "0").replace(/,/g, "")
        );
        const balanceAfterNum = parseFloat(
          (balanceAfter || "0").replace(/,/g, "")
        );

        // ÚNICA FORMA DE MARCAR ÉXITO: BALANCE AUMENTÓ
        if (!isNaN(balanceAfterNum) && balanceAfterNum > balanceBeforeNum) {
          const diff = (balanceAfterNum - balanceBeforeNum).toFixed(2);
          console.log(
            `${getCurrentTimestamp()} 🎉 ¡Balance aumentó +${diff} puntos! Reclamo EXITOSO.`
          );
          claimSuccessful = true;
        } else {
          console.log(
            `${getCurrentTimestamp()} ℹ️ Balance sin cambios. Reclamo NO exitoso.`
          );
          claimSuccessful = false;
        }

        summary.claimSuccessful = claimSuccessful;
      }

      // Determinar status final
      if (summary.claimAttempted && summary.claimSuccessful) {
        summary.status = "OK_CLAIMED";
      } else if (summary.claimAttempted && !summary.claimSuccessful) {
        summary.status = "OK_CLAIM_ATTEMPTED_NO_CHANGE";
      } else if (!summary.claimAttempted && summary.progress !== null) {
        summary.status = "OK_NO_CLAIM_PROGRESS_BELOW_100";
      } else {
        summary.status = "OK_NO_ACTION";
      }
    }
  } catch (err) {
    summary.status = "ERROR";
    summary.error = err.message || String(err);
    console.error(`${getCurrentTimestamp()} ⚠️ Error en ${label}: ${err.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log(
          `${getCurrentTimestamp()} 🔒 Navegador cerrado al final de ${label}.`
        );
      } catch (e) {
        console.error(
          `${getCurrentTimestamp()} ⚠️ Error al cerrar navegador: ${e.message}`
        );
      }
    }

    // Notificación con resumen
    const msgLines = [
      `PacketshareBot - ${summary.label}`,
      `Status: ${summary.status}`,
      summary.error ? `Error: ${summary.error}` : null,
      summary.balanceBefore !== null
        ? `Balance antes: ${summary.balanceBefore}`
        : null,
      summary.balanceAfter !== null
        ? `Balance después: ${summary.balanceAfter}`
        : null,
      summary.progress !== null ? `Progreso: ${summary.progress}%` : null,
      `Claim intentado: ${summary.claimAttempted ? "sí" : "no"}`,
      `Claim exitoso: ${summary.claimSuccessful ? "sí" : "no"}`,
      summary.timerText ? `Timer dashboard: ${summary.timerText}` : null,
    ].filter(Boolean);

    const message = msgLines.join("\n");
    await sendNotification(message);
    console.log(
      `${getCurrentTimestamp()} 📬 Notificación enviada:\n${message}`
    );
  }
}

// == SCHEDULER INTERNO: INMEDIATO + CADA DÍA A LAS 00:05 ==
function msUntilNext00_05() {
  const now = new Date();
  const next = new Date(now);

  next.setHours(0, 5, 0, 0); // 00:05:00.000 hoy
  if (next <= now) {
    // Si ya pasó, programar para mañana
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

async function scheduleDailyRun() {
  // 1) Ejecutar inmediatamente al arrancar
  runOnce("ejecución inmediata").catch(() => {});

  // 2) Programar próxima a las 00:05
  const delay = msUntilNext00_05();
  const minutes = (delay / 1000 / 60).toFixed(2);
  console.log(
    `${getCurrentTimestamp()} ⏰ Próxima ejecución diaria programada en ~${minutes} minutos (00:05).`
  );

  setTimeout(function dailyLoop() {
    runOnce("ejecución diaria 00:05").catch(() => {});
    // Reprogramar siguiente día (+24h)
    const oneDayMs = 24 * 60 * 60 * 1000;
    console.log(
      `${getCurrentTimestamp()} ⏰ Siguiente ejecución diaria en 24h (00:05 mañana).`
    );
    setTimeout(dailyLoop, oneDayMs);
  }, delay);
}

// Iniciar scheduler
scheduleDailyRun();

// Manejo de señales
process.on("SIGINT", async () => {
  console.log(
    `${getCurrentTimestamp()} \n🛑 Recibida señal de interrupción. Saliendo...`
  );
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log(
    `${getCurrentTimestamp()} \n🛑 Recibida señal de terminación. Saliendo...`
  );
  process.exit(0);
});

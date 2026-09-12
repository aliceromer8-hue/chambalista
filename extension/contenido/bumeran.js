// Content script de Bumeran: busca, lee y postula.
//
// La parte de postular se anadio el 2026-09-11, midiendo la
// estructura contra una vacante real. Ver el bloque «Postular».
//
// Ojo con los selectores: Bumeran usa styled-components, así que sus
// clases son hashes (`sc-VigVT`, `bnFyWs`) que cambian en cada despliegue
// suyo. Por eso NO se usa ninguna clase. Se usa la estructura semántica:
// dentro del enlace a la oferta, el <h2> es el título y los <h3> traen
// fecha, empresa, valoración, ubicación y modalidad, en ese orden.
// Verificado contra el sitio real: 20 de 20 ofertas extraídas completas.

(() => {
  const MODALIDAD = /^(presencial|remoto|h[ií]brido|home office)$/i;
  const SOLO_NUMERO = /^[\d.,]+$/;

  function leerOfertas() {
    const enlaces = [...document.querySelectorAll("a[href*='/empleos/']")]
      .filter((a) => a.querySelector("h2"));

    return enlaces.map((a) => {
      const encabezados = [...a.querySelectorAll("h2, h3")];
      const h2 = a.querySelector("h2");
      const i = encabezados.indexOf(h2);

      const posteriores = encabezados.slice(i + 1)
        .map((e) => e.innerText.trim()).filter(Boolean);

      // El primer h3 tras el título es la empresa, salvo que sea la
      // valoración numérica de la empresa.
      const empresa = posteriores.find((t) => !SOLO_NUMERO.test(t)) || "";
      // La ubicación es la que lleva coma («San Isidro, Lima») y no es
      // ni la empresa ni la modalidad.
      const ubicacion = posteriores.find(
        (t) => t !== empresa && t.includes(",") && !MODALIDAD.test(t) && !SOLO_NUMERO.test(t),
      ) || "";
      const modalidad = posteriores.find((t) => MODALIDAD.test(t)) || "";
      const fecha = encabezados.slice(0, i).reverse()
        .find((e) => e.tagName === "H3")?.innerText.trim() || "";

      const href = a.getAttribute("href") || "";
      const id = (href.match(/-(\d+)\.html/) || [])[1] || href;

      return {
        id: `bumeran-${id}`,
        portal: "Bumeran",
        portalId: "bumeran",
        postulable: true,
        titulo: h2.innerText.trim(),
        empresa,
        ubicacion: [ubicacion, modalidad].filter(Boolean).join(" · "),
        publicado: fecha,
        url: href.startsWith("http") ? href : `https://www.bumeran.com.pe${href}`,
        yaPostulado: false,
      };
    });
  }

  // Sesión: cuando NO hay, Bumeran muestra el enlace /login («Ingresar»).
  // Verificado contra el sitio real. La detección es por ausencia, así
  // que primero hay que confirmar que la página cargó de verdad; si no,
  // una página en blanco diría «sesión abierta» en falso.
  function haySesion() {
    if (!document.querySelector("footer, a[href*='/empleos'], header")) return false;
    return !document.querySelector("a[href='/login'], a[href*='/login?']");
  }

  function leerDetalle() {
    const texto = (s) => {
      const e = document.querySelector(s);
      return e ? e.innerText.replace(/\s+/g, " ").trim() : "";
    };
    return {
      titulo: texto("h1"),
      // El cuerpo de la oferta es el bloque de texto más largo de la página.
      descripcion: [...document.querySelectorAll("div, section")]
        .map((e) => e.innerText || "")
        .filter((t) => t.length > 200 && t.length < 6000)
        .sort((a, b) => b.length - a.length)[0]?.replace(/\s+/g, " ").trim().slice(0, 2500) || "",
      requisitos: [],
      url: location.href,
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // Postular
  // ═══════════════════════════════════════════════════════════════════
  // Estructura verificada contra una vacante real de Bumeran el
  // 2026-09-11 (practicante de marketing, Geobel):
  //
  //   div#section-postular-bar
  //     form#form-salario-pretendido
  //       input#salarioPretendido            texto, solo números
  //       input#actualizar-salario-checkbox  «Actualizar sueldo en Mi CV»
  //       button[type=submit]                «Postularme»
  //
  // DOS COSAS QUE BUMERAN HACE DISTINTO A COMPUTRABAJO
  //
  // 1. No hay campo de archivo en la vacante. Bumeran postula con el CV
  //    que la persona tiene cargado en SU perfil de Bumeran, no con uno
  //    que se adjunte aquí. O sea que el CV adaptado a la vacante —que
  //    en Computrabajo sí se adjunta— aquí no tiene dónde entrar, salvo
  //    que aparezca un paso posterior con archivo. Se busca igual tras
  //    abrir, y si no está se dice «se postuló con el CV de tu perfil».
  //    Callarlo sería dejarle creer que fue con el adaptado.
  //
  // 2. Pide la pretensión salarial ANTES de postular, en la propia
  //    vacante. No se rellena sola. Es la regla del producto desde el
  //    principio y aquí importa más que nunca: un número puesto por
  //    nosotros la puede dejar fuera del proceso, o costarle sueldo
  //    durante dos años. Se pregunta, como el DNI o el distrito.
  //
  // Y el checkbox «Actualizar sueldo en Mi CV» NO se toca jamás: cambia
  // el perfil de la persona para todas sus postulaciones futuras, no
  // solo para esta.

  const SEL_BARRA = "#section-postular-bar";
  const SEL_SALARIO = "#salarioPretendido";

  function botonPostular() {
    const dentro = document.querySelector(SEL_BARRA + " button[type=submit]");
    if (dentro && /postular/i.test(dentro.innerText || "")) return dentro;
    return [...document.querySelectorAll("button")]
      .find((b) => /^postularme$/i.test((b.innerText || "").trim())) || null;
  }

  /**
   * ¿Estamos de verdad en la postulación, o nos mandaron al acceso?
   *
   * Esta guarda existe por lo que pasó en Computrabajo: sin sesión,
   * «Postularme» redirige al login, y el código llegó a rellenar el
   * formulario de acceso con los datos de la persona y a hacer clic
   * sobre un botón de entrar creyendo que enviaba una postulación.
   */
  function enPostulacion() {
    if (/\/login|\/registro|\/ingresar/i.test(location.pathname)) return false;
    if (document.querySelector("input[type=password]")) return false;
    return true;
  }

  async function abrirFormulario() {
    const boton = botonPostular();
    if (!boton) return { abierto: false, error: "No encontré el botón de postular." };
    if (!haySesion()) {
      return { abierto: false, error: "Inicia sesión en Bumeran antes de postular." };
    }
    boton.click();
    // Bumeran es una SPA: no recarga, cambia el DOM. Se espera un poco y
    // se comprueba dónde acabamos.
    await new Promise((r) => setTimeout(r, 1200));
    if (!enPostulacion()) {
      return { abierto: false, error: "Bumeran pidió iniciar sesión. Entra y vuelve a intentarlo." };
    }
    return { abierto: true, conArchivo: camposDeArchivo().length > 0 };
  }

  /**
   * Lo que Bumeran pregunta antes de dejar postular.
   *
   * De momento el sueldo pretendido, marcado `pedirALaPersona` para que
   * el panel lo pregunte en vez de que el modelo lo invente: no está en
   * el CV y no se deduce de nada.
   */
  function leerPreguntas() {
    const preguntas = [];
    const salario = document.querySelector(SEL_SALARIO);
    if (salario && salario.offsetParent !== null) {
      preguntas.push({
        id: "salarioPretendido",
        enunciado: "¿Cuál es tu sueldo bruto pretendido? Bumeran lo pide para esta vacante.",
        tipo: "numero",
        obligatoria: Boolean(salario.required),
        pedirALaPersona: true,
      });
    }
    // Cualquier otro campo visible de la barra de postulación que no
    // conozcamos, para no enviar a ciegas un formulario a medio llenar.
    const otros = document.querySelectorAll(
      SEL_BARRA + " input:not([type=hidden]):not([type=checkbox]):not([type=submit]), "
      + SEL_BARRA + " textarea");
    for (const campo of otros) {
      if (campo.id === "salarioPretendido") continue;
      const enunciado = enunciadoDe(campo);
      if (!enunciado) continue;
      preguntas.push({
        id: campo.id || campo.name || enunciado,
        enunciado,
        tipo: "texto",
        obligatoria: Boolean(campo.required),
        pedirALaPersona: true,
      });
    }
    return preguntas;
  }

  /**
   * Escribe lo que la persona ya respondió. Nada más.
   *
   * Devuelve `pendientes` con lo que quedó sin contestar, que el panel
   * enseña antes de enviar: un formulario enviado con huecos es una
   * postulación perdida sin que nadie se entere.
   */
  function escribirRespuestas(respuestas) {
    const dadas = respuestas || {};
    const pendientes = [];
    const salario = document.querySelector(SEL_SALARIO);
    if (salario && salario.offsetParent !== null) {
      // Solo números: lo dice el propio Bumeran bajo el campo.
      const limpio = String(dadas.salarioPretendido == null ? "" : dadas.salarioPretendido)
        .replace(/[^\d]/g, "");
      if (limpio) rellenar(salario, limpio);
      else pendientes.push("Sueldo pretendido");
    }
    // El checkbox de actualizar el sueldo del perfil se deja como esté.
    return { escritas: Object.keys(dadas).length, pendientes, errores: erroresValidacion() };
  }

  async function enviar() {
    if (!enPostulacion()) {
      return { enviada: false, error: "No estamos en la postulación, sino en el acceso." };
    }
    const boton = botonPostular();
    if (!boton) return { enviada: false, error: "No encontré el botón de enviar." };
    if (boton.disabled) {
      return { enviada: false, error: "Bumeran tiene el botón bloqueado: le falta algún campo." };
    }
    boton.click();
    await new Promise((r) => setTimeout(r, 2000));
    const errores = erroresValidacion();
    if (errores.length) return { enviada: false, error: errores.join(" · ") };
    return confirmada();
  }

  /**
   * ¿Bumeran confirmó que la postulación entró?
   *
   * Se comprueba por PRESENCIA de la confirmación, nunca por ausencia
   * del botón: si la página se queda a medias, «ya no está el botón» se
   * leería como «enviada», y eso le diría a la persona que postuló a
   * algo a lo que no postuló.
   */
  function confirmada() {
    const texto = (document.body.innerText || "").toLowerCase();
    if (/ya te postulaste|postulaci[oó]n enviada|te postulaste|postulado con [eé]xito/.test(texto)) {
      return { enviada: true, mensaje: "Bumeran confirmó la postulación." };
    }
    return {
      enviada: false,
      error: "Bumeran no confirmó el envío. Revísala tú antes de darla por enviada.",
    };
  }

  chrome.runtime.onMessage.addListener((msg, _e, responder) => {
    try {
      if (msg.accion === "ping") responder({ ok: true, url: location.href, sesion: haySesion() });
      else if (msg.accion === "sesion") responder({ sesion: haySesion() });
      else if (msg.accion === "ofertas") responder({ ofertas: leerOfertas(), sesion: haySesion() });
      else if (msg.accion === "detalle") responder(leerDetalle());
      else if (msg.accion === "abrir") abrirFormulario().then(responder);
      else if (msg.accion === "preguntas") responder({ preguntas: leerPreguntas() });
      else if (msg.accion === "rellenar") responder(escribirRespuestas(msg.respuestas));
      else if (msg.accion === "escribir") responder(escribirRespuestas(msg.respuestas));
      else if (msg.accion === "adjuntar") responder(adjuntarCV(msg.nombre, msg.base64));
      else if (msg.accion === "enviar") enviar().then(responder);
      else responder({ error: "Bumeran no sabe hacer esa accion: " + msg.accion });
    } catch (e) {
      responder({ error: e.message });
    }
    return true;
  });
})();

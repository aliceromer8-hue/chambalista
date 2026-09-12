// Content script de LinkedIn: solo lectura del listado de empleos.
//
// LinkedIn es el más restrictivo de los cuatro y el que más vigila la
// automatización, así que aquí NO se postula ni se rellena nada: se lee
// la lista y la persona abre la oferta para aplicar por su cuenta.
//
// Sus clases llevan hashes que cambian, así que se prefieren atributos
// estables (`data-job-id`, `data-occludable-job-id`) y estructura.

(() => {
  const texto = (raiz, sel) => {
    const e = raiz.querySelector(sel);
    return e ? e.innerText.replace(/\s+/g, " ").trim() : "";
  };

  // Sin sesión, LinkedIn muestra los enlaces de acceso o el muro de registro.
  function haySesion() {
    if (!document.querySelector("body")) return false;
    if (document.querySelector(".authwall, [data-test-id='auth-wall']")) return false;
    if (document.querySelector("a[href*='/login'], a[href*='/uas/login'], .nav__button-secondary")) {
      return false;
    }
    // La barra global solo existe con sesión iniciada.
    return Boolean(document.querySelector("#global-nav, .global-nav, [data-test-global-nav]"));
  }

  function leerOfertas() {
    // Filtrar por el ENLACE a la oferta, no solo por el atributo.
    //
    // `[data-job-id]` lo lleva también el panel de detalle y varios
    // contenedores que no son tarjetas. Comprobado en el sitio real el
    // 2026-09-12, con sesión iniciada: el selector devolvía 32 elementos
    // y solo 14 eran ofertas. Los otros 18 entraban sin título y sin
    // URL, o sea dieciocho filas vacías en la lista de resultados que
    // además desplazaban a las buenas.
    //
    // Una oferta de verdad siempre tiene su enlace a /jobs/view/. Es la
    // misma regla que en Bumeran, donde se filtra por el <h2>.
    const tarjetas = [...document.querySelectorAll(
      "[data-occludable-job-id], [data-job-id], li.jobs-search-results__list-item",
    )].filter((c) => c.querySelector("a[href*='/jobs/view/']"));

    return tarjetas.map((c) => {
      const id = c.getAttribute("data-occludable-job-id") || c.getAttribute("data-job-id") || "";
      const enlace = c.querySelector("a[href*='/jobs/view/']");
      const href = enlace?.getAttribute("href") || (id ? `/jobs/view/${id}/` : "");
      const titulo = texto(c, "a[href*='/jobs/view/'] strong, .job-card-list__title, [class*='job-card'] strong")
        || enlace?.innerText.split("\n")[0].trim() || "";

      return {
        id: `linkedin-${id || href}`,
        portal: "LinkedIn",
        portalId: "linkedin",
        postulable: false,
        titulo,
        empresa: texto(c, "[class*='primary-description'], [class*='subtitle'], .job-card-container__company-name"),
        ubicacion: texto(c, "[class*='metadata'] li, [class*='caption']"),
        publicado: texto(c, "time"),
        url: href.startsWith("http") ? href.split("?")[0] : `https://www.linkedin.com${href.split("?")[0]}`,
        yaPostulado: /solicitado|applied/i.test(c.innerText || ""),
      };
    }).filter((o) => o.titulo && o.url);
  }

  function leerDetalle() {
    return {
      titulo: texto(document, "h1"),
      descripcion: texto(document, "#job-details, .jobs-description__content").slice(0, 2500),
      requisitos: [],
      url: location.href,
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // Rellenar — pero NO enviar
  // ═══════════════════════════════════════════════════════════════════
  // LinkedIn es el único portal donde el límite no lo pone la técnica.
  //
  // Su Acuerdo de Usuario (§8.2) prohíbe software automatizado y bots.
  // No es letra muerta: desde finales de 2025 restringen Easy Apply y
  // suspenden cuentas, y su informe de transparencia de marzo de 2026
  // habla de 23.5 millones de sesiones automatizadas marcadas en un
  // trimestre. Lo que detectan, literalmente, son extensiones de Chrome
  // que manipulan el DOM — esto.
  //
  // Y lo que se juega no es nuestra cuenta: es la de la persona. Que le
  // restrinjan su LinkedIn por usar Chamba Lista es mucho peor que no
  // tener la función, porque su perfil es su vida laboral entera y no
  // hay forma de devolvérselo.
  //
  // LA SALIDA ESTÁ EN SU PROPIA POLÍTICA
  //
  // LinkedIn admite expresamente extensiones «que mejoran la experiencia
  // del propio usuario» siempre que no raspen datos ni ENVÍEN SIN
  // REVISIÓN. Así que aquí se hace exactamente eso y nada más:
  //
  //   · se abre el formulario cuando la persona lo pide,
  //   · se rellena lo que ya se sabe de su CV,
  //   · y el envío lo pulsa ella, siempre, en su pantalla.
  //
  // `enviar()` existe y devuelve una negativa a propósito. Que esté y
  // diga que no es más difícil de saltarse por descuido que no estar:
  // si mañana alguien conecta LinkedIn al modo automático, se encuentra
  // esta respuesta y este comentario, en vez de un hueco donde meter un
  // click. El modo por lotes además lo bloquea antes, por `soloRevisado`
  // en portales.js.

  const SEL_BOTON = "button.jobs-apply-button";

  function botonPostular() {
    const b = document.querySelector(SEL_BOTON);
    if (b) return b;
    return [...document.querySelectorAll("button")]
      .find((x) => /solicitud sencilla|easy apply/i.test(x.innerText || "")) || null;
  }

  function enFormulario() {
    return Boolean(document.querySelector(".jobs-easy-apply-modal, [data-test-modal]"));
  }

  async function abrirFormulario() {
    if (!haySesion()) {
      return { abierto: false, error: "Inicia sesión en LinkedIn antes de postular." };
    }
    if (enFormulario()) return { abierto: true, revisionObligatoria: true };
    const boton = botonPostular();
    if (!boton) {
      return { abierto: false, externo: true,
               error: "Esta vacante no tiene Solicitud Sencilla: se postula en la web de la empresa." };
    }
    boton.click();
    await new Promise((r) => setTimeout(r, 1500));
    return { abierto: enFormulario(), revisionObligatoria: true,
             nota: "Se rellena, pero el envío lo das tú en LinkedIn." };
  }

  function leerPreguntas() {
    if (!enFormulario()) return [];
    const modal = document.querySelector(".jobs-easy-apply-modal, [data-test-modal]") || document;
    const preguntas = [];
    for (const campo of modal.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select")) {
      if (campo.offsetParent === null) continue;
      const enunciado = enunciadoDe(campo);
      if (!enunciado) continue;
      preguntas.push({
        id: campo.id || campo.name || enunciado,
        enunciado,
        tipo: campo.tagName === "SELECT" ? "lista"
          : (campo.type === "radio" || campo.type === "checkbox") ? "opcion" : "texto",
        obligatoria: Boolean(campo.required),
        opciones: campo.tagName === "SELECT"
          ? [...campo.options].map((o) => o.text.trim()).filter(Boolean) : [],
      });
    }
    return preguntas;
  }

  function escribirRespuestas(respuestas) {
    const dadas = respuestas || {};
    const pendientes = [];
    for (const pregunta of leerPreguntas()) {
      const valor = dadas[pregunta.id];
      if (valor == null || valor === "") {
        if (pregunta.obligatoria) pendientes.push(pregunta.enunciado);
        continue;
      }
      const campo = document.getElementById(pregunta.id)
        || document.querySelector(`[name="${CSS.escape(pregunta.id)}"]`);
      if (campo) rellenar(campo, valor);
    }
    return {
      escritas: Object.keys(dadas).length,
      pendientes,
      errores: erroresValidacion(),
      revisionObligatoria: true,
      nota: "Listo para que lo revises. El envío lo das tú en LinkedIn.",
    };
  }

  /**
   * Aquí no se envía, y es a propósito.
   *
   * Ver el bloque de arriba: pulsar «enviar» por la persona es lo que
   * convierte esto en la automatización que LinkedIn detecta y castiga
   * con la cuenta de ELLA. Queda rellenado y en pantalla.
   */
  async function enviar() {
    return {
      enviada: false,
      revisionObligatoria: true,
      error: "En LinkedIn el envío lo das tú. El formulario ya está lleno en tu pantalla: "
           + "revísalo y pulsa enviar. Es la única forma de que no te restrinjan la cuenta.",
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
      else if (msg.accion === "rellenar" || msg.accion === "escribir")
        responder(escribirRespuestas(msg.respuestas));
      else if (msg.accion === "enviar") enviar().then(responder);
      else responder({ error: "LinkedIn no sabe hacer esa accion: " + msg.accion });
    } catch (e) {
      responder({ error: e.message });
    }
    return true;
  });
})();

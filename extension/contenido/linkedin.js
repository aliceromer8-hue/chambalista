// Content script de LinkedIn: lee el listado, rellena la Solicitud
// Sencilla y la envía.
//
// LinkedIn es el más restrictivo de los cuatro y el que más vigila la
// automatización. Enviar aquí arriesga la cuenta de la persona; Ali lo
// decidió sabiéndolo — ver el bloque «ENVIAR» más abajo.
//
// Sus clases llevan hashes que cambian, así que se prefieren atributos
// estables (`data-job-id`, `data-occludable-job-id`) y estructura.

(() => {
  // Las herramientas compartidas viven en window.ChambaComun (comun.js).
  // Faltaba esta línea: el código de postular las llamaba sueltas, como
  // si fueran globales, y no lo son. Leer una pregunta, escribir una
  // respuesta o adjuntar el CV reventaba con «no está definido»: en
  // este portal nunca se llegó a rellenar nada.
  const { rellenar, enunciadoDe, erroresValidacion, adjuntarCV } = window.ChambaComun;
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
    // La barra #global-nav ya NO existe (comprobado en el sitio real el
    // 2026-09-24): LinkedIn pasó a clases con hash que cambian. Lo estable
    // son los enlaces que solo ve quien tiene sesión: Mensajes y
    // Notificaciones. Con solo #global-nav, LinkedIn nunca quedaba
    // «conectado» aunque Ali estuviera dentro.
    return Boolean(document.querySelector(
      "#global-nav, .global-nav, [data-test-global-nav], a[href*='/messaging'], a[href*='/notifications']"));
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
        // Antes `false`: resto de cuando LinkedIn era solo lectura. Con
        // eso el fondo ni intentaba rellenar —abría la oferta en otra
        // pestaña— y el modo «rellena, envías tú» nunca se llegaba a usar.
        // El envío sigue cerrado dos veces: enviar() se niega aquí y el
        // lote lo bloquea por `soloRevisado` en portales.js.
        postulable: true,
        titulo,
        empresa: texto(c, "[class*='primary-description'], [class*='subtitle'], .job-card-container__company-name"),
        ubicacion: texto(c, "[class*='metadata'] li, [class*='caption']"),
        publicado: texto(c, "time"),
        url: href.startsWith("http") ? href.split("?")[0] : `https://www.linkedin.com${href.split("?")[0]}`,
        yaPostulado: /\b(postulad[oa]|ya (te )?postulaste|solicitud enviada|solicitado|applied)\b/i.test((c.innerText || "").replace(titulo, "")),
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

  // Ya no es un botón: es un <a> «Solicitud sencilla» que lleva a
  // /jobs/view/<id>/apply/ (sitio real, 2026-09-24). La clase vieja
  // jobs-apply-button tampoco existe.
  const SEL_BOTON = "a[href*='/jobs/view/'][href*='/apply'], button.jobs-apply-button";

  function botonPostular() {
    // Solo lo que SE VE. En la ficha real queda un <button
    // class="jobs-apply-button"> oculto y vacío, resto del diseño viejo,
    // que va antes en la página: con querySelector a secas se encontraba
    // ese y el clic no hacía nada. Se prefiere el enlace a /apply.
    //
    // Y LinkedIn alterna DOS diseños de la misma ficha (visto el mismo día
    // en el sitio real): uno con un <a> a /apply y otro con botones
    // .jobs-apply-button, uno de ellos vacío (la barra fija de arriba). Se
    // juntan los dos y se prefiere el que dice «Solicitud sencilla».
    const visible = (e) => e && (e.offsetWidth || e.offsetHeight);
    const candidatos = [...document.querySelectorAll(SEL_BOTON)].filter(visible);
    const conTexto = candidatos.find((e) => /solicitud sencilla|easy apply/i.test((e.innerText || "").trim()));
    if (conTexto) return conTexto;
    if (candidatos[0]) return candidatos[0];
    // Por texto, como último recurso. OJO: en la búsqueda hay un FILTRO
    // que también se llama «Solicitud sencilla» (id searchFilter_…). Con
    // la búsqueda a secas de antes se habría pulsado el filtro en vez de
    // postular. Se excluye todo lo que sea filtro.
    return [...document.querySelectorAll("a, button")]
      .filter((x) => !/^searchFilter/.test(x.id || "") && !x.closest("[class*='filter'], [id*='filter']"))
      .find((x) => /^(solicitud sencilla|easy apply)$/i.test((x.innerText || "").trim())) || null;
  }

  // El formulario: por su ROL de diálogo, no por clases. Las clases
  // .jobs-easy-apply-modal / [data-test-modal] ya no existen.
  const SEL_MODAL = ".jobs-easy-apply-modal, [data-test-modal], [role='dialog'], [aria-modal='true']";
  function elModal() {
    return [...document.querySelectorAll(SEL_MODAL)]
      .find((m) => (m.offsetWidth || m.offsetHeight) && m.querySelector("input, textarea, select, button")) || null;
  }
  function enFormulario() {
    return Boolean(elModal());
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
    for (let i = 0; i < 8 && !enFormulario(); i++) await new Promise((r) => setTimeout(r, 500));
    if (enFormulario()) return { abierto: true };
    // Probado desde Claude en Chrome (2026-09-24): LinkedIn no abrió la
    // Solicitud Sencilla ni con un clic real ni yendo a su dirección —
    // frena la automatización—. No se finge: se dice, y se da la salida.
    return { abierto: false, manual: true,
             nota: "LinkedIn no abrió la Solicitud Sencilla desde aquí. Pulsa «Ver el formulario», "
                 + "ábrela tú en la oferta y luego «Rellenar esta pantalla»: se completa sola." };
  }

  function leerPreguntas() {
    if (!enFormulario()) return [];
    const modal = elModal() || document;
    const preguntas = [];
    for (const campo of modal.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select")) {
      if (campo.offsetParent === null) continue;
      const enunciado = enunciadoDe(campo);
      if (!enunciado) continue;
      // NO se toca lo que LinkedIn ya rellenó ni lo que no es una pregunta.
      //
      // Visto en el formulario real (2026-09-24): LinkedIn trae ya el
      // correo, el código de país, el teléfono y el CV marcado, más una
      // casilla «Sigue a <empresa>». Leídos como preguntas, se habrían
      // sobrescrito: un correo cambiado, el CV desmarcado.
      const esMarca = campo.type === "radio" || campo.type === "checkbox";
      if (!esMarca && (campo.value || "").trim()) continue;              // ya tiene valor
      if (esMarca && /resume|curr[ií]cul|\bcv\b|sigue a|follow/i.test(enunciado)) continue;
      if (campo.type === "radio" && campo.name
          && modal.querySelector(`input[type=radio][name="${CSS.escape(campo.name)}"]:checked`)) continue;
      preguntas.push({
        id: campo.id || campo.name || enunciado,
        enunciado,
        tipo: campo.tagName === "SELECT" ? "lista" : esMarca ? "opcion" : "texto",
        obligatoria: Boolean(campo.required || campo.getAttribute("aria-required") === "true"),
        opciones: campo.tagName === "SELECT"
          ? [...campo.options].map((o) => o.text.trim()).filter(Boolean) : [],
      });
    }
    return preguntas;
  }

  function escribirRespuestas(respuestas) {
    const dadas = respuestas || {};
    const pendientes = [];
    const escritas = [];
    // Por id del campo O por posición. El panel manda por posición
    // (`indice`), igual en los cuatro portales; antes aquí solo se miraba
    // el id, así que ninguna respuesta del panel llegaba nunca a escribirse.
    for (const [i, pregunta] of leerPreguntas().entries()) {
      const valor = dadas[pregunta.id] ?? dadas[i];
      if (valor == null || valor === "") {
        if (pregunta.obligatoria) pendientes.push(pregunta.enunciado);
        continue;
      }
      const campo = document.getElementById(pregunta.id)
        || document.querySelector(`[name="${CSS.escape(pregunta.id)}"]`);
      if (campo) { rellenar(campo, valor); escritas.push(i); }
    }
    return {
      escritas,
      pendientes,
      errores: erroresValidacion(),
      revisionObligatoria: true,
      nota: "Listo para que lo revises. El envío lo das tú en LinkedIn.",
    };
  }

  // ENVIAR — decisión de Ali, 2026-09-24.
  //
  // Hasta aquí LinkedIn solo rellenaba y el envío lo daba la persona: su
  // §8.2 prohíbe la automatización y restringe cuentas por ello. Ali lo
  // sabe y decidió asumirlo: «Que envíe sola». El riesgo sigue siendo el
  // mismo —lo que se juega es SU cuenta— y por eso el lote lo dice antes
  // de empezar.
  //
  // La Solicitud Sencilla tiene varias pantallas. El fondo va pantalla a
  // pantalla con `siguientePaso` (rellenando cada una) y llama a
  // `enviar` solo cuando ya está el botón final.

  const botonCon = (re) => [...document.querySelectorAll(
    SEL_MODAL.split(", ").map((s) => `${s} button`).join(", "))]
    .find((b) => !b.disabled && re.test((b.innerText || b.getAttribute("aria-label") || "").trim())) || null;

  const FINAL = /^(enviar solicitud|submit application)$/i;
  const AVANZAR = /^(siguiente|revisar|continuar|next|review|continue)$/i;

  /** Avanza UNA pantalla. Nunca pulsa el botón final. */
  async function siguientePaso() {
    if (!enFormulario()) return { avanzado: false, error: "El formulario de LinkedIn no está abierto." };
    if (botonCon(FINAL)) return { avanzado: false, ultimoPaso: true };
    const b = botonCon(AVANZAR);
    if (!b) return { avanzado: false, ultimoPaso: true };
    b.click();
    await new Promise((r) => setTimeout(r, 1500));
    const errores = erroresValidacion();
    return errores.length ? { avanzado: false, errores } : { avanzado: true };
  }

  async function enviar() {
    if (!enFormulario()) return { enviada: false, error: "El formulario de LinkedIn no está abierto." };
    const b = botonCon(FINAL);
    if (!b) return { enviada: false, error: "Todavía no estamos en el paso de enviar." };
    b.click();
    await new Promise((r) => setTimeout(r, 2500));
    const errores = erroresValidacion();
    if (errores.length) return { enviada: false, error: errores.join(" · ") };
    return confirmada();
  }

  /** Por PRESENCIA de la confirmación, nunca por ausencia del botón. */
  function confirmada() {
    const texto = (document.body.innerText || "").toLowerCase();
    if (/se envi[oó] tu solicitud|solicitud enviada|your application was sent|application submitted/.test(texto)) {
      return { enviada: true, mensaje: "LinkedIn confirmó la solicitud." };
    }
    return { enviada: false, error: "LinkedIn no confirmó el envío. Revísala tú antes de darla por enviada." };
  }

  chrome.runtime.onMessage.addListener((msg, _e, responder) => {
    try {
      if (msg.accion === "ping") responder({ ok: true, url: location.href, sesion: haySesion() });
      else if (msg.accion === "sesion") responder({ sesion: haySesion() });
      else if (msg.accion === "ofertas") responder({ ofertas: leerOfertas(), sesion: haySesion() });
      else if (msg.accion === "detalle") responder(leerDetalle());
      // «abrirFormulario» es lo que manda el fondo. Solo se entendía
      // «abrir», así que la postulación moría en el primer paso.
      else if (msg.accion === "abrir" || msg.accion === "abrirFormulario") abrirFormulario().then(responder);
      // En LinkedIn NO se sube un CV: la persona ya tiene uno marcado, y
      // LinkedIn guarda como mucho 4. Subir un Word por postulación le
      // llenaría la lista y reemplazaría el CV que ella eligió.
      else if (msg.accion === "preguntas") responder({ preguntas: leerPreguntas(), conArchivo: false });
      else if (msg.accion === "rellenar" || msg.accion === "escribir")
        responder(escribirRespuestas(msg.respuestas));
      // Faltaba: el fondo manda «adjuntar» en cada postulación y LinkedIn
      // contestaba «no sé hacer esa acción». Si el paso de CV de Solicitud
      // Sencilla tiene campo de archivo, se adjunta el adaptado; si no,
      // adjuntarCV lo dice y se postula con el CV del perfil.
      else if (msg.accion === "adjuntar") responder(adjuntarCV(msg.nombre, msg.base64));
      else if (msg.accion === "siguiente") siguientePaso().then(responder);
      else if (msg.accion === "enviar") enviar().then(responder);
      else responder({ error: "LinkedIn no sabe hacer esa accion: " + msg.accion });
    } catch (e) {
      responder({ error: e.message });
    }
    return true;
  });
})();

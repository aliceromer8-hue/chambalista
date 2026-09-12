// Content script de Indeed: solo lectura del listado.
//
// Indeed mantiene atributos estables (`data-testid`, `data-jk`), así que
// los selectores son directos. Lo que NO es estable es dónde pone el
// título: ya no está en `h2.jobTitle` ni en `[id^=jobTitle]` —ambos
// dejaron de existir— sino dentro del propio enlace de la tarjeta.
//
// Comprobado en el sitio real el 2026-09-12, con sesión: 16 tarjetas, 16
// con identificador, y el título saliendo VACÍO con los selectores que
// había. Una tarjeta sin título es una vacante que no se puede enseñar
// ni buscar, así que el portal aportaba dieciséis filas en blanco.

(() => {
  const SEL = {
    oferta: "div.job_seen_beacon",
    // El orden importa: lo primero que encaje gana. `a[data-jk] span[title]`
    // es lo que funciona hoy; los otros dos quedan detrás por si Indeed
    // vuelve atrás, y no estorban.
    titulo: "a[data-jk] span[title], a[data-jk], [id^='jobTitle']",
    empresa: "[data-testid='company-name']",
    ubicacion: "[data-testid='text-location']",
    fecha: "[data-testid='myJobsStateDate'], .date",
  };

  const texto = (raiz, sel) => {
    const e = raiz.querySelector(sel);
    return e ? e.innerText.replace(/\s+/g, " ").trim() : "";
  };

  function leerOfertas() {
    return [...document.querySelectorAll(SEL.oferta)].map((c) => {
      // El href de la tarjeta es un redirector de Indeed; la URL
      // canónica se arma con el identificador `jk`.
      const jk = c.querySelector("a[data-jk]")?.getAttribute("data-jk") || "";
      return {
        id: `indeed-${jk}`,
        portal: "Indeed",
        portalId: "indeed",
        postulable: true,
        titulo: texto(c, SEL.titulo),
        empresa: texto(c, SEL.empresa),
        ubicacion: texto(c, SEL.ubicacion),
        publicado: texto(c, SEL.fecha),
        url: jk ? `https://pe.indeed.com/viewjob?jk=${jk}` : "",
        yaPostulado: false,
      };
    }).filter((o) => o.titulo && o.url);
  }

  // Sesión: sin ella Indeed muestra el enlace a secure.indeed.com/auth.
  // Verificado contra el sitio real.
  function haySesion() {
    if (!document.querySelector("footer, #jobsearch, [data-testid], header")) return false;
    return !document.querySelector("a[href*='secure.indeed.com/auth'], a[href*='account/login']");
  }

  function leerDetalle() {
    return {
      titulo: texto(document, "h1, [data-testid='jobsearch-JobInfoHeader-title']"),
      descripcion: texto(document, "#jobDescriptionText").slice(0, 2500),
      requisitos: [...document.querySelectorAll("#jobDescriptionText li")]
        .map((li) => li.innerText.trim()).filter(Boolean).slice(0, 12),
      url: location.href,
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // Postular
  // ═══════════════════════════════════════════════════════════════════
  // Medido contra el sitio real el 2026-09-11, buscando «practicante de
  // marketing» en Lima: 32 tarjetas, sin CAPTCHA, y en el panel de
  // detalle un único botón con id estable:
  //
  //   button#indeedApplyButton   «Postularse mediante Indeed»
  //
  // LO QUE HACE A INDEED DISTINTO: EL FORMULARIO ESTÁ EN OTRO DOMINIO
  //
  // Ese botón no lleva href: abre SmartApply, que vive en
  // smartapply.indeed.com y es un asistente de VARIOS PASOS (elegir CV,
  // contestar preguntas, revisar, enviar). Por eso el manifest declara
  // también ese dominio: sin él, el content script no corre justo donde
  // está el formulario y la postulación se queda mirando una pestaña que
  // no puede tocar.
  //
  // Y por eso esto no es «rellenar y enviar» como Computrabajo, sino una
  // máquina de pasos: en cada pantalla se mira qué hay, se rellena lo que
  // se sabe, y se avanza. Cuando aparece algo que no se sabe contestar,
  // se para y se pregunta — nunca se adivina para poder seguir.
  //
  // ADEMÁS: no todas las vacantes de Indeed se postulan en Indeed. Muchas
  // mandan al ATS del propio empleador (Workday, Greenhouse), donde no
  // entramos. Esas se detectan por la ausencia de #indeedApplyButton y se
  // devuelven como «hay que hacerla a mano», que es la verdad.

  const SEL_BOTON = "#indeedApplyButton";
  const HOST_FORM = "smartapply.indeed.com";

  function botonPostular() {
    const b = document.querySelector(SEL_BOTON);
    if (b) return b;
    return [...document.querySelectorAll("button")]
      .find((x) => /postularse mediante indeed|apply with indeed/i.test(x.innerText || "")) || null;
  }

  /** ¿Esta vacante se postula EN Indeed, o manda a la web de la empresa? */
  function sePostulaAqui() {
    if (botonPostular()) return true;
    const texto = (document.body.innerText || "").toLowerCase();
    return !/sitio web de la empresa|apply on company site/.test(texto);
  }

  function enFormulario() {
    return location.host.includes(HOST_FORM);
  }

  async function abrirFormulario() {
    if (enFormulario()) return { abierto: true, conArchivo: camposDeArchivo().length > 0 };
    if (!sePostulaAqui()) {
      return {
        abierto: false,
        externo: true,
        error: "Esta vacante se postula en la web de la empresa, no en Indeed. "
             + "Ábrela tú: ahí no podemos entrar.",
      };
    }
    const boton = botonPostular();
    if (!boton) return { abierto: false, error: "No encontré el botón de postular." };
    boton.click();
    // SmartApply abre en otra pestaña o navega. Quien orquesta espera y
    // vuelve a preguntar; aquí solo se dice que se pulsó.
    await new Promise((r) => setTimeout(r, 1500));
    return { abierto: enFormulario(), enOtraPestana: !enFormulario(),
             nota: enFormulario() ? "" : "SmartApply se abrió aparte." };
  }

  /**
   * Las preguntas de la pantalla actual del asistente.
   *
   * Se lee SOLO lo que está a la vista. SmartApply enseña un paso cada
   * vez, así que leer el formulario entero no tiene sentido: lo que hay
   * es lo que toca ahora.
   */
  function leerPreguntas() {
    if (!enFormulario()) return [];
    const campos = document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select");
    const preguntas = [];
    for (const campo of campos) {
      if (campo.offsetParent === null) continue;
      const enunciado = enunciadoDe(campo);
      if (!enunciado) continue;
      const esRadio = campo.type === "radio" || campo.type === "checkbox";
      preguntas.push({
        id: campo.id || campo.name || enunciado,
        enunciado,
        tipo: esRadio ? "opcion" : (campo.tagName === "SELECT" ? "lista" : "texto"),
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
    return { escritas: Object.keys(dadas).length, pendientes, errores: erroresValidacion() };
  }

  /**
   * Avanza UN paso del asistente. No lo termina.
   *
   * Devuelve si quedan más pasos, para que quien orquesta vuelva a leer
   * preguntas y, sobre todo, para que la persona pueda mirar antes del
   * envío final. Enviar a ciegas un asistente de varios pasos es la
   * forma más fácil de mandar una postulación con un campo en blanco.
   */
  async function siguientePaso() {
    const boton = [...document.querySelectorAll("button")].find((b) => {
      const t = (b.innerText || "").trim().toLowerCase();
      return !b.disabled && /^(continuar|siguiente|continue|next)$/.test(t);
    });
    if (!boton) return { avanzado: false, ultimoPaso: true };
    boton.click();
    await new Promise((r) => setTimeout(r, 1600));
    return { avanzado: true, errores: erroresValidacion() };
  }

  function botonEnviar() {
    return [...document.querySelectorAll("button")].find((b) => {
      const t = (b.innerText || "").trim().toLowerCase();
      return !b.disabled && /enviar solicitud|enviar postulaci|submit application|submit your application/.test(t);
    }) || null;
  }

  async function enviar() {
    if (!enFormulario()) {
      return { enviada: false, error: "El formulario de Indeed no está abierto." };
    }
    const boton = botonEnviar();
    if (!boton) {
      return { enviada: false,
               error: "Todavía no estamos en el paso de enviar. Quedan pantallas por completar." };
    }
    boton.click();
    await new Promise((r) => setTimeout(r, 2500));
    const errores = erroresValidacion();
    if (errores.length) return { enviada: false, error: errores.join(" · ") };
    return confirmada();
  }

  /**
   * Por PRESENCIA de la confirmación, nunca por ausencia del botón.
   *
   * En un asistente de varios pasos, «ya no está el botón» pasa cada vez
   * que se cambia de pantalla. Leerlo como «enviada» le diría a la
   * persona que postuló en mitad del formulario.
   */
  function confirmada() {
    const texto = (document.body.innerText || "").toLowerCase();
    if (/solicitud enviada|application submitted|hemos enviado tu solicitud|postulaci[oó]n enviada/.test(texto)) {
      return { enviada: true, mensaje: "Indeed confirmó la postulación." };
    }
    return { enviada: false,
             error: "Indeed no confirmó el envío. Revísala tú antes de darla por enviada." };
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
      else if (msg.accion === "adjuntar") responder(adjuntarCV(msg.nombre, msg.base64));
      else if (msg.accion === "siguiente") siguientePaso().then(responder);
      else if (msg.accion === "enviar") enviar().then(responder);
      else responder({ error: "Indeed no sabe hacer esa accion: " + msg.accion });
    } catch (e) {
      responder({ error: e.message });
    }
    return true;
  });
})();

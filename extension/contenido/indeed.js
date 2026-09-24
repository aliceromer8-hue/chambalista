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
  // Las herramientas compartidas viven en window.ChambaComun (comun.js).
  // Faltaba esta línea: el código de postular las llamaba sueltas, como
  // si fueran globales, y no lo son. Leer una pregunta, escribir una
  // respuesta o adjuntar el CV reventaba con «no está definido»: en
  // este portal nunca se llegó a rellenar nada.
  const { rellenar, enunciadoDe, erroresValidacion, adjuntarCV, camposDeArchivo } = window.ChambaComun;
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
        // Antes `false` fijo: nunca se descartaba nada. Se mira el texto
        // de la tarjeta SIN el título, para no confundir un puesto que se
        // llame así con una marca de «ya postulaste».
        yaPostulado: /\b(postulad[oa]|ya (te )?postulaste|solicitud enviada|solicitado|applied)\b/i.test((c.innerText || "").replace(texto(c, SEL.titulo), "")),
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
  // Medido OTRA VEZ en el sitio real el 2026-09-24 (Banco Falabella,
  // «Practicante de Marketing»), y había cambiado casi todo:
  //
  //   · #indeedApplyButton ya NO existe. Es un enlace «Postularse ahora»,
  //     a[data-testid="viewjob-indeed-apply"], que va directo a
  //     smartapply.indeed.com. Con el selector viejo, Indeed no postulaba
  //     ni una.
  //   · Pantallas: elegir CV (ya viene elegido) → preguntas de la empresa
  //     → «Preparando la evaluación» (~20 s) → «Revisa tu postulación»
  //     con «Envía tu postulación» (data-testid submit-application-button).
  //   · Las preguntas de Sí/No y de nivel son radios dentro de un
  //     <fieldset> con la pregunta en el <legend>. Leídos uno a uno, cada
  //     radio era una «pregunta» llamada «Sí».
  //   · Hay desplegables PROPIOS (div role=combobox + li role=option), no
  //     <select>: «Años de experiencia en área Marketing *». Obligatorios,
  //     y sin contestarlos Indeed no deja seguir.
  //   · Un .click() programado SÍ funciona aquí (en Computrabajo no).

  const SEL_BOTON = "a[data-testid='viewjob-indeed-apply'], a[href*='smartapply.indeed.com'], #indeedApplyButton";
  const HOST_FORM = "smartapply.indeed.com";
  const visible = (e) => Boolean(e && (e.offsetWidth || e.offsetHeight));
  const limpio = (t) => (t || "").replace(/\s+/g, " ").trim();
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const sinTildes = (t) => limpio(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function botonPostular() {
    const b = [...document.querySelectorAll(SEL_BOTON)].find(visible);
    if (b) return b;
    return [...document.querySelectorAll("a, button")].filter(visible)
      .find((x) => /^(postularse ahora|postularse mediante indeed|apply now|apply with indeed)$/i
        .test(limpio(x.innerText))) || null;
  }

  /** ¿Esta vacante se postula EN Indeed, o manda a la web de la empresa? */
  function sePostulaAqui() {
    if (botonPostular()) return true;
    const texto = (document.body.innerText || "").toLowerCase();
    return !/sitio (web )?de la empresa|apply on company site/.test(texto);
  }

  // En SmartApply. El dominio basta en la vida real; el botón «Guardar y
  // cerrar» —que está en todas sus pantallas— sirve para reconocerlo
  // también en la página de prueba.
  function enFormulario() {
    return location.host.includes(HOST_FORM)
      || Boolean(document.querySelector("[data-testid^='ExitLinkWithModalComponent']"));
  }

  async function abrirFormulario() {
    if (enFormulario()) return { abierto: true, conArchivo: pideArchivo() };
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
    // Es un enlace: se va a su dirección. Lo sigue buscarFormularioAbierto
    // en el fondo, que espera a que la dirección deje de cambiar.
    if (boton.href && boton.href.includes(HOST_FORM)) {
      location.assign(boton.href);
      return { abierto: false, navegando: true };
    }
    boton.click();
    await esperar(1500);
    return { abierto: enFormulario(), enOtraPestana: !enFormulario(),
             nota: enFormulario() ? "" : "SmartApply se abrió aparte." };
  }

  // ─── Qué hay en la pantalla ────────────────────────────────────────
  //
  // Todo con un `indice` FIJO para esta pantalla, aunque algo ya esté
  // contestado: textos por su posición (0…), grupos de opciones 100+,
  // desplegables 200+. Así, si algo se rellena entre leer y escribir, las
  // respuestas no se corren de sitio.

  const RUIDO = /actualizaciones por email|alerta de empleo|job alert|email updates/i;

  function camposTexto() {
    return [...document.querySelectorAll(
      "input:not([type]), input[type=text], input[type=number], input[type=tel], input[type=email], "
      + "input[type=date], input[type=url], textarea, select")]
      .filter(visible)
      .filter((c) => !/p[aá]gina actual|current page/i.test(c.getAttribute("aria-label") || ""));
  }

  function gruposOpciones() {
    const grupos = new Map();
    for (const r of document.querySelectorAll("input[type=radio], input[type=checkbox]")) {
      if (!r.name || r.name === "resume-selection") continue;
      // Los radios de Indeed pueden estar ocultos tras su dibujo: vale que
      // se vea su etiqueta o su fieldset.
      const caja = r.closest("fieldset") || r.closest("label") || r.parentElement;
      if (!visible(r) && !visible(caja)) continue;
      if (!grupos.has(r.name)) grupos.set(r.name, []);
      grupos.get(r.name).push(r);
    }
    return [...grupos.entries()].map(([nombre, radios], g) => {
      const fs = radios[0].closest("fieldset");
      const bruto = limpio(fs?.querySelector("legend")?.innerText) || enunciadoDe(radios[0]);
      const opciones = radios.map((r) => limpio(
        document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.innerText || r.closest("label")?.innerText));
      return { indice: 100 + g, nombre, radios, bruto, opciones };
    }).filter((q) => !RUIDO.test(q.bruto) && q.opciones.every(Boolean));
  }

  function desplegables() {
    return [...document.querySelectorAll("[role=combobox]")].filter(visible).map((c, k) => {
      const bruto = limpio(document.getElementById(c.getAttribute("aria-labelledby") || "")?.innerText)
        || enunciadoDe(c);
      let zona = document.getElementById(c.getAttribute("aria-controls") || "");
      if (!zona?.querySelector("[role=option]")) {
        zona = c.parentElement;
        for (let i = 0; i < 5 && zona && !zona.querySelector("[role=option]"); i++) zona = zona.parentElement;
      }
      const items = zona ? [...zona.querySelectorAll("[role=option]")] : [];
      return { indice: 200 + k, caja: c, items, bruto, opciones: items.map((o) => limpio(o.innerText)) };
    }).filter((d) => d.items.length);
  }

  const enunciadoLimpio = (t) => limpio(t).replace(/\s*\*\s*/g, " ").replace(/\bobligatorio\b/i, "").trim();
  const esObligatoria = (t, campo) => /\*|obligatori/i.test(t || "")
    || Boolean(campo?.required) || campo?.getAttribute?.("aria-required") === "true";
  const sinElegir = (d) => !limpio(d.caja.innerText) || /^(seleccionar|selecciona|select)/i.test(limpio(d.caja.innerText));

  /**
   * Las preguntas de la pantalla actual que FALTA contestar.
   *
   * Lo que Indeed ya trae (nombre, teléfono, CV elegido) no se toca. En la
   * pantalla de revisión no hay nada que contestar: sus casillas son de
   * alertas por correo.
   */
  function leerPreguntas() {
    if (!enFormulario() || botonEnviar()) return [];
    const preguntas = [];
    camposTexto().forEach((campo, i) => {
      if (limpio(campo.value)) return;
      const bruto = enunciadoDe(campo);
      if (!bruto) return;
      preguntas.push({
        indice: i, id: campo.id || campo.name || bruto,
        enunciado: enunciadoLimpio(bruto),
        tipo: campo.tagName === "SELECT" ? "opcion" : "texto",
        obligatoria: esObligatoria(bruto, campo),
        opciones: campo.tagName === "SELECT"
          ? [...campo.options].filter((o) => o.value).map((o) => limpio(o.text)).filter(Boolean) : [],
      });
    });
    for (const g of gruposOpciones()) {
      if (g.radios.some((r) => r.checked)) continue;
      preguntas.push({ indice: g.indice, id: g.nombre, enunciado: enunciadoLimpio(g.bruto),
                       tipo: "opcion", opciones: g.opciones,
                       obligatoria: esObligatoria(g.bruto, g.radios[0]) });
    }
    for (const d of desplegables()) {
      if (!sinElegir(d)) continue;
      preguntas.push({ indice: d.indice, id: d.caja.id || d.bruto, enunciado: enunciadoLimpio(d.bruto),
                       tipo: "opcion", opciones: d.opciones, obligatoria: esObligatoria(d.bruto, d.caja) });
    }
    return preguntas;
  }

  /** La opción que corresponde a una respuesta: igual, o que empieza igual. */
  function cualOpcion(opciones, valor) {
    const v = sinTildes(valor);
    const n = opciones.map(sinTildes);
    let i = n.indexOf(v);
    // «Sí, tengo experiencia» → «Sí». Con límite de palabra: si no, un
    // «Si» encajaría con «Sin preferencia».
    const corte = (resto) => !resto || /^[\s,.;:+(]/.test(resto);
    if (i < 0) i = n.findIndex((o) => o && v.startsWith(o) && corte(v.slice(o.length)));
    if (i < 0) i = n.findIndex((o) => v && o.startsWith(v) && corte(o.slice(v.length)));
    return i;
  }

  function escribirRespuestas(respuestas) {
    const dadas = respuestas || {};
    const pendientes = [];
    const escritas = [];
    // Por posición (`indice`, lo que manda el panel) o por id del campo.
    const valorDe = (pregunta) => dadas[pregunta.indice] ?? dadas[pregunta.id];

    camposTexto().forEach((campo, i) => {
      let valor = valorDe({ indice: i, id: campo.id || campo.name });
      if (valor == null || valor === "") return;
      valor = String(valor).trim();
      if (campo.tagName === "SELECT") {
        const ops = [...campo.options];
        const k = cualOpcion(ops.map((o) => o.text), valor);
        if (k < 0) return;
        campo.value = ops[k].value;
        campo.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        // Un campo numérico no acepta una frase: se queda con el número.
        if (campo.type === "number") valor = (valor.match(/\d+(?:[.,]\d+)?/) || [""])[0].replace(",", ".");
        if (!valor) return;
        rellenar(campo, valor);
      }
      escritas.push(i);
    });
    for (const g of gruposOpciones()) {
      const valor = valorDe({ indice: g.indice, id: g.nombre });
      if (valor == null || valor === "") continue;
      const k = cualOpcion(g.opciones, valor);
      if (k < 0) { pendientes.push(enunciadoLimpio(g.bruto)); continue; }
      if (!g.radios[k].checked) g.radios[k].click();
      escritas.push(g.indice);
    }
    for (const d of desplegables()) {
      const valor = valorDe({ indice: d.indice, id: d.caja.id });
      if (valor == null || valor === "") continue;
      const k = cualOpcion(d.opciones, valor);
      if (k < 0) { pendientes.push(enunciadoLimpio(d.bruto)); continue; }
      // Pulsar la opción (aunque la lista esté cerrada) basta: medido.
      d.items[k].click();
      escritas.push(d.indice);
    }
    for (const q of leerPreguntas()) if (q.obligatoria) pendientes.push(q.enunciado);
    return { escritas, pendientes: [...new Set(pendientes)], errores: erroresValidacion() };
  }

  /** Los avisos que Indeed pone junto a lo que falta («Elige una opción para continuar»). */
  function avisosDelPortal() {
    const vistos = new Set(erroresValidacion());
    for (const e of document.querySelectorAll("[role=alert], [id*='error' i], [class*='error' i]")) {
      const t = limpio(e.innerText);
      if (visible(e) && t && t.length < 160) vistos.add(t);
    }
    for (const e of document.querySelectorAll("span, div, p")) {
      if (e.children.length || !visible(e)) continue;
      const t = limpio(e.innerText);
      if (/para continuar|es obligatori|campo requerido|this field is required|answer this question/i.test(t)) vistos.add(t);
    }
    return [...vistos];
  }

  function botonSiguiente() {
    return [...document.querySelectorAll("button")].filter(visible).find((b) =>
      !b.disabled && /^(continuar|siguiente|continue|next)$/i.test(limpio(b.innerText))) || null;
  }

  /**
   * Avanza UN paso del asistente. «Continuar» nunca es el envío: el envío
   * es «Envía tu postulación», y ese no se pulsa aquí.
   *
   * Si Indeed no cambia de pantalla es que falta algo: se devuelve lo que
   * dice, para no darle a «Continuar» ocho veces contra la misma pared.
   */
  async function siguientePaso() {
    const boton = botonSiguiente();
    if (!boton) return { avanzado: false, ultimoPaso: true };
    const antes = location.href;
    boton.click();
    for (let i = 0; i < 12; i++) {
      await esperar(400);
      if (location.href !== antes) return { avanzado: true };
    }
    const errores = avisosDelPortal();
    return errores.length ? { avanzado: false, errores } : { avanzado: false, ultimoPaso: !botonSiguiente() };
  }

  /**
   * Las pantallas donde no hay nada que contestar (el CV ya elegido) se
   * pasan solas, para que al leer preguntas se lean las de la empresa y
   * no un «0 preguntas» en la de elegir CV. Solo «Continuar»; se para en
   * cuanto hay algo que contestar, un archivo que subir o el envío.
   */
  async function pasarPantallasVacias() {
    for (let i = 0; i < 4 && enFormulario(); i++) {
      if (botonEnviar() || leerPreguntas().length || pideArchivo()) return;
      const s = await siguientePaso();
      if (!s.avanzado) return;
      await esperar(600);
    }
  }

  // ¿Hay que subir un CV? Solo si Indeed no tiene ya uno elegido.
  function pideArchivo() {
    const elegido = [...document.querySelectorAll("input[name='resume-selection']")].some((r) => r.checked);
    return !elegido && [...document.querySelectorAll("input[type=file]")].length > 0
      && /cv|curr[ií]cul|resume/i.test(document.body.innerText || "");
  }

  function botonEnviar() {
    return document.querySelector("[data-testid='submit-application-button']:not([disabled])")
      || [...document.querySelectorAll("button")].filter(visible).find((b) =>
        !b.disabled && /env[ií]a(r)? tu postulaci|enviar solicitud|enviar postulaci|submit (your )?application/i
          .test(limpio(b.innerText)))
      || null;
  }

  async function enviar() {
    if (!enFormulario()) {
      return { enviada: false, error: "El formulario de Indeed no está abierto." };
    }
    // «Preparando la evaluación» tarda ~20 s antes de enseñar el botón.
    let boton = botonEnviar();
    for (let i = 0; !boton && i < 40; i++) { await esperar(750); boton = botonEnviar(); }
    if (!boton) {
      const errores = avisosDelPortal();
      return { enviada: false,
               error: errores.length ? errores.join(" · ")
                 : "Todavía no estamos en el paso de enviar. Quedan pantallas por completar." };
    }
    boton.click();
    for (let i = 0; i < 20; i++) {
      await esperar(500);
      const c = confirmada();
      if (c.enviada) return c;
    }
    const errores = avisosDelPortal();
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
    if (/post-?apply/i.test(location.pathname)
        || /solicitud enviada|application (has been )?submitted|hemos enviado tu solicitud|postulaci[oó]n enviada|(se envi[oó]|enviamos) tu postulaci|tu postulaci[oó]n (se envi[oó]|fue enviada|ha sido enviada)/.test(texto)) {
      return { enviada: true, mensaje: "Indeed confirmó la postulación." };
    }
    return { enviada: false,
             error: "Indeed no confirmó el envío. Revísala tú antes de darla por enviada." };
  }

  chrome.runtime.onMessage.addListener((msg, _e, responder) => {
    try {
      if (msg.accion === "ping") responder({ ok: true, url: location.href, sesion: haySesion(),
                                             enviada: enFormulario() && confirmada().enviada });
      else if (msg.accion === "sesion") responder({ sesion: haySesion() });
      else if (msg.accion === "ofertas") responder({ ofertas: leerOfertas(), sesion: haySesion() });
      else if (msg.accion === "detalle") responder(leerDetalle());
      // «abrirFormulario» es lo que manda el fondo. Solo se entendía
      // «abrir», así que la postulación moría en el primer paso.
      else if (msg.accion === "abrir" || msg.accion === "abrirFormulario") abrirFormulario().then(responder);
      // Antes de leer se pasan las pantallas sin nada que contestar (la de
      // elegir CV): si no, se leían 0 preguntas y nada se preparaba.
      else if (msg.accion === "preguntas") pasarPantallasVacias().then(() =>
        responder({ preguntas: leerPreguntas(), conArchivo: pideArchivo() }));
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

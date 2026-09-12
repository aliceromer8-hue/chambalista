// Content script de Computrabajo: lee la página y llena formularios.
//
// Corre dentro de la pestaña de la persona, con la sesión que ella ya
// abrió. La extensión nunca ve ni pide su contraseña.
//
// Selectores verificados contra el sitio real el 2026-07-29.

(() => {
  const C = window.ChambaComun;

  const SEL = {
    oferta: "article.box_offer[data-id]",
    titulo: "h2 a.js-o-link",
    empresa: "[offer-grid-article-company-url]",
    ubicacion: "p.fs16.fc_base.mt5:not(.dFlex) span.mr10",
    fecha: "p.fs13.fc_aux",
    yaPostulado: "[applied-offer-tag]:not(.hide)",
    siguiente: "span[title='Siguiente'][data-path]",
    sinSesion: "a.js_login",
    detalleTitulo: "h1",
    detalleDesc: "p.mbB",
    detalleRequisitos: "ul.mbB li",
  };

  // ---------- estado de la sesión ----------
  function haySesion() {
    // Detección por AUSENCIA del botón de acceso, así que antes hay que
    // confirmar que la página cargó de verdad; si no, una página en
    // blanco diría "sesión abierta" en falso.
    if (!document.querySelector("footer, #prof-cat-search-input, article.box_offer, form")) {
      return false;
    }
    return !document.querySelector(SEL.sinSesion);
  }

  // ---------- listado de vacantes ----------
  function leerOfertas() {
    return [...document.querySelectorAll(SEL.oferta)].map((art) => {
      const enlace = art.querySelector(SEL.titulo);
      if (!enlace) return null;
      const href = (enlace.getAttribute("href") || "").split("#")[0];
      return {
        id: `computrabajo-${art.getAttribute("data-id")}`,
        portal: "Computrabajo",
        portalId: "computrabajo",
        postulable: true,
        titulo: enlace.innerText.trim(),
        empresa: C.texto(art, SEL.empresa),
        ubicacion: C.texto(art, SEL.ubicacion),
        publicado: C.texto(art, SEL.fecha),
        url: href.startsWith("http") ? href : `https://pe.computrabajo.com${href}`,
        yaPostulado: Boolean(art.querySelector(SEL.yaPostulado)),
      };
    }).filter(Boolean);
  }

  function leerDetalle() {
    return {
      titulo: C.texto(document, SEL.detalleTitulo),
      descripcion: C.texto(document, SEL.detalleDesc),
      requisitos: [...document.querySelectorAll(SEL.detalleRequisitos)]
        .map((li) => li.innerText.trim()).filter(Boolean).slice(0, 12),
      url: location.href,
    };
  }

  // ---------- postulación ----------
  function botonPostular() {
    return [...document.querySelectorAll("a, button, span")].find(
      (e) => /^postularme$|^postular$|^aplicar$/i.test((e.innerText || "").trim()) &&
             (e.offsetWidth || e.offsetHeight),
    );
  }

  /** Abre el formulario. No envía nada. */
  async function abrirFormulario() {
    if (!haySesion()) {
      return { requiereLogin: true, nota: "Inicia sesión en Computrabajo en esta pestaña." };
    }
    const boton = botonPostular();
    if (!boton) {
      const yaEsta = document.querySelector(SEL.yaPostulado);
      return {
        error: yaEsta
          ? "Ya postulaste a esta oferta."
          : "No se encontró el botón «Postularme». Puede que la oferta haya expirado.",
      };
    }
    boton.click();
    await C.esperar(1500);
    if (C.hayCaptcha()) {
      return { captcha: true, nota: "El portal mostró un CAPTCHA. Resuélvelo tú y vuelve a intentar." };
    }
    // Dónde acabamos DESPUÉS del clic.
    //
    // Arriba se comprueba la sesión, pero esa comprobación es por
    // ausencia del botón de acceso —lo dice haySesion()— y las
    // comprobaciones por ausencia fallan abiertas: si la página no cargó
    // bien, «no está el botón de acceso» se lee como «sesión abierta».
    // Además la sesión puede caducar entre la comprobación y el clic.
    //
    // Sin esto, el flujo seguía adelante sobre la página de acceso:
    // rellenaba el formulario de login con los datos de la persona y
    // luego hacía clic en «entrar» creyendo que enviaba una postulación.
    // Es el mismo fallo que ya se corrigió en la versión de escritorio.
    if (!enPostulacion()) {
      return { requiereLogin: true,
               nota: "Computrabajo pidió iniciar sesión. Entra y vuelve a intentarlo." };
    }
    return { abierto: true };
  }

  /** ¿Seguimos en la postulación, o nos mandaron al acceso? */
  function enPostulacion() {
    if (/\/acceso|\/login|\/registro/i.test(location.pathname)) return false;
    if (document.querySelector("input[type=password]")) return false;
    return true;
  }

  /** Lee las preguntas de selección del formulario abierto. */
  function leerPreguntas() {
    return [...document.querySelectorAll("form textarea, textarea")]
      .map((campo, indice) => ({ indice, enunciado: C.enunciadoDe(campo),
                                 max: campo.getAttribute("maxlength") || "",
                                 actual: (campo.value || "").trim() }))
      .filter((q) => q.enunciado);
  }

  /** Rellena los campos simples (nombre, correo, teléfono, datos guardados). */
  function rellenarCampos(perfil, guardados, patrones) {
    const completados = [];
    const pendientes = [];
    const contacto = perfil?.contacto || {};

    for (const campo of document.querySelectorAll("form input, form select")) {
      const tipo = (campo.type || "").toLowerCase();
      if (["hidden", "submit", "button", "file", "checkbox", "radio"].includes(tipo)) continue;
      if ((campo.value || "").trim()) continue;

      const etiqueta = [campo.name, campo.id, campo.placeholder, campo.getAttribute("aria-label")]
        .filter(Boolean).join(" ");
      if (!etiqueta.trim()) continue;

      // Datos personales: solo si la persona los guardó a propósito.
      const encaje = patrones.find((p) => new RegExp(p.patron, "i").test(etiqueta));
      if (encaje) {
        const valor = guardados[encaje.clave];
        if (valor) {
          C.rellenar(campo, valor);
          completados.push(`${etiqueta.slice(0, 34)} → ${valor}`);
        } else {
          pendientes.push(encaje.etiqueta);
        }
        continue;
      }

      // Datos que sí están en el CV.
      const mapa = [
        [/nombre|name/i, perfil?.nombre],
        [/mail|correo/i, contacto.email],
        [/tel[eé]fono|celular|phone|m[oó]vil/i, contacto.telefono],
        [/linkedin/i, contacto.linkedin],
      ];
      const par = mapa.find(([re, v]) => v && re.test(etiqueta));
      if (par) {
        C.rellenar(campo, par[1]);
        completados.push(`${etiqueta.slice(0, 34)} → ${par[1]}`);
      }
    }
    return { completados, pendientes: [...new Set(pendientes)] };
  }

  /** Escribe las respuestas aprobadas en los textarea. */
  function escribirRespuestas(respuestas) {
    const campos = [...document.querySelectorAll("form textarea, textarea")];
    const escritas = [];
    for (const [indice, texto] of Object.entries(respuestas || {})) {
      const campo = campos[Number(indice)];
      if (!campo || !String(texto).trim()) continue;
      C.rellenar(campo, String(texto).trim());
      escritas.push(Number(indice));
    }
    return { escritas, total: campos.length };
  }

  // ---------- envío ----------
  function candidatosEnvio() {
    const buenas = /postular|enviar|aplicar|finalizar|confirmar/i;
    const malas = /buscar|filtrar|iniciar sesi|registrar|cancelar|volver|cerrar|guardar b/i;
    return [...document.querySelectorAll("button, input[type='submit'], a.b_primary, span.b_primary")]
      .filter((e) => (e.offsetWidth || e.offsetHeight) && !e.disabled)
      .map((e) => {
        const t = (e.innerText || e.value || "").replace(/\s+/g, " ").trim();
        let pts = 0;
        if (buenas.test(t)) pts += 10;
        if (malas.test(t)) pts -= 20;
        if ((e.type || "").toLowerCase() === "submit") pts += 4;
        if (e.closest("form")) pts += 3;
        return { el: e, texto: t, pts };
      })
      .filter((b) => b.pts > 0)
      .sort((a, b) => b.pts - a.pts);
  }

  function confirmada() {
    if (document.querySelector("[applied-offer-tag]:not(.hide), .tag.postulated:not(.hide)")) {
      return "El portal marcó la oferta como «Postulado».";
    }
    const t = (document.body.innerText || "").toLowerCase();
    const frases = ["tu postulación fue enviada", "postulación enviada", "ya postulaste",
                    "hemos enviado tu postulación", "gracias por postular"];
    const hit = frases.find((f) => t.includes(f));
    return hit ? `Mensaje del portal: «${hit}»` : null;
  }

  /** El clic final. Solo se llama tras la confirmación de la persona. */
  async function enviar() {
    if (!enPostulacion()) {
      return { enviada: false, error: "No estamos en la postulación, sino en el acceso." };
    }
    if (C.hayCaptcha()) return { error: "Hay un CAPTCHA pendiente; resuélvelo en la página." };

    const ya = confirmada();
    if (ya) return { enviada: true, mensaje: `Ya estaba postulada. ${ya}` };

    const candidatos = candidatosEnvio();
    if (!candidatos.length) {
      return { error: "No se encontró el botón de envío.", diagnostico: { botones: [] } };
    }

    const urlAntes = location.href;
    const elegido = candidatos[0];
    elegido.el.click();

    for (let i = 0; i < 12; i++) {
      await C.esperar(700);
      const ok = confirmada();
      if (ok) return { enviada: true, mensaje: `Postulación enviada. ${ok}` };
      if (location.href !== urlAntes) break;
    }

    const errores = C.erroresValidacion();
    const ok = confirmada();
    if (ok) return { enviada: true, mensaje: `Postulación enviada. ${ok}` };

    return {
      enviada: false,
      mensaje: errores.length
        ? `El portal pide completar: ${errores.slice(0, 3).join(" · ")}`
        : "No se pudo confirmar el envío. Revisa la página.",
      diagnostico: {
        botonPulsado: elegido.texto,
        otrosBotones: candidatos.slice(1, 5).map((b) => b.texto),
        errores,
        cambioUrl: location.href !== urlAntes,
      },
    };
  }

  // ---------- puente con el popup y el service worker ----------
  chrome.runtime.onMessage.addListener((msg, _emisor, responder) => {
    (async () => {
      try {
        switch (msg.accion) {
          case "ping":          return responder({ ok: true, url: location.href, sesion: haySesion() });
          case "sesion":        return responder({ sesion: haySesion() });
          case "ofertas":       return responder({ ofertas: leerOfertas(), sesion: haySesion() });
          case "detalle":       return responder(leerDetalle());
          case "abrirFormulario": return responder(await abrirFormulario());
          case "preguntas":     return responder({ preguntas: leerPreguntas() });
          case "rellenar":      return responder(rellenarCampos(msg.perfil, msg.guardados, msg.patrones));
          case "adjuntar":      return responder(C.adjuntarCV(msg.nombre, msg.base64));
          case "escribir":      return responder(escribirRespuestas(msg.respuestas));
          case "enviar":        return responder(await enviar());
          default:              return responder({ error: `Acción desconocida: ${msg.accion}` });
        }
      } catch (e) {
        responder({ error: e.message });
      }
    })();
    return true;   // respuesta asíncrona
  });
})();

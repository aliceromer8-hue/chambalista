// Service worker: coordina las pestañas y guarda el estado del lote.
//
// El content script sabe leer y rellenar una página; aquí se decide a qué
// páginas ir y en qué orden. El popup solo pinta.

import { PORTALES, terminoBusqueda } from "./lib/portales.js";
import * as almacen from "./lib/almacen.js";
import * as datos from "./lib/datos.js";
import * as respuestas from "./lib/respuestas.js";
import * as ia from "./lib/ia.js";
import * as cv from "./lib/cv.js";
import * as huecos from "./lib/huecos.js";
import * as sesion from "./lib/sesion.js";
import { medir } from "./lib/medir.js";
import { TOPE_POR_TANDA } from "./lib/verificados.js";

// Lo que dice el servidor cuando se agota la cuota gratuita de IA.
// Viene de proxy_ia.py: «Llegaste al límite de N usos gratis.»
const SIN_CUOTA = /l[ií]mite de \d+ usos gratis|cuota|quota|429/i;

const PAUSA_ENTRE_VACANTES = 2500;

let lote = { fase: "inactivo", modo: "", total: 0, hechas: 0, mensaje: "", items: [], cancelado: false };

// ---------------------------------------------------------------------
// Utilidades de pestañas
// ---------------------------------------------------------------------

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pestanaLista(tabId, limite = 25000) {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    try {
      const r = await hablarCon(tabId, { accion: "ping" });
      if (r?.ok) return true;
    } catch {
      // el content script aún no cargó
    }
    await esperar(400);
  }
  return false;
}

/**
 * Habla con el content script de una pestaña, inyectándolo si no está.
 *
 * `chrome.tabs.sendMessage` a una pestaña sin content script falla con
 * «Could not establish connection. Receiving end does not exist.», que
 * es un error de Chrome y no le dice nada a nadie. Y pasa a menudo: cada
 * vez que se recarga la extensión, las pestañas de portales que ya
 * estaban abiertas se quedan sin script hasta que se recargan a mano.
 *
 * Como el manifest ya pide el permiso `scripting`, se puede arreglar en
 * vez de solo avisar: se inyecta el script que toca para ese dominio y
 * se reintenta una vez. Si ni así, entonces sí se dice algo que se
 * entienda.
 */
const GUION_POR_DOMINIO = [
  [/(^|\.)computrabajo\.com$/, ["contenido/comun.js", "contenido/computrabajo.js"]],
  [/(^|\.)bumeran\.com\.pe$/, ["contenido/comun.js", "contenido/bumeran.js"]],
  [/(^|\.)indeed\.com$/,       ["contenido/comun.js", "contenido/indeed.js"]],
  [/(^|\.)linkedin\.com$/,     ["contenido/comun.js", "contenido/linkedin.js"]],
];

async function hablarCon(tabId, mensaje) {
  try {
    // La directa a propósito: esta es la que puede fallar por falta de
    // content script, y es justo lo que el catch de abajo arregla.
    return await chrome.tabs.sendMessage(tabId, mensaje);
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(e.message || "")) {
      throw e;
    }
    let host = "";
    try {
      host = new URL((await chrome.tabs.get(tabId)).url || "").hostname;
    } catch { /* la pestaña se cerró */ }
    const guiones = (GUION_POR_DOMINIO.find(([re]) => re.test(host)) || [])[1];
    if (!guiones) {
      throw new Error("Esa pestaña no es de un portal que conozcamos.");
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: guiones });
    } catch (fallo) {
      throw new Error(`No se pudo preparar la pestaña de ${host}. `
        + `Recárgala y vuelve a intentarlo. (${fallo.message})`);
    }
    await esperar(400);
    return chrome.tabs.sendMessage(tabId, mensaje);
  }
}

async function irY(tabId, url, accion, extra = {}) {
  await chrome.tabs.update(tabId, { url });
  await esperar(1200);
  if (!(await pestanaLista(tabId))) throw new Error("La página no terminó de cargar.");
  return hablarCon(tabId, { accion, ...extra });
}

/** Pestaña de trabajo: se reutiliza una sola para no llenar el navegador. */
async function pestanaDeTrabajo() {
  const guardada = await almacen.leer("tabTrabajo", null);
  if (guardada) {
    try {
      const t = await chrome.tabs.get(guardada);
      if (t) return t.id;
    } catch {
      // se cerró
    }
  }
  const t = await chrome.tabs.create({ url: "https://pe.computrabajo.com/", active: false });
  await almacen.guardar("tabTrabajo", t.id);
  return t.id;
}

// ---------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------

async function buscar({ puesto, ciudad, nivel, portales: elegidos }) {
  const termino = terminoBusqueda(puesto, nivel);
  if (!termino) throw new Error("Escribe qué puesto buscas.");

  const tabId = await pestanaDeTrabajo();
  const vistos = new Set();
  const vacantes = [];
  const errores = [];

  for (const pid of elegidos?.length ? elegidos : ["computrabajo"]) {
    const portal = PORTALES[pid];
    if (!portal) continue;
    try {
      for (let pagina = 1; pagina <= 2; pagina++) {
        const r = await irY(tabId, portal.url(termino, ciudad, pagina), "ofertas");
        // Solo Computrabajo necesita sesión: los otros listan en público.
        if (portal.postulable && r?.sesion === false) {
          errores.push({ portal: portal.nombre, error: "Necesitas iniciar sesión." });
          break;
        }
        const nuevas = (r?.ofertas || []).filter((v) => {
          const k = `${v.titulo}|${v.empresa}`.toLowerCase();
          if (vistos.has(k) || v.yaPostulado) return false;
          vistos.add(k);
          return true;
        });
        vacantes.push(...nuevas);
        if (!nuevas.length) break;
      }
      medir("busqueda", { portal: pid, cuantas: vacantes.length });
    } catch (e) {
      errores.push({ portal: portal.nombre, error: e.message });
      medir("busqueda", { portal: pid, ok: false });
    }
  }
  return { vacantes, errores, termino };
}

// ---------------------------------------------------------------------
// Preparar una postulación
// ---------------------------------------------------------------------

/**
 * Genera el CV adaptado y lo mete en el formulario.
 *
 * Devuelve siempre un parte de lo que pasó de verdad, nunca un "listo"
 * optimista. Antes esto no existía: se reescribía el resumen en memoria
 * y el panel decía «CV adaptado a esta vacante», pero a la empresa le
 * llegaba el CV viejo que la persona tenía guardado en el portal. Era lo
 * único que el producto afirmaba y no hacía.
 *
 * Que falle no aborta la postulación: se manda con el CV del portal, que
 * es exactamente lo que pasaba antes. Pero se DICE.
 */
async function adjuntarCVAdaptado(tabId, perfil, vacante, resumen, competenciasExtra) {
  const pedido = await cv.docxAdaptado(perfil, vacante, { resumen, competenciasExtra });
  if (!pedido || pedido.error) {
    return {
      adjuntado: false,
      nota: `No se pudo generar el CV adaptado (${pedido?.error || "sin respuesta"}). `
          + "Se postula con el CV que ya tienes en el portal.",
    };
  }

  let puesto;
  try {
    puesto = await hablarCon(tabId, {
      accion: "adjuntar", nombre: pedido.nombre, base64: pedido.base64,
    });
  } catch (e) {
    return { adjuntado: false, nota: `No se pudo adjuntar: ${e.message}` };
  }

  if (!puesto?.adjuntado) {
    return {
      adjuntado: false,
      archivo: pedido.nombre,
      nota: puesto?.motivo || "El formulario no aceptó el archivo.",
    };
  }

  return {
    adjuntado: true,
    archivo: pedido.nombre,
    bytes: pedido.bytes,
    anadidas: pedido.anadidas,
    nota: `CV adaptado adjuntado: ${pedido.nombre}`
        + (pedido.anadidas?.length ? ` (con ${pedido.anadidas.join(", ")}, que confirmaste tú)` : ""),
  };
}

async function prepararUna(vacante, perfil, guardados, respuestasPersona) {
  // Postular exige cuenta. Lo que se envía lleva el nombre de la persona
  // a una empresa real: tiene que quedar claro de quién viene, y eso no
  // sale de un navegador anónimo. Buscar y ver vacantes sigue abierto.
  if (!(await sesion.hayCuenta())) {
    return {
      url: vacante.url, completados: [], pendientes: [], preguntas: [], cambiosCV: [],
      requiereCuenta: true,
      nota: "Para postular necesitas una cuenta. Créala en la web y vuelve aquí.",
    };
  }

  const tabId = await pestanaDeTrabajo();
  const reporte = { url: vacante.url, completados: [], pendientes: [], preguntas: [], cambiosCV: [] };

  // Bumeran e Indeed aportan vacantes pero no se postula desde aquí:
  // se abre la oferta para que la persona la complete en el portal.
  if (vacante.postulable === false) {
    await chrome.tabs.create({ url: vacante.url, active: true });
    return {
      ...reporte,
      soloLectura: true,
      nota: `${vacante.portal} no permite postular desde la extensión todavía. `
          + "Te abrimos la oferta para que postules ahí.",
    };
  }

  // Detalle de la oferta: sin la descripción, adaptar el CV no tiene con qué.
  if (!vacante.descripcion) {
    try {
      const d = await irY(tabId, vacante.url, "detalle");
      if (d?.descripcion) Object.assign(vacante, d);
    } catch {
      // se sigue sin la descripción
    }
  } else {
    await irY(tabId, vacante.url, "ping");
  }

  // Habilidades que la oferta pide y el CV no menciona. Se preguntan a la
  // persona ANTES de adaptar: si dice que sí, entran al .docx; si no
  // contesta, no entra nada. Nunca las decide el modelo.
  reporte.huecos = huecos.detectar(vacante, perfil);
  const confirmadas = huecos.aCompetencias(reporte.huecos, respuestasPersona?.habilidades || {});

  // Resumen del CV reenfocado a esta vacante.
  let resumenAdaptado = null;
  if (await ia.disponible()) {
    try {
      const ad = await ia.adaptarAVacante(perfil, vacante);
      if (ad?.resumen?.length) {
        resumenAdaptado = ad.resumen;
        perfil = { ...perfil, perfil: ad.resumen };
        reporte.cambiosCV = ad.cambios || [];
      }
    } catch {
      // el CV base sirve igual
    }
  }

  const abierto = await hablarCon(tabId, { accion: "abrirFormulario" });
  if (abierto?.requiereLogin) return { ...reporte, requiereLogin: true, nota: abierto.nota };
  if (abierto?.captcha) return { ...reporte, captcha: true, nota: abierto.nota };
  if (abierto?.error) return { ...reporte, error: abierto.error };

  // El .docx adaptado, adjuntado de verdad al formulario.
  //
  // Va DESPUÉS de abrir el formulario porque el campo de archivo no
  // existe hasta entonces, y antes de rellenar para que si el portal
  // autocompleta algo al recibir el CV, lo de después mande.
  reporte.cv = await adjuntarCVAdaptado(tabId, perfil, vacante, resumenAdaptado, confirmadas);

  const patrones = datos.CAMPOS.map((c) => ({
    clave: c.clave, etiqueta: c.etiqueta, patron: c.patron.source,
  }));
  const relleno = await hablarCon(tabId, {
    accion: "rellenar", perfil, guardados, patrones,
  });
  reporte.completados = relleno?.completados || [];
  reporte.pendientes = relleno?.pendientes || [];

  const { preguntas } = await hablarCon(tabId, { accion: "preguntas" });
  // Cada pregunta con su posición. Computrabajo ya la traía; LinkedIn,
  // Indeed y Bumeran no, y el panel —que guarda las respuestas por
  // posición— las metía todas bajo la clave «undefined», pisándose.
  const leidas = (preguntas || []).map((p, i) => ({ ...p, indice: p.indice ?? i }));
  reporte.preguntas = await respuestas.redactar(leidas, perfil, guardados, respuestasPersona || {});

  // Lo redactado se ESCRIBE ya en el formulario del portal.
  //
  // Antes solo se escribía al pulsar «Enviar» en el panel, así que quien
  // miraba el formulario después de preparar —y en una prueba, lo prudente
  // es NO enviar— lo encontraba vacío y concluía que no autocompletaba.
  // Escribir no envía nada: la persona sigue revisando y dando el clic.
  // Lo que falta (consentimientos, disponibilidad, datos que no están en
  // el CV) se queda vacío hasta que ella lo conteste.
  const redactadas = {};
  for (const q of reporte.preguntas) if (q.texto) redactadas[q.indice] = q.texto;
  reporte.escritas = 0;
  if (Object.keys(redactadas).length) {
    try {
      const r = await hablarCon(tabId, { accion: "escribir", respuestas: redactadas });
      reporte.escritas = Array.isArray(r?.escritas) ? r.escritas.length : Number(r?.escritas) || 0;
    } catch { /* se escriben igual al enviar */ }
  }
  reporte.listoParaEnviar = true;
  return reporte;
}

async function escribirYEnviar(respuestasAprobadas) {
  const tabId = await pestanaDeTrabajo();
  if (respuestasAprobadas && Object.keys(respuestasAprobadas).length) {
    await hablarCon(tabId, { accion: "escribir", respuestas: respuestasAprobadas });
    await esperar(400);
  }
  return hablarCon(tabId, { accion: "enviar" });
}

// ---------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------

export const CONSENTIMIENTO = [
  { clave: "irreversible", texto: "Entiendo que una postulación enviada NO se puede deshacer." },
  { clave: "sinRevisar", texto: "Entiendo que no voy a revisar cada postulación antes de que se envíe." },
  { clave: "respuestasIA", texto: "Entiendo que las respuestas las redacta una IA desde mi CV y pueden tener errores." },
  { clave: "responsable", texto: "Asumo que soy responsable del contenido que se envíe en mi nombre." },
];

const consentimientoCompleto = (a) => CONSENTIMIENTO.every((c) => a?.[c.clave] === true);

async function correrLote({ vacantes, modo, aprobacion, respuestasPersona }) {
  if (modo === "automatico" && !consentimientoCompleto(aprobacion)) {
    lote = { ...lote, fase: "terminado", mensaje: "Falta marcar las casillas de riesgo. No se envió nada." };
    return;
  }

  const perfil = await almacen.perfil.obtener();
  const guardados = await almacen.datosPersonales.obtener();
  const cola = vacantes.slice(0, TOPE_POR_TANDA);

  lote = {
    fase: "preparando", modo, total: cola.length, hechas: 0, cancelado: false,
    mensaje: `Preparando ${cola.length} vacante(s)…`,
    items: cola.map((v) => ({ ...v, estado: "pendiente", motivo: "", preguntas: [], cambiosCV: [] })),
  };

  for (let i = 0; i < cola.length; i++) {
    if (lote.cancelado) break;
    const item = lote.items[i];
    try {
      const r = await prepararUna(cola[i], perfil, guardados, respuestasPersona);
      Object.assign(item, { preguntas: r.preguntas || [], cambiosCV: r.cambiosCV || [] });

      if (r.requiereLogin) { item.estado = "omitida"; item.motivo = "Necesitas iniciar sesión."; }
      else if (r.captcha)  { item.estado = "omitida"; item.motivo = "Apareció un CAPTCHA."; }
      else if (r.error)    { item.estado = "omitida"; item.motivo = r.error; }
      else {
        // Nunca aceptar condiciones por la persona, ni en automático.
        const pendiente = respuestas.consentimientoPendiente(item.preguntas);
        if (pendiente) {
          item.estado = "omitida";
          item.motivo = `Pide aceptar una condición que no aprobaste: «${pendiente.slice(0, 100)}». Revísala tú.`;
        } else {
          item.estado = "preparada";
          const sinResponder = item.preguntas.filter((q) => !q.texto).length;
          item.motivo = sinResponder ? `${sinResponder} pregunta(s) sin responder.` : "";
        }
      }
    } catch (e) {
      item.estado = "fallida";
      item.motivo = e.message;

      // Quedarse sin cuota de IA no es «esta vacante fallo»: es que se
      // acabo el combustible y las que quedan van a fallar igual.
      //
      // Con el tope en cien y la capa gratuita en 40 llamadas cada 24 h,
      // seguir el bucle pinta ochenta tarjetas rojas identicas y entierra
      // las que SI salieron. Se para en seco y se dice el numero exacto,
      // que es lo unico accionable: cuantas entraron y cuando se renueva.
      if (SIN_CUOTA.test(e.message || "")) {
        const hechas = lote.items.filter((x) => x.estado === "enviada").length;
        const listas = lote.items.filter((x) => x.estado === "preparada").length;
        lote.cancelado = true;
        lote.mensaje = `Se acabo la cuota de IA. ${hechas} enviada(s) y ${listas} lista(s) `
          + `de ${cola.length}. Las demas quedaron sin preparar: vuelve cuando se renueve, `
          + `o pon tu propia clave en Mi perfil.`;
        item.motivo = "Se acabo la cuota de IA antes de llegar aqui.";
        break;
      }
    }

    // El candado de LinkedIn.
    //
    // Su §8.2 prohíbe la automatización y desde finales de 2025
    // restringen cuentas por ello. Lo que se arriesga es el perfil de la
    // persona —su vida laboral entera—, no el nuestro. Así que en modo
    // automático LinkedIn se prepara y se PARA: queda relleno en su
    // pantalla y el envío lo da ella.
    //
    // Va aquí, en el orquestador, además de en el content script: dos
    // cierres en sitios distintos, porque a este si alguien lo quita
    // tiene que quitarlo a propósito y no de pasada.
    const soloRevisado = Boolean(PORTALES[item.portalId]?.soloRevisado)
      || /linkedin/i.test(item.portal || "");

    if (modo === "automatico" && soloRevisado && item.estado === "preparada") {
      item.estado = "omitida";
      item.motivo = "LinkedIn no permite enviar automáticamente: queda lista para que la envíes tú.";
    } else if (modo === "automatico") {
      if (item.estado === "preparada") {
        const aprobadas = {};
        item.preguntas.forEach((q) => { if (q.texto) aprobadas[q.indice] = q.texto; });
        try {
          const env = await escribirYEnviar(aprobadas);
          item.estado = env?.enviada ? "enviada" : "fallida";
          item.motivo = env?.mensaje || env?.error || "";
        } catch (e) {
          item.estado = "fallida";
          item.motivo = e.message;
        }
      }
      // Se anota TODO: en automático el tracker es el único registro.
      await almacen.tracker.anotar({
        portal: item.portal, empresa: item.empresa, puesto: item.titulo,
        url: item.url, estado: item.estado, motivo: item.motivo,
      });
      // Y la cuenta anónima, que es lo único que nos llega a nosotros.
      // El motivo importa tanto como el resultado: saber que se omiten
      // por «pide aceptar una condición» y no por un fallo es lo que
      // dice qué hay que arreglar.
      medir(item.estado === "enviada" ? "postulacion_enviada" : "postulacion_omitida",
            { portal: item.portal, motivo: item.motivo || item.estado });
    }

    lote.hechas = i + 1;
    await esperar(PAUSA_ENTRE_VACANTES);
  }

  const cuenta = (e) => lote.items.filter((i) => i.estado === e).length;
  lote.fase = modo === "automatico" ? "terminado" : "listo";
  lote.mensaje = modo === "automatico"
    ? `Enviadas ${cuenta("enviada")} de ${lote.total}. Omitidas ${cuenta("omitida")}.`
    : `${cuenta("preparada")} de ${lote.total} listas para revisar. Nada se ha enviado.`;
}

async function enviarAprobadas(ids) {
  const perfil = await almacen.perfil.obtener();
  const guardados = await almacen.datosPersonales.obtener();
  const seleccion = lote.items.filter((i) => ids.includes(i.id) && i.estado === "preparada");

  lote.fase = "enviando";
  lote.total = seleccion.length;
  lote.hechas = 0;
  lote.mensaje = `Enviando ${seleccion.length}…`;

  for (let n = 0; n < seleccion.length; n++) {
    if (lote.cancelado) break;
    const item = seleccion[n];
    try {
      // Se reabre el formulario: entre preparar y revisar, la pestaña ya
      // navegó a otra oferta.
      await prepararUna(item, perfil, guardados, {});
      const aprobadas = {};
      item.preguntas.forEach((q) => { if (q.texto) aprobadas[q.indice] = q.texto; });
      const env = await escribirYEnviar(aprobadas);
      item.estado = env?.enviada ? "enviada" : "fallida";
      item.motivo = env?.mensaje || env?.error || "";
    } catch (e) {
      item.estado = "fallida";
      item.motivo = e.message;
    }
    await almacen.tracker.anotar({
      portal: item.portal, empresa: item.empresa, puesto: item.titulo,
      url: item.url, estado: item.estado, motivo: item.motivo,
    });
    medir(item.estado === "enviada" ? "postulacion_enviada" : "postulacion_omitida",
          { portal: item.portal, motivo: item.motivo || item.estado });
    lote.hechas = n + 1;
    await esperar(PAUSA_ENTRE_VACANTES);
  }

  lote.fase = "terminado";
  lote.mensaje = `Enviadas ${seleccion.length ? seleccion.filter((i) => i.estado === "enviada").length : 0} de ${seleccion.length}.`;
}

// ---------------------------------------------------------------------
// Mensajes del popup
// ---------------------------------------------------------------------

/**
 * Espera a que la persona termine de iniciar sesión en un portal.
 *
 * Antes el panel miraba a los 12 segundos y punto. Iniciar sesión en
 * Computrabajo con verificación por correo lleva más que eso, así que lo
 * normal era volver al panel y ver «sin conectar» después de haber
 * entrado — y a partir de ahí la persona ya no sabe si el producto está
 * roto o es ella.
 *
 * Esto mira cada vez que esa pestaña termina de cargar, hasta cinco
 * minutos, y avisa al panel en cuanto la sesión aparece. No navega ni
 * toca nada: solo pregunta al content script que ya está ahí.
 */
function vigilarAcceso(tabId, portalId) {
  const hasta = Date.now() + 5 * 60 * 1000;

  const alCargar = async (idCargada, info) => {
    if (idCargada !== tabId || info.status !== "complete") return;
    if (Date.now() > hasta) return parar();
    try {
      const r = await hablarCon(tabId, { accion: "sesion" });
      if (r?.sesion) {
        parar();
        // El panel puede estar cerrado; si nadie escucha, no pasa nada.
        chrome.runtime.sendMessage({ aviso: "sesionPortal", portal: portalId })
          .catch(() => {});
      }
    } catch { /* aún sin content script en esa pestaña */ }
  };

  const alCerrar = (idCerrada) => { if (idCerrada === tabId) parar(); };

  function parar() {
    chrome.tabs.onUpdated.removeListener(alCargar);
    chrome.tabs.onRemoved.removeListener(alCerrar);
  }

  chrome.tabs.onUpdated.addListener(alCargar);
  chrome.tabs.onRemoved.addListener(alCerrar);
  setTimeout(parar, 5 * 60 * 1000);
}

chrome.runtime.onMessage.addListener((msg, _e, responder) => {
  (async () => {
    try {
      switch (msg.accion) {
        case "buscar":
          return responder(await buscar(msg));
        case "prepararUna": {
          const perfil = await almacen.perfil.obtener();
          const guardados = await almacen.datosPersonales.obtener();
          const t0 = Date.now();
          const listo = await prepararUna(msg.vacante, perfil, guardados, msg.respuestasPersona);
          // Antes solo se anotaba `ok` = «se adjuntó el CV». En LinkedIn el
          // CV sale siempre del perfil, así que un intento que fallaba
          // en el primer paso y uno que iba bien se veían iguales, y sin
          // motivo no había forma de saber qué pasó. Ahora dice si salió,
          // por qué no, cuántas preguntas había y cuántas se escribieron.
          const fallo = listo?.requiereCuenta ? "sin_cuenta"
            : listo?.requiereLogin ? "sin_sesion_portal"
            : listo?.captcha ? "captcha"
            : listo?.soloLectura ? "solo_lectura"
            : listo?.error ? String(listo.error).slice(0, 60) : "";
          medir("postulacion_preparada", {
            portal: msg.vacante?.portalId || msg.vacante?.portal,
            ok: !fallo,
            motivo: fallo || undefined,
            con: listo?.cv?.adjuntado ? "cv_adaptado" : "cv_del_portal",
            cuantas: (listo?.preguntas || []).length,
            respondidas: listo?.escritas || 0,
            segundos: Math.round((Date.now() - t0) / 1000),
          });
          return responder(listo);
        }
        case "enviarUna": {
          const r = await escribirYEnviar(msg.respuestas);
          await almacen.tracker.anotar({
            portal: msg.vacante?.portal, empresa: msg.vacante?.empresa,
            puesto: msg.vacante?.titulo, url: msg.vacante?.url,
            estado: r?.enviada ? "enviada" : "fallida", motivo: r?.mensaje || r?.error || "",
          });
          return responder(r);
        }
        case "lotePreparar":
          correrLote(msg);                       // no se espera: el popup consulta el estado
          return responder({ iniciado: true, total: Math.min(msg.vacantes.length, TOPE_POR_TANDA) });
        case "loteEstado":
          return responder(lote);
        case "loteEnviar":
          enviarAprobadas(msg.ids);
          return responder({ iniciado: true });
        case "loteCancelar":
          lote.cancelado = true;
          lote.mensaje = "Cancelado. No se enviarán más.";
          return responder({ cancelado: true });
        case "consentimiento":
          return responder({ casillas: CONSENTIMIENTO, tope: TOPE_POR_TANDA });
        case "sesionPortales": {
          // Estado de los cuatro portales, en paralelo. Se consulta en
          // las pestañas ya abiertas: no se navega a ningún sitio para
          // no interrumpir lo que la persona esté haciendo.
          const estados = await Promise.all(
            Object.values(PORTALES).map(async (p) => {
              const patron = `${p.base.replace(/^https:\/\/(www\.)?/, "https://*.")}/*`;
              try {
                const tabs = await chrome.tabs.query({ url: [patron, `${p.base}/*`] });
                for (const t of tabs) {
                  try {
                    const r = await hablarCon(t.id, { accion: "sesion" });
                    if (r) return { id: p.id, nombre: p.nombre, postulable: p.postulable,
                                    acceso: p.acceso, sesion: Boolean(r.sesion), abierto: true };
                  } catch { /* esa pestaña no tiene content script */ }
                }
              } catch { /* patrón inválido */ }
              return { id: p.id, nombre: p.nombre, postulable: p.postulable,
                       acceso: p.acceso, sesion: null, abierto: false };
            }),
          );
          return responder({ portales: estados });
        }
        // La sesión que la persona creó en la web, traída por el puente.
        //
        // Se guarda solo si aqui no habia ninguna, o si la de la web es
        // de otra persona. Si ya hay sesión propia y es la misma, no se
        // toca: pisar un token bueno por otro igual solo sirve para
        // invalidar el que estaba en uso.
        case "sesionDeLaWeb": {
          const traida = msg.sesion;
          if (!traida?.token) return responder({ guardada: false });
          const actual = await sesion.obtener();
          const mismaPersona = actual?.usuario?.id
            && actual.usuario.id === traida.usuario?.id;
          if (actual?.token && mismaPersona) return responder({ guardada: false, yaEstaba: true });
          await sesion.guardar(traida);
          return responder({ guardada: true, correo: traida.usuario?.correo });
        }

        case "abrirAcceso": {
          const p = PORTALES[msg.portal];
          if (!p) return responder({ error: "Portal desconocido." });
          const nueva = await chrome.tabs.create({ url: p.acceso || p.base, active: true });
          vigilarAcceso(nueva.id, msg.portal);
          return responder({ ok: true, tabId: nueva.id });
        }
        case "abrirComputrabajo": {
          const t = await pestanaDeTrabajo();
          await chrome.tabs.update(t, { url: "https://candidato.pe.computrabajo.com/acceso/", active: true });
          return responder({ ok: true });
        }
        default:
          return responder({ error: `Acción desconocida: ${msg.accion}` });
      }
    } catch (e) {
      responder({ error: e.message });
    }
  })();
  return true;
});


// ---------------------------------------------------------------------
// El icono de la extensión abre el panel en su propia pestaña.
// Si ya está abierto, se trae al frente en vez de duplicarlo.
// ---------------------------------------------------------------------
const URL_PANEL = chrome.runtime.getURL("panel/panel.html");

chrome.action.onClicked.addListener(async () => {
  const abiertas = await chrome.tabs.query({ url: URL_PANEL });
  if (abiertas.length) {
    await chrome.tabs.update(abiertas[0].id, { active: true });
    await chrome.windows.update(abiertas[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: URL_PANEL });
  }
});

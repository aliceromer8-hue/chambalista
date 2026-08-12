// Service worker: coordina las pestañas y guarda el estado del lote.
//
// El content script sabe leer y rellenar una página; aquí se decide a qué
// páginas ir y en qué orden. El popup solo pinta.

import { PORTALES, terminoBusqueda } from "./lib/portales.js";
import * as almacen from "./lib/almacen.js";
import * as datos from "./lib/datos.js";
import * as respuestas from "./lib/respuestas.js";
import * as ia from "./lib/ia.js";

const TOPE_POR_TANDA = 15;
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
      const r = await chrome.tabs.sendMessage(tabId, { accion: "ping" });
      if (r?.ok) return true;
    } catch {
      // el content script aún no cargó
    }
    await esperar(400);
  }
  return false;
}

async function irY(tabId, url, accion, extra = {}) {
  await chrome.tabs.update(tabId, { url });
  await esperar(1200);
  if (!(await pestanaLista(tabId))) throw new Error("La página no terminó de cargar.");
  return chrome.tabs.sendMessage(tabId, { accion, ...extra });
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
    // Por ahora solo Computrabajo tiene content script; los otros se
    // añadirán con sus propios selectores.
    if (pid !== "computrabajo") {
      errores.push({ portal: portal.nombre, error: "Aún no conectado en la extensión." });
      continue;
    }
    try {
      for (let pagina = 1; pagina <= 2; pagina++) {
        const r = await irY(tabId, portal.url(termino, ciudad, pagina), "ofertas");
        if (r?.sesion === false) {
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
    } catch (e) {
      errores.push({ portal: portal.nombre, error: e.message });
    }
  }
  return { vacantes, errores, termino };
}

// ---------------------------------------------------------------------
// Preparar una postulación
// ---------------------------------------------------------------------

async function prepararUna(vacante, perfil, guardados, respuestasPersona) {
  const tabId = await pestanaDeTrabajo();
  const reporte = { url: vacante.url, completados: [], pendientes: [], preguntas: [], cambiosCV: [] };

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

  // Resumen del CV reenfocado a esta vacante.
  if (await ia.disponible()) {
    try {
      const ad = await ia.adaptarAVacante(perfil, vacante);
      if (ad?.resumen?.length) {
        perfil = { ...perfil, perfil: ad.resumen };
        reporte.cambiosCV = ad.cambios || [];
      }
    } catch {
      // el CV base sirve igual
    }
  }

  const abierto = await chrome.tabs.sendMessage(tabId, { accion: "abrirFormulario" });
  if (abierto?.requiereLogin) return { ...reporte, requiereLogin: true, nota: abierto.nota };
  if (abierto?.captcha) return { ...reporte, captcha: true, nota: abierto.nota };
  if (abierto?.error) return { ...reporte, error: abierto.error };

  const patrones = datos.CAMPOS.map((c) => ({
    clave: c.clave, etiqueta: c.etiqueta, patron: c.patron.source,
  }));
  const relleno = await chrome.tabs.sendMessage(tabId, {
    accion: "rellenar", perfil, guardados, patrones,
  });
  reporte.completados = relleno?.completados || [];
  reporte.pendientes = relleno?.pendientes || [];

  const { preguntas } = await chrome.tabs.sendMessage(tabId, { accion: "preguntas" });
  reporte.preguntas = await respuestas.redactar(preguntas || [], perfil, guardados, respuestasPersona || {});
  reporte.listoParaEnviar = true;
  return reporte;
}

async function escribirYEnviar(respuestasAprobadas) {
  const tabId = await pestanaDeTrabajo();
  if (respuestasAprobadas && Object.keys(respuestasAprobadas).length) {
    await chrome.tabs.sendMessage(tabId, { accion: "escribir", respuestas: respuestasAprobadas });
    await esperar(400);
  }
  return chrome.tabs.sendMessage(tabId, { accion: "enviar" });
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
    }

    if (modo === "automatico") {
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
    lote.hechas = n + 1;
    await esperar(PAUSA_ENTRE_VACANTES);
  }

  lote.fase = "terminado";
  lote.mensaje = `Enviadas ${seleccion.length ? seleccion.filter((i) => i.estado === "enviada").length : 0} de ${seleccion.length}.`;
}

// ---------------------------------------------------------------------
// Mensajes del popup
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _e, responder) => {
  (async () => {
    try {
      switch (msg.accion) {
        case "buscar":
          return responder(await buscar(msg));
        case "prepararUna": {
          const perfil = await almacen.perfil.obtener();
          const guardados = await almacen.datosPersonales.obtener();
          return responder(await prepararUna(msg.vacante, perfil, guardados, msg.respuestasPersona));
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

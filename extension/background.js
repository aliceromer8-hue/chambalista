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
import { TOPE_DIARIO, LIMITES_PORTAL } from "./lib/verificados.js";
import * as distritos from "./lib/distritos.js";
import { sincronizar } from "./lib/sincro.js";

// Lo que dice el servidor cuando se agota la cuota gratuita de IA.
// Viene de proxy_ia.py: «Llegaste al límite de N usos gratis.»
const SIN_CUOTA = /l[ií]mite de \d+ usos gratis|cuota|quota|429/i;

// 1,5 s y no 2,5: con la postulación ya más corta, la pausa pesaba. No
// se quita del todo: disparar vacantes sin respiro es lo que los portales
// miran para decidir que alguien no es una persona.
const PAUSA_ENTRE_VACANTES = 1500;

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

// Lo que se puede repetir sin consecuencias: leer. Pulsar («abrir»,
// «siguiente», «enviar») NUNCA se repite solo.
const SE_PUEDE_REPETIR = new Set(["ping", "sesion", "ofertas", "detalle", "preguntas"]);
const SE_FUE_LA_PAGINA = /back.forward cache|message channel|port closed|message port|page.*(moved|navigat)/i;

async function hablarCon(tabId, mensaje, intento = 0) {
  try {
    // La directa a propósito: esta es la que puede fallar por falta de
    // content script, y es justo lo que el catch de abajo arregla.
    return await chrome.tabs.sendMessage(tabId, mensaje);
  } catch (e) {
    // La página navegó mientras se le hablaba (Computrabajo: /match/ salta
    // sola a /candidate/kq). Visto en la tanda de Ali del 2026-09-25: tres
    // postulaciones perdidas con «The page keeping the extension port is
    // moved into back/forward cache». Leer otra vez, ya en la página
    // nueva, es seguro.
    if (SE_FUE_LA_PAGINA.test(e.message || "") && SE_PUEDE_REPETIR.has(mensaje.accion) && intento < 3) {
      await esperar(900);
      return hablarCon(tabId, mensaje, intento + 1);
    }
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

// Dónde ve cada portal «tus postulaciones». Solo Computrabajo por ahora:
// es el que esconde la marca en el listado (medido 2026-09-25).
const URL_POSTULADAS = { computrabajo: "https://candidato.pe.computrabajo.com/candidate/match/" };
const clavePuesto = (t, e) => `${t}|${e}`.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/** Las que ya postulaste en ese portal, leídas de su «Mis postulaciones». */
async function postuladasEnPortal(tabId, pid) {
  let url = URL_POSTULADAS[pid];
  const vistas = new Set();
  const leidas = [];
  for (let pag = 0; pag < 3 && url; pag++) {
    const r = await irY(tabId, url, "postuladas").catch(() => null);
    if (!r?.postuladas?.length) break;
    r.postuladas.forEach((x) => vistas.add(clavePuesto(x.titulo, x.empresa)));
    leidas.push(...r.postuladas);
    url = r.siguiente;
  }
  await importarPostuladas(pid, leidas).catch(() => {});
  return vistas;
}

/**
 * Lo que el portal dice que ya postulaste entra en TU historial, aunque
 * no haya pasado por Chamba Lista (o pasara por una versión anterior cuyo
 * historial se quedó en otra carpeta). Solo lo que aún no está.
 */
async function importarPostuladas(pid, leidas) {
  if (!leidas.length) return;
  const lista = await almacen.tracker.listar();
  const ya = new Set(lista.map((r) => clavePuesto(r.puesto, r.empresa)));
  const portal = PORTALES[pid]?.nombre || pid;
  let nuevas = 0;
  for (const x of leidas.slice().reverse()) {
    const k = clavePuesto(x.titulo, x.empresa);
    if (!x.empresa || ya.has(k)) continue;
    ya.add(k);
    await almacen.tracker.anotar({
      portal, puesto: x.titulo, empresa: x.empresa,
      // Sin enlace a la oferta en «Mis postulaciones»: una dirección
      // propia por puesto + empresa, para que la nube la guarde una vez.
      // (En la RUTA, no tras «#»: claveOferta ignora el ancla y todas
      // las importadas habrían compartido clave, pisándose.)
      url: `${URL_POSTULADAS[pid]}postulada/${encodeURIComponent(k)}`,
      estado: "enviada",
      etapa: /finalista/i.test(x.estado) ? "entrevista" : "enviada",
      motivo: [`En ${portal}: ${x.estado || "Postulado"}`, x.cuando].filter(Boolean).join(" · "),
      importada: true,
    });
    nuevas++;
  }
  if (nuevas) sincronizar().catch(() => {});
}

// ---------------------------------------------------------------------
// Tu CV en tu cuenta del portal (Ali, 2026-09-25)
// ---------------------------------------------------------------------
// «Agregar el CV adaptado a la cuenta de la persona». Computrabajo guarda
// varios CV en Word/PDF y adjunta a tus postulaciones el marcado como
// principal. Tres opciones, que elige la persona:
//   portal    mantener el que ya tiene
//   harvard   subir UNA vez el CV de Chamba Lista y dejarlo de principal
//   adaptado  antes de cada postulación, subir uno adaptado a esa vacante
//             y dejarlo de principal (se quita el adaptado anterior, que
//             es nuestro; los suyos no se tocan nunca)
const URL_CV_COMPUTRABAJO = "https://candidato.pe.computrabajo.com/candidate/cv/uploadcv";

async function cvDelPortal(tabId) {
  const r = await irY(tabId, URL_CV_COMPUTRABAJO, "cvArchivos");
  if (!r?.enPagina) throw new Error("No se pudo abrir «Mi currículum» de Computrabajo. ¿Tienes la sesión abierta?");
  return r;
}

/** Sube un CV a Computrabajo y lo deja de principal. Devuelve su id. */
async function ponerCVEnComputrabajo(tabId, pedido, { reemplazarNuestro = false } = {}) {
  let antes = await cvDelPortal(tabId);
  const nuestros = await almacen.leer("cvNuestrosComputrabajo", []);

  // Si está lleno, se hace sitio quitando un CV NUESTRO; los suyos, jamás.
  if (!antes.puedeSubir) {
    const nuestro = antes.archivos.find((a) => nuestros.includes(a.id) && !a.principal)
      || antes.archivos.find((a) => nuestros.includes(a.id));
    if (!nuestro) throw new Error("Tu Computrabajo ya tiene el máximo de CV guardados. Borra uno allí y vuelve a intentarlo.");
    await hablarCon(tabId, { accion: "cvBorrar", id: nuestro.id }).catch(() => null);
    await esperar(1500);
    await pestanaLista(tabId, 15000);
    antes = await cvDelPortal(tabId);
  }

  await hablarCon(tabId, { accion: "cvSubir", nombre: pedido.nombre, base64: pedido.base64 }).catch((e) => {
    if (!SE_FUE_LA_PAGINA.test(e.message || "")) throw e;   // subir recarga la página
  });
  await esperar(2500);
  await pestanaLista(tabId, 20000);
  const despues = await hablarCon(tabId, { accion: "cvArchivos" });
  const idsAntes = new Set(antes.archivos.map((a) => a.id));
  const nuevo = (despues?.archivos || []).find((a) => !idsAntes.has(a.id));
  if (!nuevo) throw new Error("Computrabajo no guardó el CV. Puede que el archivo no le guste; prueba con tu CV del portal.");

  await hablarCon(tabId, { accion: "cvPrincipal", id: nuevo.id }).catch((e) => {
    if (!SE_FUE_LA_PAGINA.test(e.message || "")) throw e;
  });
  await esperar(1500);
  await pestanaLista(tabId, 15000);
  const final = await hablarCon(tabId, { accion: "cvArchivos" });
  if (!final?.archivos?.find((a) => a.id === nuevo.id)?.principal) {
    throw new Error("Se subió el CV pero Computrabajo no lo dejó como principal.");
  }

  // El adaptado anterior (nuestro) sobra: solo se guarda el último.
  if (reemplazarNuestro) {
    for (const viejo of final.archivos.filter((a) => nuestros.includes(a.id) && a.id !== nuevo.id)) {
      await hablarCon(tabId, { accion: "cvBorrar", id: viejo.id }).catch(() => null);
      await esperar(1500);
      await pestanaLista(tabId, 15000);
    }
  }
  const quedan = reemplazarNuestro ? [nuevo.id] : [...nuestros, nuevo.id];
  await almacen.guardar("cvNuestrosComputrabajo", quedan.slice(-10));
  return { id: nuevo.id, nombre: nuevo.nombre };
}

async function buscar({ puesto, ciudad, nivel, portales: elegidos }) {
  const termino = terminoBusqueda(puesto, nivel);
  if (!termino) throw new Error("Escribe qué puesto buscas.");

  const tabId = await pestanaDeTrabajo();
  const vistos = new Set();
  const vacantes = [];
  let ocultasPortal = 0;
  const errores = [];

  // Si escribió un DISTRITO de Lima (lo normal: «Miraflores»), se busca en
  // toda Lima y el panel ordena por cercanía: en tu zona, cerca, lejos.
  // Buscar «en Miraflores» en el portal escondía lo de San Isidro, que
  // está a 25 minutos (Ali, 2026-09-25: «buscar el lugar y también
  // lugares cercanos»).
  const dondeVive = distritos.esDistritoDeLima(ciudad) ? ciudad : "";
  const ciudadPortal = dondeVive ? "Lima" : ciudad;

  for (const pid of elegidos?.length ? elegidos : ["computrabajo"]) {
    const portal = PORTALES[pid];
    if (!portal) continue;
    try {
      const yaEnPortal = await postuladasEnPortal(tabId, pid);
      for (let pagina = 1; pagina <= 2; pagina++) {
        const r = await irY(tabId, portal.url(termino, ciudadPortal, pagina), "ofertas");
        // Solo Computrabajo necesita sesión: los otros listan en público.
        if (portal.postulable && r?.sesion === false) {
          errores.push({ portal: portal.nombre, error: "Necesitas iniciar sesión." });
          break;
        }
        const nuevas = (r?.ofertas || []).filter((v) => {
          const k = `${v.titulo}|${v.empresa}`.toLowerCase();
          if (yaEnPortal.has(clavePuesto(v.titulo, v.empresa))) { ocultasPortal++; return false; }
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
  return { vacantes, errores, termino, ocultasPortal, dondeVive };
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
/** Adjunta al formulario un .docx ya generado. */
async function adjuntarPedido(tabId, pedido) {
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

  let tabId = await pestanaDeTrabajo();
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
  // Lo necesario para rehacer el CV adaptado a ESTA vacante cuando se
  // pida desde Postulaciones. Guardar el Word de cada una llenaría el
  // almacén; los datos para generarlo ocupan poco.
  reporte.competenciasCV = confirmadas;
  reporte.descripcion = (vacante.descripcion || "").slice(0, 1200);

  // EL CV, ANTES DE ABRIR NADA (Ali, 2026-09-25: «en Postulaciones sale
  // lo de adaptado pero recién lo adapta ahí; la idea es que se adapte al
  // momento, antes de postular a cada una, se suba, y se respondan las
  // preguntas en base a ese CV adaptado»).
  //
  //   adaptado  la IA reenfoca tu CV a esta vacante; ESE perfil es el que
  //             responde las preguntas, y el Word se sube donde se puede
  //   harvard   el de Chamba Lista tal cual
  //   portal    el que ya tienes en cada portal
  const modoCV = await modoCVElegido();
  let perfilUsado = perfil;
  let pedidoCV = null;
  if (modoCV === "adaptado") {
    if (lote?.actual) lote.actual.paso = "Adaptando tu CV a esta vacante";
    const listo = await cvAdaptado(perfil, vacante, confirmadas).catch(() => null);
    if (listo?.base) perfilUsado = listo.base;
    reporte.cvResumen = listo?.resumen || null;
    reporte.cambiosCV = listo?.cambios || [];
    if (listo?.pedido && !listo.pedido.error) pedidoCV = listo.pedido;
  } else if (modoCV === "harvard") {
    pedidoCV = await cv.docxAdaptado(perfil, null, {}).catch(() => null);
    if (pedidoCV?.error) pedidoCV = null;
  }
  reporte.modoCV = modoCV;
  // Computrabajo adjunta el CV PRINCIPAL de tu cuenta al postular: con
  // «adaptado», el de esta vacante se sube y se deja de principal antes;
  // con «harvard», se sube la primera vez que se postula ahí.
  if ((vacante.portalId || "") === "computrabajo" && modoCV === "harvard" && pedidoCV
      && !(await almacen.preferencias.obtener()).cvHarvardEnComputrabajo) {
    if (lote?.actual) lote.actual.paso = "Subiendo tu CV de Chamba Lista a Computrabajo";
    try {
      const puesto = await ponerCVEnComputrabajo(tabId, pedidoCV);
      const pr = await almacen.preferencias.obtener();
      await almacen.preferencias.guardar({ ...pr, cvHarvardEnComputrabajo: true });
      reporte.cv = { adjuntado: true, enCuenta: true, archivo: puesto.nombre };
    } catch (e) {
      reporte.cv = { adjuntado: false, nota: `No se pudo poner tu CV en Computrabajo (${e.message}). Va el principal de tu cuenta.` };
    }
    await irY(tabId, vacante.url, "ping").catch(() => null);
  }
  if ((vacante.portalId || "") === "computrabajo" && modoCV === "adaptado" && pedidoCV) {
    if (lote?.actual) lote.actual.paso = "Subiendo tu CV adaptado a Computrabajo";
    try {
      const puesto = await ponerCVEnComputrabajo(tabId, pedidoCV, { reemplazarNuestro: true });
      reporte.cv = { adjuntado: true, enCuenta: true, archivo: puesto.nombre };
    } catch (e) {
      reporte.cv = { adjuntado: false, nota: `No se pudo poner el CV adaptado en Computrabajo (${e.message}). Va el principal de tu cuenta.` };
    }
    await irY(tabId, vacante.url, "ping").catch(() => null);
  }
  // Las pantallas siguientes (LinkedIn, Indeed) responden con el mismo CV.
  await almacen.guardar("perfilTrabajo", perfilUsado);
  if (lote?.actual) lote.actual.paso = "Abriendo la postulación";

  // Dónde estaba la pestaña ANTES de pulsar «Postularme»: si después
  // está en otra página, el formulario está en esa página.
  const urlAntes = (await chrome.tabs.get(tabId).catch(() => null))?.url || "";
  let abierto;
  try {
    abierto = await hablarCon(tabId, { accion: "abrirFormulario" });
  } catch (e) {
    // Pulsar «Postular» a veces NAVEGA (Indeed → SmartApply): la página
    // se va con el mensaje a medias y Chrome contesta «message port
    // closed». No es un fallo: el formulario está en la página nueva.
    if (!/port closed|message channel|back.forward cache/i.test(e.message || "")) throw e;
    abierto = { abierto: false, enOtraPestana: true };
  }
  // El formulario puede haberse abierto en otra pestaña o en otra web.
  // Antes se seguía en la original, que ya no tenía formulario: se leían
  // cero preguntas y no se escribía nada.
  // «Ábrelo tú» (LinkedIn frena que se abra solo): no es un error. Se
  // sigue, y el panel enseña el aviso junto a «Ver el formulario» y
  // «Rellenar esta pantalla», que es la salida.
  if (abierto?.manual) reporte.avisoAbrir = abierto.nota;
  if (abierto && !abierto.abierto && !abierto.error && !abierto.manual) {
    const donde = await buscarFormularioAbierto(tabId, urlAntes);
    if (donde) {
      tabId = donde;
      await almacen.guardar("tabTrabajo", tabId);
      // NO se vuelve a llamar a abrirFormulario. En la página nueva el
      // botón que haya puede ser el de ENVIAR: en Computrabajo, pulsar
      // «Postularme» lleva a candidato.pe.computrabajo.com/match/, y
      // abrirFormulario pulsa «Postularme». Volver a llamarlo ahí sería
      // postular durante la preparación, sin que nadie revisara nada.
      abierto = { abierto: true, trasNavegar: true };
      // ¿El portal postuló solo al entrar? Pasa en ofertas sin preguntas.
      // Si es así se dice tal cual: no hay formulario que rellenar, y
      // fingir que lo hay dejaría a la persona esperando algo que ya pasó.
      const ping = await hablarCon(tabId, { accion: "ping" }).catch(() => null);
      if (ping?.enviada) {
        return { ...reporte, enviadaDirecto: true,
                 nota: `${vacante.portal || "El portal"} envió la postulación al entrar: esta oferta no tenía preguntas.` };
      }
    }
  }
  if (abierto?.yaPostulado) return { ...reporte, yaPostulado: true, error: abierto.error || "Ya habías postulado a esta." };
  if (abierto?.externo) return { ...reporte, externo: true, error: abierto.error || "Se postula en la web de la empresa." };
  if (abierto?.requiereLogin) return { ...reporte, requiereLogin: true, nota: abierto.nota };
  if (abierto?.captcha) return { ...reporte, captcha: true, nota: abierto.nota };
  if (abierto?.error) return { ...reporte, error: abierto.error };

  // La vacante queda a mano para «rellenar esta pantalla» desde el panel.
  await almacen.guardar("vacanteTrabajo", {
    titulo: vacante.titulo, empresa: vacante.empresa, descripcion: vacante.descripcion || "",
  });

  // RÁPIDO: lo que no depende de nada, a la vez.
  //
  // Antes iba todo en fila: adaptar el CV con la IA → abrir → generar el
  // Word en el servidor → adjuntar → rellenar → leer → redactar con la IA
  // → escribir. Y adaptar + Word se hacían SIEMPRE, aunque el formulario
  // no tuviera dónde subir un archivo: la página de preguntas de
  // Computrabajo usa el CV del perfil, así que en cada postulación se
  // tiraban una llamada a la IA y una al servidor. Ali: «es casi igual que
  // los 15 minutos que haría alguien manual».
  //
  // Ahora se mira primero si hay dónde adjuntar. Si no, eso no se hace.
  // Si sí, las dos llamadas a la IA —redactar y adaptar— van en paralelo.
  // Si no se pueden leer, se DICE. Antes un fallo aquí se tragaba como
  // «cero preguntas» y la postulación seguía hacia un envío imposible.
  let leido;
  try {
    leido = await hablarCon(tabId, { accion: "preguntas" });
  } catch (e) {
    return { ...reporte, error: `No se pudo leer el formulario (${e.message}).` };
  }
  const conArchivo = Boolean(leido?.conArchivo);
  if (lote?.actual) lote.actual.paso = "Respondiendo sus preguntas con tu CV";
  // Si el formulario pide archivo y elegiste «el de cada portal», va el
  // de Chamba Lista: un campo de archivo vacío no deja enviar.
  const [redaccion, cvListo] = await Promise.all([
    redactarPantalla(leido?.preguntas || [], perfilUsado, guardados, respuestasPersona, vacante),
    conArchivo && !pedidoCV ? cv.docxAdaptado(perfil, null, {}).then((pedido) => ({ pedido })).catch(() => null)
      : Promise.resolve(pedidoCV ? { pedido: pedidoCV, cambios: reporte.cambiosCV } : null),
  ]);

  // El Word antes que las respuestas: si el portal autocompleta algo al
  // recibirlo, lo que se escriba después es lo que manda.
  if (reporte.cv?.enCuenta) {
    // ya está: se subió a tu cuenta de Computrabajo antes de abrir
  } else if (conArchivo && cvListo?.pedido && !cvListo.pedido.error) {
    reporte.cv = await adjuntarPedido(tabId, cvListo.pedido);
  } else if (conArchivo) {
    reporte.cv = { adjuntado: false,
                   nota: "No se pudo generar el CV adaptado. Se postula con el que ya tienes en el portal." };
  } else {
    reporte.cv = { adjuntado: false,
                   nota: modoCV === "adaptado"
                     ? "Este portal adjunta el CV de tu perfil; las respuestas salen de tu CV adaptado a esta vacante."
                     : "Este formulario usa el CV que ya tienes guardado en el portal." };
  }

  const patrones = datos.CAMPOS.map((c) => ({
    clave: c.clave, etiqueta: c.etiqueta, patron: c.patron.source, flags: c.patron.flags,
  }));
  const relleno = await hablarCon(tabId, {
    accion: "rellenar", perfil, guardados, patrones,
  }).catch(() => ({}));
  reporte.completados = relleno?.completados || [];
  reporte.pendientes = relleno?.pendientes || [];

  reporte.preguntas = redaccion.preguntas;
  reporte.escritas = await escribirRedactadas(tabId, redaccion.preguntas);
  reporte.listoParaEnviar = true;
  return reporte;
}

/**
 * Lee las preguntas de la pantalla que está a la vista, redacta las que
 * se pueden contestar y las ESCRIBE en el formulario.
 *
 * Sirve para la primera pantalla y para las siguientes: LinkedIn e Indeed
 * reparten el formulario en varias, y la persona pasa de una a otra con
 * «Siguiente» en el propio portal. Por eso no se avanza solo: avanzar a
 * ciegas enviaría pantallas que nadie ha mirado.
 */
async function rellenarPantalla(tabId, perfil, guardados, respuestasPersona, contexto) {
  const leido = await hablarCon(tabId, { accion: "preguntas" });
  const { preguntas } = await redactarPantalla(leido?.preguntas || [], perfil, guardados,
                                               respuestasPersona, contexto);
  return { preguntas, escritas: await escribirRedactadas(tabId, preguntas) };
}

/** Redacta sin escribir: para poder hacerlo a la vez que otras cosas. */
async function redactarPantalla(preguntas, perfil, guardados, respuestasPersona, contexto) {
  // Cada pregunta con su posición. Computrabajo ya la traía; LinkedIn,
  // Indeed y Bumeran no, y el panel —que guarda las respuestas por
  // posición— las metía todas bajo la clave «undefined», pisándose.
  const leidas = (preguntas || []).map((p, i) => ({ ...p, indice: p.indice ?? i }));
  // La vacante va con las preguntas: sin ella, «¿por qué te interesa este
  // puesto?» no tenía con qué contestarse.
  return { preguntas: await respuestas.redactar(leidas, perfil, guardados,
                                                respuestasPersona || {}, contexto || {}) };
}

/** Escribe en el formulario lo que ya tiene texto. Devuelve cuántas. */
async function escribirRedactadas(tabId, redactadas) {
  const listas = {};
  for (const q of redactadas || []) if (q.texto) listas[q.indice] = q.texto;
  if (!Object.keys(listas).length) return 0;
  try {
    const r = await hablarCon(tabId, { accion: "escribir", respuestas: listas });
    return Array.isArray(r?.escritas) ? r.escritas.length : Number(r?.escritas) || 0;
  } catch {
    return 0;            // se escriben igual al enviar
  }
}

/** El CV reenfocado a la vacante y su .docx. Solo si hay dónde subirlo. */
async function modoCVElegido() {
  const prefs = await almacen.preferencias.obtener();
  return prefs.cvModo || prefs.cvPortal?.computrabajo || "portal";
}

async function cvAdaptado(perfil, vacante, confirmadas) {
  let resumen = null, cambios = [], base = perfil;
  try {
    const ad = await ia.adaptarAVacante(perfil, vacante);
    if (ad?.resumen?.length) {
      resumen = ad.resumen;
      base = { ...perfil, perfil: ad.resumen };
      cambios = ad.cambios || [];
    }
  } catch { /* el CV base sirve igual */ }
  const pedido = await cv.docxAdaptado(base, vacante, { resumen, competenciasExtra: confirmadas })
    .catch((e) => ({ error: e.message }));
  return { pedido, cambios, resumen, base };
}

/**
 * Dónde quedó el formulario después de pulsar «Postular».
 *
 * Indeed manda a SmartApply, en otra web: a veces en la misma pestaña,
 * a veces en una nueva. Se mira primero la misma, luego las nuevas.
 */
async function buscarFormularioAbierto(tabIdOriginal, urlAntes = "") {
  await esperar(1500);
  const misma = await chrome.tabs.get(tabIdOriginal).catch(() => null);
  // La misma pestaña, ahora en OTRA página: Indeed → SmartApply,
  // Computrabajo → candidato.pe.computrabajo.com/match/. Antes solo se
  // reconocía SmartApply, y en Computrabajo se seguía hablándole a una
  // página que se estaba cargando: error, y ni siquiera quedaba anotado.
  const sinAncla = (u) => String(u || "").split("#")[0];
  if (misma && sinAncla(misma.url) !== sinAncla(urlAntes)) {
    // Computrabajo encadena redirecciones (/match/ → /candidate/kq). Se
    // espera a que la dirección deje de cambiar y la página termine: si
    // no, se leen preguntas en la página intermedia y se pierden.
    //
    // /match/ NO es el destino: es una página de paso que se queda un rato
    // y luego salta sola. Con «dos lecturas iguales» bastaba que tardara
    // un segundo para leer ahí las preguntas —cero— y que la página se
    // fuera a media conversación. Era la tanda de Ali del 2026-09-25: en
    // Computrabajo, 0 preguntas leídas y ninguna enviada.
    const DE_PASO = /computrabajo\.com\/match|\/applybyapplyablejobid/i;
    let anterior = "", estable = 0;
    for (let i = 0; i < 50 && estable < 3; i++) {
      await esperar(500);
      const t = await chrome.tabs.get(tabIdOriginal).catch(() => null);
      if (!t) return null;
      estable = (t.url === anterior && t.status === "complete" && !DE_PASO.test(t.url)) ? estable + 1 : 0;
      anterior = t.url;
    }
    await pestanaLista(tabIdOriginal, 15000);
    return tabIdOriginal;
  }
  const nuevas = await chrome.tabs.query({ url: ["https://smartapply.indeed.com/*"] });
  const ultima = nuevas.sort((a, b) => b.id - a.id)[0];
  if (ultima && await pestanaLista(ultima.id, 12000)) return ultima.id;
  return null;
}

async function escribirYEnviar(respuestasAprobadas) {
  const tabId = await pestanaDeTrabajo();
  if (respuestasAprobadas && Object.keys(respuestasAprobadas).length) {
    await hablarCon(tabId, { accion: "escribir", respuestas: respuestasAprobadas });
    await esperar(400);
  }
  // Formularios de varias pantallas (LinkedIn, Indeed): cada pantalla
  // nueva se rellena ANTES de avanzar. Si alguna pide algo que no se sabe
  // contestar, el portal no deja avanzar y se para ahí con su mensaje:
  // nunca se envía un formulario a medias.
  const perfil = await almacen.perfil.obtener();
  const guardados = await almacen.datosPersonales.obtener();
  for (let paso = 0; paso < 8; paso++) {
    const s = await hablarCon(tabId, { accion: "siguiente" }).catch(() => null);
    if (s?.errores?.length) {
      return { enviada: false, error: `El portal pide completar: ${s.errores.slice(0, 3).join(" · ")}` };
    }
    if (!s?.avanzado) break;
    await rellenarPantalla(tabId, (await almacen.leer("perfilTrabajo", null)) || perfil, guardados, {},
                           await almacen.leer("vacanteTrabajo", {}));
  }
  try {
    return await hablarCon(tabId, { accion: "enviar" });
  } catch (e) {
    // «Enviar» hizo navegar la página y el mensaje se cortó a medias. En la
    // tanda del 2026-09-25 eso se anotó como fallo y las postulaciones SÍ
    // habían entrado (Computrabajo: Runway 7 y TALENTEA, «Postulado» en
    // Mis postulaciones). Se mira la página nueva antes de decir nada.
    if (!SE_FUE_LA_PAGINA.test(e.message || "")) throw e;
    await esperar(1500);
    await pestanaLista(tabId, 15000);
    const ping = await hablarCon(tabId, { accion: "ping" }).catch(() => null);
    if (ping?.enviada) return { enviada: true, mensaje: "El portal confirmó la postulación." };
    return { enviada: false, dudosa: true,
             error: "La página cambió al enviar y no se pudo confirmar. Mírala en «Mis postulaciones» del portal." };
  }
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

/**
 * Computrabajo, Indeed, LinkedIn, Bumeran, Computrabajo… en vez de diez
 * seguidas del mismo portal: las esperas de uno se solapan con el trabajo
 * en los otros, y ningún portal ve una ráfaga.
 */
/** Si enviar esta vacante pasaría un tope del día, por qué. Si no, null. */
async function topeAlcanzado(vacante) {
  const hoy = await almacen.tracker.enviadasHoy();
  if (hoy.total >= TOPE_DIARIO) return `Llegaste a ${TOPE_DIARIO} hoy, el máximo seguro. Mañana seguimos.`;
  const pid = String(vacante?.portalId || vacante?.portal || "").toLowerCase();
  const dia = LIMITES_PORTAL[pid]?.dia;
  if (dia && (hoy.porPortal[pid] || 0) >= dia) {
    return `Hoy ya van ${dia} en ${vacante.portal || pid}: es lo seguro para tu cuenta. Mañana seguimos.`;
  }
  return null;
}

function alternarPortales(vacantes) {
  const grupos = new Map();
  for (const v of vacantes) {
    const k = v.portalId || v.portal || "";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(v);
  }
  const listas = [...grupos.values()];
  const salida = [];
  for (let i = 0; salida.length < vacantes.length; i++) {
    for (const l of listas) if (l[i]) salida.push(l[i]);
  }
  return salida;
}

async function correrLote({ vacantes, modo, aprobacion, respuestasPersona }) {
  if (modo === "automatico" && !consentimientoCompleto(aprobacion)) {
    lote = { ...lote, fase: "terminado", mensaje: "Falta marcar las casillas de riesgo. No se envió nada." };
    return;
  }

  const perfil = await almacen.perfil.obtener();
  const guardados = await almacen.datosPersonales.obtener();
  const cola = alternarPortales(vacantes).slice(0, TOPE_POR_TANDA);
  const inicio = Date.now();
  // Cuándo se puede volver a postular en cada portal sin parecer ráfaga.
  const libreDesde = {};

  lote = {
    fase: "preparando", modo, total: cola.length, hechas: 0, cancelado: false,
    mensaje: `Preparando ${cola.length} vacante(s)…`,
    items: cola.map((v) => ({ ...v, estado: "pendiente", motivo: "", preguntas: [], cambiosCV: [] })),
  };

  for (let i = 0; i < cola.length; i++) {
    // En pausa se espera aquí, ENTRE vacantes: nunca a media postulación.
    while (lote.pausado && !lote.cancelado) await esperar(400);
    if (lote.cancelado) break;
    const item = lote.items[i];
    const pid = String(item.portalId || item.portal || "").toLowerCase();
    // Lo que el panel enseña «en vivo»: cuál va y qué se le está haciendo.
    lote.actual = { titulo: item.titulo, empresa: item.empresa, portal: item.portal,
                    paso: "Abriendo la oferta y leyendo sus preguntas" };

    // Topes del día: el total y el del portal. Se para ANTES de abrir.
    if (modo === "automatico") {
      const hoy = await almacen.tracker.enviadasHoy();
      const tope = LIMITES_PORTAL[pid]?.dia;
      if (hoy.total >= TOPE_DIARIO) {
        for (const resto of lote.items.slice(i)) {
          resto.estado = "tope";
          resto.motivo = `Llegaste a ${TOPE_DIARIO} hoy, el máximo seguro. Mañana seguimos.`;
        }
        lote.hechas = cola.length;
        break;
      }
      if (tope && (hoy.porPortal[pid] || 0) >= tope) {
        item.estado = "tope";
        item.motivo = `Hoy ya van ${tope} en ${item.portal}: es lo seguro para tu cuenta. Mañana seguimos.`;
        lote.hechas = i + 1;
        continue;
      }
      // Sin ráfagas: si este portal recibió una hace poco, se espera.
      const falta = (libreDesde[pid] || 0) - Date.now();
      if (falta > 0) {
        lote.actual.paso = `Esperando ${Math.ceil(falta / 1000)} s para no ir en ráfaga en ${item.portal}`;
        while (Date.now() < libreDesde[pid] && !lote.cancelado) await esperar(500);
        if (lote.cancelado) break;
        lote.actual.paso = "Abriendo la oferta y leyendo sus preguntas";
      }
    }
    const t0 = Date.now();
    try {
      const r = await prepararUna(cola[i], perfil, guardados, respuestasPersona);
      Object.assign(item, { preguntas: r.preguntas || [], cambiosCV: r.cambiosCV || [],
                            descripcion: r.descripcion || "", competencias: r.competenciasCV || [],
                            cvResumen: r.cvResumen || null, modoCV: r.modoCV || "" });

      // El portal postuló al entrar (ofertas sin preguntas): está ENVIADA.
      // Antes seguía hacia «enviar», no encontraba botón y la marcaba
      // «no se pudo» aunque ya hubiera salido.
      if (r.enviadaDirecto) { item.estado = "enviada"; item.motivo = r.nota || "Enviada."; }
      else if (r.yaPostulado) { item.estado = "ya_postulada"; item.motivo = "Ya habías postulado a esta."; }
      else if (r.externo) { item.estado = "externa"; item.motivo = "Se postula en la web de la empresa."; }
      else if (r.requiereLogin) { item.estado = "omitida"; item.motivo = "Necesitas iniciar sesión."; }
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

    // Hasta 2026-09-24 aquí había un candado: en automático LinkedIn se
    // preparaba y se paraba. Ali decidió que envíe (ver linkedin.js). El
    // único portal que puede seguir parándose es uno marcado
    // `soloRevisado` en portales.js; hoy no hay ninguno.
    const soloRevisado = Boolean(PORTALES[item.portalId]?.soloRevisado);

    if (modo === "automatico" && soloRevisado && item.estado === "preparada") {
      item.estado = "omitida";
      item.motivo = `${item.portal} no envía en automático: queda lista para que la envíes tú.`;
    } else if (modo !== "automatico" && ["ya_postulada", "externa", "enviada"].includes(item.estado)) {
      await almacen.tracker.anotar({
        portal: item.portal, empresa: item.empresa, puesto: item.titulo,
        url: item.url, estado: item.estado, motivo: item.motivo,
        descripcion: item.descripcion || "", competencias: item.competencias || [],
      });
    } else if (modo === "automatico") {
      if (item.estado === "preparada") {
        const aprobadas = {};
        item.preguntas.forEach((q) => { if (q.texto) aprobadas[q.indice] = q.texto; });
        try {
          lote.actual = { ...lote.actual, paso: "Llenando el formulario y enviando" };
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
        descripcion: item.descripcion || "", competencias: item.competencias || [],
        cvResumen: item.cvResumen || null, modoCV: item.modoCV || "", segundos: item.segundos || null,
        sinPago: (item.preguntas || []).some((q) => q.sinPagoAceptado),
      });
      // Y la cuenta anónima, que es lo único que nos llega a nosotros.
      // El motivo importa tanto como el resultado: saber que se omiten
      // por «pide aceptar una condición» y no por un fallo es lo que
      // dice qué hay que arreglar.
      medir(item.estado === "enviada" ? "postulacion_enviada" : "postulacion_omitida",
            { portal: item.portal, motivo: item.motivo || item.estado });
    }

    // Cuánto tardó DE VERDAD (Ali: «quiero saber cuánto tiempo te toma»).
    item.segundos = Math.round((Date.now() - t0) / 1000);
    if (["enviada", "fallida"].includes(item.estado)) {
      const [min, max] = LIMITES_PORTAL[pid]?.espera || [3, 6];
      libreDesde[pid] = Date.now() + (min + Math.random() * (max - min)) * 1000;
    }
    lote.hechas = i + 1;
    await esperar(PAUSA_ENTRE_VACANTES);
  }
  lote.segundos = Math.round((Date.now() - inicio) / 1000);

  const cuenta = (e) => lote.items.filter((i) => i.estado === e).length;
  lote.actual = null;
  sincronizar().catch(() => {});
  lote.fase = modo === "automatico" ? "terminado" : "listo";
  const extra = [
    cuenta("ya_postulada") && (cuenta("ya_postulada") === 1 ? "1 ya la tenías" : `${cuenta("ya_postulada")} ya las tenías`),
    cuenta("externa") && (cuenta("externa") === 1
      ? "1 se postula en la web de la empresa (te la dejamos en Postulaciones)"
      : `${cuenta("externa")} se postulan en la web de la empresa (te las dejamos en Postulaciones)`),
  ].filter(Boolean).join(" · ");
  lote.mensaje = (modo === "automatico"
    ? `Enviadas ${cuenta("enviada")} de ${lote.total}.`
      + (cuenta("omitida") + cuenta("fallida") ? ` Sin enviar: ${cuenta("omitida") + cuenta("fallida")}.` : "")
    : `${cuenta("preparada")} de ${lote.total} listas para revisar. Nada se ha enviado.`)
    + (extra ? ` ${extra}.` : "");
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
    const tope = await topeAlcanzado(item);
    if (tope) { item.estado = "tope"; item.motivo = tope; lote.hechas = n + 1; continue; }
    try {
      // Se reabre el formulario: entre preparar y revisar, la pestaña ya
      // navegó a otra oferta.
      const re = await prepararUna(item, perfil, guardados, {});
      if (re?.enviadaDirecto || re?.yaPostulado) {
        item.estado = "enviada";
        item.motivo = re.nota || re.error || "";
        throw { yaResuelta: true };
      }
      const aprobadas = {};
      item.preguntas.forEach((q) => { if (q.texto) aprobadas[q.indice] = q.texto; });
      const env = await escribirYEnviar(aprobadas);
      item.estado = env?.enviada ? "enviada" : "fallida";
      item.motivo = env?.mensaje || env?.error || "";
    } catch (e) {
      if (!e?.yaResuelta) {
        item.estado = "fallida";
        item.motivo = e.message;
      }
    }
    await almacen.tracker.anotar({
      portal: item.portal, empresa: item.empresa, puesto: item.titulo,
      url: item.url, estado: item.estado, motivo: item.motivo,
      descripcion: item.descripcion || "", competencias: item.competencias || [],
      sinPago: (item.preguntas || []).some((q) => q.sinPagoAceptado),
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
// La pestaña de acceso de un portal, vigilada hasta que haya sesión.
//
// Antes los oyentes se registraban DENTRO de esta función. Chrome duerme
// el proceso de fondo de la extensión a los ~30 s sin actividad, y al
// despertarlo solo vuelve a registrar los oyentes de nivel superior: los
// de aquí se perdían. Quien tardaba más de medio minuto en entrar —con
// verificación por correo, casi todos— no quedaba nunca conectado.
//
// Ahora lo vigilado se guarda en el almacén y el oyente vive arriba, así
// que sobrevive a que Chrome duerma y despierte la extensión.
const ES_ACCESO = /\/(login|acceso|auth|ingresar|registro|signin|signup|uas\/login|checkpoint)/i;

/**
 * Al conectar un portal, de vuelta al panel: ahí está el siguiente.
 * Ali, 2026-09-25: conectaba Bumeran, se quedaba en Bumeran y tenía que
 * volver a buscar el panel para seguir con el siguiente.
 */
async function volverAlPanel() {
  const [panel] = await chrome.tabs.query({ url: URL_PANEL }).catch(() => []);
  if (!panel) return;
  await chrome.tabs.update(panel.id, { active: true }).catch(() => {});
  await chrome.windows.update(panel.windowId, { focused: true }).catch(() => {});
}

async function vigilarAcceso(tabId, portalId) {
  const vigilando = await almacen.leer("vigilando", {});
  vigilando[tabId] = { portal: portalId, hasta: Date.now() + 15 * 60 * 1000 };
  await almacen.guardar("vigilando", vigilando);
}

async function revisarVigilada(tabId) {
  const vigilando = await almacen.leer("vigilando", {});
  const v = vigilando[tabId];
  if (!v) return;
  if (Date.now() > v.hasta) {
    delete vigilando[tabId];
    return almacen.guardar("vigilando", vigilando);
  }
  // Indeed termina el acceso en secure.indeed.com, que no es nuestro: si
  // ya salió de /auth, se entró. Se lleva la pestaña a pe.indeed.com, que
  // sí lo es, y ahí se comprueba.
  const pestana = await chrome.tabs.get(tabId).catch(() => null);
  try {
    const u = new URL(pestana?.url || "");
    if (v.portal === "indeed" && u.hostname === "secure.indeed.com" && !/\/auth/.test(u.pathname)) {
      await chrome.tabs.update(tabId, { url: "https://pe.indeed.com/" });
      return;
    }
  } catch { /* sin dirección todavía */ }
  // Muchos portales pintan la cabecera con sesión un momento DESPUÉS de
  // cargar: se mira ya y se vuelve a mirar al rato.
  for (const espera of [0, 1500, 4000]) {
    if (espera) await esperar(espera);
    try {
      const r = await hablarCon(tabId, { accion: "sesion" });
      if (r?.sesion) {
        const actual = await almacen.leer("vigilando", {});
        delete actual[tabId];
        await almacen.guardar("vigilando", actual);
        const recordadas = await almacen.leer("sesionesRecordadas", {});
        recordadas[v.portal] = Date.now();
        await almacen.guardar("sesionesRecordadas", recordadas);
        chrome.runtime.sendMessage({ aviso: "sesionPortal", portal: v.portal }).catch(() => {});
        // Conectado: la pestaña del portal ya no hace falta (Ali: «una vez
        // que se conecte, cierra la pestaña de esa plataforma»). Es la que
        // abrimos nosotros para entrar; la sesión queda en el navegador.
        await volverAlPanel();
        await esperar(700);
        await chrome.tabs.remove(tabId).catch(() => {});
        return;
      }
    } catch { /* aún sin content script en esa pestaña */ }
  }
}

// Al completar una carga Y al cambiar de dirección sin recargar (muchos
// accesos son de una sola página y no «completan» nada al entrar).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete" || info.url) revisarVigilada(tabId);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const vigilando = await almacen.leer("vigilando", {});
  if (vigilando[tabId]) { delete vigilando[tabId]; await almacen.guardar("vigilando", vigilando); }
});

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
          // Los topes del día también para una sola.
          const tope = await topeAlcanzado(msg.vacante);
          if (tope) return responder({ enviada: false, tope: true, error: tope });
          const t0 = Date.now();
          const r = await escribirYEnviar(msg.respuestas);
          await almacen.tracker.anotar({
            portal: msg.vacante?.portal, empresa: msg.vacante?.empresa,
            puesto: msg.vacante?.titulo, url: msg.vacante?.url,
            estado: r?.enviada ? "enviada" : "fallida", motivo: r?.mensaje || r?.error || "",
            sinPago: Boolean(msg.sinPago),
            descripcion: String(msg.descripcion || "").slice(0, 1200), competencias: msg.competencias || [],
            cvResumen: msg.cvResumen || null, modoCV: msg.modoCV || "",
            segundos: Math.round((Date.now() - t0) / 1000),
          });
          sincronizar().catch(() => {});
          medir(r?.enviada ? "postulacion_enviada" : "postulacion_omitida",
                { portal: msg.vacante?.portalId || msg.vacante?.portal,
                  motivo: r?.enviada ? undefined : String(r?.error || r?.mensaje || "").slice(0, 60) });
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
          lote.pausado = false;
          lote.mensaje = "Cancelado. No se enviarán más.";
          return responder({ cancelado: true });
        case "sincronizar":
          return responder(await sincronizar());
        case "importarComputrabajo": {
          const tab = await pestanaDeTrabajo();
          const antes = (await almacen.tracker.listar()).length;
          await postuladasEnPortal(tab, "computrabajo");
          const despues = (await almacen.tracker.listar()).length;
          return responder({ nuevas: Math.max(0, despues - antes) });
        }
        case "lotePausar":
          lote.pausado = true;
          return responder({ pausado: true });
        case "loteReanudar":
          lote.pausado = false;
          return responder({ pausado: false });

        // Vista previa de una vacante: su ficha, leída en la pestaña de
        // trabajo (en segundo plano) para enseñarla en el panel.
        case "verVacante": {
          // En una pestaña APARTE y en segundo plano, que se cierra al
          // leer: la de trabajo puede estar a media tanda.
          const temporal = await chrome.tabs.create({ url: msg.vacante.url, active: false });
          try {
            await esperar(1200);
            await pestanaLista(temporal.id, 20000);
            const d = await hablarCon(temporal.id, { accion: "detalle" });
            return responder({ detalle: d || null });
          } finally {
            chrome.tabs.remove(temporal.id).catch(() => {});
          }
        }

        // Tu CV en Computrabajo: cuál tienes y qué hacemos con él.
        case "cvPortalEstado": {
          const tab = await pestanaDeTrabajo();
          const r = await cvDelPortal(tab);
          return responder({ principal: r.archivos.find((a) => a.principal)?.nombre || null,
                             cuantos: r.archivos.length });
        }
        case "cvPortalElegir": {
          // Para TODOS los portales. El de Chamba Lista se sube a Computrabajo
          // en la primera postulación de ahí (al elegirlo puede que aún no
          // haya sesión: se elige en el paso 3, antes de conectar portales).
          const prefs = await almacen.preferencias.obtener();
          await almacen.preferencias.guardar({ ...prefs, cvModo: msg.modo, cvHarvardEnComputrabajo: false });
          return responder({ ok: true });
        }
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
                    // null = esa página no lo deja claro: se mira la siguiente.
                    if (r?.sesion === true) return { id: p.id, nombre: p.nombre, postulable: p.postulable,
                                    acceso: p.acceso, sesion: true, abierto: true };
                    // «Sin sesión» solo vale lejos de la página de acceso:
                    // ahí, antes de entrar, es lo normal.
                    if (r?.sesion === false && !ES_ACCESO.test(t.url || "")) {
                      return { id: p.id, nombre: p.nombre, postulable: p.postulable,
                               acceso: p.acceso, sesion: false, abierto: true };
                    }
                  } catch { /* esa pestaña no tiene content script */ }
                }
              } catch { /* patrón inválido */ }
              return { id: p.id, nombre: p.nombre, postulable: p.postulable,
                       acceso: p.acceso, sesion: null, abierto: false };
            }),
          );
          // La sesión se RECUERDA. Antes solo se veía mirando una pestaña
          // abierta del portal: Ali entraba en Bumeran, cerraba la
          // pestaña —lo normal— y el panel se quedaba «Esperando…» para
          // siempre. Ahora, vista una vez, cuenta como conectada hasta que
          // una pestaña de ese portal diga lo contrario.
          const recordadas = await almacen.leer("sesionesRecordadas", {});
          const HOY = Date.now(), CADUCA = 14 * 24 * 3600 * 1000;
          for (const e of estados) {
            if (e.sesion === true) recordadas[e.id] = HOY;
            else if (e.sesion === false) delete recordadas[e.id];
            else if (recordadas[e.id] && HOY - recordadas[e.id] < CADUCA) {
              e.sesion = true;
              e.recordada = true;
            }
          }
          await almacen.guardar("sesionesRecordadas", recordadas);
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

        // Enseñar el formulario. La pestaña de trabajo se crea en segundo
        // plano para no quitarle el panel a la persona, pero entonces
        // nunca veía el formulario rellenado —ni podía revisarlo— y
        // concluía que no se había escrito nada. Si trae respuestas del
        // panel, se escriben antes de enseñarlo.
        case "mostrarFormulario": {
          const id = await almacen.leer("tabTrabajo", null);
          if (!id) return responder({ error: "No hay ningún formulario abierto." });
          if (msg.respuestas && Object.keys(msg.respuestas).length) {
            await hablarCon(id, { accion: "escribir", respuestas: msg.respuestas }).catch(() => null);
          }
          const t = await chrome.tabs.update(id, { active: true }).catch(() => null);
          if (!t) return responder({ error: "La pestaña del formulario se cerró. Vuelve a postular." });
          await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
          return responder({ ok: true });
        }
        // Rellenar la pantalla que está a la vista, para formularios de
        // varias pantallas: la persona pulsa «Siguiente» en el portal y
        // esto rellena la nueva.
        case "rellenarPantalla": {
          const id = await almacen.leer("tabTrabajo", null);
          if (!id) return responder({ error: "No hay ningún formulario abierto." });
          const perfil = await almacen.perfil.obtener();
          const guardados = await almacen.datosPersonales.obtener();
          try {
            return responder(await rellenarPantalla(id, perfil, guardados, msg.respuestasPersona,
                                                    await almacen.leer("vacanteTrabajo", {})));
          } catch (e) {
            return responder({ error: `No se pudo leer esa pantalla: ${e.message}` });
          }
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

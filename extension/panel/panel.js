// Panel de Chamba Lista: se abre en su propia pestaña.
//
// Solo pinta y recoge decisiones. Toda la lógica de buscar, rellenar y
// enviar vive en background.js y en los content scripts.

import { NIVELES, CIUDADES, LISTA_PORTALES } from "../lib/portales.js";
import * as almacen from "../lib/almacen.js";
import * as datos from "../lib/datos.js";
import * as ia from "../lib/ia.js";
import * as coincidencia from "../lib/coincidencia.js";
import * as sesion from "../lib/sesion.js";

const $ = (s) => document.querySelector(s);
const enviar = (msg) => chrome.runtime.sendMessage(msg);
const escapar = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const estado = {
  // ¿Hay sesión de Chamba Lista? Sin ella, el CV adaptado, la IA y la
  // medición devuelven 401 y el panel no podría explicar por qué.
  conCuenta: false,
  perfil: null, vacantes: [], vacanteAbierta: null, reporte: null,
  respuestasPersona: {}, aprobacion: {},
};

// Estado de sesión de cada portal. Se consulta al arrancar y tras pulsar
// «Iniciar sesión»; el resto de la interfaz lo lee de aquí.
let sesionesCache = [];

// Portales en los que la persona acaba de pulsar «Iniciar sesión» y
// todavía no hemos visto la sesión. Sin esto, pulsaba, se iba a la
// pestaña del portal, entraba, volvía al panel y seguía viendo el punto
// rojo un rato — sin saber si el producto estaba roto o ella iba lenta.
// Un «conectando…» que no miente no cuesta nada y quita esa duda.
const conectando = new Set();

/**
 * Consola de actividad: la máquina cuenta lo que va haciendo.
 *
 * No es decoración. Buscar en cuatro portales y preparar una tanda tarda
 * minutos, y sin esto la persona ve una barra avanzar sin saber qué pasa
 * ni por qué tarda. Narrarlo es lo que hace que se entienda que el
 * trabajo lo está haciendo la web y no ella.
 */
const consola = {
  lineas: [],
  escribir(texto, definitiva = false) {
    const c = $("#consola");
    if (!c) return;
    // La última línea se reemplaza mientras la etapa sigue en curso.
    if (!definitiva && this.lineas.length && this.lineas.at(-1).viva) {
      this.lineas.at(-1).texto = texto;
    } else {
      this.lineas.push({ texto, viva: !definitiva });
    }
    if (definitiva && this.lineas.length) this.lineas.at(-1).viva = false;
    this.lineas = this.lineas.slice(-8);
    c.innerHTML = this.lineas.map((l, i) =>
      `<p class="${i < this.lineas.length - 1 ? "apagado" : ""}">` +
      `<span class="marca-linea">›</span><span>${escapar(l.texto)}</span></p>`).join("");
    c.scrollTop = c.scrollHeight;
  },
  limpiar() { this.lineas = []; const c = $("#consola"); if (c) c.innerHTML = ""; },
};

/** Aviso flotante. Antes las acciones se completaban en silencio y no
 *  quedaba claro si habían funcionado. */
function avisar(texto, tipo = "") {
  let cont = document.getElementById("avisos");
  if (!cont) {
    cont = document.createElement("div");
    cont.id = "avisos";
    document.body.appendChild(cont);
  }
  const el = document.createElement("div");
  el.className = `flotante ${tipo}`;
  el.textContent = texto;
  cont.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ---------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------
function irA(vista) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("activa", t.dataset.vista === vista));
  document.querySelectorAll(".vista").forEach((v) => v.classList.toggle("oculto", v.id !== `vista-${vista}`));
  if (vista === "inicio") pintarInicio();
  if (vista === "pipeline") pintarPipeline();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => irA(t.dataset.vista)));
document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => irA(b.dataset.ir)));

// ---------------------------------------------------------------------
// Inicio: kanban de cifras, gráfico y últimos movimientos
// ---------------------------------------------------------------------
async function pintarInicio() {
  const r = await almacen.tracker.resumen();

  pintarPortada(r);

  $("#kanban-resumen").innerHTML = almacen.ETAPAS.map((e) =>
    `<div class="etapa ${e.id}"><b>${r.porEtapa[e.id] || 0}</b><span>${e.nombre}</span></div>`,
  ).join("");

  $("#m-semana").textContent = r.estaSemana;
  $("#m-tasa").textContent = r.tasaRespuesta === null ? "—" : `${r.tasaRespuesta}%`;
  $("#m-entrevistas").textContent = r.entrevistas;
  dibujarGrafico(r.serie);

  const lista = (await almacen.tracker.listar()).slice(0, 6);
  $("#ultimos").innerHTML = lista.length
    ? lista.map((p) => {
        const f = new Date(p.fecha);
        return `<div class="portal-fila"><span class="punto ${p.etapa}"></span>` +
          `<span><strong>${escapar(p.puesto || "—")}</strong>` +
          `<div class="nota">${escapar(p.empresa || "")}</div></span>` +
          `<span class="estado nota">${f.toLocaleDateString("es-PE")}</span></div>`;
      }).join("")
    : `<p class="vacio">Todavía no has postulado a nada.</p>`;

  if (estado.vacantes.length) pintarDestacadas();
}

/**
 * La portada cambia según en qué punto está la persona. El panel entero
 * se comporta como una landing cuando es nueva —una sola cosa que hacer,
 * el resto atenuado— y se convierte en tablero cuando ya está lista.
 *
 * 0. Sin cuenta    → entrar. Es lo primero porque sin sesión el CV
 *                    adaptado, la IA y la medición devuelven 401, y la
 *                    persona lo ve como «no funciona» sin más pista.
 * 1. Sin CV        → titular grande y un único botón: cargar el CV.
 * 2. Con CV        → elegir dónde buscar e iniciar sesión en los portales.
 * 3. Todo listo    → la portada se encoge a una franja y manda el tablero.
 *
 * La etapa 0 faltaba. sesion.js tenía `entrar` y `hayCuenta` desde que se
 * añadieron las cuentas, pero el panel no los llamaba nunca: no había
 * ningún sitio donde iniciar sesión. Todo lo que necesita cuenta fallaba
 * en silencio y el panel seguía enseñando la portada como si nada.
 */
function pintarPortada(resumen) {
  const portada = $("#portada");
  const acciones = $("#portada-acciones");
  const tablero = $("#tablero");
  const conectados = sesionesCache.filter((p) => p.sesion === true);

  const etapa = !estado.conCuenta ? 0 : !estado.perfil ? 1 : !conectados.length ? 2 : 3;

  portada.classList.toggle("compacta", etapa === 3);
  // La promesa solo hace falta mientras no la haya comprobado.
  $("#hace").classList.toggle("oculto", etapa === 3 && resumen.total > 0);
  tablero.classList.toggle("esperando", etapa !== 3);
  $("#arranque").classList.add("oculto");

  if (etapa === 0) {
    $("#portada-titulo").innerHTML = "Un clic.<br>Quince postulaciones.";
    $("#portada-bajada").textContent =
      "Entra con tu cuenta de Chamba Lista para empezar. Es la misma de la web.";
    acciones.innerHTML = `
      <form class="acceso-panel" id="form-acceso" style="width:100%">
        <input type="email" id="acceso-correo" placeholder="tu@correo.com"
               autocomplete="email" required>
        <input type="password" id="acceso-clave" placeholder="tu contraseña"
               autocomplete="current-password" required minlength="8">
        <p class="nota aviso-acceso oculto" id="acceso-error"></p>
        <button class="boton primario" type="submit" id="acceso-enviar">Entrar</button>
        <button class="enlace" type="button" id="acceso-crear">No tengo cuenta todavía</button>
      </form>`;

    $("#acceso-crear").addEventListener("click", () => {
      chrome.tabs.create({ url: sesion.URL_CUENTA, active: true });
      avisar("Crea tu cuenta en la web y vuelve aquí a entrar.");
    });

    $("#form-acceso").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const boton = $("#acceso-enviar");
      const error = $("#acceso-error");
      boton.disabled = true;
      error.classList.add("oculto");
      const r = await sesion.entrar($("#acceso-correo").value.trim(),
                                    $("#acceso-clave").value);
      boton.disabled = false;
      if (r.error) {
        error.textContent = r.error;
        error.classList.remove("oculto");
        return;
      }
      estado.conCuenta = true;
      avisar(`Hola, ${r.usuario?.correo || "de nuevo"}.`);
      await pintarInicio();
    });
    return;
  }

  if (etapa === 1) {
    $("#portada-titulo").innerHTML = "Un clic.<br>Quince postulaciones.";
    $("#portada-bajada").textContent =
      "Sube tu CV una vez. Desde ahí la web busca, llena formularios y contesta las "
      + "preguntas de cada empresa. Tú solo lees y dices que sí.";
    acciones.innerHTML =
      `<button class="boton primario" id="p-cv">Subir mi CV y empezar</button>` +
      `<span class="nota">PDF o Word · listo en unos segundos</span>`;
    $("#p-cv").addEventListener("click", () => { irA("perfil"); $("#archivo-cv").click(); });
    return;
  }

  if (etapa === 2) {
    const nombre = (estado.perfil.nombre || "").split(" ")[0];
    $("#portada-titulo").innerHTML = `Listo${nombre ? `, ${escapar(nombre)}` : ""}.<br>¿Dónde buscamos?`;
    $("#portada-bajada").textContent =
      "Marca dónde quieres que busque. Entras una vez a cada uno y ya no vuelves a hacerlo: "
      + "la sesión queda en tu navegador y nunca vemos tu contraseña.";
    acciones.innerHTML = `<div class="portales-portada" style="width:100%">${
      sesionesCache.map((p) => `
        <div class="portal-tarjeta">
          <span class="marca-punto ${p.sesion ? "si" : conectando.has(p.id) ? "esperando" : "no"}"></span>
          <span>${escapar(p.nombre)}
            <span class="portal-chip" style="margin-left:5px">${p.postulable ? "postula" : "solo busca"}</span>
            ${conectando.has(p.id) && !p.sesion
              ? `<span class="nota conectando">conectando… entra en la pestaña que se abrió</span>` : ""}
          </span>
          <button class="boton chico" data-portada-acceso="${p.id}">
            ${p.sesion ? "Abrir" : conectando.has(p.id) ? "Reintentar" : "Iniciar sesión"}
          </button>
        </div>`).join("")
    }</div>`;
    acciones.querySelectorAll("[data-portada-acceso]").forEach((b) => {
      b.addEventListener("click", async () => {
        const cual = b.dataset.portadaAcceso;
        conectando.add(cual);
        pintarInicio();                       // el punto pasa a ámbar ya
        await enviar({ accion: "abrirAcceso", portal: cual });
        avisar("Inicia sesión en la pestaña que se abrió. Esto se marca solo.");
        // Sin temporizador a ciegas: el fondo vigila esa pestaña y avisa
        // en cuanto la sesión aparece. Mirar a los 12 segundos hacía que
        // quien tarda más —y con verificación por correo se tarda más—
        // volviera al panel y viera «sin conectar» después de haber
        // entrado, sin saber si estaba roto el producto o él.
      });
    });
    return;
  }

  // Etapa 3: ya está todo listo. La portada resume y deja pasar.
  const cuantas = resumen.total;
  const nombreCorto = (estado.perfil?.nombre || "").split(" ")[0];
  $("#portada-titulo").textContent = cuantas
    // «postulación» pierde la tilde en plural: no se puede pegar «es».
    ? `Llevas ${cuantas} ${cuantas === 1 ? "postulación" : "postulaciones"}`
    : `Todo listo${nombreCorto ? `, ${nombreCorto}` : ""}. ¿Qué buscamos hoy?`;
  $("#portada-bajada").textContent = cuantas
    ? `${resumen.entrevistas} en entrevista · ${conectados.length} ${conectados.length === 1 ? "portal conectado" : "portales conectados"}`
    : `${conectados.length} ${conectados.length === 1 ? "portal conectado" : "portales conectados"}. Escribe el puesto que buscas y empezamos.`;
  acciones.innerHTML = `<button class="boton primario" id="p-buscar">Buscar y postular</button>`
    + `<span class="nota">Ponle el puesto y déjala trabajando</span>`;
  $("#p-buscar").addEventListener("click", () => irA("vacantes"));
  $("#sello").innerHTML = `${resumen.porEtapa.enviada || 0}<small>enviadas</small>`;
}

/** Línea de los últimos 14 días. Sin librerías: es un path y punto. */
function dibujarGrafico(serie) {
  const svg = $("#grafico");

  // Sin ninguna postulación, una línea plana pegada al suelo parece un
  // error. Mejor decir que todavía no hay nada que graficar.
  if (!serie.some((v) => v > 0)) {
    svg.innerHTML =
      `<line x1="0" y1="60" x2="300" y2="60" stroke="var(--linea)" ` +
      `stroke-width="1.5" stroke-dasharray="4 5"/>` +
      `<text x="150" y="34" text-anchor="middle" fill="var(--tinta-3)" ` +
      `font-size="12" font-family="system-ui, sans-serif">` +
      `Tus postulaciones aparecerán aquí</text>`;
    return;
  }

  const max = Math.max(1, ...serie);
  const puntos = serie.map((v, i) => [
    (i / (serie.length - 1)) * 300,
    68 - (v / max) * 60,
  ]);
  const linea = puntos.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linea} L300,70 L0,70 Z`;
  const [ux, uy] = puntos[puntos.length - 1];

  svg.innerHTML =
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="var(--acento)" stop-opacity=".3"/>` +
    `<stop offset="100%" stop-color="var(--acento)" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${area}" fill="url(#g)"/>` +
    `<path d="${linea}" fill="none" stroke="var(--acento)" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
    `<circle cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="4.5" fill="var(--acento)"/>`;
}

function pintarDestacadas() {
  const top = coincidencia.ordenar(estado.vacantes, estado.perfil).slice(0, 3);
  $("#destacadas").innerHTML = `<div class="rejilla-vacantes">${top.map(tarjetaVacante).join("")}</div>`;
  conectarTarjetas($("#destacadas"));
}

// ---------------------------------------------------------------------
// Vacantes
// ---------------------------------------------------------------------
function iniciarBuscador() {
  $("#nivel").innerHTML = NIVELES.map((n) => `<option value="${n.id}">${n.nombre}</option>`).join("");
  $("#ciudades").innerHTML = CIUDADES.map((c) => `<option value="${escapar(c)}">`).join("");
  $("#portales").innerHTML = LISTA_PORTALES.map((p) =>
    `<label class="chk-portal"><input type="checkbox" class="chk-p" value="${p.id}" checked>` +
    `<span>${p.nombre}</span>` +
    `<span class="portal-chip">${p.postulable ? "postula" : "solo busca"}</span></label>`,
  ).join("");
}

function tarjetaVacante(v, i) {
  const e = v.encaje || {};
  const clase = e.puntaje === null || e.puntaje === undefined ? "bajo"
    : e.puntaje >= 70 ? "alto" : e.puntaje >= 40 ? "" : "bajo";
  const encaje = e.puntaje == null ? "" : `<span class="encaje ${clase}">${e.puntaje}% encaje</span>`;
  const etiquetas = (e.coincidencias || []).slice(0, 5)
    .map((c) => `<span class="etiqueta">${escapar(c)}</span>`).join("");

  const retardo = Math.min(i || 0, 8) * 45;
  return `<article class="vacante marcada" data-id="${escapar(v.id)}" style="animation-delay:${retardo}ms">
    <div class="arriba">
      <input type="checkbox" class="chk-v" checked>
      <div style="flex:1;min-width:0">
        <h3>${escapar(v.titulo)}</h3>
        <div class="meta">${escapar([v.empresa, v.ubicacion].filter(Boolean).join(" · "))}</div>
        ${v.publicado ? `<div class="meta">${escapar(v.publicado)}</div>` : ""}
      </div>
      ${encaje}
    </div>
    ${etiquetas ? `<div class="etiquetas">${etiquetas}</div>` : ""}
    <div class="pie">
      <span class="portal-chip">${escapar(v.portal)}</span>
      <button class="boton secundario chico btn-abrir" style="margin-left:auto">
        ${v.postulable === false ? "Abrir en el portal" : "Ver y postular"}
      </button>
    </div>
  </article>`;
}

function conectarTarjetas(raiz) {
  raiz.querySelectorAll(".vacante").forEach((el) => {
    const v = estado.vacantes.find((x) => x.id === el.dataset.id);
    el.querySelector(".btn-abrir")?.addEventListener("click", () => abrirVacante(v));
    el.querySelector(".chk-v")?.addEventListener("change", (ev) => {
      el.classList.toggle("marcada", ev.target.checked);
      actualizarCuenta();
    });
  });
}

function actualizarCuenta() {
  const n = $("#lista-vacantes").querySelectorAll(".chk-v:checked").length;
  $("#cuenta-marcadas").textContent = `${n} marcada(s) de ${estado.vacantes.length}`;
  $("#acciones-lote").classList.toggle("oculto", !estado.vacantes.length);
}

// Enter en cualquiera de los campos lanza la búsqueda.
["#puesto", "#ciudad"].forEach((sel) => {
  $(sel).addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-buscar").click(); });
});

$("#btn-buscar").addEventListener("click", async () => {
  const puesto = $("#puesto").value.trim();
  if (!puesto) return;
  const boton = $("#btn-buscar");
  boton.disabled = true;
  boton.textContent = "Buscando…";
  const elegidos = [...document.querySelectorAll(".chk-p:checked")].map((c) => c.value);
  $("#progreso").classList.remove("oculto");
  consola.limpiar();
  consola.escribir(`Buscando «${puesto}»…`, true);
  elegidos.forEach((id) => {
    const p = LISTA_PORTALES.find((x) => x.id === id);
    if (p) consola.escribir(`Entrando a ${p.nombre}…`, true);
  });
  $("#relleno").style.width = "35%";
  $("#resumen-busqueda").textContent = "";
  // Esqueletos: recorrer los portales tarda, y una pantalla en blanco
  // durante 10 segundos se siente como que algo se rompió.
  $("#lista-vacantes").innerHTML = Array.from({ length: 6 },
    () => `<div class="esqueleto"></div>`).join("");

  try {
    const prefs = { puesto, ciudad: $("#ciudad").value.trim(), nivel: $("#nivel").value };
    await almacen.preferencias.guardar({ ...prefs, portales: elegidos });
    const r = await enviar({ accion: "buscar", ...prefs, portales: elegidos });
    if (r?.error) throw new Error(r.error);

    // Se ordenan por encaje con el CV: lo más relevante arriba.
    estado.vacantes = estado.perfil
      ? coincidencia.ordenar(r.vacantes || [], estado.perfil)
      : (r.vacantes || []);

    if (!estado.vacantes.length) {
      $("#lista-vacantes").innerHTML = `<div class="vacio-guiado" style="grid-column:1/-1">
        <span class="emoji">🔍</span>
        <h3>Sin resultados para «${escapar(r.termino)}»</h3>
        <p>Prueba con un término más corto («marketing» en vez de «practicante de marketing digital»),
           quita la ciudad para buscar en todo el país, o revisa que tengas sesión en los portales.</p>
      </div>`;
    } else {
      $("#lista-vacantes").innerHTML = estado.vacantes.map(tarjetaVacante).join("");
      conectarTarjetas($("#lista-vacantes"));
    }
    actualizarCuenta();

    $("#relleno").style.width = "100%";
    consola.escribir(`${estado.vacantes.length} vacantes encontradas.`, true);
    if (estado.perfil) consola.escribir("Ordenadas por lo que encaja con tu CV.", true);
    setTimeout(() => $("#progreso").classList.add("oculto"), 1400);

    const fallos = (r.errores || []).map((e) => `${e.portal}: ${e.error}`).join(" · ");
    $("#resumen-busqueda").textContent =
      `${estado.vacantes.length} vacante(s) para «${r.termino}».` +
      (estado.perfil ? " Ordenadas por encaje con tu CV." : " Carga tu CV para ordenarlas por encaje.") +
      (fallos ? ` — ${fallos}` : "");
  } catch (e) {
    $("#resumen-busqueda").textContent = `No se pudo buscar: ${e.message}`;
  } finally {
    boton.disabled = false;
    boton.textContent = "Buscar";
  }
});

// ---------------------------------------------------------------------
// Una vacante: preparar, revisar, enviar
// ---------------------------------------------------------------------
async function abrirVacante(vacante) {
  if (!vacante) return;
  estado.vacanteAbierta = vacante;
  estado.respuestasPersona = {};
  $("#modal").classList.remove("oculto");
  $("#modal-contenido").innerHTML =
    `<h2>${escapar(vacante.titulo)}</h2><p class="nota">${escapar(vacante.empresa)}</p>` +
    `<p class="nota">Abriendo el formulario y redactando las respuestas…</p>`;

  estado.reporte = await enviar({ accion: "prepararUna", vacante, respuestasPersona: {} });
  pintarModal();
}

function pintarModal() {
  const v = estado.vacanteAbierta;
  const r = estado.reporte || {};
  const c = $("#modal-contenido");
  const cab = `<h2>${escapar(v.titulo)}</h2><p class="nota">${escapar([v.empresa, v.ubicacion].filter(Boolean).join(" · "))}</p>`;

  if (r.soloLectura || r.error || r.requiereLogin || r.captcha) {
    c.innerHTML = cab + `<div class="aviso alerta">${escapar(r.nota || r.error)}</div>`;
    return;
  }

  let html = cab;

  // El CV. Se dice lo que pasó de verdad, no lo que se intentó.
  //
  // Antes esto ponía «CV adaptado a esta vacante» siempre que el modelo
  // devolviera cambios, aunque el archivo que le llegaba a la empresa
  // fuera el viejo del portal. Ahora el aviso depende de si el adjunto
  // quedó puesto, que es lo único que la empresa llega a ver.
  if (r.cv?.adjuntado) {
    const extra = r.cv.anadidas?.length
      ? `<br><span class="nota">Incluye ${r.cv.anadidas.map(escapar).join(", ")}, que confirmaste tú.</span>`
      : "";
    const cambios = r.cambiosCV?.length
      ? `<br>${r.cambiosCV.map(escapar).join("<br>")}`
      : "";
    html += `<div class="aviso"><strong>Se adjuntó tu CV adaptado a esta vacante.</strong><br>`
          + `<span class="nota">${escapar(r.cv.archivo)}</span>${cambios}${extra}</div>`;
  } else if (r.cv) {
    html += `<div class="aviso alerta"><strong>Vas a postular con el CV que ya tienes en el portal.</strong><br>`
          + `${escapar(r.cv.nota || "No se pudo adjuntar el CV adaptado.")}</div>`;
  }
  if (r.completados?.length) {
    html += `<p class="nota">Se completaron solos ${r.completados.length} campo(s) del formulario.</p>`;
  }
  if (r.pendientes?.length) {
    html += `<div class="aviso alerta">El portal pide datos que no tenemos: <strong>${r.pendientes.map(escapar).join(", ")}</strong>. ` +
            `Guárdalos en <em>Mi perfil</em> o escríbelos en la página.</div>`;
  }
  html += `<div id="preguntas"></div>
    <label class="confirmar"><input type="checkbox" id="chk-revision">
      <span>Revisé el formulario en la página del portal y confirmo el envío</span></label>
    <button class="boton primario" id="btn-enviar" disabled>Enviar postulación</button>
    <p class="nota" id="estado-envio"></p>`;
  c.innerHTML = html;

  pintarPreguntas(r.preguntas || []);
  $("#chk-revision").addEventListener("change", (e) => { $("#btn-enviar").disabled = !e.target.checked; });
  $("#btn-enviar").addEventListener("click", enviarUna);
}

function pintarPreguntas(preguntas) {
  const cont = $("#preguntas");
  cont.innerHTML = "";
  preguntas.forEach((q, n) => {
    const pendientes = (q.necesita || []).filter((x) => !x.respondido);
    const div = document.createElement("div");
    div.className = "pregunta";
    div.innerHTML = `<p class="enunciado"><strong>${n + 1}.</strong> ${escapar(q.enunciado)} ` +
      (pendientes.length ? `<span class="marca-etq falta">falta que respondas</span>`
        : q.texto ? `<span class="marca-etq">redactado</span>` : "") + `</p>` +
      (q.avisoCuota ? `<div class="aviso alerta">${escapar(q.avisoCuota)}</div>` : "");

    (q.necesita || []).forEach((f) => {
      if (f.aviso) {
        div.insertAdjacentHTML("beforeend",
          `<div class="aviso alerta">${escapar(f.aviso).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</div>`);
      }
      div.insertAdjacentHTML("beforeend", `<p class="nota">${escapar(f.etiqueta)}</p>`);
      if (f.tipo === "opciones") {
        const g = document.createElement("div");
        g.className = "opciones";
        f.opciones.forEach((op) => {
          const b = document.createElement("button");
          b.className = "opcion" + (estado.respuestasPersona[f.clave] === op ? " elegida" : "");
          b.textContent = op;
          b.addEventListener("click", () => {
            estado.respuestasPersona[f.clave] = op;
            reRedactar();
          });
          g.appendChild(b);
        });
        div.appendChild(g);
      } else {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = estado.respuestasPersona[f.clave] || "";
        inp.placeholder = "Escríbelo y sal del campo";
        inp.style.cssText = "width:100%;padding:8px 11px;border:1px solid var(--linea);border-radius:6px;font:inherit;background:var(--tarjeta);color:var(--tinta)";
        inp.addEventListener("change", () => {
          estado.respuestasPersona[f.clave] = inp.value.trim();
          reRedactar();
        });
        div.appendChild(inp);
      }
    });

    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.dataset.indice = q.indice;
    ta.value = q.texto || q.actual || "";
    if (q.max) ta.maxLength = Number(q.max);
    ta.placeholder = pendientes.length ? "Responde arriba y aparece aquí, o escríbelo tú." : "Revisa o corrige.";
    div.appendChild(ta);
    cont.appendChild(div);
  });
}

async function reRedactar() {
  // Se conserva lo que la persona haya editado a mano.
  const editados = {};
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    const orig = (estado.reporte.preguntas.find((q) => String(q.indice) === ta.dataset.indice) || {}).texto || "";
    if (ta.value.trim() && ta.value.trim() !== orig.trim()) editados[ta.dataset.indice] = ta.value.trim();
  });
  estado.reporte = await enviar({
    accion: "prepararUna", vacante: estado.vacanteAbierta,
    respuestasPersona: estado.respuestasPersona,
  });
  pintarPreguntas(estado.reporte.preguntas || []);
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    if (editados[ta.dataset.indice]) ta.value = editados[ta.dataset.indice];
  });
}

async function enviarUna() {
  const boton = $("#btn-enviar");
  boton.disabled = true;
  boton.textContent = "Enviando…";
  const respuestas = {};
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    if (ta.value.trim()) respuestas[ta.dataset.indice] = ta.value.trim();
  });
  const r = await enviar({ accion: "enviarUna", vacante: estado.vacanteAbierta, respuestas });
  const est = $("#estado-envio");
  if (r?.enviada) {
    est.textContent = r.mensaje;
    avisar("Postulación enviada", "bien");
    pintarInicio();
  } else {
    const d = r?.diagnostico || {};
    est.innerHTML = `⚠️ ${escapar(r?.mensaje || r?.error || "No se pudo confirmar.")}` +
      (d.botonPulsado ? `<br>Botón que se pulsó: <code>${escapar(d.botonPulsado)}</code>` : "") +
      (d.errores?.length ? `<br>El portal pide: ${escapar(d.errores.join(" · "))}` : "");
    boton.disabled = false;
  }
  boton.textContent = "Enviar postulación";
}

$("#btn-cerrar-modal").addEventListener("click", () => $("#modal").classList.add("oculto"));
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").classList.add("oculto"); });

// ---------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------
$("#btn-lote-revisar").addEventListener("click", () => arrancarLote("revisado"));

$("#btn-lote-auto").addEventListener("click", async () => {
  const { casillas } = await enviar({ accion: "consentimiento" });
  $("#casillas").innerHTML = "";
  casillas.forEach((c) => {
    const l = document.createElement("label");
    const i = document.createElement("input");
    i.type = "checkbox";
    i.addEventListener("change", () => {
      estado.aprobacion[c.clave] = i.checked;
      $("#btn-confirmar-auto").disabled = !casillas.every((x) => estado.aprobacion[x.clave]);
    });
    l.appendChild(i);
    l.insertAdjacentHTML("beforeend", `<span>${escapar(c.texto)}</span>`);
    $("#casillas").appendChild(l);
  });
  $("#bloque-riesgo").classList.remove("oculto");
});

$("#btn-cancelar-auto").addEventListener("click", () => {
  $("#bloque-riesgo").classList.add("oculto");
  estado.aprobacion = {};
  $("#btn-confirmar-auto").disabled = true;
});
$("#btn-confirmar-auto").addEventListener("click", () => {
  $("#bloque-riesgo").classList.add("oculto");
  arrancarLote("automatico");
});

async function arrancarLote(modo) {
  consola.limpiar();
  const marcadas = [...$("#lista-vacantes").querySelectorAll(".vacante")]
    .filter((el) => el.querySelector(".chk-v")?.checked)
    .map((el) => estado.vacantes.find((v) => v.id === el.dataset.id))
    .filter(Boolean);
  if (!marcadas.length) return;

  consola.escribir(
    modo === "automatico"
      ? `Postulando a ${marcadas.length} vacantes. No tienes que hacer nada.`
      : `Preparando ${marcadas.length} vacantes. Nada se envía todavía.`, true);
  await enviar({
    accion: "lotePreparar", vacantes: marcadas, modo,
    aprobacion: estado.aprobacion, respuestasPersona: estado.respuestasPersona,
  });
  $("#progreso").classList.remove("oculto");
  seguirLote();
}

let temporizador = null;
function seguirLote() {
  clearInterval(temporizador);
  temporizador = setInterval(async () => {
    const s = await enviar({ accion: "loteEstado" });
    if (!s) return;
    $("#texto-progreso").textContent = `${s.hechas} de ${s.total}`;
    $("#relleno").style.width = s.total ? `${Math.round((s.hechas / s.total) * 100)}%` : "0";

    // Se narra cada vacante conforme se resuelve, con su desenlace.
    const hechos = (s.items || []).filter((i) => i.estado !== "pendiente");
    hechos.slice(consola.lineas.length ? undefined : 0).forEach(() => {});
    const yaContadas = consola.lineas.filter((l) => l.contada).length;
    hechos.slice(yaContadas).forEach((i) => {
      const desenlace = {
        enviada: "enviada ✓", preparada: "lista para revisar",
        omitida: "omitida", fallida: "no se pudo",
      }[i.estado] || i.estado;
      consola.escribir(`${i.empresa || i.titulo} — ${desenlace}`, true);
      if (consola.lineas.at(-1)) consola.lineas.at(-1).contada = true;
    });
    if (s.fase === "listo" || s.fase === "terminado") {
      clearInterval(temporizador);
      $("#progreso").classList.add("oculto");
      pintarResultadoLote(s);
      pintarInicio();
    }
  }, 1500);
}

function pintarResultadoLote(s) {
  const iconos = { enviada: "✅", omitida: "⏭️", fallida: "❌", preparada: "📝", pendiente: "⏳" };
  $("#lista-vacantes").innerHTML = s.items.map((i) =>
    `<article class="vacante" data-id="${escapar(i.id)}">
      <div class="arriba"><div style="flex:1;min-width:0">
        <h3>${iconos[i.estado] || ""} ${escapar(i.titulo)}</h3>
        <div class="meta">${escapar(i.empresa || "")}</div>
      </div></div>
      ${i.motivo ? `<p class="nota" style="color:var(--ambar)">${escapar(i.motivo)}</p>` : ""}
      ${s.modo === "revisado" && i.estado === "preparada"
        ? `<div class="pie"><button class="boton secundario chico btn-abrir" style="margin-left:auto">Revisar y enviar</button></div>` : ""}
    </article>`).join("");

  $("#lista-vacantes").querySelectorAll(".vacante").forEach((el) => {
    const i = s.items.find((x) => x.id === el.dataset.id);
    el.querySelector(".btn-abrir")?.addEventListener("click", () => abrirVacante(i));
  });
  $("#resumen-busqueda").textContent = s.mensaje;
  $("#acciones-lote").classList.add("oculto");
}

$("#btn-cancelar-lote").addEventListener("click", () => enviar({ accion: "loteCancelar" }));

// ---------------------------------------------------------------------
// Pipeline: columnas con arrastre
// ---------------------------------------------------------------------
async function pintarPipeline() {
  const lista = await almacen.tracker.listar();
  $("#columnas").innerHTML = almacen.ETAPAS.map((e) => {
    const suyas = lista.filter((p) => p.etapa === e.id);
    return `<div class="columna" data-etapa="${e.id}">
      <header><span class="punto ${e.id}"></span>${e.nombre}<span class="conteo">${suyas.length}</span></header>
      ${suyas.map((p) => {
        const f = new Date(p.fecha);
        return `<div class="ficha" draggable="true" data-id="${escapar(p.id)}">
          <strong>${escapar(p.puesto || "—")}</strong>
          <div class="sub">${escapar(p.empresa || "")} · ${f.toLocaleDateString("es-PE")}</div>
          ${p.motivo ? `<div class="motivo">${escapar(p.motivo)}</div>` : ""}
          <select class="mover">
            ${almacen.ETAPAS.map((x) =>
              `<option value="${x.id}"${x.id === e.id ? " selected" : ""}>${x.nombre}</option>`).join("")}
          </select>
        </div>`;
      }).join("") || `<p class="vacio" style="font-size:12px">Vacío</p>`}
    </div>`;
  }).join("");

  conectarArrastre();
}

function conectarArrastre() {
  let arrastrada = null;

  document.querySelectorAll(".ficha").forEach((f) => {
    f.addEventListener("dragstart", () => { arrastrada = f; f.classList.add("arrastrando"); });
    f.addEventListener("dragend", () => { f.classList.remove("arrastrando"); arrastrada = null; });
    // El menú sirve de alternativa accesible al arrastre.
    f.querySelector(".mover")?.addEventListener("change", async (e) => {
      await almacen.tracker.moverEtapa(f.dataset.id, e.target.value);
      avisar("Movida de etapa", "bien");
      pintarPipeline();
    });
  });

  document.querySelectorAll(".columna").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("encima"); });
    col.addEventListener("dragleave", () => col.classList.remove("encima"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("encima");
      if (!arrastrada) return;
      await almacen.tracker.moverEtapa(arrastrada.dataset.id, col.dataset.etapa);
      avisar("Movida de etapa", "bien");
      pintarPipeline();
    });
  });
}

$("#btn-exportar").addEventListener("click", async () => {
  const lista = await almacen.tracker.listar();
  const filas = [["fecha", "etapa", "puesto", "empresa", "portal", "motivo", "url"]];
  lista.forEach((r) => filas.push([r.fecha, r.etapa, r.puesto, r.empresa, r.portal, r.motivo, r.url]));
  const csv = filas.map((f) => f.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "chamba-lista-postulaciones.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  avisar("CSV descargado", "bien");
});

// ---------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------
$("#btn-cargar-cv").addEventListener("click", () => $("#archivo-cv").click());

$("#archivo-cv").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $("#estado-perfil").textContent = "Leyendo tu CV…";
  try {
    const fd = new FormData();
    fd.append("cv", f);
    const clave = await almacen.claveIA.obtener();
    // Por conCuenta: /api/cv/procesar pide sesión. Con fetch pelado el
    // servidor no ve token y responde «Inicia sesión para continuar» a
    // quien ya entró, que es exactamente lo que le pasaba a Ali.
    const r = await sesion.conCuenta("/api/cv/procesar", {
      method: "POST", body: fd, headers: clave ? { "X-IA-Key": clave } : {},
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      throw new Error("Tu sesión de Chamba Lista caducó. Vuelve a entrar arriba.");
    }
    if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
    estado.perfil = j.perfil;
    await almacen.perfil.guardar(j.perfil);
    pintarPerfil();
    avisar("CV cargado y listo", "bien");
    pintarInicio();   // cargar el CV cambia de etapa
  } catch (err) {
    $("#estado-perfil").textContent =
      `No se pudo leer: ${err.message}. Si el servicio está dormido, espera 30 s y reintenta.`;
  }
});

function pintarPerfil() {
  const p = estado.perfil;
  if (!p) {
    $("#estado-perfil").textContent = "Sin CV cargado. Cárgalo para adaptar tu CV y responder los formularios.";
    $("#resumen-cv").innerHTML = "";
    return;
  }
  const cuenta = (k) => (p[k] || []).length;
  $("#estado-perfil").textContent = `${p.nombre || "CV cargado"} — leído ${p.analizado_con === "ia" ? "con IA" : "con reglas"}.`;
  $("#resumen-cv").innerHTML = [
    ["experiencia", "experiencias"], ["liderazgo", "de liderazgo"],
    ["educacion", "estudios"], ["certificaciones", "certificaciones"],
  ].filter(([k]) => cuenta(k)).map(([k, etq]) =>
    `<div class="portal-fila"><strong>${cuenta(k)}</strong><span class="nota">${etq}</span></div>`).join("");
}

$("#btn-guardar-clave").addEventListener("click", async () => {
  const v = $("#clave-ia").value.trim();
  if (v) await almacen.claveIA.guardar(v);
  else await almacen.claveIA.borrar();
  $("#clave-ia").value = "";
  $("#clave-ia").placeholder = v ? "Clave guardada ✓" : "Pega tu clave";
  avisar(v ? "Clave guardada" : "Clave borrada", "bien");
  pintarCuota();
});

async function pintarCuota() {
  const linea = $("#estado-cuota");
  if (await almacen.claveIA.obtener()) {
    linea.textContent = "Usando tu propia clave. No consumes cuota.";
    return;
  }
  const c = await ia.cuota();
  if (!c) {
    linea.textContent = "IA incluida. (No se pudo consultar la cuota; si el servicio está dormido tarda ~30 s en despertar.)";
    return;
  }
  if (!c.servidor_configurado) {
    linea.textContent = "El servidor aún no tiene IA configurada. Puedes poner tu propia clave abajo.";
    return;
  }
  linea.textContent = c.restantes > 0
    ? `IA incluida — te quedan ${c.restantes} de ${c.limite} usos en ${c.ventana_horas} h.`
    : `Sin usos gratis por ahora${c.se_renueva_en_minutos ? `, se renuevan en ${c.se_renueva_en_minutos} min` : ""}.`;
}

/**
 * Los campos de datos personales, cada uno con el control que le toca.
 *
 * Escribir es el enemigo. Un desplegable se contesta de un toque, no se
 * escribe mal y sale redactado igual siempre — que es lo que acaba
 * leyendo la empresa. Lo que se GUARDA sigue siendo una cadena de texto,
 * así que las plantillas y las respuestas no se enteran de nada.
 */
async function pintarCamposDatos() {
  const guardados = await almacen.datosPersonales.obtener();
  $("#campos-datos").innerHTML = datos.CAMPOS.map((c) => {
    const v = guardados[c.clave] || "";
    const cabecera = `<label>${escapar(c.etiqueta)}`
      + (c.sensible ? `<span class="sensible">sensible</span>` : "")
      + `<span class="ayuda"> ${escapar(c.ayuda)}</span></label>`;

    if (c.tipo === "opciones") {
      // «A partir de una fecha» abre un selector de fecha de verdad, que
      // es lo que pedía Ali: una fecha no se escribe, se elige.
      const enLista = c.opciones.includes(v);
      const fecha = !enLista && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
      const elegida = fecha ? c.conFecha : v;
      return `<div class="campo-dato">${cabecera}
        <select data-clave="${c.clave}" data-tipo="opciones">
          <option value="">Sin responder</option>
          ${c.opciones.map((o) =>
            `<option value="${escapar(o)}"${o === elegida ? " selected" : ""}>${escapar(o)}</option>`).join("")}
        </select>
        ${c.conFecha ? `<input type="date" class="fecha-extra ${fecha ? "" : "oculto"}"
           data-fecha-de="${c.clave}" value="${escapar(fecha)}">` : ""}
      </div>`;
    }

    if (c.tipo === "red") {
      // Guardado como «Instagram: @alice». Se parte para reeditarlo.
      const corte = v.indexOf(":");
      const red = corte > 0 ? v.slice(0, corte).trim() : c.opciones[0];
      const usuario = corte > 0 ? v.slice(corte + 1).trim() : v;
      return `<div class="campo-dato">${cabecera}
        <div class="par-red">
          <select data-red-de="${c.clave}">
            ${c.opciones.map((o) =>
              `<option value="${escapar(o)}"${o === red ? " selected" : ""}>${escapar(o)}</option>`).join("")}
          </select>
          <input type="text" data-usuario-de="${c.clave}" value="${escapar(usuario)}"
                 placeholder="@tuusuario">
        </div>
      </div>`;
    }

    return `<div class="campo-dato">${cabecera}
      <input type="text" data-clave="${c.clave}" value="${escapar(v)}" placeholder="Opcional"></div>`;
  }).join("");

  // El selector de fecha aparece solo cuando toca.
  $("#campos-datos").querySelectorAll("select[data-tipo=opciones]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const campo = datos.CAMPOS.find((c) => c.clave === sel.dataset.clave);
      const fecha = $("#campos-datos").querySelector(`[data-fecha-de="${sel.dataset.clave}"]`);
      if (campo?.conFecha && fecha) fecha.classList.toggle("oculto", sel.value !== campo.conFecha);
    });
  });
}

$("#btn-guardar-datos").addEventListener("click", async () => {
  // Se recoge de los tres tipos de control y todo sale como cadena, que
  // es lo que espera `datos.validar` y todo lo que hay debajo.
  const crudo = {};
  const zona = $("#campos-datos");

  zona.querySelectorAll("input[data-clave]").forEach((i) => {
    if (i.value.trim()) crudo[i.dataset.clave] = i.value.trim();
  });

  zona.querySelectorAll("select[data-clave]").forEach((sel) => {
    if (!sel.value) return;
    const campo = datos.CAMPOS.find((c) => c.clave === sel.dataset.clave);
    const fecha = zona.querySelector(`[data-fecha-de="${sel.dataset.clave}"]`);
    // Si eligió «a partir de una fecha», lo que vale es la fecha.
    crudo[sel.dataset.clave] = (campo?.conFecha && sel.value === campo.conFecha && fecha?.value)
      ? fecha.value
      : sel.value;
  });

  zona.querySelectorAll("select[data-red-de]").forEach((sel) => {
    const usuario = zona.querySelector(`[data-usuario-de="${sel.dataset.redDe}"]`);
    const escrito = (usuario?.value || "").trim();
    if (escrito) crudo[sel.dataset.redDe] = `${sel.value}: ${escrito}`;
  });
  const { limpio, errores } = datos.validar(crudo);
  if (Object.keys(errores).length) {
    $("#estado-datos").textContent = Object.values(errores).join(" · ");
    avisar("Revisa los campos marcados", "mal");
    return;
  }
  await almacen.datosPersonales.guardar(limpio);
  const n = Object.keys(limpio).length;
  $("#estado-datos").textContent = `Guardados ${n} dato(s), solo en tu navegador.`;
  avisar(`${n} dato(s) guardados`, "bien");
});

$("#btn-borrar-datos").addEventListener("click", async () => {
  if (!confirm("¿Borrar todos los datos guardados en este navegador?")) return;
  await almacen.datosPersonales.borrar();
  await pintarCamposDatos();
  $("#estado-datos").textContent = "Borrados.";
});

// El fondo avisa en cuanto detecta la sesión en un portal. Puede llegar
// a los diez segundos o a los tres minutos: lo que no puede es obligar a
// la persona a adivinar cuándo mirar.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.aviso !== "sesionPortal") return;
  conectando.delete(msg.portal);
  revisarSesion().then(() => {
    const p = sesionesCache.find((x) => x.id === msg.portal);
    avisar(p ? `${p.nombre}: conectado.` : "Portal conectado.", "bien");
    pintarInicio();
  });
});

async function revisarSesion() {
  const chip = $("#estado-sesion");
  const r = await enviar({ accion: "sesionPortales" });
  sesionesCache = r?.portales || [];
  const conectados = sesionesCache.filter((p) => p.sesion === true).length;
  const total = sesionesCache.length;

  chip.textContent = conectados ? `${conectados}/${total} conectados` : "sin conectar";
  chip.className = "estado-sesion " + (conectados ? "ok" : "mal");
  pintarPortales();
  // Conectar un portal cambia de etapa: la portada debe reaccionar.
  if (!$("#vista-inicio").classList.contains("oculto")) pintarInicio();
}

/** Tarjeta de portales: estado y botón para iniciar sesión en cada uno. */
function pintarPortales() {
  const cont = $("#lista-portales");
  if (!cont) return;
  cont.innerHTML = sesionesCache.map((p) => {
    const etiqueta = p.sesion === true ? "conectado"
      : p.sesion === false ? "sin sesión"
      : "sin abrir";
    const clase = p.sesion === true ? "ok" : p.sesion === false ? "mal" : "";
    return `<div class="portal-fila">
      <strong>${escapar(p.nombre)}</strong>
      <span class="portal-chip">${p.postulable ? "postula" : "solo busca"}</span>
      <span class="estado-sesion ${clase}" style="margin-left:auto">${etiqueta}</span>
      <button class="boton chico" data-acceso="${p.id}">
        ${p.sesion === true ? "Abrir" : "Iniciar sesión"}
      </button>
    </div>`;
  }).join("");

  cont.querySelectorAll("[data-acceso]").forEach((b) => {
    b.addEventListener("click", async () => {
      await enviar({ accion: "abrirAcceso", portal: b.dataset.acceso });
      avisar("Inicia sesión en la pestaña que se abrió, luego vuelve aquí.");
      // Se revisa al rato: para entonces ya debería haber entrado.
      setTimeout(revisarSesion, 12000);
    });
  });
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
(async () => {
  iniciarBuscador();
  const prefs = await almacen.preferencias.obtener();
  $("#puesto").value = prefs.puesto || "";
  $("#ciudad").value = prefs.ciudad || "";
  $("#nivel").value = prefs.nivel || "cualquiera";

  estado.perfil = await almacen.perfil.obtener();
  pintarPerfil();
  if (await almacen.claveIA.obtener()) $("#clave-ia").placeholder = "Clave guardada ✓";

  await pintarCamposDatos();
  // Las sesiones primero: la etapa de la portada depende de ellas y si
  // no, se pinta la etapa equivocada durante un instante.
  // Lo primero: ¿hay cuenta? La portada entera depende de ello.
  estado.conCuenta = await sesion.hayCuenta();
  if (estado.conCuenta && !(await sesion.verificar())) {
    // Token muerto: mejor pedir la contraseña que fallar en cada botón.
    estado.conCuenta = false;
  }
  await revisarSesion();
  await pintarInicio();
  pintarCuota();
  pintarTope();
})();


// El sello de la portada lo escribe el código, no la plantilla.
//
// Puesto a mano decía «30 por tanda» cuando TOPE_POR_TANDA son 15: el
// doble de lo que el producto hace. Un número en la portada que el
// propio código desmiente es de lo poco que se puede reclamar sin
// discusión, y evitarlo cuesta ocho líneas.
async function pintarTope() {
  const sello = document.querySelector("#sello-tope");
  if (!sello) return;
  try {
    const { tope } = await enviar({ accion: "consentimiento" });
    if (tope) sello.textContent = tope;
    else sello.closest(".sello")?.remove();
  } catch {
    // Antes que enseñar un número inventado, no enseñar ninguno.
    sello.closest(".sello")?.remove();
  }
}


// Al volver al panel se vuelve a comprobar las sesiones.
//
// El fondo avisa cuando ve la sesión, pero el panel puede estar cerrado
// en ese momento —lo normal es que la persona se vaya a la pestaña del
// portal— y ese aviso se pierde. Esto es la red: al volver a mirar el
// panel, se mira de nuevo. Sin esto, quien cierra el panel mientras
// entra al portal vuelve y lo ve igual de desconectado que antes.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  revisarSesion().then(() => {
    for (const p of sesionesCache) if (p.sesion) conectando.delete(p.id);
    pintarInicio();
  });
});

// Panel de Chamba Lista: se abre en su propia pestaña.
//
// Solo pinta y recoge decisiones. Toda la lógica de buscar, rellenar y
// enviar vive en background.js y en los content scripts.

import { NIVELES, CIUDADES, LISTA_PORTALES } from "../lib/portales.js";
import * as almacen from "../lib/almacen.js";
import * as datos from "../lib/datos.js";
import * as ia from "../lib/ia.js";
import * as coincidencia from "../lib/coincidencia.js";

const $ = (s) => document.querySelector(s);
const enviar = (msg) => chrome.runtime.sendMessage(msg);
const escapar = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const estado = {
  perfil: null, vacantes: [], vacanteAbierta: null, reporte: null,
  respuestasPersona: {}, aprobacion: {},
};

// Estado de sesión de cada portal. Se consulta al arrancar y tras pulsar
// «Iniciar sesión»; el resto de la interfaz lo lee de aquí.
let sesionesCache = [];

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

  // Primera vez: en vez de cinco ceros y un gráfico plano, se explica
  // qué hacer. Los pasos se marcan solos conforme se van cumpliendo.
  const arranque = $("#arranque");
  const conectado = sesionesCache.some((p) => p.sesion === true);
  const primeraVez = !r.total && !estado.vacantes.length;
  arranque.classList.toggle("oculto", !primeraVez);
  if (primeraVez) {
    const pasos = [
      { hecho: Boolean(estado.perfil), t: "Carga tu CV",
        d: "Lo leemos y lo pasamos a formato Harvard, el que mejor leen los filtros." },
      { hecho: conectado, t: "Conecta un portal",
        d: "Inicias sesión tú, en tu navegador. Nunca vemos tu contraseña." },
      { hecho: false, t: "Busca y postula",
        d: "Escribe el puesto que quieras. Tú das el último clic siempre." },
    ];
    arranque.innerHTML = `<div class="vacio-guiado">
        <h3>Empecemos</h3>
        <p>Tres pasos y ya estás postulando. Se marcan solos conforme los completes.</p>
      </div>
      <div class="pasos">${pasos.map((p, i) => `
        <div class="paso ${p.hecho ? "hecho" : ""}">
          <span class="num">${p.hecho ? "✓" : i + 1}</span>
          <h4>${p.t}</h4><p>${p.d}</p>
        </div>`).join("")}</div>`;
  }

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

/** Línea de los últimos 14 días. Sin librerías: es un path y punto. */
function dibujarGrafico(serie) {
  const svg = $("#grafico");
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
    `<stop offset="0%" stop-color="var(--lima)" stop-opacity=".22"/>` +
    `<stop offset="100%" stop-color="var(--lima)" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${area}" fill="url(#g)"/>` +
    `<path d="${linea}" fill="none" stroke="var(--tinta)" stroke-width="2.5" ` +
    `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
    `<circle cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="4.5" fill="var(--lima)" stroke="var(--tinta)" stroke-width="2"/>`;
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

  return `<article class="vacante marcada" data-id="${escapar(v.id)}">
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
  $("#resumen-busqueda").textContent = `Recorriendo ${elegidos.length} portal(es)… puede tardar unos segundos.`;
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
  if (r.cambiosCV?.length) {
    html += `<div class="aviso"><strong>CV adaptado a esta vacante:</strong><br>${r.cambiosCV.map(escapar).join("<br>")}</div>`;
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
  const marcadas = [...$("#lista-vacantes").querySelectorAll(".vacante")]
    .filter((el) => el.querySelector(".chk-v")?.checked)
    .map((el) => estado.vacantes.find((v) => v.id === el.dataset.id))
    .filter(Boolean);
  if (!marcadas.length) return;

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
    $("#texto-progreso").textContent = `${s.mensaje} (${s.hechas}/${s.total})`;
    $("#relleno").style.width = s.total ? `${Math.round((s.hechas / s.total) * 100)}%` : "0";
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
    const r = await fetch(`${ia.SERVIDOR}/api/cv/procesar`, {
      method: "POST", body: fd, headers: clave ? { "X-IA-Key": clave } : {},
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    estado.perfil = j.perfil;
    await almacen.perfil.guardar(j.perfil);
    pintarPerfil();
    avisar("CV cargado y listo", "bien");
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

async function pintarCamposDatos() {
  const guardados = await almacen.datosPersonales.obtener();
  $("#campos-datos").innerHTML = datos.CAMPOS.map((c) =>
    `<div class="campo-dato"><label>${escapar(c.etiqueta)}` +
    (c.sensible ? `<span class="sensible">sensible</span>` : "") +
    `<span class="ayuda"> ${escapar(c.ayuda)}</span></label>` +
    `<input type="text" data-clave="${c.clave}" value="${escapar(guardados[c.clave] || "")}" placeholder="Opcional"></div>`,
  ).join("");
}

$("#btn-guardar-datos").addEventListener("click", async () => {
  const crudo = {};
  document.querySelectorAll("#campos-datos input").forEach((i) => {
    if (i.value.trim()) crudo[i.dataset.clave] = i.value.trim();
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

async function revisarSesion() {
  const chip = $("#estado-sesion");
  const r = await enviar({ accion: "sesionPortales" });
  sesionesCache = r?.portales || [];
  const conectados = sesionesCache.filter((p) => p.sesion === true).length;
  const total = sesionesCache.length;

  chip.textContent = conectados ? `${conectados}/${total} conectados` : "sin conectar";
  chip.className = "estado-sesion " + (conectados ? "ok" : "mal");
  pintarPortales();
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
  await pintarInicio();
  revisarSesion();
  pintarCuota();
})();

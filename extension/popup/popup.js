// Interfaz de la extensión. Solo pinta y recoge decisiones: la lógica
// vive en background.js y en el content script.

import { NIVELES, CIUDADES } from "../lib/portales.js";
import * as almacen from "../lib/almacen.js";
import * as datos from "../lib/datos.js";

const $ = (s) => document.querySelector(s);
const estado = { vacantes: [], vacanteAbierta: null, reporte: null, respuestasPersona: {}, aprobacion: {} };

const enviar = (msg) => chrome.runtime.sendMessage(msg);

// ---------- pestañas ----------
document.querySelectorAll(".pestana").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".pestana").forEach((x) => x.classList.toggle("activa", x === b));
    document.querySelectorAll(".vista").forEach((v) => {
      v.classList.toggle("oculto", v.id !== `vista-${b.dataset.vista}`);
    });
    if (b.dataset.vista === "tracker") pintarTracker();
  });
});

// ---------- estado de la sesión ----------
async function revisarSesion() {
  const p = $("#estado-sesion");
  try {
    const [tab] = await chrome.tabs.query({ url: "https://pe.computrabajo.com/*" });
    if (!tab) throw new Error("sin pestaña");
    const r = await chrome.tabs.sendMessage(tab.id, { accion: "sesion" });
    if (r?.sesion) {
      p.textContent = "sesión lista";
      p.className = "pastilla ok";
      $("#aviso-sesion").classList.add("oculto");
      return true;
    }
    throw new Error("sin sesión");
  } catch {
    p.textContent = "sin sesión";
    p.className = "pastilla mal";
    $("#aviso-sesion").classList.remove("oculto");
    return false;
  }
}

$("#btn-abrir-portal").addEventListener("click", () => enviar({ accion: "abrirComputrabajo" }));

// ---------- buscar ----------
function iniciarBuscador() {
  $("#nivel").innerHTML = NIVELES.map((n) => `<option value="${n.id}">${n.nombre}</option>`).join("");
  $("#ciudades").innerHTML = CIUDADES.map((c) => `<option value="${c}">`).join("");
}

$("#btn-buscar").addEventListener("click", async () => {
  const puesto = $("#puesto").value.trim();
  if (!puesto) return;
  const boton = $("#btn-buscar");
  boton.disabled = true;
  boton.textContent = "Buscando…";
  $("#resumen-busqueda").textContent = "Recorriendo Computrabajo…";

  try {
    const prefs = { puesto, ciudad: $("#ciudad").value.trim(), nivel: $("#nivel").value };
    await almacen.preferencias.guardar(prefs);
    const r = await enviar({ accion: "buscar", ...prefs, portales: ["computrabajo"] });
    if (r?.error) throw new Error(r.error);

    estado.vacantes = r.vacantes || [];
    pintarTarjetas();
    const fallos = (r.errores || []).map((e) => `${e.portal}: ${e.error}`).join(" · ");
    $("#resumen-busqueda").textContent =
      `${estado.vacantes.length} vacante(s) para «${r.termino}».` + (fallos ? ` ${fallos}` : "");
    $("#acciones-lote").classList.toggle("oculto", !estado.vacantes.length);
  } catch (e) {
    $("#resumen-busqueda").textContent = `No se pudo buscar: ${e.message}`;
  } finally {
    boton.disabled = false;
    boton.textContent = "Buscar vacantes";
  }
});

function pintarTarjetas() {
  const cont = $("#tarjetas");
  cont.innerHTML = "";
  estado.vacantes.forEach((v, i) => {
    const d = document.createElement("div");
    d.className = "tarjeta";
    d.innerHTML =
      `<h4>${v.titulo}</h4>` +
      `<div class="meta">${[v.empresa, v.ubicacion].filter(Boolean).join(" · ")}</div>` +
      (v.publicado ? `<div class="meta">${v.publicado}</div>` : "");

    const pie = document.createElement("div");
    pie.className = "pie";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = true;
    chk.dataset.i = i;
    chk.addEventListener("change", () => d.classList.toggle("marcada", chk.checked));
    pie.appendChild(chk);
    pie.insertAdjacentHTML("beforeend", `<span class="portal">${v.portal}</span>`);

    const ver = document.createElement("button");
    ver.className = "boton secundario";
    ver.textContent = "Ver y postular";
    ver.style.marginLeft = "auto";
    ver.addEventListener("click", () => abrirVacante(v));
    pie.appendChild(ver);

    d.appendChild(pie);
    d.classList.add("marcada");
    cont.appendChild(d);
  });
}

// ---------- una vacante: preparar, revisar, enviar ----------
async function abrirVacante(vacante) {
  estado.vacanteAbierta = vacante;
  estado.respuestasPersona = {};
  $("#modal").classList.remove("oculto");
  $("#modal-contenido").innerHTML =
    `<h3>${vacante.titulo}</h3><p class="detalle">${vacante.empresa}</p>` +
    `<p class="detalle">Abriendo el formulario y redactando las respuestas…</p>`;

  const r = await enviar({ accion: "prepararUna", vacante, respuestasPersona: {} });
  estado.reporte = r;
  pintarModal();
}

function pintarModal() {
  const v = estado.vacanteAbierta;
  const r = estado.reporte || {};
  const c = $("#modal-contenido");

  if (r.error || r.requiereLogin || r.captcha) {
    c.innerHTML = `<h3>${v.titulo}</h3><p class="detalle">${v.empresa}</p>` +
      `<div class="aviso"><p>${r.error || r.nota}</p></div>`;
    return;
  }

  let html = `<h3>${v.titulo}</h3><p class="detalle">${v.empresa} · ${v.ubicacion || ""}</p>`;

  if (r.cambiosCV?.length) {
    html += `<p class="detalle"><strong>CV adaptado:</strong> ${r.cambiosCV.join(" · ")}</p>`;
  }
  if (r.completados?.length) {
    html += `<p class="detalle">Se completó solo: ${r.completados.length} campo(s).</p>`;
  }
  if (r.pendientes?.length) {
    html += `<div class="aviso"><p>Estos datos no los tenemos y el portal los pide: ` +
            `<strong>${r.pendientes.join(", ")}</strong>. Guárdalos en «Mi perfil» o escríbelos en la página.</p></div>`;
  }

  html += `<div id="preguntas"></div>`;
  html += `<label class="fila"><input type="checkbox" id="chk-revision"> ` +
          `<span style="font-size:11.5px">Revisé el formulario en la página y confirmo el envío</span></label>`;
  html += `<button class="boton principal ancho" id="btn-enviar-una" disabled>Enviar postulación</button>`;
  html += `<p class="detalle" id="estado-envio"></p>`;
  c.innerHTML = html;

  pintarPreguntas(r.preguntas || []);

  $("#chk-revision").addEventListener("change", (e) => {
    $("#btn-enviar-una").disabled = !e.target.checked;
  });
  $("#btn-enviar-una").addEventListener("click", enviarUna);
}

function pintarPreguntas(preguntas) {
  const cont = $("#preguntas");
  cont.innerHTML = "";
  preguntas.forEach((q, n) => {
    const pendientes = (q.necesita || []).filter((x) => !x.respondido);
    const div = document.createElement("div");
    div.className = "pregunta";
    div.innerHTML = `<p class="enunciado"><strong>${n + 1}.</strong> ${q.enunciado} ` +
      (pendientes.length ? `<span class="etiq falta">falta que respondas</span>`
                         : q.texto ? `<span class="etiq">redactado</span>` : "");

    (q.necesita || []).forEach((f) => {
      if (f.aviso) {
        div.insertAdjacentHTML("beforeend",
          `<div class="aviso-consent">${f.aviso.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</div>`);
      }
      div.insertAdjacentHTML("beforeend", `<p class="detalle">${f.etiqueta}</p>`);
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
    ta.placeholder = pendientes.length ? "Responde arriba y aparece aquí — o escríbelo tú." : "Revisa o corrige.";
    div.appendChild(ta);
    cont.appendChild(div);
  });
}

async function reRedactar() {
  // Se conserva lo que la persona editó a mano.
  const editados = {};
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    const orig = (estado.reporte.preguntas.find((q) => String(q.indice) === ta.dataset.indice) || {}).texto || "";
    if (ta.value.trim() && ta.value.trim() !== orig.trim()) editados[ta.dataset.indice] = ta.value.trim();
  });
  const r = await enviar({
    accion: "prepararUna", vacante: estado.vacanteAbierta,
    respuestasPersona: estado.respuestasPersona,
  });
  estado.reporte = r;
  pintarPreguntas(r.preguntas || []);
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    if (editados[ta.dataset.indice]) ta.value = editados[ta.dataset.indice];
  });
}

async function enviarUna() {
  const boton = $("#btn-enviar-una");
  boton.disabled = true;
  boton.textContent = "Enviando…";
  const respuestas = {};
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    if (ta.value.trim()) respuestas[ta.dataset.indice] = ta.value.trim();
  });
  const r = await enviar({ accion: "enviarUna", vacante: estado.vacanteAbierta, respuestas });
  const est = $("#estado-envio");
  if (r?.enviada) {
    est.textContent = `✅ ${r.mensaje}`;
  } else {
    const d = r?.diagnostico || {};
    est.innerHTML = `⚠️ ${r?.mensaje || r?.error || "No se pudo confirmar."}` +
      (d.botonPulsado ? `<br>Botón pulsado: <code>${d.botonPulsado}</code>` : "") +
      (d.errores?.length ? `<br>El portal pide: ${d.errores.join(" · ")}` : "");
    boton.disabled = false;
  }
  boton.textContent = "Enviar postulación";
}

$("#btn-cerrar-modal").addEventListener("click", () => $("#modal").classList.add("oculto"));

// ---------- lote ----------
$("#btn-lote-revisar").addEventListener("click", () => arrancarLote("revisado"));

$("#btn-lote-auto").addEventListener("click", async () => {
  const { casillas } = await enviar({ accion: "consentimiento" });
  const cont = $("#casillas");
  cont.innerHTML = "";
  casillas.forEach((c) => {
    const l = document.createElement("label");
    const i = document.createElement("input");
    i.type = "checkbox";
    i.addEventListener("change", () => {
      estado.aprobacion[c.clave] = i.checked;
      $("#btn-confirmar-auto").disabled = !casillas.every((x) => estado.aprobacion[x.clave]);
    });
    l.appendChild(i);
    l.insertAdjacentHTML("beforeend", `<span>${c.texto}</span>`);
    cont.appendChild(l);
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
  const marcadas = [...document.querySelectorAll("#tarjetas input[type=checkbox]:checked")]
    .map((c) => estado.vacantes[Number(c.dataset.i)]);
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
      pintarTracker();
    }
  }, 1500);
}

function pintarResultadoLote(s) {
  const cont = $("#tarjetas");
  cont.innerHTML = "";
  const iconos = { enviada: "✅", omitida: "⏭️", fallida: "❌", preparada: "📝", pendiente: "⏳" };
  s.items.forEach((i) => {
    const d = document.createElement("div");
    d.className = `tarjeta ${i.estado}`;
    d.innerHTML = `<h4>${iconos[i.estado] || ""} ${i.titulo}</h4>` +
      `<div class="meta">${i.empresa}</div>` +
      (i.cambiosCV?.length ? `<div class="meta">CV: ${i.cambiosCV[0]}</div>` : "") +
      (i.motivo ? `<div class="motivo">${i.motivo}</div>` : "");
    if (s.modo === "revisado" && i.estado === "preparada") {
      const b = document.createElement("button");
      b.className = "boton secundario";
      b.style.marginTop = "8px";
      b.textContent = "Revisar y enviar";
      b.addEventListener("click", () => abrirVacante(i));
      d.appendChild(b);
    }
    cont.appendChild(d);
  });
  $("#resumen-busqueda").textContent = s.mensaje;
}

$("#btn-cancelar-lote").addEventListener("click", () => enviar({ accion: "loteCancelar" }));

// ---------- perfil ----------
$("#btn-cargar-cv").addEventListener("click", () => $("#archivo-cv").click());

$("#archivo-cv").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $("#estado-perfil").textContent = "Leyendo tu CV…";
  try {
    const fd = new FormData();
    fd.append("cv", f);
    const clave = await almacen.claveIA.obtener();
    const r = await fetch("https://chamba-lista.onrender.com/api/cv/procesar", {
      method: "POST", body: fd, headers: clave ? { "X-IA-Key": clave } : {},
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await almacen.perfil.guardar(j.perfil);
    pintarPerfil(j.perfil);
  } catch (err) {
    $("#estado-perfil").textContent =
      `No se pudo leer: ${err.message}. Si el servicio está dormido, espera 30 s y reintenta.`;
  }
});

function pintarPerfil(p) {
  if (!p) {
    $("#estado-perfil").textContent = "Sin CV cargado.";
    return;
  }
  const cuenta = ["experiencia", "educacion", "liderazgo"].reduce((t, k) => t + (p[k]?.length || 0), 0);
  $("#estado-perfil").textContent = `${p.nombre || "CV cargado"} — ${cuenta} entrada(s).`;
}

$("#btn-guardar-clave").addEventListener("click", async () => {
  const v = $("#clave-ia").value.trim();
  if (v) await almacen.claveIA.guardar(v);
  else await almacen.claveIA.borrar();
  $("#clave-ia").value = "";
  $("#clave-ia").placeholder = v ? "Clave guardada ✓" : "Pega tu clave";
});

async function pintarCamposDatos() {
  const guardados = await almacen.datosPersonales.obtener();
  const cont = $("#campos-datos");
  cont.innerHTML = "";
  datos.CAMPOS.forEach((c) => {
    const d = document.createElement("div");
    d.className = "campo-dato";
    d.innerHTML = `<label>${c.etiqueta}${c.sensible ? '<span class="sensible">sensible</span>' : ""}` +
      `<span class="ayuda"> ${c.ayuda}</span></label>`;
    const i = document.createElement("input");
    i.type = "text";
    i.dataset.clave = c.clave;
    i.value = guardados[c.clave] || "";
    i.placeholder = "Opcional";
    d.appendChild(i);
    cont.appendChild(d);
  });
}

$("#btn-guardar-datos").addEventListener("click", async () => {
  const crudo = {};
  document.querySelectorAll("#campos-datos input").forEach((i) => {
    if (i.value.trim()) crudo[i.dataset.clave] = i.value.trim();
  });
  const { limpio, errores } = datos.validar(crudo);
  if (Object.keys(errores).length) {
    $("#estado-datos").textContent = Object.values(errores).join(" · ");
    return;
  }
  await almacen.datosPersonales.guardar(limpio);
  $("#estado-datos").textContent = `Guardados ${Object.keys(limpio).length} dato(s) en tu navegador.`;
});

// ---------- tracker ----------
async function pintarTracker() {
  const lista = await almacen.tracker.listar();
  const cuenta = (e) => lista.filter((r) => r.estado === e).length;
  $("#resumen-tracker").innerHTML =
    `<div class="cifra"><b>${lista.length}</b><span>total</span></div>` +
    `<div class="cifra"><b>${cuenta("enviada")}</b><span>enviadas</span></div>` +
    `<div class="cifra"><b>${cuenta("omitida")}</b><span>omitidas</span></div>` +
    `<div class="cifra"><b>${cuenta("fallida")}</b><span>fallidas</span></div>`;

  $("#lista-tracker").innerHTML = lista.length
    ? lista.slice(0, 60).map((r) => {
        const f = new Date(r.fecha);
        return `<div class="fila-tracker"><div class="cab">` +
          `<span class="punto ${r.estado}"></span><strong>${r.puesto || "—"}</strong>` +
          `<time>${f.toLocaleDateString("es-PE")} ${f.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</time>` +
          `</div><div class="detalle">${r.empresa || ""}${r.motivo ? " · " + r.motivo : ""}</div></div>`;
      }).join("")
    : `<p class="detalle">Aún no hay postulaciones.</p>`;
}

$("#btn-exportar").addEventListener("click", async () => {
  const lista = await almacen.tracker.listar();
  const filas = [["fecha", "puesto", "empresa", "portal", "estado", "motivo", "url"]];
  lista.forEach((r) => filas.push([r.fecha, r.puesto, r.empresa, r.portal, r.estado, r.motivo, r.url]));
  const csv = filas.map((f) => f.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  // BOM al inicio para que Excel abra los acentos bien.
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  // Con un enlace basta y evita pedir el permiso "downloads".
  const a = document.createElement("a");
  a.href = url;
  a.download = "chamba-lista-postulaciones.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

// ---------- arranque ----------
(async () => {
  iniciarBuscador();
  const prefs = await almacen.preferencias.obtener();
  $("#puesto").value = prefs.puesto || "";
  $("#ciudad").value = prefs.ciudad || "";
  $("#nivel").value = prefs.nivel || "cualquiera";

  const p = await almacen.perfil.obtener();
  pintarPerfil(p);
  $("#aviso-perfil").classList.toggle("oculto", Boolean(p));
  if (await almacen.claveIA.obtener()) $("#clave-ia").placeholder = "Clave guardada ✓";

  await pintarCamposDatos();
  await revisarSesion();
})();

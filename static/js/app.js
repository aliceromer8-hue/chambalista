// Lógica del wizard de 5 pasos. Todo el estado vive en memoria del
// navegador: el servidor no guarda el perfil, solo el .docx generado
// y el tracker de postulaciones.

const estado = {
  archivo: null,
  perfil: null,
  cvGenerado: null,
  tipo: null,
  area: null,
  vacanteElegida: null,
};

const $ = (sel) => document.querySelector(sel);

// ---------- navegación entre pasos ----------
function irAPaso(n) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.add("oculto"));
  $(`#paso-${n}`).classList.remove("oculto");
  // "datos" es un paso intermedio opcional: en la barra cuenta como el 3.
  const actual = n === "datos" ? 3 : Number(n);
  document.querySelectorAll(".paso").forEach((chip) => {
    const num = Number(chip.dataset.paso);
    chip.classList.toggle("activo", num === actual);
    chip.classList.toggle("hecho", num < actual);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-volver]").forEach((btn) =>
  btn.addEventListener("click", () => irAPaso(Number(btn.dataset.volver)))
);

// ---------- paso 1: subir CV ----------
const zona = $("#zona-subida");
const inputCv = $("#input-cv");

$("#btn-elegir").addEventListener("click", () => inputCv.click());
inputCv.addEventListener("change", () => seleccionarArchivo(inputCv.files[0]));

zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("arrastrando"); });
zona.addEventListener("dragleave", () => zona.classList.remove("arrastrando"));
zona.addEventListener("drop", (e) => {
  e.preventDefault();
  zona.classList.remove("arrastrando");
  seleccionarArchivo(e.dataTransfer.files[0]);
});

function seleccionarArchivo(archivo) {
  if (!archivo) return;
  estado.archivo = archivo;
  $("#nombre-archivo").textContent = `Seleccionado: ${archivo.name}`;
  $("#btn-subir").disabled = false;
}

$("#btn-subir").addEventListener("click", async () => {
  const boton = $("#btn-subir");
  boton.disabled = true;
  boton.textContent = "Procesando…";
  try {
    const datos = new FormData();
    datos.append("cv", estado.archivo);
    const resp = await fetch("/api/cv/subir", { method: "POST", body: datos });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    estado.perfil = json.perfil;
    // Directo al resultado: no hay pantalla intermedia que enumere lo
    // que se "detectó". Se convierte y se muestra.
    irAPaso(2);
    await convertirYMostrar();
  } catch (e) {
    alert(`Ups: ${e.message}`);
  } finally {
    boton.disabled = false;
    boton.textContent = "Procesar mi CV";
  }
});

// ---------- paso 2: revisar y generar ----------
const NOMBRES_SECCION = {
  resumen: "Resumen profesional",
  experiencia: "Experiencia",
  educacion: "Educación",
  habilidades: "Habilidades",
  idiomas: "Idiomas",
  certificaciones: "Certificaciones y logros",
};

// Secciones del CV donde se puede añadir contenido.
const SECCIONES_CV = [
  ["perfil", "Perfil profesional"],
  ["competencias", "Competencias clave"],
  ["experiencia", "Experiencia profesional"],
  ["liderazgo", "Liderazgo y voluntariado"],
  ["educacion", "Educación"],
  ["certificaciones", "Certificaciones"],
  ["proyectos", "Proyectos"],
  ["logros", "Logros destacados"],
];

// Genera el CV y muestra el resultado. No se enumera lo que se
// "detectó": eso es ruido interno. La persona ve su CV convertido y
// juzga por sí misma.
async function convertirYMostrar() {
  const nota = $("#nota-conversion");
  nota.textContent = "Convirtiendo tu CV…";
  $("#preview-cv").innerHTML = "";

  const resp = await fetch("/api/cv/generar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(estado.perfil),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error);

  estado.cvGenerado = json.archivo;
  const enlace = $("#enlace-descarga");
  enlace.href = json.descarga;
  enlace.classList.remove("oculto");

  const prev = await fetch("/api/cv/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(estado.perfil),
  });
  const pj = await prev.json();
  $("#preview-cv").innerHTML = pj.html || "";

  nota.textContent = estado.perfil.analizado_con === "ia"
    ? "Leído con IA y reescrito al formato Harvard. Revísalo."
    : "Reescrito al formato Harvard. Revísalo.";

  pintarContacto();
  pintarSelectorSecciones();
}

function pintarContacto() {
  const p = estado.perfil;
  const c = p.contacto || {};
  $("#campo-nombre").value = p.nombre || "";
  $("#campo-ubicacion").value = c.ubicacion || "";
  $("#campo-email").value = c.email || "";
  $("#campo-telefono").value = c.telefono || "";
  $("#campo-linkedin").value = c.linkedin || "";
}

function pintarSelectorSecciones() {
  const sel = $("#seccion-destino");
  sel.innerHTML = SECCIONES_CV
    .map(([id, nombre]) => `<option value="${id}">${nombre}</option>`)
    .join("") + `<option value="__nueva__">➕ Una sección nueva…</option>`;
}

$("#seccion-destino").addEventListener("change", (e) => {
  $("#titulo-seccion").classList.toggle("oculto", e.target.value !== "__nueva__");
});

$("#btn-agregar").addEventListener("click", async () => {
  const texto = $("#texto-agregar").value.trim();
  if (!texto) return;
  const destino = $("#seccion-destino").value;
  const boton = $("#btn-agregar");
  boton.disabled = true;
  boton.textContent = "Agregando…";

  try {
    const resp = await fetch("/api/cv/agregar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        perfil: estado.perfil,
        seccion: destino,
        titulo_nuevo: $("#titulo-seccion").value.trim(),
        texto,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    estado.perfil = json.perfil;
    $("#texto-agregar").value = "";
    $("#titulo-seccion").value = "";
    await convertirYMostrar();
  } catch (e) {
    alert(`No se pudo agregar: ${e.message}`);
  } finally {
    boton.disabled = false;
    boton.textContent = "Agregar al CV";
  }
});

$("#btn-actualizar-contacto").addEventListener("click", async () => {
  estado.perfil.nombre = $("#campo-nombre").value.trim();
  estado.perfil.contacto = estado.perfil.contacto || {};
  estado.perfil.contacto.ubicacion = $("#campo-ubicacion").value.trim();
  estado.perfil.contacto.email = $("#campo-email").value.trim();
  estado.perfil.contacto.telefono = $("#campo-telefono").value.trim();
  estado.perfil.contacto.linkedin = $("#campo-linkedin").value.trim();
  try {
    await convertirYMostrar();
  } catch (e) {
    alert(`Ups: ${e.message}`);
  }
});

$("#btn-a-paso3").addEventListener("click", async () => {
  await cargarOpciones();
  irAPaso(3);
});

// ---------- paso 3: búsqueda libre ----------
// El puesto lo escribe la persona y se manda tal cual al portal: no hay
// lista cerrada de rubros. El nivel solo añade un prefijo.
let opcionesCargadas = false;
estado.nivel = "cualquiera";
estado.portales = [];

function revisarPuesto() {
  $("#btn-a-portales").disabled = !$("#campo-puesto").value.trim();
}

async function cargarOpciones() {
  if (opcionesCargadas) return;
  const json = await (await fetch("/api/buscador")).json();

  // Sugerencias: ayudan a escribir, no limitan lo que se puede buscar.
  $("#sugerencias-puesto").innerHTML = json.sugerencias
    .map((s) => `<option value="${s}">`).join("");
  $("#sugerencias-ciudad").innerHTML = json.ciudades
    .map((c) => `<option value="${c}">`).join("");

  const chips = $("#chips-sugerencias");
  chips.innerHTML = "";
  json.sugerencias.slice(0, 10).forEach((s) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = s;
    b.addEventListener("click", () => {
      $("#campo-puesto").value = s;
      revisarPuesto();
    });
    chips.appendChild(b);
  });

  const niveles = $("#opciones-nivel");
  niveles.innerHTML = "";
  json.niveles.forEach((n) => {
    const btn = document.createElement("button");
    btn.className = "opcion" + (n.id === "cualquiera" ? " elegida" : "");
    btn.textContent = n.nombre;
    btn.addEventListener("click", () => {
      estado.nivel = n.id;
      niveles.querySelectorAll(".opcion").forEach((o) => o.classList.remove("elegida"));
      btn.classList.add("elegida");
    });
    niveles.appendChild(btn);
  });

  // Portales: se puede buscar en varios a la vez.
  const cont = $("#opciones-portales");
  cont.innerHTML = "";
  estado.portales = json.portales.map((p) => p.id);
  json.portales.forEach((p) => {
    const lab = document.createElement("label");
    lab.className = "portal-check";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = true;
    inp.addEventListener("change", () => {
      estado.portales = inp.checked
        ? [...new Set([...estado.portales, p.id])]
        : estado.portales.filter((x) => x !== p.id);
    });
    lab.appendChild(inp);
    lab.insertAdjacentHTML("beforeend",
      `<span><strong>${p.nombre}</strong> <span class="detalle">${p.nota}</span></span>` +
      `<span class="estado ${p.postulable ? "activo" : "pronto"}">${p.postulable ? "Postula sola" : "Solo busca"}</span>`);
    cont.appendChild(lab);
  });

  await cargarCamposPersonales();
  opcionesCargadas = true;
}

$("#campo-puesto").addEventListener("input", revisarPuesto);
$("#btn-a-portales").addEventListener("click", () => {
  estado.puesto = $("#campo-puesto").value.trim();
  estado.ciudad = $("#campo-ciudad").value.trim();
  irAPaso("datos");
});

// ---------- paso 3b: datos personales opcionales ----------
async function cargarCamposPersonales() {
  const json = await (await fetch("/api/datos-personales")).json();
  const cont = $("#campos-personales");
  cont.innerHTML = "";
  json.campos.forEach((c) => {
    const fila = document.createElement("label");
    fila.className = "campo-personal";
    fila.innerHTML =
      `<span class="etiqueta-campo">${c.etiqueta}` +
      (c.sensible ? ` <span class="chip-sensible">dato sensible</span>` : "") +
      `</span><span class="detalle">${c.ayuda}</span>`;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.dataset.clave = c.clave;
    inp.value = json.guardados[c.clave] || "";
    inp.placeholder = "Opcional";
    fila.appendChild(inp);
    cont.appendChild(fila);
  });
}

$("#btn-saltar-datos").addEventListener("click", () => irAPaso(4));

$("#btn-guardar-datos").addEventListener("click", async () => {
  const datos = {};
  document.querySelectorAll("#campos-personales input").forEach((i) => {
    if (i.value.trim()) datos[i.dataset.clave] = i.value.trim();
  });
  try {
    const resp = await fetch("/api/datos-personales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const json = await resp.json();
    if (!resp.ok) {
      const detalle = Object.values(json.errores || {}).join(" · ");
      $("#estado-datos").textContent = `${json.error} ${detalle}`;
      return;
    }
    const n = Object.keys(json.guardados).length;
    $("#estado-datos").textContent = `Guardados ${n} dato(s) en tu computadora.`;
    irAPaso(4);
  } catch (e) {
    $("#estado-datos").textContent = `No se pudo guardar: ${e.message}`;
  }
});

// ---------- paso 4: privacidad + vacantes ----------
$("#check-sesion").addEventListener("change", (e) => {
  $("#btn-buscar").disabled = !e.target.checked;
});

// Abre el navegador local en la pantalla de acceso de Computrabajo.
// La persona escribe sus credenciales ahí; la plataforma no las ve.
$("#btn-abrir-navegador").addEventListener("click", async () => {
  const boton = $("#btn-abrir-navegador");
  boton.disabled = true;
  boton.textContent = "Abriendo…";
  try {
    const resp = await fetch("/api/navegador/abrir", { method: "POST" });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    $("#estado-sesion").textContent = json.mensaje || "Navegador abierto.";
  } catch (e) {
    $("#estado-sesion").textContent = `No se pudo abrir: ${e.message}`;
  } finally {
    boton.disabled = false;
    boton.textContent = "🌐 Abrir Computrabajo";
  }
});

$("#btn-verificar-sesion").addEventListener("click", async () => {
  const boton = $("#btn-verificar-sesion");
  const estado = $("#estado-sesion");
  boton.disabled = true;
  estado.textContent = "Verificando…";
  try {
    const resp = await fetch("/api/navegador/sesion");
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    if (json.activa) {
      estado.textContent = json.simulado
        ? "✅ Modo simulado: puedes continuar."
        : "✅ Tu sesión está abierta en Computrabajo.";
      const check = $("#check-sesion");
      check.checked = true;
      check.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      estado.textContent = "⚠️ Todavía no detectamos tu sesión. Inicia sesión en la ventana del navegador y vuelve a verificar.";
    }
  } catch (e) {
    estado.textContent = `No se pudo verificar: ${e.message}`;
  } finally {
    boton.disabled = false;
  }
});

$("#btn-buscar").addEventListener("click", async () => {
  const boton = $("#btn-buscar");
  boton.disabled = true;
  boton.textContent = "Buscando…";
  try {
    const params = new URLSearchParams({
      sesion_confirmada: "1",
      puesto: estado.puesto || "",
      nivel: estado.nivel || "cualquiera",
      ciudad: estado.ciudad || "",
      portales: (estado.portales || []).join(","),
      paginas: "2",
    });
    const resp = await fetch(`/api/vacantes?${params}`);
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    pintarVacantes(json.vacantes);

    // Si un portal falló, se dice cuál en vez de mostrar menos resultados
    // sin explicación.
    const cab = $("#resumen-busqueda");
    if (cab) {
      const fallos = (json.errores || []).map((e) => e.portal).join(", ");
      cab.textContent =
        `${json.vacantes.length} vacante(s) para «${json.busqueda}».` +
        (fallos ? ` No respondieron: ${fallos}.` : "");
    }
  } catch (e) {
    alert(`Ups: ${e.message}`);
  } finally {
    boton.disabled = false;
    boton.textContent = "Buscar vacantes";
  }
});

function pintarVacantes(vacantes) {
  // Se guardan para que el modo lote pueda usarlas sin volver a buscar.
  estado.vacantes = vacantes;
  const cont = $("#lista-vacantes");
  cont.innerHTML = "";
  if (!vacantes.length) {
    cont.innerHTML = `<p class="detalle">No hay vacantes de demostración para esa combinación — prueba con otra área o tipo.</p>`;
    return;
  }
  for (const v of vacantes) {
    const div = document.createElement("div");
    div.className = "vacante";
    // Las vacantes reales traen `publicado`; las simuladas, `descripcion` y `keywords`.
    const meta = [v.empresa, v.ubicacion, `vía ${v.portal}`, v.publicado]
      .filter(Boolean)
      .join(" · ");
    div.innerHTML =
      `<h4>${v.titulo}</h4>` +
      `<div class="meta">${meta}</div>` +
      (v.descripcion ? `<p>${v.descripcion}</p>` : "") +
      (v.keywords ? `<div>${v.keywords.map((k) => `<span class="etiqueta">${k}</span>`).join("")}</div>` : "") +
      (v.url ? `<p class="detalle"><a href="${v.url}" target="_blank" rel="noopener">Ver el aviso completo ↗</a></p>` : "");
    const btn = document.createElement("button");
    btn.className = "primario";
    btn.style.marginTop = "10px";
    btn.textContent = "Postular con revisión →";
    btn.addEventListener("click", () => {
      estado.vacanteElegida = v;
      pintarResumenPostulacion();
      irAPaso(5);
    });
    div.appendChild(btn);
    cont.appendChild(div);
  }
}

// ---------- paso 5: preparar -> revisar -> confirmar ----------
function pintarResumenPostulacion() {
  const v = estado.vacanteElegida;
  const meta = [v.empresa, v.ubicacion, `vía ${v.portal}`].filter(Boolean).join(" · ");
  $("#resumen-postulacion").innerHTML =
    `<div class="vacante"><h4>${v.titulo}</h4>` +
    `<div class="meta">${meta}</div>` +
    (v.descripcion ? `<p>${v.descripcion}</p>` : "") +
    `<p class="detalle">CV que se usará: <strong>${estado.cvGenerado || "CV Harvard generado"}</strong></p></div>`;

  // Estado inicial: solo se puede preparar; el envío aparece después.
  $("#reporte-preparacion").innerHTML = "";
  $("#alerta-datos-portal").classList.add("oculto");
  $("#wrap-revision").classList.add("oculto");
  $("#btn-confirmar-envio").classList.add("oculto");
  $("#btn-confirmar-envio").disabled = true;
  $("#check-revision").checked = false;
  $("#btn-preparar").classList.remove("oculto");
}

// Llena el formulario del portal SIN enviarlo.
$("#btn-preparar").addEventListener("click", async () => {
  const boton = $("#btn-preparar");
  boton.disabled = true;
  boton.textContent = "Preparando…";
  try {
    const resp = await fetch("/api/postular/preparar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: estado.vacanteElegida.url,
        perfil: estado.perfil,
        cv_archivo: estado.cvGenerado || "",
        datos_pendientes: (estado.perfil?.datos_faltantes || []).map((d) => d.etiqueta),
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    pintarReportePreparacion(json.reporte);
  } catch (e) {
    $("#reporte-preparacion").innerHTML = `<div class="alerta info">No se pudo preparar: ${e.message}</div>`;
  } finally {
    boton.disabled = false;
    boton.textContent = "Preparar formulario (no envía)";
  }
});

function pintarReportePreparacion(r) {
  const cont = $("#reporte-preparacion");

  // El portal mandó al login: no se preparó nada y no hay nada que enviar.
  if (r.requiere_login) {
    cont.innerHTML = `<div class="alerta info">🔒 ${r.nota}</div>`;
    $("#alerta-datos-portal").classList.add("oculto");
    $("#wrap-revision").classList.add("oculto");
    $("#btn-confirmar-envio").classList.add("oculto");
    return;
  }

  const completados = r.completados?.length
    ? `<p><strong>Se completó automáticamente:</strong></p><ul>${r.completados.map((c) => `<li>${c}</li>`).join("")}</ul>`
    : `<p class="detalle">No se completó ningún campo automáticamente.</p>`;
  cont.innerHTML = `<div class="alerta privacidad">${completados}<p class="detalle">${r.nota || ""}</p></div>`;

  // Datos que la plataforma no llena por regla: los escribe la persona.
  const pendientes = r.pendientes || [];
  const alerta = $("#alerta-datos-portal");
  if (pendientes.length) {
    alerta.classList.remove("oculto");
    alerta.innerHTML =
      `<strong>Mini-alerta 💡:</strong> el portal pide estos datos y <strong>no los completamos por ti</strong>. Escríbelos tú en la ventana del navegador antes de confirmar:` +
      `<ul>${pendientes.map((d) => `<li>${d}</li>`).join("")}</ul>`;
  } else {
    alerta.classList.add("oculto");
  }

  pintarPreguntas(r.preguntas || []);

  // Un CAPTCHA solo lo puede resolver la persona.
  if (r.captcha) {
    $("#wrap-revision").classList.add("oculto");
    $("#btn-confirmar-envio").classList.add("oculto");
    return;
  }
  if (r.listo_para_enviar) {
    $("#wrap-revision").classList.remove("oculto");
    $("#btn-confirmar-envio").classList.remove("oculto");
  }
}

// Preguntas de selección: borrador editable por pregunta. Las de
// consentimiento o compromiso salen vacías y marcadas — esas las
// contesta la persona, no la plataforma.
// Lo que la persona va aportando (distrito, disponibilidad, consentimiento).
// Con cada dato nuevo se vuelven a redactar los borradores.
estado.extras = {};

// Avisa si la redacción con modelo está activa o si se están usando las
// reglas de respaldo, que responden peor a preguntas poco comunes.
async function mostrarEstadoIA() {
  const linea = $("#estado-ia");
  if (!linea) return;
  try {
    const json = await (await fetch("/api/ia/estado")).json();
    linea.textContent = json.activa
      ? `🤖 Redacción con IA activa (${json.proveedor}: ${json.detalle}).`
      : "⚠️ Sin IA configurada: se usan reglas básicas y algunas respuestas saldrán pobres. Revísalas con cuidado.";
  } catch {
    linea.textContent = "";
  }
}

function pintarPreguntas(preguntas) {
  const bloque = $("#bloque-preguntas");
  const lista = $("#lista-preguntas");
  estado.preguntas = preguntas;
  $("#estado-respuestas").textContent = "";
  if (!preguntas.length) {
    bloque.classList.add("oculto");
    lista.innerHTML = "";
    return;
  }
  bloque.classList.remove("oculto");
  mostrarEstadoIA();
  lista.innerHTML = "";

  preguntas.forEach((p, n) => {
    const div = document.createElement("div");
    div.className = "pregunta";
    const necesita = p.necesita || [];
    // Los campos siguen visibles tras responderlos para poder cambiarlos;
    // el aviso solo aparece si de verdad queda algo sin contestar.
    const pendientes = necesita.filter((f) => !f.respondido);
    const etiqueta = pendientes.length
      ? `<span class="etiqueta decision">falta que respondas</span>`
      : (p.borrador ? `<span class="etiqueta">redactado desde tu CV</span>` : "");
    div.innerHTML = `<p class="enunciado"><strong>${n + 1}.</strong> ${p.enunciado} ${etiqueta}</p>`;

    // Datos que la plataforma no puede sacar del CV: se preguntan aquí.
    necesita.forEach((f) => {
      const caja = document.createElement("div");
      caja.className = "necesita";
      if (f.aviso) {
        caja.innerHTML = `<div class="alerta info">${f.aviso.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</div>`;
      }
      const lab = document.createElement("p");
      lab.className = "detalle";
      lab.textContent = f.etiqueta;
      caja.appendChild(lab);

      if (f.tipo === "opciones") {
        const grupo = document.createElement("div");
        grupo.className = "opciones";
        f.opciones.forEach((op) => {
          const btn = document.createElement("button");
          btn.className = "opcion";
          btn.textContent = op;
          if (estado.extras[f.clave] === op || (f.clave === "consentimiento" && estado.extras[f.clave] === "acepto" && op.startsWith("Sí"))) {
            btn.classList.add("elegida");
          }
          btn.addEventListener("click", () => {
            // El consentimiento se guarda como marca explícita, no como texto.
            estado.extras[f.clave] =
              f.clave === "consentimiento" ? (op.startsWith("Sí") ? "acepto" : "no") : op;
            reRedactar();
          });
          grupo.appendChild(btn);
        });
        caja.appendChild(grupo);
      } else {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "campo-extra";
        inp.value = estado.extras[f.clave] || "";
        inp.placeholder = "Escríbelo y sal del campo";
        inp.addEventListener("change", () => {
          estado.extras[f.clave] = inp.value.trim();
          reRedactar();
        });
        caja.appendChild(inp);
      }
      div.appendChild(caja);
    });

    const ta = document.createElement("textarea");
    ta.dataset.indice = p.indice;
    ta.rows = 3;
    ta.value = p.respuesta_actual || p.borrador || "";
    if (p.max) ta.maxLength = Number(p.max);
    ta.placeholder = pendientes.length
      ? "Responde arriba y aquí aparece la redacción — o escríbela tú."
      : "Revisa la redacción o cámbiala.";
    div.appendChild(ta);
    lista.appendChild(div);
  });
}

// Rehace los borradores con los datos nuevos, conservando lo que la
// persona ya haya editado a mano.
async function reRedactar() {
  const editados = {};
  document.querySelectorAll("#lista-preguntas textarea").forEach((ta) => {
    const original = (estado.preguntas.find((q) => String(q.indice) === ta.dataset.indice) || {}).borrador || "";
    if (ta.value.trim() && ta.value.trim() !== original.trim()) {
      editados[ta.dataset.indice] = ta.value.trim();
    }
  });
  try {
    const resp = await fetch("/api/postular/redactar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perfil: estado.perfil, extras: estado.extras, preguntas: estado.preguntas }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    pintarPreguntas(json.preguntas);
    // Restaurar lo que la persona había escrito a mano.
    document.querySelectorAll("#lista-preguntas textarea").forEach((ta) => {
      if (editados[ta.dataset.indice]) ta.value = editados[ta.dataset.indice];
    });
  } catch (e) {
    $("#estado-respuestas").textContent = `No se pudo redactar: ${e.message}`;
  }
}

$("#btn-escribir-respuestas").addEventListener("click", async () => {
  const boton = $("#btn-escribir-respuestas");
  const estado = $("#estado-respuestas");
  boton.disabled = true;
  boton.textContent = "Escribiendo…";
  try {
    const respuestas = {};
    document.querySelectorAll("#lista-preguntas textarea").forEach((ta) => {
      if (ta.value.trim()) respuestas[ta.dataset.indice] = ta.value.trim();
    });
    const resp = await fetch("/api/postular/responder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respuestas }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    const n = json.resultado?.escritas?.length || 0;
    const sinResponder = document.querySelectorAll("#lista-preguntas textarea").length - n;
    estado.textContent =
      `✅ Se escribieron ${n} respuesta(s) en el formulario.` +
      (sinResponder > 0 ? ` Quedan ${sinResponder} sin responder — complétalas en el navegador si son obligatorias.` : "");
  } catch (e) {
    estado.textContent = `No se pudieron escribir: ${e.message}`;
  } finally {
    boton.disabled = false;
    boton.textContent = "Escribir respuestas en el formulario";
  }
});

$("#check-revision").addEventListener("change", (e) => {
  $("#btn-confirmar-envio").disabled = !e.target.checked;
});

$("#btn-confirmar-envio").addEventListener("click", async () => {
  const boton = $("#btn-confirmar-envio");
  boton.disabled = true;
  boton.textContent = "Enviando…";
  try {
    const resp = await fetch("/api/postular/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vacante: estado.vacanteElegida,
        revision_humana: true,
        cv_archivo: estado.cvGenerado || "",
        datos_pendientes: (estado.perfil?.datos_faltantes || []).map((d) => d.etiqueta),
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    await pintarTracker();

    const r = json.resultado || {};
    const enviada = r.enviada !== false;
    if (enviada) {
      $("#reporte-preparacion").innerHTML =
        `<div class="alerta privacidad">✅ ${r.mensaje || "Postulación registrada."}</div>`;
      $("#check-revision").checked = false;
      $("#wrap-revision").classList.add("oculto");
      $("#btn-confirmar-envio").classList.add("oculto");
    } else {
      // No se pudo confirmar: mostrar el diagnóstico en vez de un aviso
      // genérico, y dejar el botón activo para reintentar.
      const d = r.diagnostico || {};
      const filas = [
        d.boton_pulsado && `Botón que se pulsó: <code>${d.boton_pulsado}</code>`,
        d.otros_botones?.length && `Otros botones detectados: ${d.otros_botones.map((b) => `<code>${b}</code>`).join(", ")}`,
        d.errores?.length && `Errores del portal: ${d.errores.join(" · ")}`,
        `La página ${d.cambio_url ? "sí" : "no"} cambió tras el clic.`,
      ].filter(Boolean);
      $("#reporte-preparacion").innerHTML =
        `<div class="alerta info"><strong>⚠️ ${r.mensaje}</strong>` +
        `<ul>${filas.map((f) => `<li>${f}</li>`).join("")}</ul>` +
        `<p class="detalle">Si faltan respuestas obligatorias, complétalas arriba y pulsa "Escribir respuestas en el formulario" antes de reintentar.</p></div>`;
      boton.disabled = false;
    }
  } catch (e) {
    alert(`Ups: ${e.message}`);
    boton.disabled = false;
  } finally {
    boton.textContent = "Confirmar envío";
  }
});

// ---------- postulación en lote ----------
// Dos modalidades: preparar-y-revisar (por defecto) y automática, esta
// última detrás de un consentimiento informado con casillas por riesgo.
estado.aprobacion = {};

async function pintarCasillasRiesgo() {
  const cont = $("#casillas-riesgo");
  if (cont.dataset.listo) return;
  const json = await (await fetch("/api/lote/consentimiento")).json();
  cont.innerHTML = "";
  json.casillas.forEach((c) => {
    const lab = document.createElement("label");
    lab.className = "confirmacion";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.addEventListener("change", () => {
      estado.aprobacion[c.clave] = inp.checked;
      const todas = json.casillas.every((x) => estado.aprobacion[x.clave]);
      $("#btn-confirmar-auto").disabled = !todas;
    });
    lab.appendChild(inp);
    lab.appendChild(document.createTextNode(" " + c.texto));
    cont.appendChild(lab);
  });
  cont.dataset.listo = "1";
}

$("#btn-lote-auto").addEventListener("click", async () => {
  await pintarCasillasRiesgo();
  $("#bloque-consentimiento").classList.remove("oculto");
});

$("#btn-cancelar-auto").addEventListener("click", () => {
  $("#bloque-consentimiento").classList.add("oculto");
  estado.aprobacion = {};
  document.querySelectorAll("#casillas-riesgo input").forEach((i) => (i.checked = false));
  $("#btn-confirmar-auto").disabled = true;
});

$("#btn-lote-revisado").addEventListener("click", () => arrancarLote("revisado"));
$("#btn-confirmar-auto").addEventListener("click", () => {
  $("#bloque-consentimiento").classList.add("oculto");
  arrancarLote("automatico");
});

async function arrancarLote(modo) {
  const vacantes = estado.vacantes || [];
  if (!vacantes.length) {
    alert("Primero busca vacantes en el paso 4.");
    return;
  }
  try {
    const resp = await fetch("/api/lote/preparar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vacantes,
        perfil: estado.perfil,
        extras: estado.extras,
        modo,
        aprobacion: estado.aprobacion,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    $("#progreso-lote").classList.remove("oculto");
    $("#plan-lote").innerHTML = "";
    $("#acciones-plan").classList.add("oculto");
    seguirLote();
  } catch (e) {
    alert(`No se pudo iniciar: ${e.message}`);
  }
}

let temporizadorLote = null;

function seguirLote() {
  clearInterval(temporizadorLote);
  temporizadorLote = setInterval(async () => {
    let s;
    try {
      s = await (await fetch("/api/lote/estado")).json();
    } catch {
      return;
    }
    const pct = s.total ? Math.round((s.hechas / s.total) * 100) : 0;
    $("#texto-progreso").textContent = `${s.mensaje} (${s.hechas}/${s.total})`;
    $("#barra-lote").style.width = `${pct}%`;

    if (s.fase === "listo" || s.fase === "terminado") {
      clearInterval(temporizadorLote);
      $("#progreso-lote").classList.add("oculto");
      pintarPlan(s);
      await pintarTracker();
    }
  }, 1500);
}

function pintarPlan(s) {
  const cont = $("#plan-lote");
  const iconos = { preparada: "📝", enviada: "✅", omitida: "⏭️", fallida: "❌", pendiente: "⏳" };
  cont.innerHTML = s.items
    .map(
      (i) =>
        `<div class="item-lote ${i.estado}">` +
        (s.modo === "revisado" && i.estado === "preparada"
          ? `<label class="confirmacion"><input type="checkbox" class="chk-lote" value="${i.id}" checked> </label>`
          : `<span class="icono">${iconos[i.estado] || ""}</span>`) +
        `<div class="cuerpo"><strong>${i.titulo}</strong> <span class="detalle">· ${i.empresa}</span>` +
        (i.cv ? `<div class="detalle">CV: ${i.cv}</div>` : "") +
        (i.cambios_cv?.length
          ? `<details><summary class="detalle">Cambios del CV (${i.cambios_cv.length})</summary><ul>${i.cambios_cv
              .map((c) => `<li>${c}</li>`)
              .join("")}</ul></details>`
          : "") +
        (i.motivo ? `<div class="detalle motivo">${i.motivo}</div>` : "") +
        `</div></div>`
    )
    .join("");

  const marcables = s.items.filter((i) => i.estado === "preparada").length;
  if (s.modo === "revisado" && marcables) {
    $("#acciones-plan").classList.remove("oculto");
    $("#resumen-plan").textContent = `${marcables} lista(s). Nada se ha enviado todavía.`;
  } else {
    $("#acciones-plan").classList.add("oculto");
  }
}

$("#btn-enviar-aprobadas").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".chk-lote:checked")].map((c) => c.value);
  if (!ids.length) {
    alert("No marcaste ninguna.");
    return;
  }
  if (!confirm(`Se enviarán ${ids.length} postulación(es). Esto no se puede deshacer. ¿Continuar?`)) return;
  const boton = $("#btn-enviar-aprobadas");
  boton.disabled = true;
  try {
    const resp = await fetch("/api/lote/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, revision_humana: true }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    $("#progreso-lote").classList.remove("oculto");
    $("#acciones-plan").classList.add("oculto");
    seguirLote();
  } catch (e) {
    alert(`No se pudo enviar: ${e.message}`);
  } finally {
    boton.disabled = false;
  }
});

$("#btn-cancelar-lote").addEventListener("click", async () => {
  await fetch("/api/lote/cancelar", { method: "POST" });
});

async function pintarTracker() {
  const resp = await fetch("/api/tracker");
  const json = await resp.json();
  const cont = $("#tabla-tracker");
  if (!json.postulaciones.length) {
    cont.innerHTML = `<p class="detalle">Aún no tienes postulaciones registradas.</p>`;
    return;
  }
  const filas = json.postulaciones
    .map(
      (p) =>
        `<tr><td>${p.fecha.replace("T", " ")}</td><td>${p.puesto}</td>` +
        `<td>${p.empresa}</td><td>${p.portal}</td><td>${p.estado}</td>` +
        `<td>${p.datos_pendientes?.length ? "⚠️ " + p.datos_pendientes.join(", ") : "—"}</td></tr>`
    )
    .join("");
  cont.innerHTML =
    `<table><thead><tr><th>Fecha</th><th>Puesto</th><th>Empresa</th><th>Portal</th><th>Estado</th><th>Pendientes</th></tr></thead>` +
    `<tbody>${filas}</tbody></table>`;
}

pintarTracker();

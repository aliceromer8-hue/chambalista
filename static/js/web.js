// Convertidor de CV, versión web pública.
// Sin dependencias: la página debe cargar al instante en cualquier móvil.

const $ = (s) => document.querySelector(s);
const estado = { archivo: null, perfil: null };
const CLAVE_LS = "chamba_ia_key";

// ---------- clave de IA (vive solo en este navegador) ----------
function claveGuardada() {
  try { return localStorage.getItem(CLAVE_LS) || ""; } catch { return ""; }
}

function pintarEstadoClave() {
  const p = $("#pastilla-ia");
  if (claveGuardada()) {
    p.textContent = "activa";
    p.className = "pastilla ok";
  } else {
    p.textContent = "sin configurar";
    p.className = "pastilla";
  }
}

$("#guardar-clave").addEventListener("click", () => {
  const v = $("#clave-ia").value.trim();
  try {
    if (v) localStorage.setItem(CLAVE_LS, v);
    else localStorage.removeItem(CLAVE_LS);
  } catch { /* navegación privada: se sigue sin guardar */ }
  $("#clave-ia").value = "";
  pintarEstadoClave();
});

$("#borrar-clave").addEventListener("click", () => {
  try { localStorage.removeItem(CLAVE_LS); } catch {}
  $("#clave-ia").value = "";
  pintarEstadoClave();
});

// ---------- subir ----------
const zona = $("#zona");
const input = $("#archivo");

$("#elegir").addEventListener("click", () => input.click());
input.addEventListener("change", () => elegir(input.files[0]));

zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("activa"); });
zona.addEventListener("dragleave", () => zona.classList.remove("activa"));
zona.addEventListener("drop", (e) => {
  e.preventDefault();
  zona.classList.remove("activa");
  elegir(e.dataTransfer.files[0]);
});

function elegir(f) {
  if (!f) return;
  if (f.size > 6 * 1024 * 1024) {
    $("#estado").textContent = "El archivo pesa más de 6 MB.";
    return;
  }
  estado.archivo = f;
  $("#nombre-archivo").textContent = f.name;
  $("#procesar").disabled = false;
  $("#estado").textContent = "";
}

// ---------- procesar ----------
$("#procesar").addEventListener("click", async () => {
  const boton = $("#procesar");
  boton.disabled = true;
  boton.textContent = "Convirtiendo…";
  $("#estado").textContent = claveGuardada()
    ? "Leyendo tu CV con IA, esto tarda unos segundos…"
    : "Leyendo tu CV…";

  try {
    const datos = new FormData();
    datos.append("cv", estado.archivo);
    const cabeceras = {};
    const clave = claveGuardada();
    if (clave) cabeceras["X-IA-Key"] = clave;

    const resp = await fetch("/api/cv/procesar", { method: "POST", body: datos, headers: cabeceras });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error);
    estado.perfil = json.perfil;

    const prev = await fetch("/api/cv/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.perfil),
    });
    const pj = await prev.json();
    $("#preview").innerHTML = pj.html || "";

    await pintarSugerencias();

    $("#estado").textContent = "";
    $("#zona-1").classList.add("oculto");
    $("#zona-2").classList.remove("oculto");
    // El paso de instalar solo aparece cuando ya hay un CV convertido:
    // antes de eso no significa nada y sería una interrupción.
    $("#zona-3").classList.remove("oculto");

    // Lo que sobra una vez que ya convirtió: la cadena de cuatro pasos y
    // «Qué pasa con tu CV» son argumentos para decidirse a subirlo. Ya lo
    // subió. Dejarlos ahí es hacerle leer el anuncio después de comprar.
    for (const s of ["#cadena", "#rotulo-subir", "#privacidad"]) {
      $(s).classList.add("oculto");
    }

    // Y se lleva la vista AL RESULTADO, no arriba del todo: subir al tope
    // le enseñaba otra vez el titular en lugar de su CV, y tenía que
    // buscar dónde había quedado lo que acababa de pedir.
    $("#zona-2").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    $("#estado").textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = "Convertir mi CV";
  }
});

// ---------- descargar ----------
$("#descargar").addEventListener("click", async () => {
  const boton = $("#descargar");
  boton.disabled = true;
  try {
    const resp = await fetch("/api/cv/descargar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.perfil),
    });
    if (!resp.ok) throw new Error("No se pudo generar el archivo.");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CV-${(estado.perfil.nombre || "Harvard").replace(/\s+/g, "-")}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- qué puestos buscar ----------
// El CV convertido no sirve de nada guardado en Descargas. Esto es el
// puente: le dice qué buscar y por qué, en el mismo momento en que
// acaba de ver su CV nuevo y está con ganas.
//
// Sale de reglas, no de IA: instantáneo, gratis y explicable. Si no se
// puede deducir, no se pinta nada — más vale callar que sugerirle
// puestos donde lo van a filtrar.

const escapar = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function pintarSugerencias() {
  const caja = $("#sugerencias");
  caja.classList.add("oculto");
  caja.innerHTML = "";
  try {
    const r = await fetch("/api/cv/sugerencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.perfil),
    });
    if (!r.ok) return;
    const s = await r.json();
    if (!s.puestos?.length) return;

    const fichas = s.puestos.slice(0, 6).map((p) => `
      <a class="ficha-puesto" target="_blank" rel="noopener"
         href="https://pe.computrabajo.com/trabajo-de-${encodeURIComponent(p.texto.toLowerCase().replace(/\s+/g, "-"))}">
        <strong>${escapar(p.texto)}</strong>
        <span>${escapar(p.razon)}</span>
      </a>`).join("");

    caja.innerHTML = `
      <p class="antetitulo">Con este CV puedes buscar</p>
      <p class="lectura">${escapar(s.explicacion)}</p>
      <div class="rejilla-puestos">${fichas}</div>
      <p class="detalle">Si no encaja, busca lo que tú quieras: esto es solo un atajo.</p>`;
    caja.classList.remove("oculto");
  } catch {
    // Que falle no rompe la conversión, que es lo que vino a hacer.
  }
}

$("#otro").addEventListener("click", () => {
  estado.archivo = estado.perfil = null;
  input.value = "";
  $("#nombre-archivo").textContent = "";
  $("#procesar").disabled = true;
  $("#zona-2").classList.add("oculto");
  $("#zona-3").classList.add("oculto");
  for (const s of ["#cadena", "#rotulo-subir", "#privacidad", "#zona-1"]) {
    $(s).classList.remove("oculto");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
});

pintarEstadoClave();

// Convertidor de CV, versión web pública.
// Sin dependencias: la página debe cargar al instante en cualquier móvil.

const $ = (s) => document.querySelector(s);
const estado = { archivo: null, perfil: null };
// ---------- qué se dice sobre la IA ----------
// La frase de privacidad NO va fija en el HTML: depende de si la clave de
// Gemini tiene facturación activada. En el plan gratuito, Google usa lo
// que se le envía para mejorar sus productos y personal suyo puede
// llegar a leerlo — y lo que se envía son CVs con nombres y teléfonos de
// otras personas. Con facturación eso deja de pasar.
//
// Se pregunta al servidor en vez de escribirlo a mano porque una frase
// fija se convierte en mentira en cuanto cambia la configuración, y esta
// en concreto es una promesa de privacidad.
async function pintarPrivacidadIA() {
  const li = $("#privacidad-ia");
  if (!li) return;
  try {
    const e = await (await fetch("/api/estado")).json();
    if (!e.ia_activa) {
      li.textContent = "Tu CV se lee aquí mismo, sin enviarlo a ningún otro sitio.";
    } else if (e.ia_facturada) {
      li.innerHTML = "Para leer tu CV, su texto se envía a <strong>Google</strong>, "
        + "que lo procesa y no lo usa para entrenar sus modelos.";
    } else {
      li.innerHTML = "Para leer tu CV, su texto se envía a <strong>Google</strong>. "
        + "Hoy va por su plan gratuito, y en ese plan Google puede usarlo para "
        + "mejorar sus productos y personal suyo puede llegar a leerlo.";
    }
  } catch { /* si falla, queda la frase corta del HTML */ }
}

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
  $("#estado").textContent = "Leyendo tu CV, esto tarda unos segundos…";

  try {
    // Sin cabecera de clave: la IA la pone el servidor. La persona no
    // tiene que crear ninguna cuenta en Google para usar esto.
    const datos = new FormData();
    datos.append("cv", estado.archivo);
    const resp = await fetch("/api/cv/procesar", { method: "POST", body: datos });
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
      <p class="detalle">¿No encaja ninguno? Escribe el que tú quieras:</p>
      <form class="buscador-libre" id="buscador-libre">
        <input type="text" id="puesto-libre" autocomplete="off"
               placeholder="Enfermera, cajero, practicante de derecho, chef…">
        <button class="boton principal" type="submit">Buscar</button>
      </form>`;

    // Antes esto solo DECÍA que buscara lo que quisiera y no había dónde
    // escribirlo: la persona tenía que ir a Computrabajo por su cuenta.
    caja.querySelector("#buscador-libre").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const q = caja.querySelector("#puesto-libre").value.trim();
      if (!q) return;
      const ruta = q.toLowerCase().replace(/\s+/g, "-");
      window.open(`https://pe.computrabajo.com/trabajo-de-${encodeURIComponent(ruta)}`,
                  "_blank", "noopener");
    });
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

pintarPrivacidadIA();

// ---------- cuenta ----------
// Convertir el CV NO pide cuenta: es el gancho y tiene que seguir sin
// fricción. Postular SÍ, porque lo que se envía lleva el nombre de la
// persona a empresas reales y tiene que quedar claro de quién viene.
//
// La sesión vive en localStorage. Es lo normal en una web sin servidor
// de sesiones, y el token caduca solo; si el navegador la pierde, se
// vuelve a entrar y no se pierde nada, porque los datos están en la nube.
const SESION = "chamba_sesion";

function sesion() {
  try { return JSON.parse(localStorage.getItem(SESION) || "null"); } catch { return null; }
}

function guardarSesion(s) {
  try {
    if (s) localStorage.setItem(SESION, JSON.stringify(s));
    else localStorage.removeItem(SESION);
  } catch { /* navegación privada */ }
}

/** Cabecera de autorización, si hay sesión. */
function conSesion(extra = {}) {
  const s = sesion();
  return s?.token ? { ...extra, Authorization: `Bearer ${s.token}` } : extra;
}

function pintarCuenta() {
  const s = sesion();
  const dentro = Boolean(s?.token);
  $("#quien-soy").textContent = dentro ? s.usuario.correo : "";
  $("#btn-entrar").classList.toggle("oculto", dentro);
  $("#btn-salir").classList.toggle("oculto", !dentro);
  // El paso de postular enseña el botón que toca según haya sesión o no.
  const instalar = $("#instalar"), pedirCuenta = $("#instalar-entrar"), porque = $("#por-que-cuenta");
  if (instalar && pedirCuenta) {
    instalar.classList.toggle("oculto", !dentro);
    pedirCuenta.classList.toggle("oculto", dentro);
    if (porque) porque.classList.toggle("oculto", dentro);
  }
}

// El diálogo hace las dos cosas: entrar y registrarse. Separarlos obliga
// a decidir antes de saber si ya tienes cuenta, que es justo lo que la
// gente no recuerda.
let modoRegistro = false;

function pintarModo() {
  $("#titulo-cuenta").textContent = modoRegistro ? "Crea tu cuenta" : "Entra a tu cuenta";
  $("#sub-cuenta").textContent = modoRegistro
    ? "Hace falta para postular: lo que se envía va con tu nombre."
    : "Tu CV y tus postulaciones te siguen entre dispositivos.";
  $("#btn-enviar").textContent = modoRegistro ? "Crear cuenta" : "Entrar";
  $("#btn-cambiar").textContent = modoRegistro
    ? "¿Ya tienes cuenta? Entra"
    : "¿No tienes cuenta? Créala";
  $("#contrasena").setAttribute("autocomplete", modoRegistro ? "new-password" : "current-password");
  errorCuenta("");
}

function errorCuenta(t) {
  const p = $("#error-cuenta");
  p.textContent = t || "";
  p.classList.toggle("oculto", !t);
}

function abrirCuenta(registro = false) {
  modoRegistro = registro;
  pintarModo();
  $("#dlg-cuenta").showModal();
}

$("#btn-entrar").addEventListener("click", () => abrirCuenta(false));
$("#instalar-entrar")?.addEventListener("click", () => abrirCuenta(true));
$("#btn-cerrar").addEventListener("click", () => $("#dlg-cuenta").close());
$("#btn-cambiar").addEventListener("click", () => { modoRegistro = !modoRegistro; pintarModo(); });

$("#btn-olvide").addEventListener("click", async () => {
  const correo = $("#correo").value.trim();
  if (!correo) { errorCuenta("Escribe tu correo primero."); return; }
  await fetch("/api/cuenta/recuperar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correo }),
  });
  // Siempre el mismo mensaje: decir si un correo está registrado le
  // confirma a un desconocido quién tiene cuenta aquí.
  errorCuenta("Si ese correo tiene cuenta, te llegará un enlace para cambiar la contraseña.");
});

$("#form-cuenta").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const correo = $("#correo").value.trim();
  const contrasena = $("#contrasena").value;
  const boton = $("#btn-enviar");
  boton.disabled = true;
  errorCuenta("");
  try {
    const r = await fetch(`/api/cuenta/${modoRegistro ? "registrar" : "entrar"}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo, contrasena }),
    });
    const j = await r.json();
    if (!r.ok) { errorCuenta(j.error || "No se pudo completar."); return; }
    if (j.falta_confirmar) {
      errorCuenta("Cuenta creada. Confirma el correo que te enviamos y vuelve a entrar.");
      modoRegistro = false; pintarModo();
      return;
    }
    guardarSesion(j);
    pintarCuenta();
    $("#dlg-cuenta").close();
    $("#contrasena").value = "";
  } catch (e) {
    errorCuenta("No se pudo conectar. Inténtalo de nuevo.");
  } finally {
    boton.disabled = false;
  }
});

$("#btn-salir").addEventListener("click", async () => {
  try {
    await fetch("/api/cuenta/salir", { method: "POST", headers: conSesion() });
  } catch { /* da igual: lo que importa es soltarla de aquí */ }
  guardarSesion(null);
  pintarCuenta();
});

// Al cargar: si el token caducó, se limpia en vez de dejar una sesión
// muerta que falla en la primera petición sin explicar por qué.
(async () => {
  pintarCuenta();
  if (!sesion()?.token) return;
  try {
    const r = await fetch("/api/cuenta/yo", { headers: conSesion() });
    const j = await r.json();
    if (!j.usuario) { guardarSesion(null); pintarCuenta(); }
  } catch { /* sin red: se deja como está */ }
})();

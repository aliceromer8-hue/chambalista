// Convertidor de CV, versión web pública.
// Sin dependencias: la página debe cargar al instante en cualquier móvil.

const $ = (s) => document.querySelector(s);
const estado = { archivo: null, perfil: null };

// ---------- no perder lo hecho ----------
// El CV convertido se guarda en el navegador. Sin esto, salir a mirar una
// vacante —que es justo lo que la página invita a hacer— borraba todo el
// trabajo: al volver había que subir el CV otra vez y esperar de nuevo a
// que la IA lo leyera. Perder el progreso por seguir un enlace nuestro es
// el peor momento posible para perderlo.
//
// Se guarda solo el perfil ya convertido, no el archivo original: es lo
// que cuesta obtener, y el archivo lo tiene ella en su disco.
const TRABAJO = "chamba_trabajo";

function guardarTrabajo() {
  try {
    if (estado.perfil) {
      localStorage.setItem(TRABAJO, JSON.stringify({
        perfil: estado.perfil,
        cuando: Date.now(),
      }));
    } else {
      localStorage.removeItem(TRABAJO);
    }
  } catch { /* navegación privada: se sigue sin guardar */ }
}

function trabajoGuardado() {
  try {
    const t = JSON.parse(localStorage.getItem(TRABAJO) || "null");
    // Una semana. Más allá, el CV probablemente ya cambió y restaurarlo
    // sería enseñarle algo viejo sin que sepa de dónde salió.
    if (!t?.perfil || Date.now() - (t.cuando || 0) > 7 * 24 * 3600 * 1000) return null;
    return t.perfil;
  } catch { return null; }
}
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
      li.textContent = "aquí mismo, sin salir";
    } else if (e.ia_facturada) {
      li.textContent = "lo lee Google, sin entrenar con él";
    } else {
      // La única de las tres que no cabe en cuatro palabras, y no se
      // recorta más: que Google pueda usar el CV y que alguien suyo pueda
      // leerlo son los dos hechos que a la persona le importan. Decir
      // solo «lo lee Google» aquí sería quedarse con la mitad cómoda.
      li.textContent = "lo lee Google · en su plan gratis puede usarlo y revisarlo";
    }
  } catch { /* si falla, queda la frase del HTML */ }
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

    guardarTrabajo();
    subirPerfil();          // a la cuenta, si la hay. No se espera.

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

function volverAlPrincipio() {
  input.value = "";
  $("#nombre-archivo").textContent = "";
  $("#procesar").disabled = true;
  $("#zona-2").classList.add("oculto");
  $("#zona-3").classList.add("oculto");
  $("#nota-restaurado")?.classList.add("oculto");
  for (const s of ["#cadena", "#rotulo-subir", "#privacidad", "#zona-1"]) {
    $(s).classList.remove("oculto");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#otro").addEventListener("click", () => {
  estado.archivo = estado.perfil = null;
  guardarTrabajo();          // al vaciarse el perfil, esto lo borra
  volverAlPrincipio();
});

// Al volver, se recupera lo que ya estaba hecho.
//
// Se repinta desde el perfil guardado en vez de rehacer la conversión:
// no se vuelve a subir nada, no se vuelve a llamar a la IA y no se vuelve
// a esperar. La vista previa y las sugerencias sí se piden otra vez,
// porque son baratas y así reflejan cualquier cambio del formato.
async function repintarResultado() {
  try {
    const prev = await fetch("/api/cv/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.perfil),
    });
    $("#preview").innerHTML = (await prev.json()).html || "";
  } catch { /* sin red: se enseña igual lo demás */ }

  await pintarSugerencias();

  $("#zona-1").classList.add("oculto");
  $("#zona-2").classList.remove("oculto");
  $("#zona-3").classList.remove("oculto");
  for (const sel of ["#cadena", "#rotulo-subir", "#privacidad"]) {
    $(sel).classList.add("oculto");
  }
}

async function restaurarTrabajo() {
  const perfil = trabajoGuardado();
  if (!perfil) return;
  // Sin sesión no se restaura, aunque haya copia en el navegador: todo lo
  // que se puede hacer con ese CV —la vista previa, el .docx, las
  // sugerencias— pide cuenta. Enseñarlo sería una pantalla que se ve
  // entera y falla en el primer botón.
  if (!sesion()?.token) return;
  estado.perfil = perfil;
  await repintarResultado();

  // Se avisa de que esto viene de antes. Encontrarse la página ya
  // avanzada sin explicación desconcierta más que ayudar.
  const nota = $("#nota-restaurado");
  if (nota) nota.classList.remove("oculto");
}

// El camino se recorre CUANDO SE VE, no al cargar la página.
//
// La sección está abajo del todo: si la animación arranca con la carga,
// para cuando alguien baja hasta ahí ya terminó y lo que encuentra es una
// línea quieta. Animar algo que nadie está mirando es gastar el efecto.
//
// Sin este JavaScript la sección se ve igual de bien, solo que quieta:
// el CSS deja por defecto el camino ya recorrido y las paradas
// encendidas. Por eso lo primero que se hace es «apagarlo», y solo si de
// verdad se va a poder encender.
function animarRuta() {
  const zona = document.querySelector(".ruta-envoltura");
  if (!zona || !("IntersectionObserver" in window)) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  zona.classList.add("por-recorrer");

  // Red de seguridad. Apagar el camino y esperar a que alguien lo mire es
  // una apuesta: si el navegador nunca avisa —una pestaña que se abrió de
  // fondo y no se ha llegado a pintar, por ejemplo— la sección se queda
  // en blanco para siempre, que es mucho peor que quieta.
  //
  // Un IntersectionObserver siempre entrega una primera respuesta al
  // observar, aunque sea «no se ve». Si a los dos segundos no ha llegado
  // NINGUNA, este navegador no va a avisar: se enciende y se acabó.
  let hubo = false;
  const ojo = new IntersectionObserver((entradas) => {
    hubo = true;
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      zona.classList.replace("por-recorrer", "recorriendo");
      ojo.disconnect();        // se recorre una vez, no cada vez que pasa
    }
  }, { threshold: 0.45 });
  ojo.observe(zona);

  setTimeout(() => {
    if (hubo) return;
    ojo.disconnect();
    zona.classList.remove("por-recorrer");   // queda como si no hubiera JS
  }, 2000);
}

pintarPrivacidadIA();
animarRuta();
restaurarTrabajo();

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
    if (s) {
      // Se anota CUÁNDO caduca, no solo cuánto duraba: al recargar la
      // página horas después, «expira_en: 3600» ya no dice nada.
      if (s.expira_en) s.caduca = Date.now() + (s.expira_en - 60) * 1000;
      localStorage.setItem(SESION, JSON.stringify(s));
    } else {
      localStorage.removeItem(SESION);
    }
  } catch { /* navegación privada */ }
}

// El token de Supabase dura una hora. Sin esto, a la hora justa la
// sesión moría y la página echaba a la persona sin decir por qué, en
// mitad de lo que estuviera haciendo. Se cambia por uno nuevo con el
// token de refresco, que dura mucho más y para eso lo guardamos.
let renovando = null;

async function renovarSesion() {
  const s = sesion();
  if (!s?.refresco) return null;
  // Si dos llamadas piden renovar a la vez, una sola petición: dos
  // renovaciones en paralelo invalidan la una a la otra.
  renovando = renovando || (async () => {
    try {
      const r = await fetch("/api/cuenta/renovar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresco: s.refresco }),
      });
      const j = await r.json();
      if (!r.ok || !j.token) { guardarSesion(null); pintarCuenta(); return null; }
      guardarSesion(j);
      pintarCuenta();
      return j;
    } catch { return null; }
    finally { renovando = null; }
  })();
  return renovando;
}

/** Como fetch, pero con la sesión puesta y renovándola si hizo falta. */
async function conCuenta(url, opciones = {}) {
  const s = sesion();
  if (s?.caduca && Date.now() > s.caduca) await renovarSesion();
  const ir = () => fetch(url, { ...opciones, headers: conSesion(opciones.headers || {}) });
  let r = await ir();
  // Un 401 después de renovar es una sesión de verdad muerta; uno antes
  // puede ser solo un token vencido antes de lo previsto.
  if (r.status === 401 && sesion()?.refresco && await renovarSesion()) r = await ir();
  return r;
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
  // La puerta tapa la zona de subir mientras no haya sesión. Todo el
  // producto pide cuenta, así que enseñar el recuadro de arrastrar el CV
  // a quien no puede usarlo solo sirve para que se estrelle al soltarlo.
  const puerta = $("#puerta"), zonaSubir = $("#zona"), convertir = $("#procesar");
  if (puerta && zonaSubir) {
    puerta.classList.toggle("oculto", dentro);
    zonaSubir.classList.toggle("oculto", !dentro);
    convertir.classList.toggle("oculto", !dentro);
  }
  pintarDatos();
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
  // La casilla solo al crear cuenta: quien ya entra la aceptó en su día,
  // y volver a pedirla en cada inicio de sesión la convierte en un
  // trámite que se marca sin leer.
  $("#fila-acepta").classList.toggle("oculto", !modoRegistro);
  $("#acepta").checked = false;
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
$("#puerta-crear")?.addEventListener("click", () => abrirCuenta(true));
$("#puerta-entrar")?.addEventListener("click", () => abrirCuenta(false));
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
  if (modoRegistro && !$("#acepta").checked) {
    errorCuenta("Marca la casilla para aceptar la política de privacidad y las condiciones.");
    return;
  }
  boton.disabled = true;
  errorCuenta("");
  try {
    const r = await fetch(`/api/cuenta/${modoRegistro ? "registrar" : "entrar"}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo, contrasena, acepta: $("#acepta").checked }),
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
    // Si ya venía trabajando sin cuenta, ese CV es el bueno y se sube.
    // Si llega en blanco, se baja el que tuviera guardado. Así entrar
    // hace algo por ella, que era justo lo que no pasaba.
    if (estado.perfil) subirPerfil(); else bajarPerfil();
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
  estado.archivo = estado.perfil = null;
  try { localStorage.removeItem(TRABAJO); } catch { /* navegación privada */ }
  pintarCuenta();
  // Sin sesión no se puede hacer nada con lo que quedaba en pantalla:
  // dejarlo ahí es una pantalla que falla en el primer clic.
  volverAlPrincipio();
});

// ---------- el CV, en la nube ----------
// El diálogo prometía «tu CV y tus postulaciones te siguen entre
// dispositivos» y no era verdad: la sesión se abría y no se subía nada.
// Entrar no servía absolutamente para nada. Esto es lo que lo cumple.
//
// El guardado es un extra silencioso: si falla, no se avisa ni se
// interrumpe. La copia del navegador sigue estando y es la que se usa.

async function subirPerfil() {
  if (!estado.perfil || !sesion()?.token) return;
  try {
    await conCuenta("/api/nube/perfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.perfil),
    });
  } catch { /* silencioso a propósito */ }
}

async function bajarPerfil() {
  if (!sesion()?.token || estado.perfil) return;   // lo de aquí manda
  try {
    const r = await conCuenta("/api/nube/perfil");
    if (!r.ok) return;
    const perfil = (await r.json()).perfil;
    if (!perfil) return;
    estado.perfil = perfil;
    guardarTrabajo();
    await repintarResultado();
    const nota = $("#nota-restaurado");
    if (nota) {
      nota.textContent = "Este es el CV que tenías guardado en tu cuenta.";
      nota.classList.remove("oculto");
    }
  } catch { /* sin red: se sigue sin ello */ }
}

// ---------- mis datos ----------
function pintarDatos() {
  const s = sesion();
  const zona = $("#zona-datos");
  if (!zona) return;
  zona.classList.toggle("oculto", !s?.token);
  if (s?.token) $("#datos-correo").textContent = s.usuario.correo;
}

function avisoDatos(t) {
  const p = $("#aviso-datos");
  if (!p) return;
  p.textContent = t || "";
  p.classList.toggle("oculto", !t);
}

// Derecho de acceso: llevarse una copia, en un formato que se pueda
// abrir en cualquier sitio. Se arma en el navegador con lo que ya
// devuelven las dos rutas; no hace falta pedirle nada a nadie.
$("#btn-descargar-datos")?.addEventListener("click", async () => {
  avisoDatos("Preparando…");
  try {
    const [p, q] = await Promise.all([
      conCuenta("/api/nube/perfil"),
      conCuenta("/api/nube/postulaciones"),
    ]);
    const datos = {
      cuenta: sesion()?.usuario?.correo || null,
      exportado: new Date().toISOString(),
      cv: p.ok ? (await p.json()).perfil : null,
      postulaciones: q.ok ? (await q.json()).postulaciones : [],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "mis-datos-chamba-lista.json";
    a.click();
    URL.revokeObjectURL(url);
    avisoDatos("");
  } catch {
    avisoDatos("No se pudo preparar la descarga. Inténtalo de nuevo.");
  }
});

// Derecho de cancelación, ejercido en el acto. Se confirma porque no
// tiene vuelta atrás, y se dice exactamente qué desaparece: «¿estás
// seguro?» no le dice a nadie qué está a punto de perder.
$("#btn-borrar-todo")?.addEventListener("click", async () => {
  const correo = sesion()?.usuario?.correo || "tu cuenta";
  const seguro = confirm(
    `Se va a borrar ${correo}, tu CV guardado y todo tu historial de postulaciones.`
    + `

No se puede deshacer y no guardamos copia. ¿Seguimos?`);
  if (!seguro) return;
  avisoDatos("Borrando…");
  try {
    const r = await conCuenta("/api/cuenta", { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { avisoDatos(j.error || "No se pudo borrar."); return; }
    // Se limpia también lo del navegador: dejar el CV en localStorage
    // después de borrar la cuenta sería no haber borrado nada.
    guardarSesion(null);
    try { localStorage.removeItem(TRABAJO); } catch {}
    alert("Listo. Tu cuenta y tus datos se han borrado.");
    location.reload();
  } catch {
    avisoDatos("No se pudo conectar. Inténtalo de nuevo.");
  }
});

// Al cargar: si el token caducó, se renueva; si ya no hay forma, se
// limpia en vez de dejar una sesión muerta que falla en la primera
// petición sin explicar por qué.
(async () => {
  pintarCuenta();
  pintarDatos();
  if (!sesion()?.token) return;
  try {
    const r = await conCuenta("/api/cuenta/yo");
    const j = await r.json();
    if (!j.usuario) { guardarSesion(null); pintarCuenta(); pintarDatos(); return; }
    await bajarPerfil();
  } catch { /* sin red: se deja como está */ }
})();

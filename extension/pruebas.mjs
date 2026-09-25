// Pruebas de la lógica de la extensión, fuera de Chrome.
//
//   node extension/pruebas.mjs
//
// Simula chrome.storage para poder cargar los módulos. Cubre lo que se
// puede romper en silencio: la búsqueda libre, la validación de datos y
// —lo más importante— que las preguntas de consentimiento y compromiso
// nunca se respondan solas.

const BASE = new URL(".", import.meta.url).href;

const almacenFalso = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k in almacenFalso ? { [k]: almacenFalso[k] } : {}),
      set: async (o) => Object.assign(almacenFalso, o),
      remove: async (k) => { delete almacenFalso[k]; },
    },
  },
};
// El proxy de IA no debe llamarse en estas pruebas: se corta la red.
globalThis.fetch = async () => { throw new Error("sin red en las pruebas"); };

const { terminoBusqueda, PORTALES, LISTA_PORTALES } = await import(`${BASE}lib/portales.js`);
const datos = await import(`${BASE}lib/datos.js`);
const respuestas = await import(`${BASE}lib/respuestas.js`);
const almacen = await import(`${BASE}lib/almacen.js`);

const fs2 = await import("node:fs");

let fallos = 0;
const check = (nombre, ok, extra = "") => {
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${extra ? " — " + extra : ""}`);
  if (!ok) fallos++;
};
const titulo = (t) => console.log(`\n${"=".repeat(70)}\n${t}\n${"=".repeat(70)}`);

titulo("BÚSQUEDA LIBRE — cualquier profesión, sin lista cerrada");
for (const [entrada, nivel, esperado] of [
  ["enfermera", "practicas", "practicante de enfermera"],
  ["practicante de derecho", "practicas", "practicante de derecho"],
  ["psicologo organizacional", "semi", "psicologo organizacional"],
  ["cajero", "cualquiera", "cajero"],
  ["jefe de sistemas", "senior", "jefe de sistemas"],
]) {
  const got = terminoBusqueda(entrada, nivel);
  check(`«${entrada}» (${nivel})`, got === esperado, got);
}
check("URL de Computrabajo",
  PORTALES.computrabajo.url("practicante de enfermeria", "Trujillo") ===
  "https://pe.computrabajo.com/trabajo-de-practicante-de-enfermeria-en-trujillo");
check("URL de Bumeran",
  PORTALES.bumeran.url("cajero", "Arequipa").includes("empleos-busqueda-cajero-en-arequipa"));
check("URL de Indeed",
  PORTALES.indeed.url("analista de datos", "Lima").includes("q=analista+de+datos"));
check("los cuatro portales están registrados", LISTA_PORTALES.length === 4,
  LISTA_PORTALES.map((p) => p.nombre).join(", "));
// Un portal marcado `postulable` tiene que tener de verdad las funciones
// de postular. Marcarlo sin escribirlas hace que la extension lo intente,
// falle a medias y deje a la persona creyendo que postulo.
{
  const fsp = await import("node:fs/promises");
  const postulables = LISTA_PORTALES.filter((p) => p.postulable).map((p) => p.id);
  check("hay al menos un portal que postula", postulables.length >= 1, postulables.join(", "));
  for (const id of postulables) {
    const codigo = await fsp.readFile(new URL(`contenido/${id}.js`, BASE), "utf8");
    check(`${id} tiene el codigo de postular, no solo la marca`,
      /function botonPostular/.test(codigo) && /async function enviar/.test(codigo));
    // Quien envia tiene que confirmar que entro. Quien NO envia —LinkedIn—
    // no necesita confirmar nada: lo que tiene que demostrar es lo
    // contrario, que no hay camino de envio.
    if (LISTA_PORTALES.find((p) => p.id === id)?.soloRevisado) {
      check(`${id} no envia, asi que no necesita confirmacion`,
        !/function confirmada/.test(codigo));
    } else {
      check(`${id} comprueba el envio por confirmacion, no por ausencia`,
        /function confirmada/.test(codigo));
    }
    check(`${id} se protege del redirect al login`,
      /input\[type=password\]|\/login/.test(codigo));
  }
  // Lo verificado de verdad es otra cosa, y manda sobre lo que se promete.
  const ver = await fsp.readFile(new URL("lib/verificados.js", BASE), "utf8");
  check("existe la lista de postulacion verificada",
    /POSTULACION_VERIFICADA/.test(ver) && /POSTULACION_SIN_PROBAR/.test(ver));
  check("y distingue lo escrito de lo comprobado",
    /computrabajo/.test(ver.split("POSTULACION_VERIFICADA")[1].split("]")[0]));
}
check("todos tienen URL de acceso para iniciar sesión",
  LISTA_PORTALES.every((p) => p.acceso && p.acceso.startsWith("https://")));
check("URL de LinkedIn",
  PORTALES.linkedin.url("practicante de marketing", "Lima").includes("keywords=practicante"));

titulo("DATOS PERSONALES");
const { limpio, errores } = datos.validar({ dni: "70123456", distrito: "Surco", pretension: "S/1500" });
check("DNI válido se guarda", limpio.dni === "70123456");
check("pretensión con S/ se rechaza", Boolean(errores.pretension), errores.pretension);
check("DNI se reconoce en el formulario",
  datos.paraCampo("Ingrese su numero de DNI", { dni: "70123456" }).valor === "70123456");
check("el distrito no se confunde con el teléfono",
  datos.paraCampo("¿En qué distrito resides?", { dni: "1" }).campo?.clave === "distrito");

titulo("PREGUNTAS — la garantía del proyecto");
const PERFIL = { nombre: "Alice Romero", contacto: { email: "a@b.c" }, perfil: ["Estudiante de Marketing."] };
const PREGUNTAS = [
  { indice: 0, enunciado: "Confirmo que he leido que las practicas son AD HONOREM (sin remuneracion economica)." },
  { indice: 1, enunciado: "¿Cuentas con disponibilidad para practicas presenciales en La Molina de lunes a viernes?" },
  { indice: 2, enunciado: "¿En que distrito resides actualmente?" },
  { indice: 3, enunciado: "¿Cual es tu numero de DNI?" },
];
const guardados = { dni: "70123456", distrito: "Surco" };

const r1 = await respuestas.redactar(PREGUNTAS, PERFIL, guardados, {});
// Desde 2026-09-24 TODO es automático (Ali): también las prácticas sin
// pago se aceptan solas, y queda anotado para que se sepa.
check("ad honorem se acepta sola", /Confirmo que he leído/.test(r1[0].texto), `«${r1[0].texto}»`);
check("y queda anotado que era sin pago", r1[0].sinPagoAceptado === true);
check("ad honorem avisa que es SIN PAGO", r1[0].necesita[0].aviso.includes("sin pago"));
// Desde 2026-09-24 la disponibilidad se contesta sola («sí»): preguntar
// es el último recurso. Queda editable en el panel.
check("disponibilidad se contesta sola, con un sí",
  /^Sí, cuento con disponibilidad/.test(r1[1].texto), r1[1].texto);
check("disponibilidad detecta el lugar",
  r1[1].necesita[0].etiqueta.includes("La Molina"), r1[1].necesita[0].etiqueta);
check("el distrito guardado se responde solo", r1[2].texto === "Resido en Surco.", r1[2].texto);
check("el DNI guardado se responde solo", r1[3].texto === "Mi DNI es 70123456.", r1[3].texto);
check("no queda nada pendiente que frene el envío", respuestas.consentimientoPendiente(r1) === null);

const r2 = await respuestas.redactar(PREGUNTAS, PERFIL, guardados, {
  consent_0: "Sí, confirmo y acepto",
  disp_1: "Sí, con restricciones de horario",
});
check("tras aceptar, se redacta", r2[0].texto.includes("Confirmo que he leído"), r2[0].texto);
check("tras elegir, la disponibilidad se redacta",
  r2[1].texto.includes("coordinando el horario"), r2[1].texto);
check("ya no queda consentimiento pendiente", respuestas.consentimientoPendiente(r2) === null);

const r3 = await respuestas.redactar(PREGUNTAS, PERFIL, {}, { consent_0: "No" });
check("si dice NO, no se acepta nada", r3[0].texto === "", `«${r3[0].texto}»`);

titulo("ALMACÉN Y TRACKER");
await almacen.perfil.guardar(PERFIL);
check("el perfil se guarda y se lee", (await almacen.perfil.obtener()).nombre === "Alice Romero");
await almacen.tracker.anotar({ puesto: "Practicante", estado: "enviada", url: "u1" });
await almacen.tracker.anotar({ puesto: "Analista", estado: "omitida", url: "u2" });
const t = await almacen.tracker.listar();
check("anota las dos", t.length === 2);
check("ordena por más reciente", t[0].puesto === "Analista");
check("detecta una ya postulada", (await almacen.tracker.yaPostulado("u1")) === true);
check("no confunde omitida con enviada", (await almacen.tracker.yaPostulado("u2")) === false);

// ---------------------------------------------------------------------
titulo("HUECOS DE HABILIDADES — nunca se añade nada solo");
// ---------------------------------------------------------------------
const huecos = await import(`${BASE}lib/huecos.js`);

const CV_ALI = { secciones: {
  resumen: ["Estudiante de Marketing en la USIL, ciclo 11."],
  habilidades: ["Excel intermedio", "Meta Ads", "Google Analytics", "Canva"],
  idiomas: ["Inglés intermedio"],
} };

const pide = (reqs) => huecos.detectar({ requisitos: reqs }, CV_ALI).map((h) => h.habilidad);

check("detecta lo que pide y no tiene", pide(["Manejo de Power BI"]).includes("Power BI"));
check("no pregunta por lo que sí tiene", pide(["Excel intermedio", "Canva"]).length === 0);
check("ignora el relleno del aviso", pide(["Proactivo y responsable", "Trabajo en equipo"]).length === 0);
check("una alternativa cubierta no se pregunta", pide(["Canva o Photoshop"]).length === 0);
check("si no cubre ninguna alternativa, sí pregunta", pide(["Figma o Illustrator"]).length === 2);
check("distingue deseable de obligatorio",
  huecos.detectar({ requisitos: ["Deseable: Power BI"] }, CV_ALI)[0].deseable === true);
check("trae la frase del aviso como contexto",
  huecos.detectar({ requisitos: ["Conocimientos de SQL"] }, CV_ALI)[0].frase.includes("SQL"));
check("nunca pregunta más de cuatro cosas",
  huecos.detectar({ requisitos: ["SQL", "SAP", "Power BI", "Tableau", "Python", "Salesforce"] }, CV_ALI).length <= 4);

const hs = huecos.detectar({ requisitos: ["Power BI", "SQL"] }, CV_ALI);
check("sin respuesta no se añade nada", huecos.aCompetencias(hs, {}).length === 0);
check("un NO explícito tampoco añade", huecos.aCompetencias(hs, { "Power BI": false }).length === 0);
check("solo se añade lo que ella marcó",
  JSON.stringify(huecos.aCompetencias(hs, { "Power BI": true, SQL: false })) === '["Power BI"]');

// ---------------------------------------------------------------------
titulo("DISTRITOS — cuánto está dispuesta a viajar");
// ---------------------------------------------------------------------
const distritos = await import(`${BASE}lib/distritos.js`);

const OFERTAS = [
  { ubicacion: "Santiago de Surco, Lima" }, { ubicacion: "La Molina" },
  { ubicacion: "Los Olivos" }, { ubicacion: "San Isidro" },
  { ubicacion: "Ate" }, { ubicacion: "" },
];
const cuantas = (disp) => distritos.filtrar(OFERTAS, "La Molina", disp).dentro.length;

check("exacto deja solo el distrito (y las sin dato)", cuantas("exacto") === 2);
check("cerca incluye los que colindan", cuantas("cerca") === 4);
check("cerca deja fuera un distrito no vecino",
  distritos.filtrar(OFERTAS, "La Molina", "cerca").fuera.some((v) => v.ubicacion === "San Isidro"));
check("zona incluye toda Lima Moderna",
  distritos.filtrar(OFERTAS, "La Molina", "zona").dentro.some((v) => v.ubicacion === "San Isidro"));
check("zona deja fuera Ate, que es Lima Este",
  distritos.filtrar(OFERTAS, "La Molina", "zona").fuera.some((v) => v.ubicacion === "Ate"));
check("lima no filtra nada", cuantas("lima") === OFERTAS.length);
check("una vacante sin ubicación nunca se descarta",
  distritos.filtrar(OFERTAS, "La Molina", "exacto").dentro.some((v) => v.ubicacion === ""));
check("nada se pierde: dentro + fuera = todas",
  distritos.filtrar(OFERTAS, "La Molina", "cerca").dentro.length
  + distritos.filtrar(OFERTAS, "La Molina", "cerca").fuera.length === OFERTAS.length);
check("un distrito desconocido no rompe el filtro",
  distritos.filtrar(OFERTAS, "Chimbote", "cerca").dentro.length === OFERTAS.length);
check("sabe la zona de cada distrito", distritos.zonaDe("Los Olivos") === "norte");

// ---------------------------------------------------------------------
titulo("SESION — postular necesita cuenta");
// ---------------------------------------------------------------------
// Buscar y ver vacantes sigue abierto. Postular no: lo que se envia lleva
// el nombre de la persona a una empresa real y tiene que quedar claro de
// quien viene.
const sesion = await import(`${BASE}lib/sesion.js`);

check("sin sesion guardada, no hay cuenta", (await sesion.hayCuenta()) === false);
check("sin cuenta, la cabecera va sin token",
  !("Authorization" in (await sesion.cabecera())));

await sesion.guardar({ token: "abc123", usuario: { correo: "a@b.pe" } });
check("con sesion, si hay cuenta", (await sesion.hayCuenta()) === true);
const cab = await sesion.cabecera({ "Content-Type": "application/json" });
check("y la cabecera lleva el token", cab.Authorization === "Bearer abc123");
check("sin romper lo que ya traia", cab["Content-Type"] === "application/json");

await sesion.guardar(null);
check("al salir, la sesion se borra", (await sesion.obtener()) === null);

check("sin cuenta, subir el perfil no hace nada", (await sesion.subirPerfil({ n: 1 })) === false);
check("sin cuenta, bajar el perfil devuelve null", (await sesion.bajarPerfil()) === null);
check("sin cuenta, subir postulaciones devuelve 0",
  (await sesion.subirPostulaciones([{ url: "x" }])) === 0);
check("sin cuenta, bajar postulaciones devuelve lista vacia",
  (await sesion.bajarPostulaciones()).length === 0);
check("pero un fallo de lectura devuelve null, no lista vacia",
  /if \(!r\.ok\) return null/.test(
    fs2.readFileSync(new URL("lib/sesion.js", BASE), "utf8")));


titulo("RENOVAR — la sesion no se muere a la hora");

{
  // El caso real: una tanda de postulaciones dura mas de una hora. Antes,
  // al caducar el token la extension se encontraba un 401, borraba la
  // sesion y dejaba a medias lo que estuviera enviando.
  const fuente = await (await import("node:fs/promises"))
    .readFile(new URL("lib/sesion.js", BASE), "utf8");
  check("existe el renovador", fuente.includes("async function renovar()"));
  check("y una peticion que lo usa", fuente.includes("async function conCuenta("));
  check("se reintenta una vez tras un 401",
        fuente.includes("r.status === 401 && await renovar()"));
  check("dos renovaciones a la vez no se pisan", fuente.includes("renovando = renovando ||"));
  check("ya no quedan fetch sueltos a la nube",
        !/fetch\(`\$\{SERVIDOR\}\/api\/nube/.test(fuente));
  check("ni a la ruta de quien soy",
        !/fetch\(`\$\{SERVIDOR\}\/api\/cuenta\/yo/.test(fuente));
}


titulo("SESION EN TODO — nada llama al servidor a pelo");

{
  // Este fallo lo metimos nosotros: al cerrar /api/cv/docx y /api/ia/*
  // detras de la sesion, cv.js e ia.js seguian llamando con fetch
  // pelado. Resultado: 401, el error se tragaba, y la postulacion
  // continuaba con el CV viejo del portal sin decir nada. El CV
  // adaptado —que es la funcion entera— no se habria adjuntado nunca.
  const fs3 = await import("node:fs/promises");
  for (const mod of ["cv.js", "ia.js"]) {
    const fuente = await fs3.readFile(new URL(`lib/${mod}`, BASE), "utf8");
    comprobarSuelto(mod, fuente);
  }
}

function comprobarSuelto(mod, fuente) {
  const sueltos = fuente.match(/fetch\(`\$\{SERVIDOR\}[^`]*`/g) || [];
  check(`${mod} no llama al servidor sin sesion`, sueltos.length === 0, sueltos.join(", "));
  check(`${mod} usa conCuenta`, /conCuenta\(/.test(fuente));
}

{
  const fs3 = await import("node:fs/promises");
  const ses = await fs3.readFile(new URL("lib/sesion.js", BASE), "utf8");
  check("conCuenta esta exportada", /export async function conCuenta/.test(ses));
  const srv = await fs3.readFile(new URL("lib/servidor.js", BASE), "utf8");
  check("la direccion del servidor vive en su propio modulo",
        /export const SERVIDOR/.test(srv));
  const ia = await fs3.readFile(new URL("lib/ia.js", BASE), "utf8");
  check("y ia.js ya no la declara, para no cerrar un circulo",
        !/^export const SERVIDOR =/m.test(ia));
}


titulo("LINKEDIN — envía, sabiendo el riesgo, y sin atajos");

{
  // Decisión de Ali, 2026-09-24: «Que envíe sola». Antes LinkedIn solo
  // rellenaba porque su §8.2 prohíbe la automatización y lo que se
  // arriesga es la cuenta de la persona. El riesgo sigue: estas pruebas
  // cuidan que se envíe BIEN y que se avise antes.
  const fsp = await import("node:fs/promises");
  const li = await fsp.readFile(new URL("contenido/linkedin.js", BASE), "utf8");
  const fondo = await fsp.readFile(new URL("background.js", BASE), "utf8");
  const port = await fsp.readFile(new URL("lib/portales.js", BASE), "utf8");
  const ver = await fsp.readFile(new URL("lib/verificados.js", BASE), "utf8");
  const pj = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");

  const siguiente = li.slice(li.indexOf("async function siguientePaso"), li.indexOf("async function enviar"));
  // Lo peligroso de un formulario por pantallas es pulsar «Enviar» creyendo
  // que se pulsaba «Siguiente». Se mira el botón final ANTES de avanzar.
  check("avanzar de pantalla nunca pulsa el botón final",
    siguiente.indexOf("botonCon(FINAL)") > -1
    && siguiente.indexOf("botonCon(FINAL)") < siguiente.indexOf("botonCon(AVANZAR)"));
  check("el envío se confirma por el mensaje de LinkedIn, no por suposición",
    /function confirmada\(\)/.test(li) && /se envi\[oó\] tu solicitud/.test(li));
  check("si LinkedIn pide algo al avanzar, se para ahí",
    /errores\.length \? \{ avanzado: false, errores \}/.test(li));
  check("LinkedIn ya no va marcado soloRevisado", !/soloRevisado: true/.test(port));
  check("y no queda un candado por nombre en el lote",
    !/\|\| \/linkedin\/i\.test\(item\.portal/.test(fondo));
  check("está en «sin probar»: el envío no se ha probado en LinkedIn real",
    /linkedin/.test(ver.split("POSTULACION_SIN_PROBAR")[1].split("]")[0]));
  // Es SU cuenta la que se arriesga: se dice antes de lanzar el lote.
  check("el lote avisa del riesgo de LinkedIn antes de empezar",
    /LinkedIn puede limitar/.test(pj) && /deLinkedin/.test(pj));
  // Las pantallas nuevas se rellenan antes de avanzar, no a ciegas.
  const env = fondo.slice(fondo.indexOf("async function escribirYEnviar"));
  check("en varias pantallas, cada una se rellena antes de avanzar",
    /accion: "siguiente"/.test(env) && /await rellenarPantalla\(tabId/.test(env));
}


titulo("EL PANEL SABE ENTRAR — faltaba y nada lo avisaba");

{
  // sesion.js tenia `entrar` y `hayCuenta` desde que existen las cuentas,
  // pero el panel no los llamaba: no habia ningun sitio donde iniciar
  // sesion. Resultado: el CV adaptado daba 401, la IA daba 401 y la
  // medicion no anotaba nada — todo en silencio, porque esos errores
  // estan escritos para no tumbar la postulacion.
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");

  check("el panel importa el modulo de sesion", /from "\.\.\/lib\/sesion\.js"/.test(pjs));
  check("y pregunta si hay cuenta al arrancar", /sesion\.hayCuenta\(\)/.test(pjs));
  check("hay una etapa 0 antes de todo lo demas", /etapa === 0/.test(pjs));
  check("que se decide por la cuenta, no por el CV",
    /!estado\.conCuenta \? 0/.test(pjs));
  check("con formulario para entrar de verdad",
    /sesion\.entrar\(/.test(pjs) && /form-acceso/.test(pjs));
  check("y salida para quien aun no tiene cuenta",
    /sesion\.URL_CUENTA/.test(pjs));
  check("un token muerto se trata como no tener cuenta",
    /sesion\.verificar\(\)/.test(pjs));
  check("el error de entrar se enseña, no se traga",
    /acceso-error/.test(pjs));
}


titulo("MENOS ESCRIBIR — elegir en vez de teclear");

{
  // Ali: «nuestra plataforma soluciona mucho el mundo de la pereza».
  // Cada campo de texto libre es una excusa para abandonar, y ademas
  // cada quien escribia una cosa distinta: «ya», «cuando sea», «a partir
  // del 3». Con opciones sale redactado igual siempre.
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");
  const conTipo = datos.CAMPOS.filter((c) => c.tipo);

  check("hay campos que se eligen, no se escriben", conTipo.length >= 4,
    conTipo.map((c) => c.clave).join(", "));
  for (const clave of ["disponibilidadInicio", "licencia", "movilidad", "redes"]) {
    const c = datos.CAMPOS.find((x) => x.clave === clave);
    check(`${clave} ya no es texto libre`, Boolean(c && c.tipo), c ? c.tipo : "no existe");
  }

  const disp = datos.CAMPOS.find((c) => c.clave === "disponibilidadInicio");
  check("disponibilidad ofrece fecha de verdad", Boolean(disp.conFecha));
  check("y el panel pinta un selector de fecha", /type="date"/.test(pjs));

  const lic = datos.CAMPOS.find((c) => c.clave === "licencia");
  check("licencia trae las categorias peruanas",
    lic.opciones.includes("A-I") && lic.opciones.includes("No tengo"),
    lic.opciones.slice(0, 4).join(", "));

  const red = datos.CAMPOS.find((c) => c.clave === "redes");
  check("la red social se elige de una lista", red.tipo === "red" && red.opciones.length >= 4);
  check("y se guarda diciendo de que red es", /\$\{sel\.value\}: \$\{escrito\}/.test(pjs));

  // Lo guardado sigue siendo texto: nada de lo que hay debajo se entera.
  for (const c of conTipo) {
    check(`${c.clave} sigue validando como texto`, c.validar instanceof RegExp);
  }
}


titulo("EL PUENTE — entrar una vez, no dos");

{
  // La sesion de la web vive en el localStorage del sitio; la de la
  // extension, en chrome.storage. Son dos almacenes que no se ven, asi
  // que quien entraba en la landing abria el panel y se encontraba otra
  // vez con «entra con tu cuenta» — y el CV fallaba con un 401.
  const fsp = await import("node:fs/promises");
  const puente = await fsp.readFile(new URL("contenido/puente.js", BASE), "utf8");
  const man = JSON.parse(await fsp.readFile(new URL("manifest.json", BASE), "utf8"));
  const fondo = await fsp.readFile(new URL("background.js", BASE), "utf8");

  const suyo = man.content_scripts.find((cs) => cs.js.includes("contenido/puente.js"));
  check("el puente esta declarado en el manifest", Boolean(suyo));
  check("y SOLO en nuestro dominio",
    Boolean(suyo) && suyo.matches.every((m) => /chamba-lista|chambalista/.test(m)),
    suyo ? suyo.matches.join(", ") : "");
  check("lee la sesion de la web", /chamba_sesion/.test(puente));
  check("y no toca nada mas de la pagina",
    !/document\.querySelector|innerHTML|fetch\(/.test(puente));
  check("el fondo la recibe", /case "sesionDeLaWeb"/.test(fondo));
  check("y no pisa una sesion propia de la misma persona",
    /mismaPersona/.test(fondo));
}

titulo("SIN COLETILLAS QUE NO SIGNIFICAN NADA");

{
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");
  const visible = pjs.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("el panel ya no habla de servicios dormidos",
    !/dormid/i.test(visible));
  check("el CV se sube con la sesion puesta",
    /sesion\.conCuenta\("\/api\/cv\/procesar"/.test(pjs));
  check("y si el token murio, lo dice claro",
    /caduc/i.test(pjs));
}


titulo("CONTRASTE — un fondo fijo obliga a colores fijos encima");

{
  // «Subir mi CV y empezar sale en negro, no se ve nada». La portada es
  // SIEMPRE lima y el boton principal tambien era lima: 1.0:1, o sea
  // invisible. Y en modo oscuro var(--tinta) es casi blanca, asi que el
  // texto salia a 1.1:1 sobre lima.
  //
  // Esto calcula el contraste de verdad con la formula de WCAG, en vez
  // de fiarse de que la regla «parece» correcta.
  const fsp = await import("node:fs/promises");
  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");

  const hex = (h) => h.replace("#", "").match(/../g).map((x) => parseInt(x, 16));
  const lum = (h) => {
    const [r, g, b] = hex(h).map((v) => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const LIMA = "#D4F249";
  const regla = css.match(/\.portada \.boton\.primario \{([^}]*)\}/);
  check("hay una regla para el boton principal dentro de la portada", Boolean(regla));
  if (regla) {
    const fondo = (regla[1].match(/background:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
    check("su fondo es un color fijo, no una variable de tema", Boolean(fondo),
      regla[1].trim().slice(0, 60));
    if (fondo) {
      const r = contraste(fondo, LIMA);
      check("y se recorta contra el lima de la portada", r >= 4.5, `${r.toFixed(1)}:1`);
    }
  }
  check("el texto de la portada tambien lleva tinta fija",
    /\.portada,[\s\S]{0,200}color: #131316/.test(css));

  // Y NINGUNA regla de tema oscuro puede volver a tocarla.
  //
  // Este es el fallo que se vio en pantalla: la portada llevaba
  // `background: var(--papel-2)` en oscuro, y con la tinta fija encima
  // daba negro sobre negro. Un bloque de fondo fijo se queda fijo en los
  // dos temas, o no se le pueden poner colores fijos encima. Una de las
  // dos, no las dos a medias.
  const bloquesOscuros = [];
  const re = /@media \(prefers-color-scheme: dark\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let prof = 1, j = m.index + m[0].length;
    while (j < css.length && prof) {
      if (css[j] === "{") prof++;
      else if (css[j] === "}") prof--;
      j++;
    }
    bloquesOscuros.push(css.slice(m.index + m[0].length, j));
  }
  const tocanPortada = bloquesOscuros
        .flatMap((b) => [...b.matchAll(new RegExp("([^\\n{}]*\\\\.portada[^\\n{}]*)\\\\{([^}]*)\\\\}", "g"))])
    .map((r) => r[1].trim());
  check("ninguna regla de tema oscuro repinta la portada",
    tocanPortada.length === 0, tocanPortada.join(" | "));
}


titulo("TEMAS — que ningun bloque quede ilegible en oscuro");

{
  // La regla que se salto y costo el «no se ve nada»:
  //
  //   Si el FONDO cambia con el tema, el TEXTO encima tambien tiene que
  //   cambiar. Si el fondo es fijo, el texto tiene que ser fijo.
  //
  // Mezclar las dos cosas hace que uno de los dos temas salga mal por
  // fuerza. La portada tenia fondo variable (papel-2 en oscuro) y texto
  // fijo (#131316): negro sobre negro, 1.0:1.
  //
  // Ojo: --lima, --coral y --sol NO cambian entre temas, asi que poner
  // texto fijo encima de ellas es correcto. La prueba lo tiene en cuenta;
  // si no, saltaria en diez sitios que estan bien.
  const fsp = await import("node:fs/promises");
  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");

  const varsDe = (txt) => {
    const m = {};
    for (const r of txt.matchAll(/(--[\w-]+):\s*([^;]+);/g)) m[r[1]] = r[2].trim();
    return m;
  };
  const corte = css.indexOf("@media");
  const raiz = varsDe(corte > 0 ? css.slice(0, corte) : css);
  const oscuro = {};
  for (const m of css.matchAll(/@media \(prefers-color-scheme: dark\)\s*\{/g)) {
    let prof = 1, j = m.index + m[0].length;
    while (j < css.length && prof) {
      if (css[j] === "{") prof++; else if (css[j] === "}") prof--;
      j++;
    }
    Object.assign(oscuro, varsDe(css.slice(m.index + m[0].length, j)));
  }
  const cambia = (v) => v in oscuro && raiz[v] !== oscuro[v];

  const sospechosas = [];
  for (const r of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = r[1].trim().split("\n").pop().trim();
    if (!sel || sel.startsWith("@") || sel.startsWith("/*")) continue;
    const fondo = (r[2].match(/background(?:-color)?:\s*([^;]+)/) || [])[1];
    const texto = (r[2].match(/(?<!-)\bcolor:\s*([^;]+)/) || [])[1];
    if (!fondo || !texto) continue;
    // `none` y `transparent` no son fondo: lo que se ve detrás es otra
    // cosa y esta comprobación no puede decir nada sobre ellos.
    if (/^\s*(none|transparent|inherit)\s*$/.test(fondo)) continue;
    const varFondo = (fondo.match(/var\((--[\w-]+)\)/) || [])[1];
    const varTexto = (texto.match(/var\((--[\w-]+)\)/) || [])[1];
    // El caso malo: el fondo se mueve con el tema y el texto no.
    const fondoSeMueve = varFondo ? cambia(varFondo) : false;
    const textoSeMueve = varTexto ? cambia(varTexto) : false;
    if (fondoSeMueve !== textoSeMueve && (fondoSeMueve || textoSeMueve)) {
      sospechosas.push(`${sel} (fondo ${fondo.trim()}, texto ${texto.trim()})`);
    }
  }
  check("ningun bloque mezcla fondo de tema con texto fijo",
    sospechosas.length === 0, sospechosas.slice(0, 3).join(" | "));
}


titulo("EL RECORRIDO — que subir el CV no sea un callejon");

{
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");
  const { queHace } = await import(`${BASE}lib/portales.js`);

  // Ali: «subo el CV y no se puede seguir». El boton de la portada te
  // lleva a Mi perfil para abrir el selector de archivo; el CV cargaba
  // bien, la portada avanzaba... y esa portada esta en la pestaña de
  // Inicio, que ya no estas mirando. Te quedabas con el CV cargado y sin
  // un solo boton que dijera «sigue por aqui».
  // El manejador entero, no «900 caracteres despues de guardar»: esa
  // ventana fija se rompio en cuanto el manejador gano un bloque de
  // errores, sin que el comportamiento cambiara nada.
  const iniSubida = pjs.indexOf('$("#archivo-cv").addEventListener("change"');
  const trasSubir = pjs.slice(iniSubida, pjs.indexOf("\n});", iniSubida));
  check("al subir el CV se vuelve al recorrido", /irA\("inicio"\)/.test(trasSubir),
    "subir el CV es el paso uno de cuatro, no el final");
  check("y se avisa de que se cargo", /avisar\(/.test(trasSubir));

  // Y el titular de cada etapa dice lo mismo.
  const titulares = [...pjs.matchAll(/portada-titulo"\)\.innerHTML = "([^"]+)"/g)].map((m) => m[1]);
  check("ningun titular del panel promete quince",
    !titulares.some((t) => /quince/i.test(t)), titulares.join(" | "));

  // Cada portal dice lo que hace, no todos lo mismo.
  const dicen = ["computrabajo", "bumeran", "indeed", "linkedin"]
    .map((id) => `${id}:${queHace({ id, postulable: true }).etiqueta}`);
  // Lo comprobado y lo que está en pruebas no pueden decir lo mismo.
  check("lo comprobado y lo que está en pruebas no dicen lo mismo",
    new Set(dicen.map((d) => d.split(":")[1])).size >= 2, dicen.join(" · "));
  check("computrabajo es el unico que dice «postula» a secas",
    queHace({ id: "computrabajo", postulable: true }).etiqueta === "postula");
  const sinTildes = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // LinkedIn envía desde 2026-09-24 y no se ha probado en LinkedIn real.
  check("linkedin dice que está en pruebas",
    /pruebas/.test(sinTildes(queHace({ id: "linkedin", postulable: true }).etiqueta)),
    queHace({ id: "linkedin", postulable: true }).etiqueta);
  check("y los sin comprobar lo dicen",
    /pruebas/.test(queHace({ id: "bumeran", postulable: true }).etiqueta));

  // La etiqueta sale de la CONFIGURACION, no del objeto que llegue: el
  // fondo manda los portales con pocos campos y soloRevisado no viaja.
  const port = await fsp.readFile(new URL("lib/portales.js", BASE), "utf8");
  check("queHace mira la configuracion por id",
    /PORTALES\[portal\?\.id\]/.test(port));
}


titulo("ENVIAR — no con una pregunta de consentimiento en blanco");

{
  // El fallo mas serio del recorrido. Las preguntas de consentimiento
  // —«¿aceptas practicas no remuneradas?»— se dejan en blanco A
  // PROPOSITO: no las contesta el modelo, las contesta la persona. Pero
  // nada se lo decia: marcaba la casilla de revision, el boton se
  // activaba, y la postulacion salia con la pregunta vacia.
  //
  // La proteccion funcionaba a medias: evitaba que respondieramos
  // nosotros, no que la respuesta se fuera vacia. Segun el formulario
  // eso es una postulacion descartada o, peor, un silencio que el portal
  // lee como un si.
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");

  check("enviar mira las preguntas, no solo la casilla",
    /sinContestar/.test(pjs) && /revisarSiPuedeEnviar/.test(pjs));
  check("el boton se bloquea si queda alguna sin contestar",
    /disabled = !revisado \|\| sinContestar\.length > 0/.test(pjs));
  check("y se dice por que, no se bloquea en silencio",
    /Falta contestar/.test(pjs));
  check("se marca cual falta, para no tener que buscarla",
    /sin-contestar/.test(pjs));
  check("se revisa al escribir, no solo al marcar",
    /addEventListener\("input", revisarSiPuedeEnviar\)/.test(pjs));
  check("y se revisa nada mas abrir la pantalla",
    /revisarSiPuedeEnviar\(\);/.test(pjs));

  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");
  check("la que falta se ve distinta", /\.pregunta\.sin-contestar/.test(css));
}


titulo("LOTE AUTOMATICO — decir antes lo que va a pasar");

{
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");

  // El lote salta los portales que no envian solos —LinkedIn— y el fondo
  // los marca «omitida». Bien hecho, pero nadie se lo decia ANTES:
  // marcabas las casillas de riesgo contando con enviar diez y salian
  // siete, sin explicacion hasta el final.
  check("se avisa de cuales no se enviaran solas", /aviso-lote/.test(pjs));
  check("y se cuentan antes de pedir el consentimiento",
    /seSaltan/.test(pjs) && pjs.indexOf("seSaltan") < pjs.indexOf("btn-confirmar-auto"));
  check("el aviso sale de soloRevisado, no de una lista a mano",
    /cfg\.soloRevisado/.test(pjs));
  check("y dice cuantas SI se enviaran", /Se enviar/.test(pjs));

  // Buscar sin escribir nada no puede ser un no-op mudo.
  check("buscar con el campo vacio avisa",
    /Escribe qué puesto buscas y le damos/.test(pjs));
  check("y lleva el cursor al campo", /\$\("#puesto"\)\.focus\(\)/.test(pjs));
  check("con cero resultados no dice «ordenadas por encaje»",
    /estado\.vacantes\.length === 0 \? ""/.test(pjs));
}


titulo("ANCHO REAL — el panel de Chrome son 380 px, no 900");

{
  // Toda la pestaña «Mi perfil» se salia de la pantalla. La causa: un
  // `1fr` tiene el contenido minimo como suelo, asi que la tarjeta de
  // Portales —cuatro filas de nombre + etiqueta + boton, sin partir—
  // empujaba la columna a 402 px dentro de un panel de 348. Y lo empeore
  // yo al alargar las etiquetas a «rellena, envias tu».
  const fsp = await import("node:fs/promises");
  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");

  check("las rejillas estrechas pueden encoger",
    /\.rejilla \{ grid-template-columns: minmax\(0, 1fr\)/.test(css),
    "un `1fr` a secas no baja de su contenido minimo");
  const bloque = (sel) => {
    const i = css.indexOf(sel + " {");
    return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
  };
  check("las filas de portal se parten si no caben",
    /flex-wrap: wrap/.test(bloque(".portal-fila")), bloque(".portal-fila").slice(0, 60));
  // La tarjeta de portal se rehizo como rejilla en vez de flex: cuatro
  // columnas que no se parten, con el nombre recortandose si hace falta.
  // Lo que hay que comprobar no es COMO lo hace sino que pueda encoger —
  // con `flex-wrap` acababa en tres lineas y cien pixeles de alto.
  check("la tarjeta de portal puede encoger sin desbordar",
    /minmax\(0, 1fr\)/.test(bloque(".portal-tarjeta"))
    || /flex-wrap: wrap/.test(bloque(".portal-tarjeta")),
    bloque(".portal-tarjeta").slice(0, 80));
  // Decision revisada: el nombre NO se recorta. Es el dato de la fila, y
  // «Compu…» no sirve para nada. Lo que cede es la etiqueta, que
  // desaparece del todo cuando la fila se estrecha de verdad.
  check("la etiqueta cede antes que el nombre",
    /text-overflow: ellipsis/.test(bloque(".portal-chip"))
    && !/text-overflow: ellipsis/.test(bloque(".portal-nombre")));
  check("las cuatro pestañas caben en 380 px",
    /@media \(max-width: 400px\)[\s\S]{0,120}\.tab \{/.test(css),
    "«Mi perfil» se cortaba por seis pixeles");

  // No se prohibe `1fr` en general —con contenido que encoge esta bien—
  // sino en la rejilla que contiene las tarjetas de portal, que es la
  // que tiene un minimo grande y no puede ceder.
  check("la rejilla de las tarjetas lleva suelo cero",
    /minmax\(0, 1fr\)/.test(css.slice(css.indexOf(".rejilla {"), css.indexOf(".rejilla {") + 400)),
    "ahi es donde vive la tarjeta de Portales");
}


titulo("ESCRITORIO — el panel se abre en una pestaña entera, no en un popup");

{
  // Dato que cambia el objetivo de diseño: background.js abre el panel
  // con chrome.tabs.create, asi que en un PC coge el ancho completo de
  // la ventana —1280, 1440— y no los 380 px de un panel lateral. Estuve
  // probandolo a 380 y ese es un tamaño que casi nunca ve.
  const fsp = await import("node:fs/promises");
  const fondo = await fsp.readFile(new URL("background.js", BASE), "utf8");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");
  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");

  check("el panel se abre en una pestaña completa",
    /chrome\.tabs\.create\(\{ url: URL_PANEL/.test(fondo));
  check("y el ancho de lectura tiene tope, para que no se estire sin fin",
    /main \{[^}]*max-width/.test(css));

  // El argumento de venta ya no está: quien abre el panel ya tiene cuenta,
  // o sea que ya compró la idea. Ali: «ellos están ahí para lo que
  // quieren, no les hagamos bolas».
  const htmlPanel = await fsp.readFile(new URL("panel/panel.html", BASE), "utf8");
  check("no hay bloque «cómo postula por ti»", !/id="hace"/.test(htmlPanel) && !/#hace"/.test(pjs));

  // No tener portales conectados todavia no es una averia.
  check("sin portales conectados el aviso es neutro, no rojo",
    /habiaConectado \? "mal" : "neutro"/.test(pjs));
  check("y solo avisa en rojo si la sesion se cayo",
    /sesión caída/.test(pjs));
  check("hay estilo para ese estado neutro", /\.estado-sesion\.neutro/.test(css));
}


titulo("ESTADO VACIO — una sola cosa que hacer, sin escribir");

{
  // Ali: «la flojera es la joya, debemos facilitarlo lo mas que se pueda».
  //
  // Antes, con cero postulaciones, se dejaba el tablero entero —cinco
  // columnas de «0» y dos tarjetas vacias— al 38 % de opacidad y sin
  // poder tocarlo. Eso no es un estado vacio: es ruido atenuado ocupando
  // la pantalla para decir que todavia no se puede usar.
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");
  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");

  check("el tablero se esconde si no hay nada que enseñar",
    /tablero\.classList\.toggle\("oculto"/.test(pjs));
  check("y ya no queda el tablero fantasma atenuado",
    !/#tablero\.esperando/.test(css), "opacity .38 y pointer-events none");
  check("en su lugar hay un arranque con una sola cosa que hacer",
    /pintarArranque/.test(pjs));

  // Lo importante: no se le pide que escriba.
  check("los puestos los propone el servidor, no los escribe la persona",
    /\/api\/cv\/sugerencias/.test(pjs));
  check("cada puesto es un clic que ya busca",
    /#puesto"\)\.value = b\.dataset\.puesto/.test(pjs)
    && /#btn-buscar"\)\.click\(\)/.test(pjs));
  check("con la razon de por que se propone", /p\.razon/.test(pjs));
  check("y la explicacion del momento de carrera", /arranque-pista/.test(pjs));
  check("escribirlo a mano sigue siendo posible, pero es la salida",
    /arranque-otro/.test(pjs));
  check("las sugerencias se piden una sola vez", /sugerenciasPedidas/.test(pjs));

  // El nombre del portal no se recorta nunca: es EL dato de la fila.
  const bloquePortal = css.slice(css.indexOf(".portal-nombre {"), css.indexOf("}", css.indexOf(".portal-nombre {")));
  check("el nombre del portal no se recorta",
    !/text-overflow: ellipsis/.test(bloquePortal), bloquePortal.trim().slice(0, 60));
  check("y las tarjetas piden ancho suficiente para no cortarlo",
    /minmax\(min\(300px, 100%\), 1fr\)/.test(css));
}


titulo("UN PORTAL, NO CUATRO — el tercer punto de fuga");

{
  // Se pedian cuatro sesiones seguidas antes de ver una sola vacante.
  // Cuatro peajes delante de alguien que todavia no ha visto funcionar
  // nada, y ademas innecesarios: con un portal conectado ya se busca y
  // se postula.
  const fsp = await import("node:fs/promises");
  const pjs = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");
  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");

  check("solo se pide uno al principio", /ordenados\.slice\(0, 1\)/.test(pjs));
  check("los demas quedan plegados", /mas-portales/.test(pjs) && /<details/.test(pjs));
  // Lo que importa es que el <summary> NOMBRE los portales plegados, no la
  // frase exacta que los presenta.
  const resumenPlegado = (pjs.match(/<summary>[\s\S]*?<\/summary>/) || [""])[0];
  check("y se nombran, para que se sepa que estan ahi",
    /resto\.map\(\(p\) => escapar\(p\.nombre\)\)/.test(resumenPlegado), resumenPlegado.slice(0, 80));
  check("hay estilo para el desplegable", /\.mas-portales/.test(css));

  // El primero es el que tiene la postulacion COMPROBADA, no el primero
  // de la lista. Si mañana se verifica Bumeran, el orden se ajusta solo.
  check("el primero se elige por estar verificado",
    /queHace\(p\)\.tono === "bien"/.test(pjs),
    "no por el orden en que esten declarados");
  check("en cuanto hay uno conectado se ven todos",
    /ordenados\.filter\(\(p\) => p\.sesion\)\.length/.test(pjs));
}


titulo("LAS FRASES QUE LEE LA EMPRESA");

{
  // Estos campos no se quedan en el panel: se escriben en el formulario
  // de la empresa. Con los controles nuevos —desplegables y calendario—
  // lo guardado cambio de forma y las frases salian raras:
  //
  //   «Mi disponibilidad para empezar es 2026-10-01.»   formato de BD
  //   «Mi usuario es TikTok: @alicemkt.»                no lo dice nadie
  const disp = datos.CAMPOS.find((c) => c.clave === "disponibilidadInicio");
  const red = datos.CAMPOS.find((c) => c.clave === "redes");

  check("una fecha se escribe como la escribe una persona",
    disp.plantilla("2026-10-01") === "Puedo empezar a partir del 1 de octubre de 2026.",
    disp.plantilla("2026-10-01"));
  check("y una opcion sigue leyendose bien",
    /inmediata/.test(disp.plantilla("Inmediata")), disp.plantilla("Inmediata"));
  check("ninguna frase deja ver el formato ISO",
    !/\d{4}-\d{2}-\d{2}/.test(disp.plantilla("2026-10-01")));

  check("la red social se nombra, no se pega",
    red.plantilla("TikTok: @alicemkt") === "Mi TikTok es @alicemkt.",
    red.plantilla("TikTok: @alicemkt"));
  check("y un valor sin red no rompe",
    /solo_usuario/.test(red.plantilla("solo_usuario")), red.plantilla("solo_usuario"));

  // Ninguna plantilla puede escupir «undefined» ni «[object Object]».
  const feo = datos.CAMPOS
    .map((c) => ({ c: c.clave, t: c.plantilla("x") }))
    .filter((r) => /undefined|NaN|\[object/.test(r.t));
  check("ninguna plantilla escupe basura", feo.length === 0, JSON.stringify(feo));
}


titulo("LA PESTAÑA SIN CONTENT SCRIPT — el fallo mas probable del primer intento");

{
  // chrome.tabs.sendMessage a una pestaña sin content script falla con
  // «Could not establish connection. Receiving end does not exist.»:
  // un error de Chrome que no dice nada. Y pasa a menudo — cada vez que
  // se recarga la extension, las pestañas de portales que ya estaban
  // abiertas se quedan sin script hasta recargarlas a mano.
  //
  // Como el manifest ya pide `scripting`, se puede ARREGLAR en vez de
  // solo avisar.
  const fsp = await import("node:fs/promises");
  const fondo = await fsp.readFile(new URL("background.js", BASE), "utf8");
  const man = JSON.parse(await fsp.readFile(new URL("manifest.json", BASE), "utf8"));

  check("existe un unico camino para hablar con la pestaña",
    /async function hablarCon\(/.test(fondo));
  check("reconoce ese error concreto de Chrome",
    /Receiving end does not exist/.test(fondo));
  check("e inyecta el script en vez de rendirse",
    /chrome\.scripting\.executeScript/.test(fondo));
  check("el permiso `scripting` esta pedido",
    (man.permissions || []).includes("scripting"), (man.permissions || []).join(", "));

  // Nada puede llamar a sendMessage por fuera: si lo hace, se salta el
  // arreglo y vuelve el error crudo.
  const sueltas = [...fondo.matchAll(/chrome\.tabs\.sendMessage\(/g)].length;
  check("solo hablarCon llama a sendMessage directamente", sueltas === 2,
    `${sueltas} llamadas (deben ser 2: la primera y el reintento)`);

  // Y sin recursion: hablarCon llamandose a si misma cuelga el fondo.
  const cuerpo = fondo.slice(fondo.indexOf("async function hablarCon("),
                             fondo.indexOf("async function irY("));
  check("hablarCon no se llama a si misma",
    !/return await hablarCon\(/.test(cuerpo), "seria una recursion infinita");

  // Cada dominio sabe que guiones inyectar, y coinciden con el manifest.
  for (const cs of man.content_scripts.filter((c) => !c.js.includes("contenido/puente.js"))) {
    const archivo = cs.js.find((j) => j !== "contenido/comun.js");
    check(`${archivo.split("/").pop()} esta en la tabla de inyeccion`,
      fondo.includes(`"${archivo}"`), archivo);
  }
}

// ══════════════════════════════════════════════════════════════════════
// LA VERSIÓN QUE SE VE ES LA QUE SE EJECUTA
// ══════════════════════════════════════════════════════════════════════
// Ali pasó horas arreglando fallos que ya estaban arreglados: Chrome
// tenía cargada la carpeta vieja y nada en pantalla lo decía. El pie del
// panel existe para que eso se vea de un vistazo, así que aquí se
// comprueba que sigue estando y —lo que de verdad importa— que el número
// sale del manifest cargado y no de una constante escrita a mano.
{
  titulo("VERSIÓN — que no se pueda probar código viejo sin enterarse");

  const fsp = await import("node:fs/promises");
  const man = JSON.parse(await fsp.readFile(new URL("manifest.json", BASE), "utf8"));
  const html = await fsp.readFile(new URL("panel/panel.html", BASE), "utf8");
  const js = await fsp.readFile(new URL("panel/panel.js", BASE), "utf8");
  const css = await fsp.readFile(new URL("panel/panel.css", BASE), "utf8");

  check("el manifest declara una version", /^\d+\.\d+\.\d+$/.test(man.version || ""),
    man.version);
  check("el panel tiene donde enseñarla", html.includes('id="version-extension"'));
  check("y el pie existe en el CSS", /\.pie-version\s*\{/.test(css));
  check("se pinta al arrancar el panel", js.includes("pintarVersion();"));

  // El corazon de la prueba: una constante diria la version nueva aunque
  // Chrome siguiera ejecutando la vieja — la mentira exacta que esto
  // existe para no contar.
  check("el numero sale de getManifest, no de una constante",
    js.includes("chrome.runtime.getManifest().version"));

  const sinLaLlamada = js.split("getManifest().version").join("");
  check("la version no esta ademas escrita a mano en panel.js",
    !sinLaLlamada.includes(man.version),
    sinLaLlamada.includes(man.version) ? "se desincronizaria en silencio" : "");
}

// ══════════════════════════════════════════════════════════════════════
// EL CSS PARSEA — un selector suelto se come la regla siguiente
// ══════════════════════════════════════════════════════════════════════
// Habia un `.chk-portal` sin bloque, y el parser de CSS se traga todo
// hasta la siguiente llave: se llevo por delante `.boton { ... }` entero.
// Resultado: NINGUN boton de la extension tenia padding, ni forma de
// pildora, ni peso. El de «Entrar» medía 21 px de alto y Ali lo vio
// «muerto» — no estaba apagado, estaba sin estilo.
//
// Lo peor es que no falla ruidosamente: el navegador descarta la regla y
// sigue como si nada. Por eso se comprueba aqui, y no mirando.
{
  titulo("CSS — que no haya reglas que se coman a la siguiente");

  const fsp2 = await import("node:fs/promises");
  const css = await fsp2.readFile(new URL("panel/panel.css", BASE), "utf8");
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const abren = (limpio.match(/{/g) || []).length;
  const cierran = (limpio.match(/}/g) || []).length;
  check("las llaves cuadran", abren === cierran, `${abren} abren, ${cierran} cierran`);

  // Una linea que parece selector y no abre bloque debe ir seguida de `{`.
  // (Un `}` tambien vale: es la ultima declaracion sin punto y coma.)
  const lineas = limpio.split("\n");
  const huerfanos = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (!l || l.includes("{") || /[,;}]$/.test(l)) continue;
    if (!/^[.#[:a-zA-Z*]/.test(l)) continue;
    const sig = (lineas.slice(i + 1).find((x) => x.trim()) || "").trim();
    if (!sig.startsWith("{") && !sig.startsWith("}")) {
      huerfanos.push(`linea ${i + 1}: «${l}»`);
    }
  }
  check("ningun selector se queda sin bloque", huerfanos.length === 0,
    huerfanos.slice(0, 3).join(" · "));

  // Y la regla concreta que se perdio, por su nombre: si vuelve a
  // desaparecer, el boton vuelve a medir 21 px y nadie se entera.
  const base = css.match(/(?:^|\n)\.boton\s*\{([^}]*)\}/);
  check("la regla base .boton existe", Boolean(base));
  for (const prop of ["padding", "border-radius", "box-shadow", "font-weight"]) {
    check(`  .boton declara ${prop}`, Boolean(base) && base[1].includes(prop));
  }
}

// ══════════════════════════════════════════════════════════════════════
// EL TITULAR NO PUEDE PROMETER LO QUE EL CODIGO NO HACE
// ══════════════════════════════════════════════════════════════════════
// La portada decia «Cien postulaciones» mientras background.js mandaba
// quince por tanda. Eran dos numeros en dos archivos distintos y nadie
// los comparaba nunca. Ahora salen del mismo sitio.
{
  titulo("TITULAR — el numero de la portada es el que el codigo cumple");

  const fsp3 = await import("node:fs/promises");
  const ver = await fsp3.readFile(new URL("lib/verificados.js", BASE), "utf8");
  const fondo2 = await fsp3.readFile(new URL("background.js", BASE), "utf8");
  const pjs = await fsp3.readFile(new URL("panel/panel.js", BASE), "utf8");
  const phtml = await fsp3.readFile(new URL("panel/panel.html", BASE), "utf8");

  check("el tope vive en verificados.js, con los packs",
    /export const TOPE_POR_TANDA\s*=\s*(?:\d+|PACK_MAYOR)/.test(ver));
  check("background.js lo importa en vez de declararlo",
    fondo2.includes('import { TOPE_POR_TANDA }') &&
    !/^const TOPE_POR_TANDA/m.test(fondo2));

  const pack = Number((ver.match(/PACK_MAYOR\s*=\s*(\d+)/) || [])[1]);
  // El tope puede estar escrito como numero o como `PACK_MAYOR`. Lo
  // segundo es lo deseable: asi no hay dos numeros que desincronizar.
  const topeCrudo = (ver.match(/TOPE_POR_TANDA\s*=\s*([A-Z_\d]+)/) || [])[1];
  const tope = topeCrudo === "PACK_MAYOR" ? pack : Number(topeCrudo);
  check("los dos numeros se leen", Number.isFinite(tope) && Number.isFinite(pack),
    `tope ${tope}, pack ${pack}`);

  check("el titular se escribe desde los numeros, no a mano",
    pjs.includes("titularPortada()") &&
    !/portada-titulo"\)\.innerHTML = "Cien/.test(pjs));

  // Lo que de verdad importa no es que la cadena «Un clic» este en el
  // archivo —esta, dentro de una rama— sino que esa rama este CERRADA
  // por la comparacion. Buscar la cadena a secas da un falso positivo.
  const cuerpo = (pjs.match(/function titularPortada\(\)\s*\{([\s\S]*?)^\}/m) || [])[1] || "";
  check("titularPortada compara el tope con el pack",
    /TOPE_POR_TANDA\s*>=\s*PACK_MAYOR/.test(cuerpo), cuerpo ? "" : "no se encontro la funcion");

  // Y lo que devuelve cuando la comparacion NO se cumple —el caso de hoy—
  // no puede prometer un clic.
  const salidaPorDefecto = cuerpo.split("}").pop();
  check("sin cubrir el pack, el titular no promete un clic",
    Boolean(cuerpo) && !/un clic/i.test(salidaPorDefecto),
    salidaPorDefecto.trim().slice(0, 60));

  // Y el primer fotograma (el HTML estatico) dice lo mismo que el JS.
  const enHtml = (phtml.match(/id="portada-titulo">([^<]*(?:<br>)?[^<]*)</) || [])[1] || "";
  check("el HTML estatico no contradice al JS",
    tope >= pack ? enHtml.includes("Un clic") : !enHtml.includes("Un clic"),
    enHtml.replace(/<br>/g, " "));
}

// ══════════════════════════════════════════════════════════════════════
// EL RECORRIDO — una sola cosa que hacer cada vez
// ══════════════════════════════════════════════════════════════════════
// La primera pantalla ofrecia cuatro pestañas con el mismo peso cuando
// solo una servia: «Vacantes» y «Postulaciones» estaban vacias sin CV.
// Y el sello «15 por tanda» flotaba al lado de un titular que promete
// cien — dos numeros peleandose antes de que la persona hiciera nada.
{
  titulo("RECORRIDO — sin CV, una sola cosa que hacer");

  const fsp4 = await import("node:fs/promises");
  const pjs2 = await fsp4.readFile(new URL("panel/panel.js", BASE), "utf8");
  const pcss = await fsp4.readFile(new URL("panel/panel.css", BASE), "utf8");

  check("el sello se esconde hasta que significa algo",
    /#sello"\)\?\.classList\.toggle\("oculto", etapa < 2\)/.test(pjs2));

  // Se marcan, NO se bloquean: quien pulsa una pestaña apagada no
  // aprende nada, solo choca. Ahora entra y la pantalla le explica.
  // Cada pestaña declara desde que etapa sirve; sin cuenta (etapa 0) no
  // sirve ninguna salvo Inicio, que es donde se entra.
  const sirve = (pjs2.match(/SIRVE_DESDE\s*=\s*\{([^}]*)\}/) || [])[1] || "";
  check("cada pestaña dice desde que etapa sirve",
    /perfil:\s*1/.test(sirve) && /vacantes:\s*3/.test(sirve) && /pipeline:\s*3/.test(sirve), sirve);
  check("las pestañas se marcan con esa tabla, no a mano",
    /etapa < \(SIRVE_DESDE\[tab\.dataset\.vista\]/.test(pjs2));
  check("y NUNCA se deshabilitan", /tab\.disabled\s*=\s*false/.test(pjs2)
    && !/tab\.disabled\s*=\s*cerrada/.test(pjs2));
  check("dicen que falta antes de pulsar", /tab\.title\s*=\s*queFalta/.test(pjs2));
  check("hay estilo para la pestaña pendiente", /\.menu \.tab\.pendiente\s*\{/.test(pcss));

  // Y al entrar, la pantalla trae el cartel con el boton que lo resuelve.
  check("las tres vistas llevan cartel de «que falta»",
    /for \(const \[vista, desde\] of Object\.entries\(SIRVE_DESDE\)\)/.test(pjs2));
  // Y lo que no sirve todavia se TAPA, no solo se anuncia: con el cartel
  // encima y los botones debajo, sin cuenta se podia subir el CV y
  // acabar en un 401.
  check("lo que aun no sirve se tapa entero",
    /classList\.toggle\("cerrada", etapa < desde\)/.test(pjs2)
    && /\.vista\.cerrada > :not\(\.guia\)/.test(pcss));
  check("el primer paso es la cuenta, no el CV",
    /\[PASOS\.cuenta, PASOS\.cv, PASOS\.portales\]\[etapa\]/.test(pjs2));
  check("el cartel sale de UN solo calculo del paso siguiente",
    /function queFalta\(etapa\)/.test(pjs2)
    && (pjs2.match(/queFalta\(etapa\)/g) || []).length >= 2);
  check("y tiene estilo propio", /\.guia\s*\{/.test(pcss));

  // «Mi perfil» guarda los datos y el cierre de sesion: bloquear la
  // salida de alguien no es correcto en ningun momento.
  check("«Mi perfil» nunca se bloquea",
    !/perfil:\s*etapa/.test(pjs2));

  // Y la unica accion de la etapa sin CV es subirlo.
  check("sin CV, la portada solo ofrece subir el CV",
    /Subir mi CV/.test(pjs2));
}

// ══════════════════════════════════════════════════════════════════════
// SUBIR EL CV SIN QUE SE «CUELGUE»
// ══════════════════════════════════════════════════════════════════════
{
  titulo("SUBIDA — sin cuenta no se intenta, y se puede reintentar");
  const fsp5 = await import("node:fs/promises");
  const pj = await fsp5.readFile(new URL("panel/panel.js", BASE), "utf8");
  const ph = await fsp5.readFile(new URL("panel/panel.html", BASE), "utf8");
  const i = pj.indexOf('$("#archivo-cv").addEventListener("change"');
  const h = pj.slice(i, pj.indexOf("\n});", i));

  // Sin esto, elegir el mismo archivo tras un error no dispara `change`
  // y el boton parece muerto.
  check("el selector se vacia para poder reintentar", /e\.target\.value\s*=\s*""/.test(h));
  check("sin cuenta no se llega a llamar al servidor",
    h.indexOf("hayCuenta()") > -1 && h.indexOf("hayCuenta()") < h.indexOf("/api/cv/procesar"));
  check("una respuesta sin perfil es un error claro, no un TypeError",
    /!j\.perfil/.test(h));
  // Guardado el CV, un fallo al pintar no puede decir «fallo la subida».
  check("pintar despues de guardar va en su propio try",
    (h.match(/try \{/g) || []).length >= 2);

  check("hay boton de cerrar sesion", /id="btn-salir"/.test(ph));
  check("y llama de verdad a sesion.salir()", /sesion\.salir\(\)/.test(pj));
  // Otra cuenta en el mismo ordenador no puede heredar el CV de la anterior.
  const s = pj.slice(pj.indexOf('$("#btn-salir")'), pj.indexOf('$("#btn-salir")') + 500);
  check("al salir se borra el CV guardado en el navegador", /almacen\.perfil\.borrar\(\)/.test(s));
}

// ══════════════════════════════════════════════════════════════════════
// NINGÚN ELEMENTO QUE FALTE PUEDE TUMBAR EL PANEL
// ══════════════════════════════════════════════════════════════════════
// panel.js engancha sus botones al cargar: `$("#btn-salir").addEventListener`.
// Si ese id no existe en el HTML, `$()` devuelve null, la línea revienta y
// se lleva el módulo ENTERO — ni portada, ni pestañas, ni nada. Desde
// fuera se ve como «se crashea», sin ninguna pista.
//
// Pasó de verdad: el banco de pruebas llevaba una copia vieja del HTML
// sin «Cerrar sesión», y el panel no arrancó. Esto lo caza antes.
{
  titulo("IDS — todo lo que panel.js busca existe");

  const fsp6 = await import("node:fs/promises");
  const pjs3 = await fsp6.readFile(new URL("panel/panel.js", BASE), "utf8");
  const phtml3 = await fsp6.readFile(new URL("panel/panel.html", BASE), "utf8");

  // Ids que existen: los del HTML, y los que panel.js crea él mismo en
  // sus plantillas (formulario de acceso, botones de la portada...).
  const existen = new Set([
    ...[...phtml3.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]),
    ...[...pjs3.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]),
    // Los que el código crea bajo demanda: `p.id = "aviso-lote"`.
    ...[...pjs3.matchAll(/\.id\s*=\s*"([\w-]+)"/g)].map((m) => m[1]),
  ]);

  const buscados = [...new Set(
    [...pjs3.matchAll(/\$\("#([\w-]+)"\)/g)].map((m) => m[1]),
  )];
  const faltan = buscados.filter((id) => !existen.has(id));
  check(`los ${buscados.length} ids que usa panel.js existen`, faltan.length === 0,
    faltan.join(", "));

  // Y el banco no puede quedarse con una copia vieja del panel: si el
  // HTML cambia, el banco miente sobre lo que ve la persona.
  const banco = await fsp6.readFile(new URL("panel/prueba-banco.html", BASE), "utf8")
    .catch(() => "");
  if (banco) {
    const sinSellos = (s) => s.replace(/\?v=\d+/g, "").replace(/\r\n/g, "\n");
    check("el banco lleva el panel.html actual, no una copia vieja",
      sinSellos(banco).includes(sinSellos(phtml3).trim()),
      "regenera prueba-banco.html desde panel.html");
  }
}

// ══════════════════════════════════════════════════════════════════════
// SIN FRASES QUE DESPIERTEN MIEDO
// ══════════════════════════════════════════════════════════════════════
// «Nunca vemos tu contraseña» planta justo la idea de que podríamos verla:
// negar algo lo instala. La landing ya lo sabía (hay un comentario en
// web.html que lo dice); el panel no. Esto impide que vuelvan.
//
// OJO: no aplica a los avisos de consentimiento del modo automático. Eso
// es consentimiento informado de un riesgo real, y quitarlo sería peor
// que asustar. Por eso se miran frases concretas de «tranquilización»,
// no cualquier «no».
{
  titulo("TONO — sin negaciones que asusten");
  const fsp7 = await import("node:fs/promises");
  const sinComentarios = (s) => s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const html = sinComentarios(await fsp7.readFile(new URL("panel/panel.html", BASE), "utf8"));
  const js = sinComentarios(await fsp7.readFile(new URL("panel/panel.js", BASE), "utf8"));

  const MIEDO = [
    /nunca (vemos|ve|pedimos|te pedimos|guardamos|compartimos)/i,
    /no (vemos|guardamos|compartimos|vendemos|pedimos) tu/i,
    /nada sale sin/i,
    /no te preocupes/i,
  ];
  for (const [nombre, texto] of [["panel.html", html], ["panel.js", js]]) {
    const hallado = MIEDO.map((re) => (texto.match(re) || [])[0]).filter(Boolean);
    check(`${nombre} no tranquiliza negando`, hallado.length === 0, hallado.join(" · "));
  }
}

// ══════════════════════════════════════════════════════════════════════
// LA PORTADA SE LEE EN LOS DOS TEMAS
// ══════════════════════════════════════════════════════════════════════
// La portada es lima SIEMPRE. La tarjeta del portal, el sello y la hoja de
// CV usaban colores del tema: en oscuro se volvían oscuros con texto
// oscuro encima. «Computrabajo» y el número del sello eran invisibles.
{
  titulo("PORTADA — colores fijos sobre fondo fijo");
  const fsp8 = await import("node:fs/promises");
  const css = await fsp8.readFile(new URL("panel/panel.css", BASE), "utf8");
  const pjs4 = await fsp8.readFile(new URL("panel/panel.js", BASE), "utf8");

  for (const pieza of [".portada .portal-tarjeta", ".portada .sello", ".portada .hoja-flotante"]) {
    const re = new RegExp(pieza.replace(/\./g, "\\.") + "\\s*\\{[^}]*background:\\s*#[0-9A-Fa-f]{6}");
    check(`${pieza} lleva fondo fijo`, re.test(css));
  }
  // El punto de estado no tenía tamaño: nunca se había visto.
  check("el punto de estado del portal tiene tamaño",
    /\.marca-punto\s*\{[^}]*width:\s*\d+px/.test(css));
  // «Entrar» ya es el botón de la cuenta; dos «Entrar» distintos confunden.
  check("el botón del portal dice «Conectar», no «Entrar»",
    /"Conectar"/.test(pjs4) && !/: "Entrar"\}?\s*\n\s*<\/button>/.test(pjs4));
  // El «−» del desplegable se había corrompido en un «2».
  check("no queda el «2» corrupto del desplegable", !/content:\s*"2/.test(css));
}

// ══════════════════════════════════════════════════════════════════════
// «ASÍ TRABAJA UNA TANDA»
// ══════════════════════════════════════════════════════════════════════
{
  // «Así trabaja una tanda» se quitó: explicaba cómo funciona algo que la
  // persona solo quiere USAR. Esto impide que vuelvan explicadores así.
  titulo("SIN EXPLICADORES — la persona viene a postular, no a aprender");
  const fsp9 = await import("node:fs/promises");
  const html2 = await fsp9.readFile(new URL("panel/panel.html", BASE), "utf8");
  const pjs5 = await fsp9.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("no hay «Así trabaja una tanda»", !/en-marcha|Así trabaja una tanda/.test(html2 + pjs5));
  // El cartel de cada paso: título y botón. Sin párrafo de «por qué».
  check("los carteles de paso no llevan explicación", !/falta\.porque/.test(pjs5));
}

// ══════════════════════════════════════════════════════════════════════
// EL NOMBRE ES EL DE LA CUENTA, NO EL DEL CV
// ══════════════════════════════════════════════════════════════════════
// Ali entró con su cuenta, cargó el CV de Gonzalo, y el panel pasó a
// llamarla «GONZALO». La identidad es la cuenta; el CV es un documento.
{
  titulo("NOMBRE — sale de la cuenta");
  const fsp10 = await import("node:fs/promises");
  const pjs6 = await fsp10.readFile(new URL("panel/panel.js", BASE), "utf8");
  const ses = await fsp10.readFile(new URL("lib/sesion.js", BASE), "utf8");
  const sinComent = pjs6.replace(/^\s*(\/\/|\*).*$/gm, "");

  check("ningún saludo usa el nombre del CV",
    !/perfil\??\.nombre/.test(sinComent), (sinComent.match(/.{0,30}perfil\??\.nombre.{0,20}/) || [""])[0]);
  check("hay una sola fuente del nombre: la cuenta", /function nombreCuenta\(/.test(pjs6)
    && /estado\.usuario\?\.nombre/.test(pjs6));
  check("la cabecera se pinta desde la cuenta",
    /function pintarQuienSoy\(\)[\s\S]{0,300}estado\.usuario/.test(pjs6));
  check("sin nombre en la cuenta, se ofrece ponerlo", /id="form-nombre"|#form-nombre/.test(pjs6));
  check("el nombre se guarda en la cuenta", /\/api\/cuenta\/nombre/.test(ses));
  check("al verificar se recoge el nombre puesto en la web",
    /guardar\(\{ \.\.\.\(await obtener\(\)\), usuario: j\.usuario \}\)/.test(ses));
}

// ══════════════════════════════════════════════════════════════════════
// EL CONTRATO FONDO ↔ PORTALES
// ══════════════════════════════════════════════════════════════════════
// El fondo mandaba «abrirFormulario» y LinkedIn, Indeed y Bumeran solo
// entendían «abrir». Respondían «no sé hacer esa acción» y la postulación
// moría en el primer paso: en tres de los cuatro portales NUNCA se llegó a
// leer una pregunta. Ali lo vio como «no autocompleta».
//
// Nadie comparaba lo que manda el fondo con lo que entiende cada portal.
// Esto lo compara.
{
  titulo("CONTRATO — cada acción del fondo la entiende cada portal");
  const fspc = await import("node:fs/promises");
  const fondoC = await fspc.readFile(new URL("background.js", BASE), "utf8");

  // Lo que el fondo le pide a una pestaña de portal (también las
  // llamadas partidas en varias líneas).
  const manda = [...new Set(
    [...fondoC.matchAll(/hablarCon\(\s*tabId,\s*\{\s*accion:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]),
  )];
  check("se leen las acciones que manda el fondo", manda.length >= 5, manda.join(", "));

  for (const portal of ["computrabajo", "linkedin", "indeed", "bumeran"]) {
    const src = await fspc.readFile(new URL(`contenido/${portal}.js`, BASE), "utf8");
    const entiende = new Set(
      [...src.matchAll(/(?:case\s+|accion\s*===\s*)"([a-zA-Z]+)"/g)].map((m) => m[1]),
    );
    const faltan = manda.filter((a) => !entiende.has(a));
    check(`${portal} entiende todo lo que le pide el fondo`, faltan.length === 0,
      faltan.length ? `no entiende: ${faltan.join(", ")}` : "");
  }

  // Las respuestas viajan por POSICIÓN. Cada pregunta tiene que llevarla,
  // y cada portal tiene que aceptar la posición al escribir.
  check("el fondo le pone posición a cada pregunta",
    /indice:\s*p\.indice\s*\?\?\s*i/.test(fondoC));
  for (const portal of ["linkedin", "indeed"]) {
    const src = await fspc.readFile(new URL(`contenido/${portal}.js`, BASE), "utf8");
    // Indeed escribe por su `indice` fijo (textos 0…, opciones 100+,
    // desplegables 200+), que es la posición que le pone el fondo.
    check(`${portal} escribe por id o por posición`, portal === "indeed"
      ? /dadas\[pregunta\.indice\]\s*\?\?\s*dadas\[pregunta\.id\]/.test(src)
      : /dadas\[pregunta\.id\]\s*\?\?\s*dadas\[i\]/.test(src));
    // Contar lo escrito DE VERDAD, no las respuestas recibidas.
    check(`${portal} cuenta lo que escribió, no lo que recibió`,
      !/escritas:\s*Object\.keys\(dadas\)\.length/.test(src));
  }
  const bum = await fspc.readFile(new URL("contenido/bumeran.js", BASE), "utf8");
  check("bumeran escribe por id o por posición", /dadas\.salarioPretendido\s*\?\?\s*dadas\[0\]/.test(bum));

  // Y lo redactado se escribe al preparar, no solo al enviar.
  const prep = fondoC.slice(fondoC.indexOf("async function prepararUna"),
                            fondoC.indexOf("async function escribirYEnviar"));
  check("al preparar ya se escribe lo redactado en el formulario",
    /accion:\s*"escribir"/.test(prep));
  check("y la medición dice por qué falló", /motivo:\s*fallo/.test(fondoC));
}

// ══════════════════════════════════════════════════════════════════════
// LAS HERRAMIENTAS COMPARTIDAS, CONECTADAS
// ══════════════════════════════════════════════════════════════════════
// comun.js expone rellenar, enunciadoDe, adjuntarCV... en
// window.ChambaComun. LinkedIn, Indeed y Bumeran las llamaban sueltas,
// como si fueran globales. No lo son: leer una pregunta, escribir una
// respuesta o adjuntar el CV reventaba con «no está definido». En esos
// tres portales NUNCA se rellenó nada, y ninguna prueba lo veía porque
// nadie ejecutaba ese código.
{
  titulo("COMÚN — ningún portal usa una herramienta sin tomarla");
  const fspm = await import("node:fs/promises");
  const comun = await fspm.readFile(new URL("contenido/comun.js", BASE), "utf8");
  const exportadas = ((comun.match(/return \{([^}]*)\};\s*\}\)\(\);\s*$/m) || [])[1] || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  check("se leen las herramientas que exporta comun.js", exportadas.length >= 5, exportadas.join(", "));

  for (const portal of ["computrabajo", "linkedin", "indeed", "bumeran"]) {
    const src = await fspm.readFile(new URL(`contenido/${portal}.js`, BASE), "utf8");
    const tomadas = new Set(((src.match(/const \{([^}]*)\}\s*=\s*window\.ChambaComun/) || [])[1] || "")
      .split(",").map((s) => s.trim()).filter(Boolean));
    const sueltas = exportadas.filter((f) => {
      // Uso suelto: `f(` sin `.` delante (C.f( es la otra forma válida).
      const usa = new RegExp(`(^|[^.\\w])${f}\\(`, "m").test(src);
      const local = new RegExp(`(function\\s+${f}\\b|const\\s+${f}\\s*=)`).test(src);
      return usa && !local && !tomadas.has(f);
    });
    check(`${portal} toma de ChambaComun todo lo que usa`, sueltas.length === 0,
      sueltas.length ? `sin conectar: ${sueltas.join(", ")}` : "");
  }

  // Y ningún portal que sabe postular se marca como «no postulable» al
  // leer sus ofertas: LinkedIn lo hacía, y el fondo ni lo intentaba.
  const lk = await fspm.readFile(new URL("contenido/linkedin.js", BASE), "utf8");
  check("las ofertas de LinkedIn llegan al modo «rellena»", !/postulable:\s*false/.test(lk));
}

// ══════════════════════════════════════════════════════════════════════
// SOLO LO DEL TEMA QUE BUSCASTE
// ══════════════════════════════════════════════════════════════════════
// Buscando «practicante de marketing» salió «Practicante de Diseño
// Gráfico». Se ordenaba por el CV, pero nunca se filtraba por la búsqueda.
{
  titulo("TEMA — la lista es de lo que buscaste");
  const { relacionada } = await import(`${BASE}lib/coincidencia.js`);
  const casos = [
    ["Practicante de Diseño Gráfico", "practicante de marketing", false],
    ["Practicante de Marketing / Gestión y análisis de leads", "practicante de marketing", true],
    ["Asistente de Redes Sociales", "practicante de marketing", true],
    ["Practicante MKT Digital", "practicante de marketing", true],
    ["Practicante de Contabilidad", "practicante de marketing", false],
    ["Practicante de Enfermería", "enfermera", true],
    ["Cualquier puesto", "practicante", true],          // sin tema: no se filtra
    ["", "marketing", true],                              // sin título: no se juzga
  ];
  for (const [titulo, busca, esperado] of casos) {
    check(`«${titulo || "(sin título)"}» para «${busca}» → ${esperado ? "sí" : "no"}`,
      relacionada({ titulo }, busca) === esperado);
  }
  const fspt = await import("node:fs/promises");
  const pj = await fspt.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("la búsqueda filtra por tema", /coincidencia\.relacionada\(v, puesto\)/.test(pj));
  check("y deja ver lo quitado", /Ver también \$\{estado\.fueraDeTema\.length\}/.test(pj));
}

// ══════════════════════════════════════════════════════════════════════
// VER EL FORMULARIO QUE SE RELLENÓ
// ══════════════════════════════════════════════════════════════════════
// La pestaña de trabajo se crea en segundo plano. Ali nunca veía el
// formulario rellenado —ni podía revisarlo, aunque la casilla le pedía
// «revisé el formulario en la página del portal»— y concluía que no se
// escribía nada.
{
  titulo("FORMULARIO — se puede ver, y se sigue por varias pantallas");
  const fspf = await import("node:fs/promises");
  const fo = await fspf.readFile(new URL("background.js", BASE), "utf8");
  const pj = await fspf.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("el fondo sabe enseñar la pestaña del formulario", /case "mostrarFormulario"/.test(fo));
  check("y antes escribe lo contestado en el panel",
    /case "mostrarFormulario"[\s\S]{0,400}accion: "escribir"/.test(fo));
  check("el panel tiene el botón para verlo", /id="btn-ver-form"/.test(pj));
  check("en LinkedIn ese es el botón principal y no hay «Enviar»",
    /soloRevisado \? "primario" : "secundario"/.test(pj) && /id="btn-enviar"/.test(pj)
    && /soloRevisado \? " oculto" : ""/.test(pj));
  check("se puede rellenar la pantalla siguiente", /case "rellenarPantalla"/.test(fo)
    && /id="btn-rellenar-pantalla"/.test(pj));
  check("preparar y «rellenar pantalla» usan la misma función",
    (fo.match(/await rellenarPantalla\(/g) || []).length >= 2);
  // Indeed abre SmartApply en otra web: hay que seguirla.
  check("si el formulario se abre en otra pestaña o web, se sigue",
    /async function buscarFormularioAbierto/.test(fo) && /smartapply/.test(fo));
  check("pulsar «Postular» que navega no se trata como error",
    /port closed\|message channel/.test(fo));
}

// ══════════════════════════════════════════════════════════════════════
// «POSTULAR A TODAS», A LA VISTA · Y CONECTAR MÁS PORTALES
// ══════════════════════════════════════════════════════════════════════
{
  titulo("ACCIONES — a la vista cuando sirven");
  const fspa = await import("node:fs/promises");
  const ph = await fspa.readFile(new URL("panel/panel.html", BASE), "utf8");
  const pj = await fspa.readFile(new URL("panel/panel.js", BASE), "utf8");
  const pc = await fspa.readFile(new URL("panel/panel.css", BASE), "utf8");
  check("«Postular a todas» es el botón principal, no uno de peligro",
    /class="boton primario" id="btn-lote-auto"/.test(ph));
  check("y la barra se queda fija abajo", /\.barra-lote\s*\{[^}]*position:\s*sticky/.test(pc));
  // Sin elegir ninguna van todas; eligiendo, solo esas. Y lo dice.
  check("dice a cuántas va a postular", /las \$\{n\} elegidas/.test(pj) && /las \$\{total\}/.test(pj));
  check("con un portal conectado, se ofrecen los demás en Inicio",
    /Conectar más portales/.test(pj) && /sinConectar\.map\(filaPortal\)/.test(pj));
  check("la tarjeta de portal es UNA función, usada en los dos sitios",
    (pj.match(/map\(filaPortal\)/g) || []).length >= 3);
}

// ══════════════════════════════════════════════════════════════════════
// VERSIÓN ATRASADA
// ══════════════════════════════════════════════════════════════════════
// Ali probó un arreglo que su Chrome no había cargado: el evento de su
// prueba llegó con el formato viejo. Sin aviso, eso le pasa a cualquiera.
{
  titulo("VERSIÓN — si va atrasada, se dice");
  const fspv = await import("node:fs/promises");
  const pj = await fspv.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("el panel compara su versión con la publicada",
    /version_extension/.test(pj) && /function esMasNueva/.test(pj));
  const esMasNueva = new Function(`${pj.match(/function esMasNueva[\s\S]*?\n\}/)[0]}; return esMasNueva;`)();
  check("0.3.4 es más nueva que 0.3.3", esMasNueva("0.3.4", "0.3.3") === true);
  check("0.3.10 es más nueva que 0.3.9 (no orden de texto)", esMasNueva("0.3.10", "0.3.9") === true);
  check("la misma no es más nueva", esMasNueva("0.3.3", "0.3.3") === false);
}

// ══════════════════════════════════════════════════════════════════════
// POSTULARME NAVEGA — Y LA PREPARACIÓN NUNCA PUEDE ENVIAR
// ══════════════════════════════════════════════════════════════════════
// Comprobado en el sitio real el 2026-09-24: «Postularme» en Computrabajo
// ya no abre un formulario en la página; lleva a
// candidato.pe.computrabajo.com/match/. La extensión seguía hablándole a
// la página vieja, fallaba sin anotar nada, y Ali veía «no hace nada».
{
  titulo("NAVEGACIÓN — se sigue a la página nueva sin pulsar nada más");
  const fspn = await import("node:fs/promises");
  const fo = await fspn.readFile(new URL("background.js", BASE), "utf8");
  const ct = await fspn.readFile(new URL("contenido/computrabajo.js", BASE), "utf8");
  const prep = fo.slice(fo.indexOf("async function prepararUna"), fo.indexOf("async function rellenarPantalla"));

  check("se apunta la URL de antes de pulsar", /const urlAntes = /.test(prep));
  check("cualquier cambio de página cuenta, no solo SmartApply",
    /sinAncla\(misma\.url\) !== sinAncla\(urlAntes\)/.test(fo));
  // Lo importante: tras navegar NO se vuelve a llamar a abrirFormulario,
  // que en Computrabajo pulsa «Postularme» — en /match/ podría enviar.
  const trasEncontrar = prep.slice(prep.indexOf("const donde = await buscarFormularioAbierto"));
  const hastaCierre = trasEncontrar.slice(0, trasEncontrar.indexOf("\n  }\n"));
  check("tras navegar no se vuelve a pulsar nada",
    !/accion:\s*"abrirFormulario"/.test(hastaCierre), hastaCierre.slice(0, 80));
  check("y Computrabajo no pulsa dentro del flujo de postulación",
    /location\.host\.startsWith\("candidato\."\)[\s\S]{0,120}return \{ abierto: true/.test(ct));
  // El textarea oculto «Comment» de la ficha no es una pregunta.
  check("Computrabajo solo lee preguntas visibles", /q\.enunciado && q\.visible/.test(ct));
}

{
  titulo("YA POSTULADAS — no vuelven a salir");
  const fspy = await import("node:fs/promises");
  for (const portal of ["indeed", "bumeran", "linkedin"]) {
    const src = await fspy.readFile(new URL(`contenido/${portal}.js`, BASE), "utf8");
    check(`${portal} detecta «ya postulaste» en la tarjeta`,
      !/yaPostulado:\s*false/.test(src) && /postulad\[oa\]/.test(src));
  }
  const pj = await fspy.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("el panel quita las que ya postuló con Chamba Lista (por clave de oferta)",
    /almacen\.tracker\.clavesPostuladas\(\)/.test(pj) && /almacen\.claveOferta\(todas\[k\]\.url\)/.test(pj));
  check("y lo dice", /Ocultamos \$\{estado\.yaPostuladasOcultas\}/.test(pj));
  // Al conectar un portal el panel se repinta; el desplegable se cerraba
  // y parecía que todo se reiniciaba.
  check("el desplegable de portales sigue abierto mientras uno se conecta",
    (pj.match(/conectando\.has\(p\.id\)\) \? " open" : ""/g) || []).length >= 2);
}

// ══════════════════════════════════════════════════════════════════════
// COMPUTRABAJO — «PREGUNTAS DE SELECCIÓN» (sitio real, 2026-09-24)
// ══════════════════════════════════════════════════════════════════════
// «Postularme» lleva a candidato.pe.computrabajo.com/candidate/kq: textos
// KillerQuestions[n].OpenQuestion, opciones .ClosedQuestion y «Enviar mi
// CV». Un clic programado sobre «Postularme» no hacía nada.
{
  titulo("COMPUTRABAJO — la página de preguntas nueva");
  const fspk = await import("node:fs/promises");
  const ct = await fspk.readFile(new URL("contenido/computrabajo.js", BASE), "utf8");
  const resp = await import(`${BASE}lib/respuestas.js`);

  check("va a postular por la dirección del botón, no con un clic",
    /boton\.dataset\.hrefOfferApply/.test(ct) && /location\.assign\(destino\)/.test(ct));
  check("lee también las preguntas de opciones", /function leerOpciones\(\)/.test(ct)
    && /concat\(leerOpciones\(\)\)/.test(ct));
  check("quita «(máximo N caracteres)» del enunciado", /m\[aá\]ximo \\d\+ caracteres/.test(ct));
  check("sabe marcar una opción", /input\[type=radio\]\[name=/.test(ct));
  check("el ping dice si el portal ya postuló solo", /enviada: Boolean\(confirmada\(\)\)/.test(ct));

  // Las de opciones las elige la persona, con las opciones DEL PORTAL.
  const horario = { indice: 100, tipo: "opcion", enunciado: "En que horario te encuentras con mayor disponibilidad",
                    opciones: ["8:00AM - 1:00PM", "1:00PM - 6:00PM", "2:00PM - 7:00PM"] };
  const [sinElegir] = await resp.redactar([horario], {}, {}, {});
  // Se elige SOLO entre los turnos del portal (sin preguntar), y se puede
  // cambiar en el panel.
  check("un horario se elige solo, entre los turnos del portal",
    horario.opciones.includes(sinElegir.texto), sinElegir.texto);
  check("y se le ofrecen los turnos del portal, no «Sí / No»",
    JSON.stringify(sinElegir.necesita[0]?.opciones) === JSON.stringify(horario.opciones),
    JSON.stringify(sinElegir.necesita[0]?.opciones));
  const [elegido] = await resp.redactar([horario], {}, {}, { opc_100: "1:00PM - 6:00PM" });
  check("al elegir, queda esa opción", elegido.texto === "1:00PM - 6:00PM");

  // El teléfono sale del CV, no del modelo.
  const [tel] = await resp.redactar([{ indice: 2, enunciado: "Déjanos tu numero actualizado para ponernos en contacto." }],
    { contacto: { telefono: "999 888 777" } }, {}, {});
  check("«déjanos tu número» se contesta con el teléfono del CV", tel.texto === "Mi número es 999 888 777.", tel.texto);
  const [sinTel] = await resp.redactar([{ indice: 2, enunciado: "Déjanos tu número de celular" }], { contacto: {} }, {}, {});
  check("sin teléfono en el CV y sin ser obligatorio, no se interrumpe",
    sinTel.texto === "" && sinTel.necesita.length === 0);
  const [telObligatorio] = await resp.redactar(
    [{ indice: 2, enunciado: "Déjanos tu número de celular", obligatoria: true }], { contacto: {} }, {}, {});
  check("si el portal lo exige, entonces sí se pregunta", telObligatorio.necesita.length === 1);

  // Elegir una opción no vuelve a navegar ni a pulsar «Postularme».
  const pj = await fspk.readFile(new URL("panel/panel.js", BASE), "utf8");
  const rr = pj.slice(pj.indexOf("async function reRedactar"), pj.indexOf("function respuestasDelPanel"));
  check("elegir una opción solo vuelve a leer esta pantalla",
    /accion: "rellenarPantalla"/.test(rr) && !/accion: "prepararUna"/.test(rr));
}

// ══════════════════════════════════════════════════════════════════════
// PREGUNTAR ES EL ÚLTIMO RECURSO (Ali, 2026-09-24)
// ══════════════════════════════════════════════════════════════════════
// «Lo de pedir ayuda al usuario es lo último que queremos hacer.» Una
// tanda de treinta con una pregunta cada una eran treinta interrupciones.
{
  titulo("SIN INTERRUMPIR — solo se pregunta lo que compromete de verdad");
  const r = await import(`${BASE}lib/respuestas.js`);

  const [adHonorem] = await r.redactar([{ indice: 0, enunciado: "Confirmo que las prácticas son AD HONOREM (sin remuneración)." }], {}, {}, {});
  check("prácticas SIN PAGO: se aceptan solas y quedan anotadas",
    /Confirmo/.test(adHonorem.texto) && adHonorem.sinPagoAceptado === true);
  check("y no frenan el envío automático", r.consentimientoPendiente([adHonorem]) === null);

  const [terminos] = await r.redactar([{ indice: 0, enunciado: "Acepto los términos y condiciones y el tratamiento de mis datos." }], {}, {}, {});
  check("unos términos normales se aceptan solos", /acepto las condiciones/.test(terminos.texto));
  check("y no frenan el envío", r.consentimientoPendiente([terminos]) === null);
  const [noAcepto] = await r.redactar([{ indice: 0, enunciado: "Acepto los términos y condiciones." }], {}, {}, { consent_0: "No" });
  check("salvo que ella diga que no", noAcepto.texto === "");

  // Una opción que no es de disponibilidad es un HECHO sobre la persona:
  // un «Sí» elegido a ciegas sería inventar. Esa la decide el modelo.
  const [hecho] = await r.redactar([{ indice: 100, tipo: "opcion", enunciado: "¿Tienes experiencia en SAP?",
                                      opciones: ["Sí", "No"] }], {}, {}, {});
  check("una opción que es un hecho no se elige a ciegas", hecho.texto === "", hecho.texto);

  // Un dato que el modelo no sabe y el portal no exige: en blanco.
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(new URL("lib/respuestas.js", BASE), "utf8");
  check("lo que el modelo no sabe y no es obligatorio no se pregunta",
    /r\.falta && !q\.obligatoria/.test(src));
  check("el modelo recibe la vacante", /puesto: contexto\.titulo/.test(src));
}

// ══════════════════════════════════════════════════════════════════════
// MÁS RÁPIDO
// ══════════════════════════════════════════════════════════════════════
{
  titulo("VELOCIDAD — no hacer lo que no hace falta, y en paralelo");
  const fs = await import("node:fs/promises");
  const fo = await fs.readFile(new URL("background.js", BASE), "utf8");
  const prep = fo.slice(fo.indexOf("async function prepararUna"), fo.indexOf("async function rellenarPantalla"));
  check("adaptar el CV y generar el Word solo si hay dónde subirlo",
    /conArchivo \? cvAdaptado\(/.test(prep) && !/ia\.adaptarAVacante/.test(prep));
  check("redactar y adaptar van a la vez", /Promise\.all\(\[\s*redactarPantalla/.test(prep));
  for (const portal of ["computrabajo", "linkedin", "indeed", "bumeran"]) {
    const src = await fs.readFile(new URL(`contenido/${portal}.js`, BASE), "utf8");
    check(`${portal} dice si el formulario pide archivo`, /conArchivo:/.test(src));
  }
  check("la pausa entre vacantes bajó", /PAUSA_ENTRE_VACANTES = 1500/.test(fo));
}

// ══════════════════════════════════════════════════════════════════════
// CONECTAR UN PORTAL SE QUEDA CONECTADO
// ══════════════════════════════════════════════════════════════════════
// Ali: «ingreso pero sigue saliendo conectando». La sesión solo se veía
// con una pestaña del portal abierta, y la vigilancia moría cuando Chrome
// dormía la extensión.
{
  titulo("CONEXIÓN — se recuerda, y la vigilancia sobrevive");
  const fs = await import("node:fs/promises");
  const fo = await fs.readFile(new URL("background.js", BASE), "utf8");
  const pj = await fs.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("la sesión vista se recuerda aunque se cierre la pestaña",
    /sesionesRecordadas/.test(fo) && /e\.recordada = true/.test(fo));
  check("y se olvida si el portal dice que ya no hay sesión",
    /e\.sesion === false\) delete recordadas/.test(fo));
  // El oyente tiene que estar a nivel superior: dentro de una función
  // se pierde cuando Chrome duerme la extensión.
  check("la vigilancia vive en el almacén y el oyente es de nivel superior",
    /^chrome\.tabs\.onUpdated\.addListener/m.test(fo) && /almacen\.guardar\("vigilando"/.test(fo));
  check("también mira al cambiar de dirección sin recargar", /info\.status === "complete" \|\| info\.url/.test(fo));
  check("el panel revisa solo mientras conectas", /function vigilarConexiones\(\)/.test(pj)
    && /if \(!conectando\.size/.test(pj));
}

// ══════════════════════════════════════════════════════════════════════
// LINKEDIN DE VERDAD (medido en el sitio real, 2026-09-24)
// ══════════════════════════════════════════════════════════════════════
// Clases con hash, sin #global-nav, dos diseños de la misma ficha (con
// <a> a /apply o con botones), un FILTRO que también se llama «Solicitud
// sencilla», y un formulario que LinkedIn ya trae relleno.
{
  titulo("LINKEDIN — lo que hay en el sitio real hoy");
  const fs = await import("node:fs/promises");
  const li = await fs.readFile(new URL("contenido/linkedin.js", BASE), "utf8");

  check("la sesión se ve por Mensajes/Notificaciones, no solo por #global-nav",
    /a\[href\*='\/messaging'\]/.test(li) && /a\[href\*='\/notifications'\]/.test(li));
  check("encuentra el enlace a /apply, no solo botones", /a\[href\*='\/jobs\/view\/'\]\[href\*='\/apply'\]/.test(li));
  check("solo cuenta lo que se ve (hay un botón viejo oculto y vacío)",
    /filter\(visible\)/.test(li));
  check("prefiere el que dice «Solicitud sencilla»", /const conTexto = candidatos\.find/.test(li));
  check("nunca pulsa el FILTRO «Solicitud sencilla»", /searchFilter/.test(li));
  check("el formulario se reconoce por su rol de diálogo", /\[role='dialog'\]/.test(li));
  // Lo que LinkedIn ya rellenó no se toca.
  check("no toca campos que ya tienen valor", /!esMarca && \(campo\.value \|\| ""\)\.trim\(\)\) continue/.test(li));
  check("no toca el CV marcado ni «Sigue a la empresa»", /resume\|curr\[ií\]cul\|\\bcv\\b\|sigue a\|follow/.test(li));
  check("no sube un CV nuevo en LinkedIn", /conArchivo: false/.test(li));
  // Si LinkedIn no abre la Solicitud Sencilla, se dice y se da la salida.
  check("si LinkedIn no la abre, se dice cómo seguir", /manual: true/.test(li));
  check("sin caracteres de control invisibles", !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(li));
}

// ══════════════════════════════════════════════════════════════════════
// AUTOMÁTICO POR DEFECTO (Ali, 2026-09-24)
// ══════════════════════════════════════════════════════════════════════
// «Todo lo tiene que hacer directamente automático, la persona no debe
// tocar nada. Habrá gente que ponga la opción de que siempre les avise
// antes de postular, pero apuntamos a lo que la gran mayoría hará.»
{
  titulo("AUTOMÁTICO — postular envía; revisar es una opción");
  const fs = await import("node:fs/promises");
  const pj = await fs.readFile(new URL("panel/panel.js", BASE), "utf8");
  const ph = await fs.readFile(new URL("panel/panel.html", BASE), "utf8");
  const av = pj.slice(pj.indexOf("async function abrirVacante"), pj.indexOf("function pintarModal"));
  check("«Postular» prepara y ENVÍA si está todo contestado",
    /accion: "enviarUna"/.test(av) && /!prefs\.revisarAntes && !noSigue && !faltaAlgo/.test(av));
  check("solo se para si falta un dato obligatorio o algo impide seguir",
    /n\) => !n\.respondido/.test(av));
  // Desde 2026-09-25 es un interruptor (Ali: «un botón deslizable on/off»),
  // el mismo en la barra de la tanda y en Mi perfil.
  check("postula sola / te avisa antes es un interruptor, en la tanda y en Mi perfil",
    (ph.match(/class="sw-auto"/g) || []).length >= 3);
  check("y viene encendido: postula sola", /class="sw-auto" role="switch" checked/.test(ph));
  check("el consentimiento del lote se da una sola vez",
    /almacen\.leer\("aprobacionAuto"/.test(pj) && /almacen\.guardar\("aprobacionAuto"/.test(pj));
  check("la tarjeta dice «Postular», no «Ver y postular»", !/"Ver y postular"/.test(pj));
}

// ══════════════════════════════════════════════════════════════════════
// INDEED DE VERDAD (medido en SmartApply real, 2026-09-24)
// ══════════════════════════════════════════════════════════════════════
// El botón ya no era #indeedApplyButton, las preguntas de Sí/No se leían
// radio a radio, los desplegables propios no se veían y el botón final
// («Envía tu postulación») no encajaba. Indeed no postulaba ni una.
// El recorrido completo está en prueba-indeed.html (DOM copiado del real).
{
  titulo("INDEED — lo que hay en SmartApply hoy");
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(new URL("contenido/indeed.js", BASE), "utf8");
  const comun = await fs.readFile(new URL("contenido/comun.js", BASE), "utf8");

  check("encuentra el enlace «Postularse ahora»", /a\[data-testid='viewjob-indeed-apply'\]/.test(src));
  check("y va a su dirección, sin depender de un clic", /location\.assign\(boton\.href\)/.test(src));
  check("las preguntas de opciones se leen por su <legend>", /querySelector\("legend"\)/.test(src));
  check("los desplegables propios (role=combobox) se leen y se eligen",
    /\[role=combobox\]/.test(src) && /\[role=option\]/.test(src) && /d\.items\[k\]\.click\(\)/.test(src));
  check("índices fijos: textos 0…, opciones 100+, desplegables 200+",
    /indice: 100 \+ g/.test(src) && /indice: 200 \+ k/.test(src));
  check("no toca el CV que Indeed ya tiene elegido", /r\.name === "resume-selection"/.test(src));
  check("ni la casilla de alertas por correo de la revisión", /actualizaciones por email/.test(src));
  check("pasa sola la pantalla de elegir CV antes de leer preguntas",
    /accion === "preguntas"\) pasarPantallasVacias\(\)/.test(src));
  check("reconoce «Envía tu postulación»",
    /submit-application-button/.test(src) && /env\[ií\]a\(r\)\? tu postulaci/.test(src));
  check("espera a «Preparando la evaluación» antes de enviar", /i < 40; i\+\+\) \{ await esperar\(750\)/.test(src));
  check("si Indeed no deja seguir, devuelve lo que dice", /function avisosDelPortal/.test(src)
    && /errores\.length \? \{ avanzado: false, errores \}/.test(src));
  check("«Sí» no se confunde con «Sin preferencia»", /const corte = /.test(src));
  check("un <select> se rellena con su propio setter", /HTMLSelectElement\.prototype/.test(comun));
  check("sin caracteres de control invisibles", !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src));
}

// ══════════════════════════════════════════════════════════════════════
// BUMERAN DE VERDAD (medido en el sitio real, 2026-09-24)
// ══════════════════════════════════════════════════════════════════════
// «Postularme» es el submit del formulario del sueldo, y el sueldo ya
// viene relleno desde el CV de Bumeran. Abrir lo pulsaba: postulaba al
// PREPARAR, también con «Revisar antes» activado.
{
  titulo("BUMERAN — preparar no postula; el sueldo de su CV se respeta");
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(new URL("contenido/bumeran.js", BASE), "utf8");
  const abrir = src.slice(src.indexOf("async function abrirFormulario"), src.indexOf("function leerPreguntas"));
  check("abrir el formulario NO pulsa «Postularme»", !/\.click\(\)/.test(abrir));
  check("el sueldo que ya trae Bumeran no se pregunta", /!\(salario\.value \|\| ""\)\.trim\(\)\) \{\s*preguntas\.push/.test(src));
  check("ni se pisa al escribir", /salario\.offsetParent !== null && !\(salario\.value/.test(src.slice(src.indexOf("function escribirRespuestas"))));
  check("el enunciado encaja con el dato guardado «pretensión»", /pretensi[oó]n salarial \(sueldo bruto\)/.test(src));

  const i = src.indexOf("function soloCifra");
  const soloCifra = eval("(" + src.slice(i, src.indexOf("return s.split", i)) + "return s.split(/[.,]/)[0]; })");
  check("«S/ 1,500.00» se escribe 1500 (antes 150000)", soloCifra("Mi pretensión salarial es de S/ 1,500.00.") === "1500");
  check("«2 500» y «1.500» son miles", soloCifra("2 500") === "2500" && soloCifra("S/ 1.500") === "1500");
  check("«1200.50» se queda en 1200", soloCifra("1200.50") === "1200");
  check("enviar espera la confirmación, no mira una sola vez", /i < 16; i\+\+/.test(src));
}

// ══════════════════════════════════════════════════════════════════════
// RONDA 2026-09-25 — lo que falló en la tanda real de Ali
// ══════════════════════════════════════════════════════════════════════
// Eventos de Supabase de su tanda (15:21–15:22): en Computrabajo 0
// preguntas leídas, «port moved into back/forward cache», «Necesitas
// iniciar sesión» estando dentro, y «No se encontró el botón» en ofertas
// que ya estaban enviadas. Indeed salía como «no conectado» siempre.
{
  titulo("TANDA REAL — Computrabajo sigue la página hasta el formulario");
  const fs = await import("node:fs/promises");
  const fo = await fs.readFile(new URL("background.js", BASE), "utf8");
  check("/match/ es una página de paso: no se lee ahí", /DE_PASO = \/computrabajo/.test(fo));
  check("y se pide la dirección quieta tres veces, no dos", /estable < 3/.test(fo));
  check("una lectura que pilla la página navegando se repite",
    /SE_PUEDE_REPETIR = new Set\(\["ping", "sesion", "ofertas", "detalle", "preguntas"\]\)/.test(fo)
    && /SE_FUE_LA_PAGINA\.test/.test(fo));
  check("pulsar (abrir, siguiente, enviar) NUNCA se repite solo",
    !/SE_PUEDE_REPETIR = new Set\([^)]*(abrirFormulario|siguiente|enviar)/.test(fo));
  check("si no se pueden leer las preguntas, se dice (no «0 preguntas»)",
    /No se pudo leer el formulario/.test(fo) && !/accion: "preguntas" \}\)\.catch\(\(\) => \(\{\}\)\)/.test(fo));
  check("enviada al entrar cuenta como ENVIADA en la tanda", /if \(r\.enviadaDirecto\) \{ item\.estado = "enviada"/.test(fo));
  check("ya postulada y externa tienen su propio estado",
    /item\.estado = "ya_postulada"/.test(fo) && /item\.estado = "externa"/.test(fo));
  check("el panel ve qué hace la tanda ahora mismo", /lote\.actual = \{/.test(fo));
}

{
  titulo("YA POSTULADAS — no vuelven a salir, venga de donde venga");
  const al = await import(`${BASE}lib/almacen.js`);
  const k = al.claveOferta;
  check("Computrabajo con #lc= y ?x= es la misma oferta",
    k("https://pe.computrabajo.com/ofertas-de-trabajo/oferta-ABC#lc=Score-3")
      === k("https://pe.computrabajo.com/ofertas-de-trabajo/oferta-ABC?x=1"));
  check("Indeed: solo cuenta jk", k("https://pe.indeed.com/viewjob?jk=abc&from=serp") === k("https://pe.indeed.com/viewjob?jk=abc"));
  check("LinkedIn: solo cuenta el id", k("https://www.linkedin.com/jobs/view/123/?trk=x") === k("https://linkedin.com/jobs/view/123"));
  check("dos ofertas distintas no se confunden",
    k("https://pe.indeed.com/viewjob?jk=a") !== k("https://pe.indeed.com/viewjob?jk=b"));
  const fs = await import("node:fs/promises");
  const pj = await fs.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("lo que el portal ya resolvió al abrirla se anota", /estadoResuelto/.test(pj) && /quitarDeLaLista\(vacante\)/.test(pj));
  for (const portal of ["computrabajo", "indeed", "linkedin", "bumeran"]) {
    const src = await fs.readFile(new URL(`contenido/${portal}.js`, BASE), "utf8");
    check(`${portal} dice «ya postulaste» en vez de «no hay botón»`, /yaPostulado: (true|Boolean)/.test(src));
  }
}

{
  titulo("CONECTAR — se queda conectado, e Indeed también");
  const fs = await import("node:fs/promises");
  const fo = await fs.readFile(new URL("background.js", BASE), "utf8");
  const ind = await fs.readFile(new URL("contenido/indeed.js", BASE), "utf8");
  const por = await fs.readFile(new URL("lib/portales.js", BASE), "utf8");
  check("«sin sesión» en la página de acceso no borra la conexión", /!ES_ACCESO\.test\(t\.url/.test(fo));
  check("una página que no lo deja claro (null) no cuenta como «sin sesión»", /r\?\.sesion === true\) return/.test(fo));
  check("Indeed no se da por desconectado por tener enlaces a su cuenta",
    !/return !document\.querySelector\("a\[href\*='secure\.indeed\.com\/auth'\]/.test(ind) && /AccountMenu/.test(ind));
  check("el acceso a Indeed vuelve a pe.indeed.com", /continue=https%3A%2F%2Fpe\.indeed\.com/.test(por));
  check("y si se queda en secure.indeed.com, se le lleva", /u\.hostname === "secure\.indeed\.com"/.test(fo));
  check("conectado un portal, se vuelve al panel para el siguiente", /await volverAlPanel\(\)/.test(fo));
  const ver = await fs.readFile(new URL("lib/verificados.js", BASE), "utf8");
  const lista = (s, re) => JSON.stringify((s.match(re) || [])[1]?.match(/"[a-z]+"/g) || []);
  check("portales.js y verificados.js dicen lo mismo de qué está verificado",
    lista(por, /const VERIFICADOS = \[([^\]]*)\]/) === lista(ver, /POSTULACION_VERIFICADA = \[([^\]]*)\]/));
}

{
  titulo("PANEL — claro, interruptor, elegir, en vivo, CV de cada una");
  const fs = await import("node:fs/promises");
  const pc = await fs.readFile(new URL("panel/panel.css", BASE), "utf8");
  const ph = await fs.readFile(new URL("panel/panel.html", BASE), "utf8");
  const pj = await fs.readFile(new URL("panel/panel.js", BASE), "utf8");
  check("siempre claro: ni un bloque oscuro", !/prefers-color-scheme:\s*dark/.test(pc) && /color-scheme: light/.test(pc));
  check("las variables que usa el JS existen", ["--acento", "--tinta-3", "--ambar"].every((v) => pc.includes(`${v}:`)));
  check("el modo se elige con un interruptor, no con cuatro casillas",
    /id="sw-elegir"/.test(ph) && !/id="casillas"/.test(ph));
  check("encender el interruptor ES el consentimiento que pide el fondo",
    /almacen\.guardar\("aprobacionAuto", aprobacion\)/.test(pj));
  check("la lista va en filas y de veinte en veinte", /function filaVacante/.test(pj) && /const POR_PAGINA = 20/.test(pj));
  check("sin elegir ninguna van todas; eligiendo, solo esas", /estado\.elegidas\.size\s*\?/.test(pj));
  check("la tanda se ve en vivo y cada envío se celebra", /id="en-vivo"/.test(ph) && /function celebrar/.test(pj));
  check("cada postulación tiene su CV adaptado", /function descargarCVAdaptado/.test(pj) && /boton-cv/.test(pj));
  check("el recorrido cuenta → CV → portales → postular", /function pintarRecorrido/.test(pj) && /id="recorrido"/.test(ph));
  check("todo lo que se mueve respeta «reducir movimiento»", /prefers-reduced-motion: reduce\)\s*\{\s*\.hoja-flotante/.test(pc));
}

{
  titulo("COMPUTRABAJO — «Mis postulaciones» manda, no la marca escondida");
  const fs = await import("node:fs/promises");
  const ct = await fs.readFile(new URL("contenido/computrabajo.js", BASE), "utf8");
  const fo = await fs.readFile(new URL("background.js", BASE), "utf8");
  check("se leen tus postulaciones de candidate/match/", /URL_POSTULADAS = \{ computrabajo: "https:\/\/candidato\.pe\.computrabajo\.com\/candidate\/match\/"/.test(fo)
    && /case "postuladas":/.test(ct));
  check("con textContent: las de fuera de pantalla no se pintan", /e\?\.textContent/.test(ct.slice(ct.indexOf("function leerPostuladas"))));
  check("y se quitan de la búsqueda por puesto + empresa", /yaEnPortal\.has\(clavePuesto\(v\.titulo, v\.empresa\)\)/.test(fo));
  check("el panel cuenta también esas", /r\.ocultasPortal/.test(await fs.readFile(new URL("panel/panel.js", BASE), "utf8")));
  check("«Ya te postulaste» (lo que dice /match/) cuenta como enviada", /"ya te postulaste"/.test(ct));
  check("sin sesión se espera a que la cabecera cargue antes de rendirse", /i < 6 && !haySesion\(\)/.test(ct));
  check("un «Enviar» que hace navegar se comprueba en la página nueva",
    /dudosa: true/.test(fo) && /if \(ping\?\.enviada\) return \{ enviada: true/.test(fo));
}

console.log(`
${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`}`);

process.exit(fallos ? 1 : 0);

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
check("ad honorem queda VACÍA", r1[0].texto === "", `«${r1[0].texto}»`);
check("ad honorem avisa que es SIN PAGO", r1[0].necesita[0].aviso.includes("sin pago"));
check("disponibilidad queda VACÍA", r1[1].texto === "");
check("disponibilidad detecta el lugar",
  r1[1].necesita[0].etiqueta.includes("La Molina"), r1[1].necesita[0].etiqueta);
check("el distrito guardado se responde solo", r1[2].texto === "Resido en Surco.", r1[2].texto);
check("el DNI guardado se responde solo", r1[3].texto === "Mi DNI es 70123456.", r1[3].texto);
check("hay consentimiento pendiente", respuestas.consentimientoPendiente(r1) !== null);

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


titulo("LINKEDIN — rellena, pero no envia nunca");

{
  // No es una fase pendiente, es la decision. Su §8.2 prohibe la
  // automatizacion y lo que se arriesga es la cuenta de la persona.
  // Por eso hay DOS cierres en sitios distintos: si alguien quita uno,
  // el otro sigue, y para quitar los dos hay que hacerlo a proposito.
  const fsp = await import("node:fs/promises");
  const li = await fsp.readFile(new URL("contenido/linkedin.js", BASE), "utf8");
  const fondo = await fsp.readFile(new URL("background.js", BASE), "utf8");
  const port = await fsp.readFile(new URL("lib/portales.js", BASE), "utf8");

  check("el content script de LinkedIn no pulsa enviar",
    /async function enviar\(\)[\s\S]{0,400}?enviada: false/.test(li));
  check("y no busca ningun boton de envio",
    !/botonEnviar|submit application|enviar solicitud/i.test(li));
  check("LinkedIn va marcado soloRevisado", /soloRevisado: true/.test(port));
  check("y el lote automatico lo respeta", /soloRevisado && item\.estado/.test(fondo));
  // El bloque del candado: desde donde se calcula soloRevisado hasta el
  // else. Se busca el ULTIMO «soloRevisado», que es el codigo; el
  // primero esta en el comentario que lo explica.
  const candado = fondo.slice(fondo.lastIndexOf("const soloRevisado"),
                              fondo.lastIndexOf("const soloRevisado") + 700);
  check("con red de seguridad por nombre, por si falta la marca",
    /linkedin/i.test(candado));
  check("queda anotado como omitida, no como enviada",
    /item\.estado = "omitida"/.test(candado));

  const ver = await fsp.readFile(new URL("lib/verificados.js", BASE), "utf8");
  check("y esta en SOLO_RELLENA, no en pendiente de probar",
    /SOLO_RELLENA/.test(ver) && /linkedin/.test(ver.split("SOLO_RELLENA")[1].split("]")[0]));
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

console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`}`);
process.exit(fallos ? 1 : 0);

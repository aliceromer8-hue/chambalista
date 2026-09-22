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
  const trasSubir = pjs.slice(pjs.indexOf("almacen.perfil.guardar"),
                              pjs.indexOf("almacen.perfil.guardar") + 900);
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
  check("los cuatro portales no dicen todos lo mismo",
    new Set(dicen.map((d) => d.split(":")[1])).size >= 3, dicen.join(" · "));
  check("computrabajo es el unico que dice «postula» a secas",
    queHace({ id: "computrabajo", postulable: true }).etiqueta === "postula");
  const sinTildes = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  check("linkedin avisa de que el envio lo da la persona",
    /envias tu/.test(sinTildes(queHace({ id: "linkedin", postulable: true }).etiqueta)),
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

  // El argumento de venta estorba a quien ya compro.
  check("el bloque «como postula por ti» se retira al cargar el CV",
    /#hace"\)\.classList\.toggle\("oculto", etapa >= 2\)/.test(pjs),
    "en escritorio empujaba el tablero fuera de la vista");

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
  check("y se nombran, para que se sepa que estan ahi",
    /Añadir \$\{resto\.map/.test(pjs));
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
    /export const TOPE_POR_TANDA\s*=\s*\d+/.test(ver));
  check("background.js lo importa en vez de declararlo",
    fondo2.includes('import { TOPE_POR_TANDA }') &&
    !/^const TOPE_POR_TANDA/m.test(fondo2));

  const tope = Number((ver.match(/TOPE_POR_TANDA\s*=\s*(\d+)/) || [])[1]);
  const pack = Number((ver.match(/PACK_MAYOR\s*=\s*(\d+)/) || [])[1]);
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

console.log(`
${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`}`);

process.exit(fallos ? 1 : 0);

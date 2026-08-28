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
check("los tres portales están registrados", LISTA_PORTALES.length === 3);
check("solo Computrabajo postula",
  LISTA_PORTALES.filter((p) => p.postulable).map((p) => p.id).join() === "computrabajo");

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

console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`}`);
process.exit(fallos ? 1 : 0);

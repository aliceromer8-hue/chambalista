// Cuánto encaja una vacante con el CV de la persona.
//
// No usa el modelo: es cálculo local, instantáneo y gratis. Se ejecuta
// sobre decenas de vacantes a la vez, así que gastar una llamada de IA
// por cada una sería lento y caro para lo que aporta.
//
// El puntaje NO es una promesa de nada: es una ayuda para ordenar la
// lista. Por eso la interfaz muestra también QUÉ coincidió, para que la
// persona juzgue por sí misma en vez de creerse un número.

const VACIAS = new Set([
  "de","del","la","el","los","las","un","una","unos","unas","y","o","en","con",
  "para","por","que","se","su","sus","al","es","son","como","mas","más","the",
  "and","for","con","sin","segun","según","sobre","entre","desde","hasta","muy",
  "nuestro","nuestra","buscamos","empresa","puesto","trabajo","area","área",
  "años","año","experiencia","conocimiento","conocimientos","manejo","nivel",
]);

function palabras(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 3 && !VACIAS.has(p));
}

/** Todo el texto del CV, aplanado. */
function textoDelCV(perfil) {
  const partes = [];
  for (const clave of ["perfil", "competencias", "experiencia", "liderazgo",
                       "educacion", "certificaciones", "logros", "proyectos"]) {
    for (const e of perfil?.[clave] || []) {
      if (typeof e === "string") partes.push(e);
      else if (e?.categoria) partes.push(`${e.categoria} ${e.items}`);
      else partes.push([e.organizacion, e.cargo, ...(e.logros || [])].filter(Boolean).join(" "));
    }
  }
  return partes.join(" ");
}

/**
 * Devuelve { puntaje, coincidencias, faltantes }.
 *
 * `puntaje` es 0–100. `coincidencias` son las palabras del anuncio que
 * el CV respalda; `faltantes`, las que pide y no aparecen.
 */
export function calcular(vacante, perfil) {
  const delCV = new Set(palabras(textoDelCV(perfil)));
  if (!delCV.size) return { puntaje: null, coincidencias: [], faltantes: [] };

  const textoVacante = [vacante.titulo, vacante.descripcion, (vacante.requisitos || []).join(" ")]
    .filter(Boolean).join(" ");
  const delAnuncio = [...new Set(palabras(textoVacante))];
  if (!delAnuncio.length) return { puntaje: null, coincidencias: [], faltantes: [] };

  const coincidencias = delAnuncio.filter((p) => delCV.has(p));
  const faltantes = delAnuncio.filter((p) => !delCV.has(p));

  // El título pesa más que el cuerpo: si coincide el puesto, importa más
  // que compartir palabras sueltas de la descripción.
  const delTitulo = new Set(palabras(vacante.titulo));
  const tituloCoincide = [...delTitulo].filter((p) => delCV.has(p)).length;
  const bonoTitulo = delTitulo.size ? (tituloCoincide / delTitulo.size) * 35 : 0;

  const base = (coincidencias.length / delAnuncio.length) * 65;
  const puntaje = Math.min(99, Math.round(base + bonoTitulo));

  return {
    puntaje,
    coincidencias: coincidencias.slice(0, 8),
    faltantes: faltantes.slice(0, 6),
  };
}

/** Ordena las vacantes por encaje, de mayor a menor. */
export function ordenar(vacantes, perfil) {
  return vacantes
    .map((v) => ({ ...v, encaje: calcular(v, perfil) }))
    .sort((a, b) => (b.encaje.puntaje ?? -1) - (a.encaje.puntaje ?? -1));
}


// ---------------------------------------------------------------------
// ¿Es del tema que se buscó?
// ---------------------------------------------------------------------
//
// Los portales devuelven cualquier cosa que se parezca: buscar
// «practicante de marketing» traía «Practicante de Diseño Gráfico»,
// porque para el portal «practicante» ya es parecido. Y como el CV de
// quien busca marketing suele mencionar diseño, encima subía en la lista.
//
// Ordenar por el CV no basta: primero hay que quedarse con lo que es del
// tema. Se mira el TÍTULO, que es lo que dice qué puesto es; la
// descripción menciona de todo.

// Lo que dice el NIVEL, no el tema. «Practicante» no hace a dos vacantes
// del mismo tema.
const NIVEL = new Set([
  "practicante", "practicantes", "practica", "practicas", "pasante", "pasantia",
  "becario", "becaria", "asistente", "auxiliar", "junior", "trainee", "analista",
  "senior", "jefe", "coordinador", "coordinadora", "profesional", "preprofesional",
  "estudiante", "egresado", "egresada", "bachiller", "encargado", "encargada",
]);

// Temas y sus palabras. Buscar una palabra de un tema acepta cualquier
// título con otra del mismo tema: quien busca marketing quiere ver
// «Asistente de Redes Sociales» aunque no diga «marketing».
const TEMAS = [
  ["marketing", "mercadeo", "publicidad", "comunicacion", "comunicaciones", "digital",
   "redes", "sociales", "community", "contenido", "contenidos", "marca", "marcas",
   "branding", "trade", "growth", "leads", "ecommerce", "comercial", "brand", "medios",
   "influencer", "audiovisual", "campanas", "performance"],
  ["administracion", "administrativo", "administrativa", "gestion", "negocios",
   "operaciones", "logistica", "compras", "almacen"],
  ["contabilidad", "contable", "contador", "contadora", "finanzas", "financiero",
   "financiera", "tesoreria", "auditoria", "tributacion", "tributaria", "costos"],
  ["sistemas", "software", "desarrollo", "desarrollador", "programador", "programacion",
   "informatica", "soporte", "datos", "data", "developer", "frontend", "backend", "tecnologia"],
  ["recursos", "humanos", "rrhh", "seleccion", "reclutamiento", "talento", "personas",
   "bienestar", "nominas", "planillas"],
  ["derecho", "legal", "abogado", "abogada", "juridico", "juridica", "leyes", "cumplimiento"],
  ["diseno", "disenador", "disenadora", "grafico", "grafica", "ilustracion", "creativo",
   "creativa", "multimedia"],
  ["ingenieria", "ingeniero", "industrial", "produccion", "calidad", "mantenimiento",
   "procesos", "planta"],
  ["psicologia", "psicologo", "psicologa"],
  ["ventas", "vendedor", "vendedora", "asesor", "asesora", "atencion", "cliente", "clientes"],
];

// Las abreviaturas que la gente escribe y palabras() se come por cortas.
function expandir(texto) {
  return String(texto || "")
    .replace(/\bmkt\b/gi, "marketing")
    .replace(/\brr\.?\s?hh\b/gi, "rrhh")
    .replace(/\bti\b/gi, "tecnologia");
}

const deTema = (texto) => palabras(expandir(texto)).filter((p) => !NIVEL.has(p));
const raizDe = (p) => p.slice(0, 5);

/**
 * ¿La vacante es del tema de `busqueda`?
 *
 * Si la búsqueda no dice tema (solo «practicante»), o el título no tiene
 * nada con qué juzgar, se da por buena: ante la duda se enseña.
 */
export function relacionada(vacante, busqueda) {
  const pedidas = deTema(busqueda);
  if (!pedidas.length) return true;
  const delTitulo = deTema(vacante?.titulo);
  if (!delTitulo.length) return true;

  const aceptadas = new Set(pedidas);
  for (const tema of TEMAS) {
    const tocaElTema = pedidas.some((p) => tema.includes(p) || tema.some((t) => raizDe(t) === raizDe(p)));
    if (tocaElTema) tema.forEach((t) => aceptadas.add(t));
  }
  const raices = new Set([...aceptadas].map(raizDe));
  return delTitulo.some((p) => aceptadas.has(p) || raices.has(raizDe(p)));
}

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

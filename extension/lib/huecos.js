// Habilidades que la oferta pide y el CV no menciona.
//
// Para qué: hay gente que sí maneja Power BI y se le olvidó ponerlo en el
// CV. En vez de que el modelo lo invente —o de que la persona pierda la
// vacante por un olvido— se le pregunta a ella y ella decide.
//
// La regla que no se toca: ESTE MÓDULO NUNCA AÑADE NADA. Devuelve
// preguntas. Quien responde es la persona, y la respuesta por defecto es
// que no. Si contesta que sí, se añade al CV adaptado de esa vacante; si
// no contesta, no pasa nada y se postula igual.
//
// Por qué no lo decide la IA: porque la diferencia entre "se te olvidó
// ponerlo" y "ponlo para que te llamen" es la diferencia entre un CV
// completo y uno falso, y esa frontera la cruza la persona con su nombre,
// no un modelo con el nuestro.
//
// Por qué un catálogo y no las palabras sueltas del anuncio: `coincidencia.js`
// ya devuelve `faltantes`, pero son palabras crudas —"proactivo",
// "responsable", "disponibilidad"—. Preguntar por eso sería ruido y la
// persona dejaría de leer los avisos. Aquí solo se pregunta por cosas con
// nombre propio: herramientas, software, idiomas, certificados y licencias.

// ---------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------
// [nombre que se le muestra a la persona, /cómo aparece en los anuncios/]
// Cubre lo que sale en los avisos peruanos de practicantes y asistentes
// en los rubros más comunes, no solo los de oficina.

const CATALOGO = [
  // Hojas de cálculo y datos
  ["Excel avanzado", /excel\s*(avanzado|nivel\s*avanzado)|tablas\s*din[aá]micas|macros|buscarv|power\s*query/],
  ["Excel", /\bexcel\b/],
  ["Power BI", /power\s*-?\s*bi\b/],
  ["Tableau", /\btableau\b/],
  ["Looker Studio", /looker\s*studio|data\s*studio/],
  ["SQL", /\bsql\b|consultas\s*sql/],
  ["Python", /\bpython\b/],
  ["SPSS", /\bspss\b/],
  ["Google Sheets", /google\s*sheets|hojas\s*de\s*c[aá]lculo\s*de\s*google/],

  // ERP, CRM y contabilidad
  ["SAP", /\bsap\b/],
  ["Salesforce", /salesforce/],
  ["HubSpot", /hubspot/],
  ["Concar", /\bconcar\b/],
  ["Starsoft", /starsoft/],
  ["Siigo", /\bsiigo\b/],
  ["Odoo", /\bodoo\b/],
  ["PLAME / PDT", /\bplame\b|\bpdt\b/],
  ["Facturación electrónica", /facturaci[oó]n\s*electr[oó]nica/],

  // Marketing y diseño
  ["Google Ads", /google\s*ads|adwords/],
  ["Meta Ads", /meta\s*ads|facebook\s*ads|business\s*manager/],
  ["Google Analytics", /google\s*analytics|\bga4\b/],
  ["SEO", /\bseo\b|posicionamiento\s*org[aá]nico/],
  ["Email marketing", /mailchimp|email\s*marketing|klaviyo/],
  ["Canva", /\bcanva\b/],
  ["Photoshop", /photoshop|\bps\b(?=\s*[,y])/],
  ["Illustrator", /illustrator/],
  ["Premiere / edición de video", /premiere|after\s*effects|edici[oó]n\s*de\s*video|capcut/],
  ["Figma", /\bfigma\b/],
  ["WordPress", /wordpress/],

  // Ingeniería, construcción y logística
  ["AutoCAD", /auto\s*-?\s*cad\b/],
  ["Revit", /\brevit\b/],
  ["SolidWorks", /solid\s*works/],
  ["SketchUp", /sketch\s*up/],
  ["MS Project", /ms\s*project|microsoft\s*project/],
  ["AutoCAD / ArcGIS", /arc\s*gis|\bqgis\b/],
  ["Lean / Six Sigma", /lean\s*manufacturing|six\s*sigma|\bkaizen\b/],
  ["ISO 9001", /iso\s*9001|sistemas?\s*de\s*gesti[oó]n\s*de\s*calidad/],

  // Programación
  ["JavaScript", /javascript|\bjs\b(?=\s*[,y])/],
  ["Java", /\bjava\b(?!\s*script)/],
  ["React", /\breact\b/],
  ["Git", /\bgit\b|github/],

  // Idiomas
  ["Inglés avanzado", /ingl[eé]s\s*(avanzado|c1|c2|fluido|nativo)/],
  ["Inglés intermedio", /ingl[eé]s\s*(intermedio|b1|b2)/],
  ["Inglés", /\bingl[eé]s\b/],
  ["Portugués", /portugu[eé]s/],
  ["Quechua", /quechua/],

  // Licencias y otros requisitos con nombre
  ["Licencia de conducir", /licencia\s*de\s*conducir|brevete|\ba-?i{1,3}\b/],
  ["Movilidad propia", /movilidad\s*propia|veh[ií]culo\s*propio|moto\s*propia/],
  ["Carné de sanidad", /carn[eé]\s*de\s*sanidad/],
];

// Palabras que marcan un requisito como opcional. Cambia el tono de la
// pregunta: por un "deseable" no vale la pena alarmar a nadie.
const ES_DESEABLE = /deseable|opcional|de\s*preferencia|preferentemente|no\s*excluyente|ser[aá]\s*un\s*plus|valorable/i;

const normal = (t) => (t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Todo el texto del CV en una cadena, incluidas las dos formas de perfil. */
function textoDelCV(perfil) {
  const partes = [];
  const secciones = perfil?.secciones;
  if (secciones) {
    for (const bloque of Object.values(secciones)) {
      for (const linea of bloque || []) partes.push(String(linea));
    }
  }
  for (const clave of ["perfil", "competencias", "experiencia", "liderazgo",
                       "educacion", "certificaciones", "logros", "proyectos"]) {
    for (const e of perfil?.[clave] || []) {
      if (typeof e === "string") partes.push(e);
      else if (e?.categoria) partes.push(`${e.categoria} ${e.items}`);
      else partes.push([e.organizacion, e.cargo, ...(e.logros || [])].filter(Boolean).join(" "));
    }
  }
  return normal(partes.join(" \n "));
}

/** La frase del anuncio donde aparece la habilidad, para dar contexto. */
function frasePara(texto, expresion) {
  for (const trozo of (texto || "").split(/[\n•·|]|(?<=[.;])\s+/)) {
    if (expresion.test(normal(trozo))) {
      const limpio = trozo.trim().replace(/\s+/g, " ");
      if (limpio.length > 3) return limpio.slice(0, 160);
    }
  }
  return "";
}

/**
 * Qué pide la oferta que el CV no respalda.
 *
 * Devuelve una lista de { habilidad, deseable, frase, pregunta }. Vacía
 * si no falta nada — que es lo normal y lo que se espera.
 */
export function detectar(vacante, perfil) {
  const textoOferta = [vacante?.titulo, vacante?.descripcion,
                       (vacante?.requisitos || []).join("\n")].filter(Boolean).join("\n");
  if (!textoOferta.trim()) return [];

  const oferta = normal(textoOferta);
  const cv = textoDelCV(perfil);
  if (!cv.trim()) return [];

  const encontradas = [];
  const yaCubiertas = new Set();

  for (const [nombre, expresion] of CATALOGO) {
    if (!expresion.test(oferta)) continue;
    if (expresion.test(cv)) {          // el CV ya lo dice: no se pregunta
      yaCubiertas.add(nombre);
      continue;
    }
    // "Excel avanzado" ya implica preguntar por Excel: no se duplica.
    if (nombre === "Excel" && (yaCubiertas.has("Excel avanzado")
        || encontradas.some((h) => h.habilidad === "Excel avanzado"))) continue;
    if (nombre === "Inglés" && encontradas.some((h) => h.habilidad.startsWith("Inglés"))) continue;

    const frase = frasePara(textoOferta, expresion);

    // "Canva o Photoshop" con Canva en el CV ya está cubierto: la oferta
    // ofrece alternativas y ella cumple una. Preguntar por la otra sería
    // pedirle que rellene un hueco que no existe.
    if (/\s+o\s+|\s*\/\s*|alguno de|cualquiera de/i.test(frase)) {
      const otraCubre = CATALOGO.some(([otro, exprOtro]) =>
        otro !== nombre && exprOtro.test(normal(frase)) && exprOtro.test(cv));
      if (otraCubre) continue;
    }

    const deseable = ES_DESEABLE.test(frase);
    encontradas.push({
      habilidad: nombre,
      deseable,
      frase,
      pregunta: deseable
        ? `Esta oferta menciona ${nombre} como deseable. ¿Lo manejas y se te pasó ponerlo en el CV?`
        : `Esta oferta pide ${nombre}. ¿Lo manejas y se te pasó ponerlo en el CV?`,
    });
  }

  // Tope deliberado. Si una oferta pide diez cosas que no tiene, el
  // problema no es el CV: es que esa vacante no es para ella. Preguntar
  // diez veces la haría contestar cualquier cosa con tal de avanzar.
  return encontradas.slice(0, 4);
}

/**
 * Traduce lo que la persona respondió en líneas para el CV adaptado.
 *
 * `respuestas` es { "Power BI": true|false }. Solo pasan las marcadas
 * que sí; el resto se descarta sin dejar rastro.
 */
export function aCompetencias(huecos, respuestas) {
  return (huecos || [])
    .filter((h) => respuestas?.[h.habilidad] === true)
    .map((h) => h.habilidad);
}

/** Cuántas de las que pide la oferta sí están respaldadas por el CV. */
export function resumen(vacante, perfil) {
  const faltan = detectar(vacante, perfil);
  return {
    faltan,
    hayQuePreguntar: faltan.length > 0,
    obligatorias: faltan.filter((h) => !h.deseable).length,
  };
}

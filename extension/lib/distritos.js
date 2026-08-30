// Distancia en Lima: qué tan lejos está dispuesta a ir.
//
// En Lima el tráfico decide más que el sueldo. Una vacante en Los Olivos
// para alguien de La Molina son dos horas de ida y dos de vuelta, y eso
// se abandona a las dos semanas. Pero tampoco se puede filtrar solo por
// el distrito exacto: hay gente que sí cruza la ciudad si vale la pena, y
// hay distritos pegados que la persona ni siquiera piensa como "otro
// distrito".
//
// Por eso no se filtra por distrito sino por DISPOSICIÓN, que la persona
// elige y puede cambiar en cualquier momento:
//
//     exacto    solo mi distrito
//     cerca     mi distrito y los que colindan       (por defecto)
//     zona      toda mi zona de Lima
//     lima      cualquier parte de Lima
//
// La vecindad está escrita a mano, no calculada: colindar importa más
// que la distancia en línea recta, porque lo que se cruza es tráfico, no
// kilómetros. San Juan de Lurigancho y San Isidro están cerca en el mapa
// y lejísimos en la Vía de Evitamiento.
//
// Sin coordenadas, sin API de mapas, sin pedirle la dirección a nadie:
// el distrito basta y es mucho menos invasivo.

const ZONAS = {
  centro: ["lima", "cercado de lima", "breña", "la victoria", "rimac", "san luis",
           "lince", "jesus maria", "magdalena del mar", "magdalena", "pueblo libre",
           "san miguel"],
  moderna: ["miraflores", "san isidro", "santiago de surco", "surco", "san borja",
            "barranco", "la molina", "surquillo"],
  norte: ["los olivos", "san martin de porres", "smp", "independencia", "comas",
          "puente piedra", "carabayllo", "ancon", "santa rosa"],
  sur: ["villa el salvador", "villa maria del triunfo", "san juan de miraflores",
        "chorrillos", "lurin", "pachacamac", "punta hermosa", "san bartolo"],
  este: ["san juan de lurigancho", "sjl", "ate", "ate vitarte", "vitarte", "santa anita",
         "el agustino", "chaclacayo", "lurigancho", "chosica", "cieneguilla"],
  callao: ["callao", "bellavista", "la perla", "la punta", "carmen de la legua",
           "ventanilla", "mi peru"],
};

// Distritos que colindan de verdad. Solo se listan los que la gente usa
// como origen de un viaje diario; los conos completos se cubren por zona.
const VECINOS = {
  "la molina": ["ate", "santiago de surco", "san borja", "cieneguilla"],
  "santiago de surco": ["san borja", "miraflores", "barranco", "chorrillos", "la molina", "surquillo", "san juan de miraflores"],
  "san borja": ["san isidro", "surquillo", "santiago de surco", "la molina", "san luis", "la victoria"],
  "miraflores": ["san isidro", "surquillo", "barranco", "santiago de surco"],
  "san isidro": ["miraflores", "lince", "san borja", "magdalena del mar", "jesus maria", "surquillo"],
  "surquillo": ["miraflores", "san borja", "santiago de surco", "san isidro"],
  "barranco": ["miraflores", "chorrillos", "santiago de surco"],
  "lince": ["san isidro", "jesus maria", "la victoria", "cercado de lima"],
  "jesus maria": ["lince", "pueblo libre", "magdalena del mar", "breña", "san isidro"],
  "pueblo libre": ["jesus maria", "magdalena del mar", "san miguel", "breña"],
  "magdalena del mar": ["san isidro", "pueblo libre", "jesus maria", "san miguel"],
  "san miguel": ["pueblo libre", "magdalena del mar", "callao", "cercado de lima"],
  "cercado de lima": ["breña", "la victoria", "rimac", "san miguel", "lince", "el agustino"],
  "breña": ["cercado de lima", "pueblo libre", "jesus maria", "la victoria"],
  "la victoria": ["cercado de lima", "lince", "san luis", "san borja", "el agustino"],
  "san luis": ["la victoria", "san borja", "ate", "el agustino"],
  "rimac": ["cercado de lima", "independencia", "san juan de lurigancho", "el agustino"],
  "ate": ["santa anita", "la molina", "san luis", "el agustino", "chaclacayo"],
  "santa anita": ["ate", "el agustino", "san juan de lurigancho", "san luis"],
  "el agustino": ["san juan de lurigancho", "santa anita", "la victoria", "cercado de lima", "san luis"],
  "san juan de lurigancho": ["el agustino", "rimac", "independencia", "santa anita"],
  "los olivos": ["san martin de porres", "independencia", "comas", "puente piedra"],
  "san martin de porres": ["los olivos", "independencia", "rimac", "cercado de lima", "callao"],
  "independencia": ["los olivos", "san martin de porres", "comas", "rimac", "san juan de lurigancho"],
  "comas": ["los olivos", "independencia", "puente piedra", "carabayllo"],
  "chorrillos": ["barranco", "santiago de surco", "san juan de miraflores", "villa el salvador"],
  "san juan de miraflores": ["villa maria del triunfo", "villa el salvador", "chorrillos", "santiago de surco"],
  "villa el salvador": ["villa maria del triunfo", "san juan de miraflores", "chorrillos", "lurin"],
  "villa maria del triunfo": ["villa el salvador", "san juan de miraflores", "pachacamac"],
  "callao": ["bellavista", "la perla", "san miguel", "san martin de porres", "ventanilla"],
  "bellavista": ["callao", "la perla", "san miguel"],
};

const NIVELES = ["exacto", "cerca", "zona", "lima"];

const normal = (t) => (t || "").toLowerCase().normalize("NFKD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Todos los distritos conocidos, para el desplegable. */
export function catalogo() {
  const todos = new Set();
  for (const lista of Object.values(ZONAS)) for (const d of lista) todos.add(d);
  return [...todos].sort();
}

/** En qué zona cae un distrito. */
export function zonaDe(distrito) {
  const d = normal(distrito);
  for (const [zona, lista] of Object.entries(ZONAS)) {
    if (lista.includes(d)) return zona;
  }
  return null;
}

/**
 * Los distritos aceptables desde `base` con la disposición dada.
 *
 * Devuelve null cuando no hay que filtrar nada (disposición "lima" o
 * base desconocida), que es distinto de devolver una lista vacía.
 */
export function alcance(base, disposicion = "cerca") {
  const d = normal(base);
  if (!d || disposicion === "lima" || !NIVELES.includes(disposicion)) return null;

  if (disposicion === "exacto") return new Set([d]);

  if (disposicion === "cerca") {
    const cerca = new Set([d, ...(VECINOS[d] || [])]);
    // Si no está en la tabla de vecinos, "cerca" se degrada a su zona
    // antes que devolver solo el distrito y esconderle ofertas buenas.
    if (!VECINOS[d]) {
      const z = zonaDe(d);
      return z ? new Set(ZONAS[z]) : null;
    }
    return cerca;
  }

  const z = zonaDe(d);
  return z ? new Set(ZONAS[z]) : null;
}

/** ¿La ubicación de esta vacante cae dentro del alcance? */
export function alcanza(ubicacionVacante, permitidos) {
  if (!permitidos) return true;              // sin filtro
  const u = normal(ubicacionVacante);
  if (!u) return true;                       // sin dato: no se descarta
  for (const p of permitidos) {
    if (u.includes(p)) return true;
  }
  return false;
}

/**
 * Parte las vacantes en las que entran y las que quedan fuera.
 *
 * No se descarta nada en silencio: `fuera` se le muestra a la persona
 * plegado, porque a veces vale la pena cruzar la ciudad y esa decisión
 * no es nuestra.
 */
export function filtrar(vacantes, base, disposicion = "cerca") {
  const permitidos = alcance(base, disposicion);
  if (!permitidos) return { dentro: vacantes || [], fuera: [], permitidos: null };

  const dentro = [], fuera = [];
  for (const v of vacantes || []) {
    (alcanza(v.ubicacion, permitidos) ? dentro : fuera).push(v);
  }
  return { dentro, fuera, permitidos: [...permitidos] };
}

/** Frase para la interfaz: qué se está filtrando ahora mismo. */
export function explicar(base, disposicion = "cerca") {
  const permitidos = alcance(base, disposicion);
  if (!permitidos) return "Ofertas en cualquier parte de Lima.";
  if (disposicion === "exacto") return `Solo ofertas en ${base}.`;
  const otros = permitidos.size - 1;
  if (disposicion === "cerca") {
    return `Ofertas en ${base} y ${otros} distrito${otros === 1 ? "" : "s"} que colindan.`;
  }
  return `Ofertas en toda tu zona de Lima (${permitidos.size} distritos).`;
}

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


// ═══════════════════════════════════════════════════════════════════
// Cuánto te tomaría llegar (Ali, 2026-09-25)
// ═══════════════════════════════════════════════════════════════════
// «Algo muy importante en Lima es el lugar»: trabajos en tu zona, cerca
// y lejos, y «te tomaría tanto tiempo desde Miraflores».
//
// Google Maps de verdad es una API de pago; aquí no se gasta. Así que:
//   · el TIEMPO es una estimación nuestra, dicha como estimación: centro
//     aproximado de cada distrito, distancia en línea recta × 1,4 (las
//     calles no van en línea recta) a ~17 km/h, la velocidad media del
//     transporte público limeño en hora punta, + 10 min de caminar y
//     esperar;
//   · el enlace «Ver ruta» abre Google Maps con el origen y el destino
//     ya puestos, y ahí la persona ve la ruta real de ese momento. Un
//     enlace no cuesta nada.

// Centro aproximado de cada distrito [latitud, longitud].
const CENTROS = {
  "cercado de lima": [-12.046, -77.043], "breña": [-12.057, -77.050], "la victoria": [-12.070, -77.017],
  "rimac": [-12.030, -77.030], "san luis": [-12.075, -76.995], "lince": [-12.084, -77.035],
  "jesus maria": [-12.076, -77.049], "magdalena del mar": [-12.091, -77.070], "pueblo libre": [-12.074, -77.064],
  "san miguel": [-12.077, -77.091], "miraflores": [-12.121, -77.030], "san isidro": [-12.098, -77.036],
  "santiago de surco": [-12.145, -76.992], "san borja": [-12.101, -76.999], "barranco": [-12.148, -77.021],
  "la molina": [-12.084, -76.936], "surquillo": [-12.113, -77.018], "los olivos": [-11.990, -77.071],
  "san martin de porres": [-12.010, -77.080], "independencia": [-11.994, -77.047], "comas": [-11.936, -77.051],
  "puente piedra": [-11.866, -77.074], "carabayllo": [-11.850, -77.030], "ancon": [-11.773, -77.175],
  "santa rosa": [-11.804, -77.164], "villa el salvador": [-12.213, -76.937], "villa maria del triunfo": [-12.160, -76.935],
  "san juan de miraflores": [-12.157, -76.970], "chorrillos": [-12.169, -77.018], "lurin": [-12.275, -76.870],
  "pachacamac": [-12.230, -76.860], "punta hermosa": [-12.334, -76.823], "san bartolo": [-12.388, -76.781],
  "san juan de lurigancho": [-11.980, -77.000], "ate": [-12.026, -76.922], "santa anita": [-12.044, -76.970],
  "el agustino": [-12.044, -76.999], "chaclacayo": [-11.975, -76.767], "lurigancho": [-11.936, -76.697],
  "cieneguilla": [-12.108, -76.815], "callao": [-12.056, -77.118], "bellavista": [-12.061, -77.105],
  "la perla": [-12.070, -77.110], "la punta": [-12.072, -77.164], "carmen de la legua": [-12.040, -77.098],
  "ventanilla": [-11.874, -77.132], "mi peru": [-11.855, -77.123],
};

// Cómo lo escribe la gente → cómo se llama en CENTROS.
const ALIAS = {
  "surco": "santiago de surco", "sjl": "san juan de lurigancho", "smp": "san martin de porres",
  "magdalena": "magdalena del mar", "ate vitarte": "ate", "vitarte": "ate", "chosica": "lurigancho",
  "lima": "cercado de lima", "cercado": "cercado de lima", "sjm": "san juan de miraflores",
  "vmt": "villa maria del triunfo", "ves": "villa el salvador", "lima cercado": "cercado de lima",
};

const NOMBRES = Object.keys(CENTROS);
const TITULO = (d) => d.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).replace(/\bDe\b/g, "de").replace(/\bDel\b/g, "del");

/**
 * El distrito que menciona un texto («Los Olivos, Lima» → los olivos).
 * Se busca el nombre MÁS LARGO que aparezca: «San Juan de Miraflores»
 * contiene «Miraflores» y no es Miraflores.
 */
export function distritoEn(texto) {
  const t = ` ${normal(texto)} `;
  if (!t.trim()) return null;
  const encontrados = [...NOMBRES, ...Object.keys(ALIAS)]
    .filter((n) => t.includes(` ${n} `))
    .sort((a, b) => b.length - a.length);
  if (!encontrados.length) return null;
  const n = encontrados[0];
  // «Lima» a secas (el departamento) no dice el distrito: no se usa si
  // hay otro nombre más preciso, y solo, significa «en Lima, sin más».
  if (n === "lima" && encontrados.length === 1) return null;
  return ALIAS[n] || n;
}

/** ¿Es un distrito de Lima que conocemos? («Miraflores» sí, «Arequipa» no). */
export function esDistritoDeLima(texto) {
  const d = distritoEn(texto);
  return Boolean(d && CENTROS[d]);
}

function km(a, b) {
  const R = 6371, rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minutos estimados en transporte público, redondeados a 5. */
export function minutosEstimados(kmLinea) {
  const min = 10 + (kmLinea * 1.4 / 17) * 60;
  return Math.max(10, Math.round(min / 5) * 5);
}

/**
 * Dónde queda una vacante respecto a donde vive la persona.
 *
 *   franja  "tu_zona"  su distrito o uno que colinda
 *           "cerca"    hasta ~9 km en línea recta
 *           "lejos"    más allá
 *           "remoto"   no hay que ir
 *           null       la vacante no dice el distrito
 */
export function ubicar(ubicacionVacante, base) {
  const texto = normal(ubicacionVacante);
  if (/\b(remoto|home office|teletrabajo)\b/.test(texto) && !/h[ií]brido/.test(texto)) {
    return { franja: "remoto", distrito: null, km: 0, minutos: 0 };
  }
  const origen = distritoEn(base);
  const destino = distritoEn(ubicacionVacante);
  if (!origen || !destino || !CENTROS[origen] || !CENTROS[destino]) {
    return { franja: null, distrito: destino ? TITULO(destino) : null, km: null, minutos: null };
  }
  const distancia = km(CENTROS[origen], CENTROS[destino]);
  const vecino = origen === destino || (VECINOS[origen] || []).includes(destino);
  return {
    franja: vecino ? "tu_zona" : distancia <= 9 ? "cerca" : "lejos",
    distrito: TITULO(destino),
    km: Math.round(distancia * 10) / 10,
    minutos: origen === destino ? 15 : minutosEstimados(distancia),
  };
}

/** Enlace a la ruta en transporte público en Google Maps. Gratis: es un enlace. */
export function enlaceRuta(base, ubicacionVacante) {
  const o = distritoEn(base), d = distritoEn(ubicacionVacante);
  if (!o || !d) return null;
  const q = (x) => encodeURIComponent(`${TITULO(x)}, Lima, Perú`);
  return `https://www.google.com/maps/dir/?api=1&origin=${q(o)}&destination=${q(d)}&travelmode=transit`;
}

/** «Miraflores», bonito, para la interfaz. */
export function nombreBonito(texto) {
  const d = distritoEn(texto);
  return d ? TITULO(d) : (texto || "").trim();
}

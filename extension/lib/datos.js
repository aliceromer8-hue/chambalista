// Datos que los portales piden y no están en el CV.
//
// La persona los guarda una vez y los formularios se completan solos.
// Viven únicamente en su navegador.
//
// Los marcados `obligatorio` se piden ANTES de postular (Ali, 2026-09-25:
// «eso es obligatorio antes de postular, si no, ¿con qué info respondes?»).
// DNI, nacimiento, distrito, cuándo empiezas, horario y pretensión: lo que
// las preguntas de selección piden casi siempre y el CV no trae.

export const CAMPOS = [
  {
    clave: "dni",
    obligatorio: true,
    etiqueta: "DNI",
    ayuda: "8 dígitos. Casi todos los portales lo piden.",
    // Estricto. Antes llevaba «documento», «identidad» y «c.i.»; el último,
    // con las tildes, encajaba en «institución», «atención», «remuneración»:
    // una pregunta de estudios se contestó con el DNI (Ali, 2026-09-25).
    patron: /(^|[^\p{L}])(dni|d\.n\.i\.?|n[uú]mero de documento|documento de identidad|documento nacional|carn[eé] de extranjer[ií]a)([^\p{L}]|$)/iu,
    validar: /^\d{8}$/,
    error: "El DNI peruano tiene 8 dígitos.",
    sensible: true,
    plantilla: (v) => `Mi DNI es ${v}.`,
  },
  {
    clave: "fechaNacimiento",
    obligatorio: true,
    etiqueta: "Fecha de nacimiento",
    ayuda: "DD/MM/AAAA",
    patron: /nacimiento|birth|fecha de nac/i,
    validar: /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    error: "Usa el formato DD/MM/AAAA.",
    sensible: true,
    plantilla: (v) => `Mi fecha de nacimiento es ${v}.`,
  },
  {
    clave: "distrito",
    obligatorio: true,
    etiqueta: "Distrito donde vives",
    ayuda: "Por ejemplo: Surco, Miraflores, Los Olivos.",
    patron: /distrito|residencia|d[oó]nde vives/i,
    validar: /^.{2,60}$/,
    error: "Escribe el nombre del distrito.",
    sensible: false,
    plantilla: (v) => `Resido en ${v}.`,
  },
  {
    clave: "direccion",
    etiqueta: "Dirección",
    ayuda: "Opcional. Algunos formularios la piden completa.",
    patron: /direcci[oó]n|address|domicilio/i,
    validar: /^.{5,120}$/,
    error: "Escribe la dirección o déjala vacía.",
    sensible: true,
    plantilla: (v) => `Mi dirección es ${v}.`,
  },
  {
    clave: "pretension",
    obligatorio: true,
    etiqueta: "Pretensión salarial (S/)",
    ayuda: "Solo el número, por ejemplo 1500.",
    patron: /pretensi[oó]n|expectativa salarial|salario esperado|aspiraci[oó]n salarial|remuneraci[oó]n (pretendida|esperada)|cu[aá]nto esperas ganar/i,
    validar: /^\d{3,6}$/,
    error: "Escribe solo el número, sin S/ ni comas.",
    sensible: false,
    plantilla: (v) => `Mi pretensión salarial es de S/ ${v}.`,
  },
  {
    clave: "disponibilidadInicio",
    obligatorio: true,
    etiqueta: "Disponibilidad para empezar",
    ayuda: "Elige una, o pon la fecha exacta.",
    // Escribiendo a mano cada quien ponía una cosa: «ya», «cuando sea»,
    // «a partir del 3». Con opciones se responde de un toque y además
    // sale escrito igual siempre, que es lo que lee la empresa.
    tipo: "opciones",
    opciones: ["Inmediata", "En 15 días", "En 30 días", "A partir de una fecha"],
    conFecha: "A partir de una fecha",
    patron: /disponibilidad para (empezar|iniciar)|cu[aá]ndo puedes empezar|desde cu[aá]ndo/i,
    validar: /^.{3,60}$/,
    error: "Describe tu disponibilidad.",
    sensible: false,
    // Lo guardado puede ser una opcion («Inmediata») o una fecha ISO,
    // que es como la devuelve <input type="date">. Escribirle
    // «2026-10-01» a una empresa es mandarle el formato de la base de
    // datos: nadie contesta asi.
    plantilla: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v)
      ? `Puedo empezar a partir del ${enCastellano(v)}.`
      : `Mi disponibilidad para empezar es ${v.toLowerCase()}.`),
  },
  {
    clave: "horario",
    obligatorio: true,
    etiqueta: "Horario que puedes cumplir",
    ayuda: "Lo preguntan casi todas las prácticas y los primeros empleos.",
    tipo: "opciones",
    opciones: ["Tiempo completo", "Medio tiempo (mañanas)", "Medio tiempo (tardes)", "Por horas", "Flexible"],
    patron: /horario|turno|disponibilidad horaria|jornada/i,
    validar: /^.{3,60}$/,
    error: "Elige tu horario.",
    sensible: false,
    plantilla: (v) => `Puedo cumplir un horario de ${v.toLowerCase()}.`,
  },
  {
    clave: "redes",
    etiqueta: "Red social",
    ayuda: "La que te pidan. Lo preguntan en marketing y comunicaciones.",
    // Antes era un solo campo de texto donde había que acordarse de
    // poner de qué red era. Ahora se elige la red y solo se escribe el
    // usuario: queda «Instagram: @alice», que es lo que espera leer
    // quien lo pide.
    tipo: "red",
    opciones: ["Instagram", "TikTok", "LinkedIn", "Facebook", "X", "Behance", "Portafolio web"],
    patron: /instagram|tiktok|tik tok|facebook|red social|usuario de/i,
    validar: /^.{2,80}$/,
    error: "Elige la red y escribe tu usuario.",
    sensible: false,
    // Guardado como «TikTok: @alicemkt». «Mi usuario es TikTok:
    // @alicemkt» no lo escribe nadie; «Mi TikTok es @alicemkt», si.
    plantilla: (v) => {
      const corte = v.indexOf(":");
      if (corte < 1) return `Mi usuario es ${v}.`;
      return `Mi ${v.slice(0, corte).trim()} es ${v.slice(corte + 1).trim()}.`;
    },
  },
  {
    clave: "licencia",
    etiqueta: "Licencia de conducir",
    ayuda: "Las categorías peruanas, tal cual las pide el portal.",
    tipo: "opciones",
    // Categorías del reglamento peruano. A-I es la de coche particular
    // y es la que piden casi siempre; las AII y AIII son de transporte.
    opciones: ["No tengo", "A-I", "A-IIa", "A-IIb", "A-IIIa", "A-IIIb", "A-IIIc",
               "B-I", "B-IIa", "B-IIb", "B-IIc"],
    patron: /licencia de conducir|brevete/i,
    validar: /^.{2,40}$/,
    error: "Indica la categoría o «no tengo».",
    sensible: false,
    plantilla: (v) => `Licencia de conducir: ${v}.`,
  },
  {
    clave: "movilidad",
    etiqueta: "¿Movilidad propia?",
    ayuda: "Un toque.",
    tipo: "opciones",
    opciones: ["Sí", "No"],
    patron: /movilidad propia|veh[ií]culo propio|auto propio/i,
    validar: /^.{2,40}$/,
    error: "Responde sí o no.",
    sensible: false,
    plantilla: (v) => `Movilidad propia: ${v}.`,
  },
];

export function validar(datos) {
  const limpio = {};
  const errores = {};
  for (const c of CAMPOS) {
    const valor = String(datos?.[c.clave] ?? "").trim();
    if (!valor) continue;
    if (!c.validar.test(valor)) {
      errores[c.clave] = c.error;
      continue;
    }
    limpio[c.clave] = valor;
  }
  return { limpio, errores };
}

// Una pregunta que pide que CUENTES algo (estudios, experiencia, motivos)
// no se contesta con un dato suelto: se redacta desde tu CV. Los datos
// sensibles COMPLEMENTAN; no sustituyen a una respuesta.
const ES_PARA_REDACTAR = /estudi|carrera|formaci[oó]n|experiencia|conocimient|habilidad|cu[eé]ntanos|describe|explica|por qu[eé]|motiv|logro|proyecto|especialidad|instituci[oó]n|universidad|ciclo|herramienta/i;

/** ¿Alguno de los datos guardados encaja con la etiqueta de este campo? */
export function paraCampo(etiqueta, guardados = {}) {
  if (ES_PARA_REDACTAR.test(etiqueta || "") || String(etiqueta || "").length > 140) return { campo: null, valor: null };
  for (const c of CAMPOS) {
    if (c.patron.test(etiqueta)) {
      return { campo: c, valor: guardados[c.clave] || null };
    }
  }
  return { campo: null, valor: null };
}

export function faltantes(guardados = {}) {
  return CAMPOS.filter((c) => !guardados[c.clave])
    .map((c) => ({ clave: c.clave, etiqueta: c.etiqueta, ayuda: c.ayuda }));
}


const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
               "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «2026-10-01» -> «1 de octubre de 2026». */
function enCastellano(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d || m < 1 || m > 12) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}


/** Los obligatorios que faltan. Sin ellos no se postula. */
export function faltanObligatorios(guardados = {}) {
  return CAMPOS.filter((c) => c.obligatorio && !String(guardados[c.clave] || "").trim());
}

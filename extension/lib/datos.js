// Datos que los portales piden y no están en el CV.
//
// La persona puede guardarlos una vez para que los formularios se
// completen solos. Todo es opcional y vive únicamente en su navegador.
// Lo que no guarde se sigue reportando como pendiente en la revisión.

export const CAMPOS = [
  {
    clave: "dni",
    etiqueta: "DNI",
    ayuda: "8 dígitos. Casi todos los portales lo piden.",
    patron: /\bdni\b|documento|identidad|n[uú]mero de documento|c\.?i\.?\b/i,
    validar: /^\d{8}$/,
    error: "El DNI peruano tiene 8 dígitos.",
    sensible: true,
    plantilla: (v) => `Mi DNI es ${v}.`,
  },
  {
    clave: "fechaNacimiento",
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
    etiqueta: "Pretensión salarial (S/)",
    ayuda: "Solo el número, por ejemplo 1500.",
    patron: /pretensi[oó]n|expectativa salarial|salario esperado|remuneraci[oó]n/i,
    validar: /^\d{3,6}$/,
    error: "Escribe solo el número, sin S/ ni comas.",
    sensible: false,
    plantilla: (v) => `Mi pretensión salarial es de S/ ${v}.`,
  },
  {
    clave: "disponibilidadInicio",
    etiqueta: "Disponibilidad para empezar",
    ayuda: "Por ejemplo: inmediata, 15 días.",
    patron: /disponibilidad para (empezar|iniciar)|cu[aá]ndo puedes empezar|desde cu[aá]ndo/i,
    validar: /^.{3,60}$/,
    error: "Describe tu disponibilidad.",
    sensible: false,
    plantilla: (v) => `Mi disponibilidad para empezar es ${v}.`,
  },
  {
    clave: "redes",
    etiqueta: "Usuario de Instagram / TikTok",
    ayuda: "Con arroba. Lo piden en marketing y comunicaciones.",
    patron: /instagram|tiktok|tik tok|facebook|red social|usuario de/i,
    validar: /^.{2,60}$/,
    error: "Escribe tu usuario.",
    sensible: false,
    plantilla: (v) => `Mi usuario es ${v}.`,
  },
  {
    clave: "licencia",
    etiqueta: "Licencia de conducir",
    ayuda: "Por ejemplo: A-I, o «no tengo».",
    patron: /licencia de conducir|brevete/i,
    validar: /^.{2,40}$/,
    error: "Indica la categoría o «no tengo».",
    sensible: false,
    plantilla: (v) => `Licencia de conducir: ${v}.`,
  },
  {
    clave: "movilidad",
    etiqueta: "¿Movilidad propia?",
    ayuda: "Sí o no.",
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

/** ¿Alguno de los datos guardados encaja con la etiqueta de este campo? */
export function paraCampo(etiqueta, guardados = {}) {
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

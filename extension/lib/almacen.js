// Todo lo que la extensión guarda vive en el navegador de la persona,
// en chrome.storage.local. No hay servidor que reciba nada.
//
// - perfil            : el CV estructurado
// - datosPersonales   : DNI, distrito, etc. (opcionales)
// - claveIA           : su propia clave de Gemini o Groq
// - tracker           : historial de postulaciones
// - preferencias      : último puesto buscado, ciudad, portales

const CLAVES = {
  perfil: "perfil",
  datos: "datosPersonales",
  clave: "claveIA",
  tracker: "tracker",
  prefs: "preferencias",
};

export async function leer(clave, porDefecto = null) {
  const r = await chrome.storage.local.get(clave);
  return r[clave] ?? porDefecto;
}

export async function guardar(clave, valor) {
  await chrome.storage.local.set({ [clave]: valor });
  return valor;
}

export const perfil = {
  obtener: () => leer(CLAVES.perfil, null),
  guardar: (p) => guardar(CLAVES.perfil, p),
  borrar: () => chrome.storage.local.remove(CLAVES.perfil),
};

export const datosPersonales = {
  obtener: () => leer(CLAVES.datos, {}),
  guardar: (d) => guardar(CLAVES.datos, d),
  borrar: () => chrome.storage.local.remove(CLAVES.datos),
};

export const claveIA = {
  obtener: () => leer(CLAVES.clave, ""),
  guardar: (c) => guardar(CLAVES.clave, c),
  borrar: () => chrome.storage.local.remove(CLAVES.clave),
};

export const preferencias = {
  obtener: () => leer(CLAVES.prefs, { puesto: "", ciudad: "", nivel: "cualquiera" }),
  guardar: (p) => guardar(CLAVES.prefs, p),
};

// Las etapas por las que pasa una postulación. El orden importa: así
// se pintan las columnas del panel.
export const ETAPAS = [
  { id: "por_postular", nombre: "Por postular", color: "lapiz" },
  { id: "enviada", nombre: "Enviada", color: "pluma" },
  { id: "entrevista", nombre: "Entrevista", color: "ambar" },
  { id: "oferta", nombre: "Oferta", color: "verde" },
  { id: "descartada", nombre: "Descartada", color: "rojo" },
];

// Los estados que produce la automatización se traducen a etapas del
// pipeline: "omitida" y "fallida" quedan como pendientes de postular,
// porque eso es lo que son — algo que la persona todavía puede retomar.
const ETAPA_DE_ESTADO = {
  enviada: "enviada",
  omitida: "por_postular",
  fallida: "por_postular",
  preparada: "por_postular",
};

export const tracker = {
  async listar() {
    const lista = await leer(CLAVES.tracker, []);
    // Registros antiguos no tienen etapa: se deduce del estado.
    return lista.map((r) => ({
      ...r,
      etapa: r.etapa || ETAPA_DE_ESTADO[r.estado] || "por_postular",
    }));
  },

  /** Mueve una postulación de etapa (el kanban del panel). */
  async moverEtapa(id, etapa) {
    const lista = await leer(CLAVES.tracker, []);
    const i = lista.findIndex((r) => r.id === id);
    if (i === -1) return null;
    lista[i] = { ...lista[i], etapa, actualizado: new Date().toISOString() };
    await guardar(CLAVES.tracker, lista);
    return lista[i];
  },

  /** Cuántas hay en cada etapa, para las cifras del panel. */
  async resumen() {
    const lista = await this.listar();
    const porEtapa = Object.fromEntries(ETAPAS.map((e) => [e.id, 0]));
    for (const r of lista) porEtapa[r.etapa] = (porEtapa[r.etapa] || 0) + 1;

    const hace7dias = Date.now() - 7 * 24 * 3600 * 1000;
    const estaSemana = lista.filter((r) => new Date(r.fecha).getTime() > hace7dias);
    const enviadas = lista.filter((r) => r.etapa !== "por_postular");
    const avanzaron = lista.filter((r) => ["entrevista", "oferta"].includes(r.etapa));

    return {
      total: lista.length,
      porEtapa,
      estaSemana: estaSemana.length,
      // Tasa de respuesta: de las que se enviaron, cuántas avanzaron.
      tasaRespuesta: enviadas.length ? Math.round((avanzaron.length / enviadas.length) * 100) : null,
      entrevistas: porEtapa.entrevista || 0,
      // Serie de los últimos 14 días, para el gráfico.
      serie: Array.from({ length: 14 }, (_, i) => {
        const dia = new Date();
        dia.setHours(0, 0, 0, 0);
        dia.setDate(dia.getDate() - (13 - i));
        const sig = new Date(dia).setDate(dia.getDate() + 1);
        return lista.filter((r) => {
          const t = new Date(r.fecha).getTime();
          return t >= dia.getTime() && t < sig;
        }).length;
      }),
    };
  },
  async anotar(registro) {
    const lista = await leer(CLAVES.tracker, []);
    lista.unshift({
      id: crypto.randomUUID().slice(0, 8),
      fecha: new Date().toISOString(),
      etapa: ETAPA_DE_ESTADO[registro.estado] || "por_postular",
      ...registro,
    });
    // Se recorta para no llenar el almacenamiento del navegador.
    await guardar(CLAVES.tracker, lista.slice(0, 500));
    return lista;
  },
  async yaPostulado(url) {
    const lista = await leer(CLAVES.tracker, []);
    return lista.some((r) => r.url === url && r.estado === "enviada");
  },
  borrar: () => chrome.storage.local.remove(CLAVES.tracker),
};

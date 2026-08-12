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

export const tracker = {
  async listar() {
    return leer(CLAVES.tracker, []);
  },
  async anotar(registro) {
    const lista = await leer(CLAVES.tracker, []);
    lista.unshift({
      id: crypto.randomUUID().slice(0, 8),
      fecha: new Date().toISOString(),
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

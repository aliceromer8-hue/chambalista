// El puente entre la web y la extensión.
//
// Corre SOLO en chambalista, en ninguna otra página.
//
// POR QUÉ EXISTE
//
// La sesión de la web vive en el localStorage del sitio; la de la
// extensión, en chrome.storage. Son dos almacenes distintos y ninguno ve
// al otro, así que quien entraba en la landing abría el panel y se
// encontraba otra vez con «entra con tu cuenta».
//
// POR QUÉ SINCRONIZA EN LOS DOS SENTIDOS
//
// Las dos copias comparten el token de refresco, y Supabase lo cambia
// cada vez que se usa: si la extensión renovaba la sesión, la copia de
// la web quedaba con un token ya gastado. Al volver a la web, esta
// intentaba renovar con él, Supabase lo tomaba por un token robado y
// cerraba la sesión entera —la de la web y la de la extensión—. Por
// eso había que entrar cada vez.
//
// Ahora gana siempre la copia más reciente («emitida»), en cualquiera de
// los dos sentidos, y la web pregunta aquí ANTES de renovar.
//
// No lee nada del CV, ni toca la página, ni manda nada fuera: mueve la
// sesión que la propia persona creó en NUESTRO sitio entre la web y
// NUESTRA extensión.

(() => {
  const CLAVE_WEB = "chamba_sesion";
  const SALIO_WEB = "chamba_salio";      // la persona cerró sesión en la web
  const CLAVE_EXT = "sesion";
  const SALIO_EXT = "salio";             // la persona cerró sesión en el panel

  // Que la web sepa que hay alguien a quien preguntar antes de renovar.
  // Corre en document_start, antes que los scripts de la página.
  try { document.documentElement.dataset.chambaExtension = "1"; } catch { /* da igual */ }

  const leerJSON = (clave) => {
    try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch { return null; }
  };
  const conToken = (s) => (s?.token ? s : null);
  const emitida = (s) => Number(s?.emitida) || 0;

  async function sincronizar() {
    let ext, salioExt;
    try {
      const d = await chrome.storage.local.get([CLAVE_EXT, SALIO_EXT]);
      ext = conToken(d[CLAVE_EXT]);
      salioExt = Number(d[SALIO_EXT]) || 0;
    } catch {
      return false;                       // la extensión se actualizó o se quitó
    }
    const web = conToken(leerJSON(CLAVE_WEB));
    const salioWeb = Number(leerJSON(SALIO_WEB)) || 0;

    // La web ya intentó renovar con este token y Supabase lo rechazó: la
    // copia de la extensión es la misma y tampoco vale.
    let muerta = null;
    try { muerta = localStorage.getItem("chamba_muerta"); } catch { /* privado */ }
    if (ext && muerta && ext.refresco === muerta) {
      await chrome.storage.local.remove(CLAVE_EXT).catch(() => {});
      ext = null;
    }

    if (!web && !ext) return false;

    // Solo hay sesión en la extensión.
    if (!web) {
      // Si la persona salió en la web DESPUÉS de que la extensión tuviera
      // esa sesión, salir vale para las dos.
      if (salioWeb && emitida(ext) <= salioWeb) {
        await chrome.storage.local.remove(CLAVE_EXT).catch(() => {});
        return false;
      }
      escribirWeb(ext);
      return true;
    }

    // Solo hay sesión en la web.
    if (!ext) {
      if (salioExt && emitida(web) <= salioExt) {
        try { localStorage.removeItem(CLAVE_WEB); } catch { /* privado */ }
        return true;
      }
      await chrome.storage.local.set({ [CLAVE_EXT]: web }).catch(() => {});
      return false;
    }

    // Las dos: ya son la misma.
    if (web.refresco === ext.refresco && web.token === ext.token) return false;

    // Gana la más reciente. Si ninguna dice cuándo se emitió (sesiones de
    // antes de este arreglo), la de la web, que es donde se entra.
    if (emitida(ext) > emitida(web)) { escribirWeb(ext); return true; }
    await chrome.storage.local.set({ [CLAVE_EXT]: web }).catch(() => {});
    return false;
  }

  function escribirWeb(s) {
    try {
      localStorage.setItem(CLAVE_WEB, JSON.stringify(s));
      localStorage.removeItem(SALIO_WEB);
    } catch { /* navegación privada */ }
  }

  // `cambio`: la sesión de la web cambió y la página tiene que repintarse.
  async function sincronizarYAvisar() {
    const cambio = await sincronizar().catch(() => false);
    window.postMessage({ chamba: "sincronizado", cambio }, location.origin);
  }

  sincronizarYAvisar();

  // La página pide sincronizar al cargar, antes de renovar y cada vez que
  // guarda o suelta la sesión.
  window.addEventListener("message", (e) => {
    if (e.source === window && e.origin === location.origin && e.data?.chamba === "sincronizar") {
      sincronizarYAvisar();
    }
  });
  // `storage` salta en las OTRAS pestañas del sitio.
  window.addEventListener("storage", (e) => {
    if (e.key === CLAVE_WEB || e.key === SALIO_WEB) sincronizarYAvisar();
  });
  // Al volver a la pestaña: la extensión pudo renovar mientras tanto.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sincronizarYAvisar();
  });
})();

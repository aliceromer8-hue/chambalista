// El puente entre la web y la extensión.
//
// Corre SOLO en chambalista, en ninguna otra página.
//
// POR QUÉ EXISTE
//
// La sesión de la web vive en el localStorage del sitio; la de la
// extensión, en chrome.storage. Son dos almacenes distintos y ninguno ve
// al otro, así que quien entraba en la landing abría el panel y se
// encontraba otra vez con «entra con tu cuenta». Pedir la contraseña dos
// veces por lo mismo es de las cosas que hacen abandonar un producto, y
// además parece que no funciona.
//
// Esto la copia de un lado al otro. Nada más. No lee nada del CV, ni
// toca la página, ni manda nada fuera: coge la sesión que la propia
// persona acaba de crear en NUESTRO sitio y se la pasa a NUESTRA
// extensión.

(() => {
  const CLAVE_WEB = "chamba_sesion";

  function leerSesion() {
    try {
      const s = JSON.parse(localStorage.getItem(CLAVE_WEB) || "null");
      return s?.token ? s : null;
    } catch {
      return null;      // navegación privada, o almacenamiento bloqueado
    }
  }

  function pasar() {
    const sesion = leerSesion();
    if (!sesion) return;
    // Al fondo, que es quien guarda en chrome.storage. Si el fondo está
    // dormido Chrome lo despierta; si la extensión no está, esto falla y
    // no pasa nada.
    chrome.runtime.sendMessage({ accion: "sesionDeLaWeb", sesion }).catch(() => {});
  }

  pasar();

  // Y otra vez cuando la persona entra o sale estando ya en la página:
  // `storage` salta en las OTRAS pestañas, así que se mira también al
  // volver a esta.
  window.addEventListener("storage", (e) => { if (e.key === CLAVE_WEB) pasar(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pasar();
  });
  // El inicio de sesión ocurre en esta misma pestaña y no dispara
  // `storage`. Se mira unas cuantas veces durante el primer minuto, que
  // es cuando la persona se está registrando.
  let quedan = 12;
  const reloj = setInterval(() => { pasar(); if (--quedan <= 0) clearInterval(reloj); }, 5000);
})();

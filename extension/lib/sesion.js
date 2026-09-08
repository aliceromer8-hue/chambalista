// La sesión de la persona, compartida entre la web y la extensión.
//
// La extensión no tiene su propia pantalla de registro: se entra en la
// web y la extensión usa esa sesión. Duplicar el formulario significaría
// mantener dos, y que la persona no sepa cuál de los dos usó.
//
// El token se guarda en chrome.storage.local, que es del navegador de la
// persona y no viaja a ningún sitio salvo en la cabecera de nuestras
// propias peticiones.

import { SERVIDOR } from "./ia.js";

const CLAVE = "sesion";

export async function obtener() {
  const { [CLAVE]: s } = await chrome.storage.local.get(CLAVE);
  return s || null;
}

export async function guardar(sesion) {
  if (sesion) await chrome.storage.local.set({ [CLAVE]: sesion });
  else await chrome.storage.local.remove(CLAVE);
}

/** ¿Hay sesión iniciada? */
export async function hayCuenta() {
  return Boolean((await obtener())?.token);
}

/** Cabecera de autorización para nuestras peticiones. */
export async function cabecera(extra = {}) {
  const s = await obtener();
  return s?.token ? { ...extra, Authorization: `Bearer ${s.token}` } : extra;
}

/**
 * Cambia el token caducado por uno nuevo con el de refresco.
 *
 * Sin esto, a la hora justa la sesión moría en mitad de una tanda de
 * postulaciones: la extensión se encontraba un 401, borraba la sesión y
 * dejaba a medias lo que estuviera enviando, sin decir por qué.
 */
let renovando = null;

async function renovar() {
  const s = await obtener();
  if (!s?.refresco) return null;
  // Dos renovaciones a la vez se invalidan la una a la otra.
  renovando = renovando || (async () => {
    try {
      const r = await fetch(`${SERVIDOR}/api/cuenta/renovar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresco: s.refresco }),
      });
      const j = await r.json();
      if (!r.ok || !j.token) { await guardar(null); return null; }
      await guardar(j);
      return j;
    } catch { return null; }
    finally { renovando = null; }
  })();
  return renovando;
}

/** Como fetch, con la sesión puesta y renovándola si hace falta. */
async function conCuenta(ruta, opciones = {}) {
  const ir = async () => fetch(`${SERVIDOR}${ruta}`, {
    ...opciones, headers: await cabecera(opciones.headers || {}),
  });
  let r = await ir();
  if (r.status === 401 && await renovar()) r = await ir();
  return r;
}

/**
 * Entra con correo y contraseña.
 *
 * No se registra desde aquí a propósito: crear cuenta obliga a aceptar la
 * política de privacidad, y eso se lee en la web, donde está el enlace y
 * hay sitio para mostrarlo. Un panel de extensión es el peor lugar para
 * pedirle a alguien que acepte algo que no puede leer.
 */
export async function entrar(correo, contrasena) {
  try {
    const r = await fetch(`${SERVIDOR}/api/cuenta/entrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo, contrasena }),
    });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "No se pudo entrar." };
    await guardar(j);
    return { usuario: j.usuario };
  } catch (e) {
    return { error: `No se pudo conectar: ${e.message}` };
  }
}

export async function salir() {
  try {
    await fetch(`${SERVIDOR}/api/cuenta/salir`, {
      method: "POST", headers: await cabecera(),
    });
  } catch { /* lo que importa es soltarla de aquí */ }
  await guardar(null);
}

/**
 * Comprueba que la sesión sigue viva, y la limpia si no.
 *
 * Un token caducado que se queda guardado hace que la siguiente
 * petición falle sin explicar por qué. Mejor descubrirlo al abrir.
 */
export async function verificar() {
  const s = await obtener();
  if (!s?.token) return null;
  try {
    const r = await conCuenta("/api/cuenta/yo");
    const j = await r.json();
    if (j.usuario) return j.usuario;
  } catch {
    return s.usuario;          // sin red: se asume válida hasta saber otra cosa
  }
  await guardar(null);
  return null;
}

/** El enlace donde se crea la cuenta, para abrirlo desde el panel. */
export const URL_CUENTA = `${SERVIDOR}/`;

// ---------------------------------------------------------------------
// Sincronizar con la nube
// ---------------------------------------------------------------------
// Sin sesión no se sincroniza nada y no pasa nada: los datos siguen en
// el navegador como hasta ahora. El guardado en la nube es para no
// perderlos al cambiar de equipo, no un requisito para trabajar.

export async function subirPerfil(perfil) {
  if (!(await hayCuenta()) || !perfil) return false;
  try {
    const r = await conCuenta("/api/nube/perfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(perfil),
    });
    return r.ok;
  } catch { return false; }
}

export async function bajarPerfil() {
  if (!(await hayCuenta())) return null;
  try {
    const r = await conCuenta("/api/nube/perfil");
    return r.ok ? (await r.json()).perfil : null;
  } catch { return null; }
}

export async function subirPostulaciones(items) {
  if (!(await hayCuenta()) || !items?.length) return 0;
  try {
    const r = await conCuenta("/api/nube/postulaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postulaciones: items }),
    });
    return r.ok ? (await r.json()).guardadas || 0 : 0;
  } catch { return 0; }
}

export async function bajarPostulaciones() {
  if (!(await hayCuenta())) return [];
  try {
    const r = await conCuenta("/api/nube/postulaciones");
    return r.ok ? (await r.json()).postulaciones || [] : [];
  } catch { return []; }
}

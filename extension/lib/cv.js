// El .docx adaptado, pedido al servidor.
//
// La extensión no puede generar un .docx: es un ZIP con XML dentro que
// arma python-docx, y no hay forma razonable de replicar el formato
// Harvard en el navegador. Así que el servidor lo genera y aquí solo se
// pide y se pasa al content script.
//
// Lo que se manda es el perfil que la persona ya tiene guardado más dos
// cosas de esta vacante en concreto: el resumen reenfocado y las
// habilidades que ELLA confirmó que se le habían olvidado poner. El
// servidor no inventa nada, solo mezcla.

import { SERVIDOR } from "./ia.js";

/** Nombre de archivo legible: la empresa ve esto en su bandeja. */
function sufijoDe(vacante) {
  const partes = [vacante?.empresa, vacante?.titulo].filter(Boolean).join("-");
  return partes
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Pide el CV adaptado a esta vacante.
 *
 * Devuelve { nombre, base64, bytes, anadidas } o null si no se pudo.
 * Devolver null es una respuesta válida: significa "postula con el CV
 * que el portal ya tiene", que es lo que pasaba siempre hasta ahora.
 */
export async function docxAdaptado(perfil, vacante, { resumen, competenciasExtra } = {}) {
  if (!perfil) return null;
  try {
    const r = await fetch(`${SERVIDOR}/api/cv/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        perfil,
        resumen: resumen || null,
        competencias_extra: competenciasExtra || [],
        sufijo: sufijoDe(vacante),
      }),
    });
    if (!r.ok) return { error: `El servidor respondió ${r.status}` };
    const j = await r.json();
    if (!j?.base64) return { error: j?.error || "El servidor no devolvió el archivo." };
    return { nombre: j.nombre, base64: j.base64, bytes: j.bytes, anadidas: j.anadidas || [] };
  } catch (e) {
    // Sin red o servidor dormido (Render tarda ~30 s en despertar).
    return { error: `No se pudo pedir el CV al servidor: ${e.message}` };
  }
}

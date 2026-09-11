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

import { conCuenta } from "./sesion.js";

/**
 * La SEMILLA con la que el servidor elige el nombre del archivo.
 *
 * Ojo: esto ya no se escribe en el nombre. Antes sí, y salía
 * «CV-Alice-Romero-Harvard-Artesco-Practicante-de-Marketing.docx»: la
 * empresa veía su propio nombre en el archivo, que no lo hace una
 * persona. Ahora solo decide cuál de las formas naturales toca, para que
 * la misma vacante dé siempre el mismo archivo y vacantes distintas den
 * nombres distintos. El servidor manda: ver nombres_cv.py.
 */
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
    // Por conCuenta y no por fetch pelado: /api/cv/docx pide sesión, y
    // sin ella devuelve 401. El error se traga más abajo y la
    // postulación seguiría con el CV viejo del portal sin decir nada —
    // que es justo el fallo silencioso que esto existe para evitar.
    const r = await conCuenta("/api/cv/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        perfil,
        resumen: resumen || null,
        competencias_extra: competenciasExtra || [],
        sufijo: sufijoDe(vacante),
        // El puesto sí puede salir en el nombre —«CV Alice Romero -
        // Marketing» lo escribe mucha gente—; la empresa, no.
        puesto: vacante?.titulo || null,
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

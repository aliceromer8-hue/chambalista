// Tus postulaciones, guardadas en TU CUENTA.
//
// Ali, 2026-09-25: «me gustaría que haya memoria por cuenta: con mi cuenta
// ya he postulado en las pruebas anteriores y no se guarda. Sin importar
// la versión: haremos mejoras constantemente y la idea es que nuestros
// usuarios se mantengan».
//
// Por qué se perdía: el historial vivía SOLO en chrome.storage de la
// extensión. Al cargar una versión nueva desde otra carpeta, Chrome la
// trata como otra extensión —otro id, otro almacén vacío— y el historial
// se quedaba en la vieja. Las funciones para subirlo a la cuenta existían
// en sesion.js desde que hay cuentas, pero nadie las llamaba.
//
// Ahora: al abrir el panel, al terminar una tanda y al mover una ficha, se
// baja lo de la cuenta, se fusiona con lo del navegador (por oferta, no
// por URL entera) y se sube el resultado. La cuenta manda; el navegador es
// una copia de trabajo.

import * as almacen from "./almacen.js";
import * as sesion from "./sesion.js";

// La tabla solo admite estos estados (supabase/002-cuentas.sql): se guarda
// la ETAPA, que es lo que la persona ve y mueve.
const ETAPAS_NUBE = new Set(["por_postular", "enviada", "entrevista", "oferta", "descartada"]);

/** Qué estado local corresponde a una fila de la nube. */
function estadoDesde(fila) {
  if (fila.estado !== "por_postular") return "enviada";
  return /web de la empresa/i.test(fila.motivo || "") ? "externa" : "omitida";
}

let enCurso = null;

/**
 * Baja, fusiona y sube. Devuelve { ok, nuevas }.
 *
 * Si la nube no contesta, NO se toca nada: un fallo de red no puede
 * parecer un historial vacío (ver sesion.bajarPostulaciones).
 */
export function sincronizar() {
  if (!enCurso) enCurso = hacer().finally(() => { enCurso = null; });
  return enCurso;
}

async function hacer() {
  if (!(await sesion.hayCuenta())) return { ok: false, motivo: "sin cuenta" };
  const remotas = await sesion.bajarPostulaciones();
  if (remotas === null) return { ok: false, motivo: "sin red" };

  const locales = await almacen.leer("tracker", []);
  const porClave = new Map(locales.map((r) => [almacen.claveOferta(r.url), r]));
  let nuevas = 0;
  for (const f of remotas) {
    const k = almacen.claveOferta(f.url);
    const l = porClave.get(k);
    if (!l) {
      const registro = {
        id: crypto.randomUUID().slice(0, 8),
        fecha: f.actualizado, actualizado: f.actualizado,
        url: f.url, puesto: f.titulo, empresa: f.empresa, portal: f.portal,
        etapa: ETAPAS_NUBE.has(f.estado) ? f.estado : "por_postular",
        estado: estadoDesde(f), motivo: f.motivo || "",
      };
      locales.push(registro);
      porClave.set(k, registro);
      nuevas++;
    } else if (ETAPAS_NUBE.has(f.estado) && f.estado !== l.etapa
               && new Date(f.actualizado) > new Date(l.actualizado || l.fecha || 0)) {
      // La movieron en otro equipo después: gana la más reciente.
      l.etapa = f.estado;
      l.actualizado = f.actualizado;
    }
  }
  locales.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  await almacen.guardar("tracker", locales.slice(0, 500));

  // Una fila por oferta (la tabla es única por usuario + url).
  const unicas = [...new Map(locales.filter((r) => r.url)
    .map((r) => [almacen.claveOferta(r.url), r])).values()];
  await sesion.subirPostulaciones(unicas.map((r) => ({
    url: r.url, titulo: r.puesto || "", empresa: r.empresa || "", portal: r.portal || "",
    estado: ETAPAS_NUBE.has(r.etapa) ? r.etapa : "por_postular",
    motivo: String(r.motivo || "").slice(0, 300),
  })));
  return { ok: true, nuevas };
}

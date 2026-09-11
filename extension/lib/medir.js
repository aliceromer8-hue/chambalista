// Contar lo que pasa en el navegador, que el servidor no ve.
//
// Buscar, preparar y enviar ocurren aquí, en el equipo de la persona. Si
// nadie se los cuenta al servidor, no existen — y «postulación enviada»
// no es una métrica más: es EL producto. Sin ella no se puede responder
// a «¿esto le sirve a alguien?», que es la única pregunta que importa
// antes de cobrar por ello.
//
// Lo que se manda es un tipo de una lista cerrada y un puñado de valores
// con pocas variantes: el portal, si salió bien, el motivo de una
// omisión. Nada del CV, nada del puesto, nada escrito por la persona.
// Con el puesto exacto y la hora se identifica a alguien aunque no vaya
// ni nombre ni id, y lo que la política promete son conteos que no
// identifican a nadie.

import { conCuenta } from "./sesion.js";

export async function medir(tipo, detalle = {}) {
  try {
    await conCuenta("/api/medir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, detalle }),
    });
  } catch {
    // Medir es un extra. Que falle no puede estropear una postulación:
    // es preferible perder el dato que perderle la vacante a alguien.
  }
}

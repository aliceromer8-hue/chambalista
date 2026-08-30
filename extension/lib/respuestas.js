// Redacción de las preguntas de selección de los portales.
//
// Regla que no se rompe, esté o no la IA: las preguntas de CONSENTIMIENTO
// (aceptar que unas prácticas son ad honorem, aceptar condiciones) y las
// de COMPROMISO (disponibilidad, horarios, viajar) no se responden solas.
// Se le preguntan a la persona y se le explica qué está aceptando.
//
// Estas dos comprobaciones van ANTES de llamar al modelo, así que esas
// preguntas ni siquiera se le envían.

import { paraCampo } from "./datos.js";
import * as ia from "./ia.js";

// Se busca por RAÍZ, no por conjugación.
//
// Antes estaban las formas en primera persona —"acepto", "autorizo"—
// porque así se redacta una casilla que uno marca. Pero los formularios
// preguntan en tercera: "¿Acepta usted...?" no contiene "acepto", y por
// esa letra se colaban al modelo preguntas que nunca debe responder.
//
// Ancho a propósito: bloquear de más solo hace que la persona conteste
// una pregunta extra; bloquear de menos hace que una IA acepte
// condiciones laborales en su nombre.
const ES_CONSENTIMIENTO = new RegExp(
  [
    "acept\\w*", "autoriz\\w*", "confirm\\w*", "declar\\w*",
    "consient\\w*", "consentimiento",
    "comprometer\\w*", "comprometo", "comprometes", "compromete\\w*", "compromiso",
    "(?:est\\w{1,3}|de)\\s+acuerdo", "conforme",
    "h[ea]\\s+le[ií]do", "le[ií]do\\s+y",
    "t[eé]rminos\\s+y\\s+condiciones",
    "pol[ií]tica\\s+de\\s+(?:privacidad|datos|tratamiento)",
    "tratamiento\\s+de\\s+(?:datos|mis\\s+datos)",
    "ad honorem", "sin remuneraci[oó]n", "no remunerad", "sin pago", "no percibir",
  ].join("|"),
  "i",
);
const ES_COMPROMISO = /disponibilidad|disponible|lunes a (viernes|s[aá]bado)|horario rotativo|movilizarte|viajar|trasladarte/i;

/** Clasifica una pregunta para saber cómo tratarla. */
export function clasificar(enunciado) {
  if (ES_CONSENTIMIENTO.test(enunciado)) return "consentimiento";
  if (ES_COMPROMISO.test(enunciado)) return "compromiso";
  if (/estudias|carrera|universidad|instituto|ciclo|egresad|titulad/i.test(enunciado)) return "estudios";
  if (/herramientas|manejas|dominio|software|nivel de/i.test(enunciado)) return "herramientas";
  if (/experiencia|has trabajado|por qu[eé]|cu[eé]ntanos|motiva/i.test(enunciado)) return "experiencia";
  return "otra";
}

function avisoConsentimiento(enunciado) {
  if (/ad honorem|sin remuneraci[oó]n|no remunerad/i.test(enunciado)) {
    return "⚠️ Ojo: al confirmar estás aceptando que estas prácticas son **sin pago**. " +
           "Tu beneficio sería la experiencia, capacitación y certificación.";
  }
  return "Al confirmar aceptas las condiciones que indica la empresa.";
}

function lugarDe(enunciado) {
  const m = enunciado.match(/en\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]{2,25}?)\s+de\s+lunes/);
  return m ? m[1].trim() : "";
}

/**
 * Redacta las respuestas de una tanda de preguntas.
 *
 * @returns [{indice, enunciado, clase, texto, necesita:[...]}]
 *   `necesita` son los datos que la persona tiene que aportar; mientras
 *   haya alguno sin responder, `texto` va vacío.
 */
export async function redactar(preguntas, perfil, guardados = {}, respuestasPersona = {}) {
  const salida = preguntas.map((p) => ({ ...p, clase: clasificar(p.enunciado), texto: "", necesita: [] }));

  // 1. Consentimiento y compromiso: decide la persona, no el modelo.
  for (const q of salida) {
    if (q.clase === "consentimiento") {
      const r = respuestasPersona[`consent_${q.indice}`];
      q.necesita.push({
        clave: `consent_${q.indice}`,
        etiqueta: "¿Confirmas que lo leíste y lo aceptas?",
        tipo: "opciones",
        opciones: ["Sí, confirmo y acepto", "No"],
        aviso: avisoConsentimiento(q.enunciado),
        respondido: Boolean(r),
      });
      if (r === "Sí, confirmo y acepto") {
        q.texto = "Confirmo que he leído y comprendido las condiciones indicadas.";
      }
    } else if (q.clase === "compromiso") {
      const r = respuestasPersona[`disp_${q.indice}`];
      const lugar = lugarDe(q.enunciado);
      q.necesita.push({
        clave: `disp_${q.indice}`,
        etiqueta: `¿Tienes disponibilidad${lugar ? ` para ir a ${lugar}` : ""}?`,
        tipo: "opciones",
        opciones: ["Sí, completa", "Sí, con restricciones de horario", "No"],
        respondido: Boolean(r),
      });
      if (r === "Sí, completa") {
        q.texto = `Sí, cuento con disponibilidad${lugar ? ` para asistir a ${lugar}` : ""}.`;
      } else if (r === "Sí, con restricciones de horario") {
        q.texto = `Sí, cuento con disponibilidad${lugar ? ` para ${lugar}` : ""}, coordinando el horario según mis clases.`;
      } else if (r === "No") {
        q.texto = "Por el momento no cuento con esa disponibilidad.";
      }
    }
  }

  // 2. Datos ya guardados: se responden al instante, sin gastar el modelo.
  for (const q of salida) {
    if (q.texto || q.clase === "consentimiento" || q.clase === "compromiso") continue;
    const { campo, valor } = paraCampo(q.enunciado, guardados);
    if (campo && valor) {
      q.texto = campo.plantilla(valor);
    } else if (campo && !valor) {
      q.necesita.push({
        clave: campo.clave,
        etiqueta: campo.etiqueta,
        tipo: "texto",
        respondido: Boolean(respuestasPersona[campo.clave]),
      });
      if (respuestasPersona[campo.clave]) {
        q.texto = campo.plantilla(respuestasPersona[campo.clave]);
      }
    }
  }

  // 3. Lo que queda, al modelo — en UNA sola llamada.
  const pendientes = salida.filter((q) => !q.texto && q.necesita.length === 0);
  if (pendientes.length) {
    const respuestas = await ia.redactarLote(
      pendientes.map((q) => q.enunciado), perfil, guardados,
    );
    if (respuestas?.agotada) {
      // Sin cuota: la persona escribe estas a mano. Se le dice por qué.
      pendientes.forEach((q) => { q.avisoCuota = respuestas.error; });
    } else if (Array.isArray(respuestas)) {
      pendientes.forEach((q, i) => {
        const r = respuestas[i];
        if (!r) return;
        if (r.falta) {
          q.necesita.push({
            clave: `extra_${q.indice}`,
            etiqueta: r.falta,
            tipo: "texto",
            respondido: Boolean(respuestasPersona[`extra_${q.indice}`]),
          });
          if (respuestasPersona[`extra_${q.indice}`]) {
            q.texto = respuestasPersona[`extra_${q.indice}`];
          }
        } else {
          q.texto = r.texto;
        }
      });
    }
  }

  return salida;
}

/** ¿Queda alguna pregunta de consentimiento sin aprobar? */
export function consentimientoPendiente(preguntas) {
  for (const q of preguntas) {
    if (q.clase !== "consentimiento") continue;
    const sin = (q.necesita || []).some((n) => !n.respondido);
    if (sin) return q.enunciado;
  }
  return null;
}

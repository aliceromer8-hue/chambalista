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
/**
 * Una respuesta en prosa: sin guiones, viñetas ni saltos de línea.
 * Ali, 2026-09-25: «todas las respuestas salen del CV y en un tono
 * profesional, sin guiones, corrido, humanizado». El modelo ya lo tiene
 * como regla; esto es la red por si alguna se cuela como lista.
 */
export function enProsa(texto) {
  const partes = String(texto || "")
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-–—•*·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  // Tras una coma, «Estoy…» pasa a «estoy…» (solo palabras comunes: los
  // nombres propios como Canva o Excel se quedan como están).
  const COMUN = /^(Estoy|Tengo|Manejo|Soy|He|Cuento|Estudio|Me|Mi|Mis|El|La|Los|Las|Un|Una|En|Con|Por|Para|Actualmente|Además|También)\b/;
  let t = partes.map((l, i) => {
    const suave = i > 0 && !/[.!?:]$/.test(partes[i - 1]) ? l.replace(COMUN, (w) => w.toLowerCase()) : l;
    return i < partes.length - 1 && !/[.!?:;,]$/.test(suave) ? `${suave},` : suave;
  }).join(" ");
  t = t.replace(/\s+[–—-]\s+/g, ", ").replace(/\s{2,}/g, " ").trim();
  if (t && !/[.!?]$/.test(t)) t += ".";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export async function redactar(preguntas, perfil, guardados = {}, respuestasPersona = {}, contexto = {}) {
  const salida = preguntas.map((p) => ({ ...p, clase: clasificar(p.enunciado), texto: "", necesita: [] }));

  // POLÍTICA (Ali, 2026-09-24): preguntar a la persona es el ÚLTIMO
  // recurso. «A menos que sea extremadamente importante.» Antes cada
  // disponibilidad, cada horario y cada «acepto las condiciones» esperaba
  // a que ella contestara, y una tanda de treinta se convertía en treinta
  // interrupciones: casi lo mismo que postular a mano.
  //
  // Ahora se contesta lo razonable por defecto —y queda a la vista y
  // editable en el panel—, y solo se pregunta lo que de verdad la
  // compromete. Hoy eso es UNA cosa: aceptar prácticas sin pago.
  const SIN_PAGO = /ad honorem|sin remuneraci[oó]n|no remunerad|sin pago|no percibir/i;

  // 1. Consentimiento y compromiso.
  for (const q of salida) {
    if (q.clase === "consentimiento") {
      const clave = `consent_${q.indice}`;
      const r = respuestasPersona[clave];
      if (SIN_PAGO.test(q.enunciado)) {
        // Prácticas sin pago: hasta 2026-09-24 era la única que se
        // preguntaba. Ali: «todo automático, la persona no debe tocar
        // nada». Se acepta —postular no es aceptar el puesto: se puede
        // declinar en la entrevista— y queda ANOTADO en la postulación
        // (`sinPagoAceptado`) para que se sepa a cuáles fue así. Quien no
        // quiera, dice «No» aquí o activa la revisión en Mi perfil.
        q.texto = r === "No" ? "" : "Confirmo que he leído y comprendido las condiciones indicadas.";
        q.sinPagoAceptado = r !== "No";
        q.necesita.push({
          clave, etiqueta: "¿Confirmas que lo leíste y lo aceptas?", tipo: "opciones",
          opciones: ["Sí, confirmo y acepto", "No"],
          aviso: avisoConsentimiento(q.enunciado), respondido: true, automatica: !r,
        });
      } else {
        // Leer las condiciones, el tratamiento de datos: lo que acepta
        // cualquiera que postula. Se acepta, salvo que ella diga que no.
        q.texto = r === "No" ? "" : "Confirmo que he leído y acepto las condiciones indicadas.";
        q.necesita.push({ clave, etiqueta: "¿Lo aceptas?", tipo: "opciones",
                          opciones: ["Sí, confirmo y acepto", "No"], respondido: true, automatica: !r });
      }
    } else if (q.clase === "compromiso") {
      const clave = `disp_${q.indice}`;
      const r = respuestasPersona[clave] || "Sí, completa";      // por defecto, sí
      const lugar = lugarDe(q.enunciado);
      q.necesita.push({
        clave, etiqueta: `¿Tienes disponibilidad${lugar ? ` para ir a ${lugar}` : ""}?`,
        tipo: "opciones", opciones: ["Sí, completa", "Sí, con restricciones de horario", "No"],
        respondido: true, automatica: !respuestasPersona[clave],
      });
      if (r === "Sí, completa") {
        // Con sus datos, la respuesta dice algo: horario y cuándo empieza.
        const horario = guardados.horario ? ` en horario de ${String(guardados.horario).toLowerCase()}` : "";
        const inicio = guardados.disponibilidadInicio === "Inmediata" ? " y puedo incorporarme de inmediato"
          : guardados.disponibilidadInicio && !/^\d{4}-/.test(guardados.disponibilidadInicio)
            ? ` y puedo empezar ${String(guardados.disponibilidadInicio).toLowerCase()}` : "";
        q.texto = `Sí, cuento con disponibilidad${lugar ? ` para asistir a ${lugar}` : ""}${horario}${inicio}.`;
      } else if (r === "Sí, con restricciones de horario") {
        q.texto = `Sí, cuento con disponibilidad${lugar ? ` para ${lugar}` : ""}, coordinando el horario según mis clases.`;
      } else if (r === "No") {
        q.texto = "Por el momento no cuento con esa disponibilidad.";
      }
    }
  }

  // 1b. Preguntas de opciones del portal (horarios, sedes, turnos): las
  // elige la persona entre las opciones DEL PORTAL. Antes pasaban por
  // «compromiso» y se le ofrecía «Sí / No» para una pregunta de «¿qué
  // turno?»; o, peor, iban al modelo, que no puede elegir un horario por
  // nadie.
  //
  // Ahora se ELIGEN solas cuando son de disponibilidad (turnos, sedes,
  // modalidad): la más flexible, o la primera. Las demás —«¿tienes
  // experiencia en X? Sí/No»— son hechos sobre la persona, y un «Sí»
  // elegido a ciegas sería inventar: esas las elige el modelo con el CV.
  const FLEXIBLE = /cualquier|indistint|ambos|ambas|todos|todas|flexible|full ?time|tiempo completo/i;
  for (const q of salida) {
    if (q.tipo !== "opcion" || !(q.opciones || []).length) continue;
    const clave = `opc_${q.indice}`;
    const r = respuestasPersona[clave];
    const deDisponibilidad = q.clase === "compromiso" || /horario|turno|sede|modalidad|jornada/i.test(q.enunciado);
    const auto = deDisponibilidad ? (q.opciones.find((o) => FLEXIBLE.test(o)) || q.opciones[0]) : "";
    const elegida = r && q.opciones.includes(r) ? r : auto;
    q.necesita = [{ clave, etiqueta: q.enunciado, tipo: "opciones", opciones: q.opciones,
                    respondido: Boolean(elegida), automatica: !r && Boolean(auto) }];
    q.texto = elegida;
    if (!elegida) q.porModelo = true;          // la elige el modelo, abajo
  }

  // 2. Datos ya guardados: se responden al instante, sin gastar el modelo.
  for (const q of salida) {
    if (q.tipo === "opcion") continue;
    if (q.texto || q.clase === "consentimiento" || q.clase === "compromiso") continue;
    const { campo, valor } = paraCampo(q.enunciado, guardados);
    if (campo && valor) {
      q.texto = campo.plantilla(valor);
    } else if (campo && !valor && !q.obligatoria) {
      // No está guardado y el portal no lo exige: se deja en blanco antes
      // que interrumpir. (Antes se preguntaba siempre.)
      q.saltar = true;
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

  // 2b. Teléfono y correo: salen del CV, no del modelo.
  //
  // «Déjanos tu número actualizado para ponernos en contacto» (TALENTEA,
  // Computrabajo) iba al modelo. El número está en el CV y no hay nada
  // que redactar: se escribe tal cual. Si el CV no lo tiene, se pregunta.
  const TEL = /(n[uú]mero|celular|tel[eé]fono|whatsapp)/i;
  const CORREO = /(correo|e-?mail)/i;
  for (const q of salida) {
    if (q.texto || q.necesita.length || q.tipo === "opcion") continue;
    const contacto = perfil?.contacto || {};
    if (TEL.test(q.enunciado) && !/documento|dni|identidad/i.test(q.enunciado)) {
      if (contacto.telefono) q.texto = `Mi número es ${contacto.telefono}.`;
      else if (!q.obligatoria) q.saltar = true;
      else q.necesita.push({ clave: `tel_${q.indice}`, etiqueta: "Tu número de celular", tipo: "texto",
                             respondido: Boolean(respuestasPersona[`tel_${q.indice}`]) });
      if (!q.texto && respuestasPersona[`tel_${q.indice}`]) q.texto = `Mi número es ${respuestasPersona[`tel_${q.indice}`]}.`;
    } else if (CORREO.test(q.enunciado) && contacto.email) {
      q.texto = `Mi correo es ${contacto.email}.`;
    }
  }

  // 3. Lo que queda, al modelo — en UNA sola llamada.
  // Las de opciones que no son de disponibilidad también van: el modelo
  // elige entre las opciones del portal con lo que dice el CV.
  const pendientes = salida.filter((q) =>
    !q.saltar && ((!q.texto && q.necesita.length === 0) || q.porModelo));
  if (pendientes.length) {
    // La vacante viaja con las preguntas. Antes el modelo no sabía a qué
    // puesto se postulaba, así que «¿por qué te interesa este puesto?»
    // volvía como FALTA_DATO y se le preguntaba a la persona.
    const extras = {
      ...guardados,
      ...(contexto.titulo ? { puesto: contexto.titulo } : {}),
      ...(contexto.empresa ? { empresa: contexto.empresa } : {}),
      ...(contexto.descripcion ? { vacante: String(contexto.descripcion).slice(0, 700) } : {}),
    };
    const respuestas = await ia.redactarLote(
      pendientes.map((q) => (q.porModelo
        ? `${q.enunciado} (responde SOLO con una de estas opciones, tal cual: ${q.opciones.join(" | ")})`
        : q.enunciado)),
      perfil, extras,
    );
    if (respuestas?.agotada) {
      // Sin cuota: la persona escribe estas a mano. Se le dice por qué.
      pendientes.forEach((q) => { q.avisoCuota = respuestas.error; });
    } else if (Array.isArray(respuestas)) {
      pendientes.forEach((q, i) => {
        const r = respuestas[i];
        if (!r) return;
        if (q.porModelo) {
          // Se acepta solo si es una de las opciones del portal.
          const elegida = q.opciones.find((o) => o.toLowerCase() === String(r.texto || "").trim().toLowerCase());
          if (elegida) { q.texto = elegida; q.necesita[0].respondido = true; q.necesita[0].automatica = true; }
          return;
        }
        if (r.falta && !q.obligatoria) {
          // El modelo no lo sabe y el portal no lo exige: en blanco, sin
          // interrumpir. Preguntar es el último recurso.
          return;
        }
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
          q.texto = enProsa(r.texto);
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

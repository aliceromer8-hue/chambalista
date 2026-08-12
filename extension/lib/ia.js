// Llamadas al modelo. La clave es de la persona y vive en su navegador.
//
// Notas que costaron depuración con Gemini:
// - El alias `gemini-flash-latest` sí tiene cuota gratuita; pedir
//   `gemini-2.0-flash` por su nombre exacto devuelve 429 con "limit: 0".
// - Estos modelos razonan antes de responder y ese razonamiento sale del
//   mismo presupuesto de tokens, así que un maxOutputTokens bajo devuelve
//   texto truncado o vacío.
// - Al parsear hay que descartar las partes marcadas `thought`.

import { claveIA } from "./almacen.js";

const MODELO_GEMINI = "gemini-flash-latest";
const MODELO_GROQ = "llama-3.3-70b-versatile";
const MARCA_FALTA = "FALTA_DATO:";

export async function disponible() {
  return Boolean(await claveIA.obtener());
}

/** Las claves de Gemini y las de Groq se distinguen por su forma. */
function proveedorDe(clave) {
  return clave.startsWith("gsk_") ? "groq" : "gemini";
}

async function pedir(url, cuerpo, cabeceras = {}, reintentos = 3) {
  let espera = 5000;
  for (let i = 0; i < reintentos; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras },
      body: JSON.stringify(cuerpo),
    });
    if (r.ok) return r.json();
    // La capa gratuita limita por minuto; conviene reintentar.
    if ((r.status === 429 || r.status === 503) && i < reintentos - 1) {
      await new Promise((s) => setTimeout(s, espera));
      espera *= 2;
      continue;
    }
    throw new Error(`El modelo respondió ${r.status}`);
  }
}

async function llamar(instrucciones, prompt, tope = 2000) {
  const clave = await claveIA.obtener();
  if (!clave) return null;

  try {
    if (proveedorDe(clave) === "groq") {
      const d = await pedir(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: MODELO_GROQ,
          messages: [
            { role: "system", content: instrucciones },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: Math.min(tope, 4000),
        },
        { Authorization: `Bearer ${clave}` },
      );
      return d?.choices?.[0]?.message?.content?.trim() || null;
    }

    const d = await pedir(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${clave}`,
      {
        systemInstruction: { parts: [{ text: instrucciones }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: tope },
      },
    );
    const partes = d?.candidates?.[0]?.content?.parts || [];
    // Descartar el razonamiento: no es la respuesta.
    return partes.filter((p) => !p.thought).map((p) => p.text || "").join(" ").trim() || null;
  } catch (e) {
    console.warn("Chamba Lista — el modelo falló:", e.message);
    return null;
  }
}

function extraerJSON(texto) {
  if (!texto) return null;
  const limpio = texto.replace(/^```(?:json)?\s*/im, "").replace(/\s*```$/m, "").trim();
  const i = limpio.indexOf("{");
  const f = limpio.lastIndexOf("}");
  if (i === -1 || f <= i) return null;
  try {
    return JSON.parse(limpio.slice(i, f + 1));
  } catch {
    return null;
  }
}

function cvEnTexto(perfil, extras = {}) {
  const l = [];
  if (perfil?.nombre) l.push(`Nombre: ${perfil.nombre}`);
  const c = perfil?.contacto || {};
  for (const [et, k] of [["Ciudad", "ubicacion"], ["Email", "email"], ["Teléfono", "telefono"]]) {
    if (c[k]) l.push(`${et}: ${c[k]}`);
  }
  const titulos = {
    perfil: "Perfil profesional", experiencia: "Experiencia", liderazgo: "Liderazgo y voluntariado",
    educacion: "Educación", competencias: "Competencias", certificaciones: "Certificaciones",
    logros: "Logros",
  };
  for (const [k, t] of Object.entries(titulos)) {
    const v = perfil?.[k];
    if (!Array.isArray(v) || !v.length) continue;
    const lineas = v.map((e) => {
      if (typeof e === "string") return e;
      if (e?.categoria) return `${e.categoria}: ${e.items}`;
      const cab = [e.organizacion, e.cargo, e.fechas, e.lugar].filter(Boolean).join(" · ");
      return [cab, ...(e.logros || []).map((x) => `  - ${x}`)].join("\n");
    });
    l.push(`\n${t}:\n${lineas.join("\n")}`);
  }
  const extra = Object.entries(extras).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (extra.length) l.push(`\nDatos adicionales que indicó:\n${extra.join("\n")}`);
  return l.join("\n");
}

const INSTRUCCIONES_LOTE = `Eres un asistente que ayuda a una persona a responder las preguntas de una postulación de empleo en Perú.

Recibes su CV y una lista numerada de preguntas. Devuelve ÚNICAMENTE un objeto JSON válido, sin explicaciones ni bloques de código:

{"respuestas": [{"n": 1, "texto": "..."}, {"n": 2, "texto": "FALTA_DATO: qué dato hace falta"}]}

REGLAS ESTRICTAS:
1. Una entrada por pregunta, con el mismo número que se te dio.
2. Responde en primera persona, en español natural, como lo escribiría la persona.
3. Usa ÚNICAMENTE información del CV. Está terminantemente prohibido inventar datos, cifras, herramientas, experiencias o nombres que no aparezcan.
4. Si el CV no tiene la información, pon "FALTA_DATO: <qué dato hace falta>". Es preferible pedir el dato a inventarlo.
5. Responde SOLO lo que cada pregunta pide. Si preguntan el distrito, no menciones el teléfono.
6. Máximo 400 caracteres por respuesta. Sin viñetas ni comillas envolventes.
7. No copies fragmentos del CV en crudo: redacta una frase.`;

/** Redacta varias respuestas en una sola llamada. */
export async function redactarLote(enunciados, perfil, extras = {}) {
  if (!enunciados.length) return [];
  const listado = enunciados.map((e, i) => `${i + 1}. ${e}`).join("\n");
  const datos = extraerJSON(await llamar(
    INSTRUCCIONES_LOTE,
    `CV de la persona:\n${cvEnTexto(perfil, extras)}\n\nPreguntas:\n${listado}\n\nDevuelve el JSON.`,
  ));
  if (!datos?.respuestas) return null;

  const salida = new Array(enunciados.length).fill(null);
  for (const item of datos.respuestas) {
    const n = Number(item?.n);
    if (!Number.isInteger(n) || n < 1 || n > enunciados.length) continue;
    const texto = String(item.texto || "").trim();
    salida[n - 1] = texto.toUpperCase().startsWith(MARCA_FALTA)
      ? { falta: texto.slice(MARCA_FALTA.length).trim() || "este dato", texto: "" }
      : { falta: null, texto: texto.slice(0, 480) };
  }
  return salida;
}

const INSTRUCCIONES_ADAPTAR = `Adaptas un CV a una vacante concreta para que la persona destaque, SIN mentir.

Devuelve ÚNICAMENTE un objeto JSON válido:
{"resumen": ["2 o 3 líneas orientadas a esta vacante"], "cambios": ["qué cambiaste y por qué"]}

REGLAS ABSOLUTAS:
1. PROHIBIDO inventar. No añadas herramientas, logros, empresas, cifras ni títulos que no estén en el CV.
2. Adaptar es REORDENAR y REFORMULAR lo que ya existe.
3. Si la vacante pide algo que la persona NO tiene, no lo menciones.
4. Mantén el idioma del CV original.`;

/** Reenfoca el resumen del CV hacia una vacante. */
export async function adaptarAVacante(perfil, vacante) {
  const partes = [
    `VACANTE: ${vacante.titulo || ""}`,
    `Empresa: ${vacante.empresa || ""}`,
    `Descripción: ${vacante.descripcion || "(no disponible)"}`,
    `\nCV ACTUAL:\n${cvEnTexto(perfil)}`,
  ];
  const datos = extraerJSON(await llamar(INSTRUCCIONES_ADAPTAR, partes.join("\n")));
  if (!datos) return null;
  const norm = (v) => (typeof v === "string" ? v.split("\n") : v || [])
    .map((x) => String(x).trim()).filter(Boolean);
  return { resumen: norm(datos.resumen), cambios: norm(datos.cambios).slice(0, 5) };
}

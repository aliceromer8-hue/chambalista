# -*- coding: utf-8 -*-
"""Redacción de respuestas con un modelo de lenguaje (opciones gratuitas).

Las reglas escritas a mano no alcanzan: cada vacante inventa sus propias
preguntas ("confírmanos tu usuario de TikTok", "¿por qué te interesa el
puesto?") y no hay patrón que las cubra todas. Aquí se delega la
redacción a un modelo, con tres proveedores gratuitos y detección
automática del que esté disponible:

  1. Ollama      — local, gratis y privado (necesita instalarlo)
  2. Gemini      — capa gratuita, requiere GEMINI_API_KEY
  3. Groq        — capa gratuita, requiere GROQ_API_KEY

Si no hay ninguno, `disponible()` devuelve False y la plataforma sigue
funcionando con las reglas de `respuestas.py`.

Lo que el modelo NO decide (se resuelve antes de llamarlo, en
respuestas.py): aceptar condiciones y comprometer disponibilidad. Eso lo
responde la persona siempre.
"""

import json
import os
import re
import time
import urllib.error
import urllib.request

# Algunos antivirus y proxies corporativos interceptan TLS con un
# certificado que el almacén de Python rechaza ("CERTIFICATE_VERIFY_FAILED:
# Basic Constraints of CA cert not marked critical"). `truststore` delega
# la verificación al almacén del sistema operativo, donde ese certificado
# sí está instalado. Se sigue verificando: no se desactiva nada.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

TIEMPO_LIMITE = 60

# Alias "latest" en vez de una versión fija: las claves nuevas de AI Studio
# traen cuota gratuita para este alias, mientras que pedir gemini-2.0-flash
# por su nombre exacto devuelve 429 con "limit: 0".
MODELO_GEMINI = "gemini-flash-latest"

# Tope de tokens de salida. Los modelos flash razonan antes de responder y
# ese razonamiento sale del mismo presupuesto, así que un tope bajo devuelve
# texto truncado. `_llamar` lo sube para tareas largas (analizar un CV).
TOPE_SALIDA = 2000

# Marca que devuelve el modelo cuando el CV no tiene el dato. Se usa para
# preguntárselo a la persona en vez de dejar que invente algo.
MARCA_FALTA = "FALTA_DATO:"

INSTRUCCIONES = """Eres un asistente que ayuda a una persona a responder preguntas de una postulación de empleo en Perú.

REGLAS ESTRICTAS:
1. Responde en primera persona, en español natural, como lo escribiría la persona.
2. Usa ÚNICAMENTE información del CV que te doy. Está terminantemente prohibido inventar datos, cifras, herramientas, experiencias o nombres que no aparezcan en el CV.
3. Si el CV NO contiene la información necesaria para responder, responde exactamente:
   FALTA_DATO: <descripción breve de qué dato hace falta>
   No inventes ni des rodeos: es preferible pedir el dato.
4. Responde SOLO lo que la pregunta pide. Si preguntan el distrito, no menciones el teléfono.
5. Máximo 400 caracteres. Sin viñetas, sin encabezados, sin comillas envolventes.
6. No copies fragmentos del CV en crudo: redacta una frase.

Devuelve solo la respuesta, nada más."""


# ---------------------------------------------------------------------------
# Proveedores
# ---------------------------------------------------------------------------

def _pedir(url, cuerpo, cabeceras=None, reintentos=3):
    """POST JSON con reintentos ante 429 y 503.

    La capa gratuita limita peticiones por minuto, y una postulación
    encadena varias llamadas. Sin reintento, la primera que topa el límite
    hace caer todo al respaldo por reglas sin explicación visible.
    """
    datos = json.dumps(cuerpo).encode("utf-8")
    espera = 6
    for intento in range(reintentos):
        req = urllib.request.Request(
            url, data=datos, headers={"Content-Type": "application/json", **(cabeceras or {})}
        )
        try:
            with urllib.request.urlopen(req, timeout=TIEMPO_LIMITE) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and intento < reintentos - 1:
                time.sleep(espera)
                espera *= 2
                continue
            raise
    return {}


def _ollama_modelo():
    """Primer modelo instalado en Ollama, si el servidor está levantado."""
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as r:
            modelos = json.load(r).get("models", [])
        return modelos[0]["name"] if modelos else None
    except Exception:
        return None


def _con_ollama(prompt, modelo):
    r = _pedir("http://localhost:11434/api/chat", {
        "model": modelo,
        "messages": [
            {"role": "system", "content": INSTRUCCIONES},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "options": {"temperature": 0.3},
    })
    return (r.get("message", {}).get("content") or "").strip()


def _con_gemini(prompt, clave):
    modelo = os.environ.get("GEMINI_MODEL", MODELO_GEMINI)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={clave}"
    r = _pedir(url, {
        "systemInstruction": {"parts": [{"text": INSTRUCCIONES}]},
        "contents": [{"parts": [{"text": prompt}]}],
        # maxOutputTokens alto a propósito: los modelos flash actuales
        # razonan antes de responder y ese razonamiento consume del mismo
        # presupuesto. Con un tope bajo se agota pensando y la respuesta
        # llega vacía o truncada a media frase.
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": TOPE_SALIDA},
    })
    try:
        partes = r["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError):
        return ""
    # Descartar los fragmentos de razonamiento: no son la respuesta.
    return " ".join(p.get("text", "") for p in partes if not p.get("thought")).strip()


def _con_groq(prompt, clave):
    modelo = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    r = _pedir(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            "model": modelo,
            "messages": [
                {"role": "system", "content": INSTRUCCIONES},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 300,
        },
        {"Authorization": f"Bearer {clave}"},
    )
    try:
        return r["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError):
        return ""


def proveedor():
    """Devuelve (nombre, detalle) del proveedor disponible, o (None, motivo)."""
    modelo = _ollama_modelo()
    if modelo:
        return "ollama", modelo
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini", os.environ.get("GEMINI_MODEL", MODELO_GEMINI)
    if os.environ.get("GROQ_API_KEY"):
        return "groq", os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    return None, "sin proveedor configurado"


def disponible():
    return proveedor()[0] is not None


# ---------------------------------------------------------------------------
# Redacción
# ---------------------------------------------------------------------------

def _cv_en_texto(perfil, extras=None):
    """Arma el contexto del CV que se le pasa al modelo."""
    lineas = []
    if perfil.get("nombre"):
        lineas.append(f"Nombre: {perfil['nombre']}")
    contacto = perfil.get("contacto", {})
    for etiqueta, clave in [("Email", "email"), ("Teléfono/celular", "telefono"), ("LinkedIn", "linkedin")]:
        if contacto.get(clave):
            lineas.append(f"{etiqueta}: {contacto[clave]}")

    titulos = {
        "resumen": "Resumen profesional",
        "experiencia": "Experiencia",
        "educacion": "Educación",
        "habilidades": "Habilidades y herramientas",
        "idiomas": "Idiomas",
        "certificaciones": "Certificaciones y logros",
    }
    for clave, titulo in titulos.items():
        contenido = perfil.get("secciones", {}).get(clave)
        if contenido:
            lineas.append(f"\n{titulo}:\n" + "\n".join(contenido))

    # Datos que la persona aportó en la plataforma y no están en el CV.
    if extras:
        adicionales = [f"{k}: {v}" for k, v in extras.items() if v and k not in ("consentimiento", "disponibilidad")]
        if adicionales:
            lineas.append("\nDatos adicionales que la persona indicó:\n" + "\n".join(adicionales))
    return "\n".join(lineas)


def _limpiar_respuesta(texto):
    texto = (texto or "").strip()
    # Algunos modelos envuelven en comillas o añaden un prefijo.
    texto = re.sub(r"^(respuesta|answer)\s*:\s*", "", texto, flags=re.I).strip()
    if len(texto) > 1 and texto[0] in "\"'“" and texto[-1] in "\"'”":
        texto = texto[1:-1].strip()
    return texto


INSTRUCCIONES_LOTE = """Eres un asistente que ayuda a una persona a responder las preguntas de una postulación de empleo en Perú.

Recibes su CV y una lista numerada de preguntas. Devuelve ÚNICAMENTE un objeto JSON válido, sin explicaciones ni bloques de código:

{"respuestas": [{"n": 1, "texto": "..."}, {"n": 2, "texto": "FALTA_DATO: qué dato hace falta"}]}

REGLAS ESTRICTAS:
1. Una entrada por pregunta, con el mismo número que se te dio.
2. Responde en primera persona, en español natural, como lo escribiría la persona.
3. Usa ÚNICAMENTE información del CV. Está terminantemente prohibido inventar datos, cifras, herramientas, experiencias o nombres que no aparezcan.
4. Si el CV no tiene la información, pon "FALTA_DATO: <qué dato hace falta>" en el texto. Es preferible pedir el dato a inventarlo.
5. Responde SOLO lo que cada pregunta pide. Si preguntan el distrito, no menciones el teléfono.
6. Máximo 400 caracteres por respuesta. Sin viñetas ni comillas envolventes.
7. No copies fragmentos del CV en crudo: redacta una frase."""


def redactar_lote(enunciados, perfil, extras=None):
    """Redacta varias respuestas en UNA sola llamada.

    Una llamada por pregunta agotaba el límite por minuto de la capa
    gratuita (cinco preguntas = cinco peticiones, más el análisis del CV y
    la adaptación). Agrupadas es una sola petición y además el modelo ve
    todas las preguntas a la vez, así que no repite lo mismo en dos.

    Devuelve {indice: (texto, falta)} o None si no hay proveedor o falla.
    """
    if not enunciados:
        return {}
    if not disponible():
        return None

    listado = "\n".join(f"{n}. {e}" for n, e in enumerate(enunciados, 1))
    prompt = (
        f"CV de la persona:\n{_cv_en_texto(perfil, extras)}\n\n"
        f"Preguntas:\n{listado}\n\n"
        "Devuelve el JSON con una respuesta por pregunta."
    )
    datos = _extraer_json(_llamar(prompt, INSTRUCCIONES_LOTE))
    if not isinstance(datos, dict) or not isinstance(datos.get("respuestas"), list):
        return None

    salida = {}
    for item in datos["respuestas"]:
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("n"))
        except (TypeError, ValueError):
            continue
        if not 1 <= n <= len(enunciados):
            continue
        texto = _limpiar_respuesta(str(item.get("texto", "")))
        if texto.upper().startswith(MARCA_FALTA):
            salida[n - 1] = ("", texto[len(MARCA_FALTA):].strip() or "este dato")
        else:
            salida[n - 1] = (texto[:480], None)
    return salida or None


INSTRUCCIONES_ANALISIS = """Eres un analizador de CVs. Recibes el texto crudo de un CV (extraído de un PDF o un Word, con el formato desordenado) y devuelves su contenido estructurado.

Devuelve ÚNICAMENTE un objeto JSON válido, sin explicaciones ni bloques de código, con esta forma exacta:

{
  "nombre": "nombre completo",
  "contacto": {"ubicacion": "Ciudad, País", "email": "", "telefono": "", "linkedin": ""},
  "perfil": ["párrafo del perfil o resumen profesional"],
  "competencias": [
    {"categoria": "Análisis & Herramientas", "items": "SPSS · Power BI · Excel Avanzado"},
    {"categoria": "Idiomas", "items": "Español (nativo) · Inglés C1"}
  ],
  "experiencia": [
    {"organizacion": "Empresa", "lugar": "Lima, PE", "cargo": "Puesto",
     "fechas": "Dic 2022 – Ago 2023", "logros": ["logro 1", "logro 2"]}
  ],
  "liderazgo": [ {misma forma que experiencia} ],
  "educacion": [
    {"organizacion": "Universidad", "lugar": "Lima, PE",
     "cargo": "Carrera en Marketing  |  Ciclo 11", "fechas": "2021 – Presente", "logros": []}
  ],
  "certificaciones": ["Entidad · Nombre de la certificación\\t2025"],
  "proyectos": ["descripción del proyecto en desarrollo"],
  "logros": ["logro destacado 1", "logro destacado 2"]
}

REGLAS:
1. Copia el contenido del CV tal como está. NO inventes, NO añadas, NO completes datos que no aparezcan.
2. Si una sección no existe en el CV, pon una lista vacía.
3. SEPARA bien cada entrada: la organización va en "organizacion", la ciudad en "lugar", el puesto o carrera en "cargo", el rango de fechas en "fechas" y los logros en "logros" como frases sueltas SIN el guion inicial.
4. "liderazgo" es para voluntariado, clubes, asociaciones y programas; el trabajo remunerado va en "experiencia".
5. En "competencias", agrupa por categoría cuando el CV las tenga ("Análisis & Herramientas:", "Idiomas:", etc.). Si no hay categorías, deja "categoria" vacío.
6. En "certificaciones", pon el año al final separado por un tabulador (\\t).
7. No incluyas el DNI, la dirección exacta ni la fecha de nacimiento aunque aparezcan.
8. Mantén los acentos y la redacción original de los logros."""


def _extraer_json(texto):
    """Saca el objeto JSON de la respuesta, aunque venga en un bloque."""
    texto = (texto or "").strip()
    texto = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto, flags=re.I | re.M).strip()
    inicio, fin = texto.find("{"), texto.rfind("}")
    if inicio == -1 or fin <= inicio:
        return None
    try:
        return json.loads(texto[inicio:fin + 1])
    except json.JSONDecodeError:
        return None


def _llamar(prompt, instrucciones, tope=2000):
    """Llamada genérica al proveedor disponible. Devuelve texto o None."""
    nombre, detalle = proveedor()
    if not nombre:
        return None
    global INSTRUCCIONES, TOPE_SALIDA
    previas, tope_previo = INSTRUCCIONES, TOPE_SALIDA
    INSTRUCCIONES, TOPE_SALIDA = instrucciones, tope
    try:
        if nombre == "ollama":
            return _con_ollama(prompt, detalle)
        if nombre == "gemini":
            return _con_gemini(prompt, os.environ["GEMINI_API_KEY"])
        return _con_groq(prompt, os.environ["GROQ_API_KEY"])
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return None
    finally:
        INSTRUCCIONES, TOPE_SALIDA = previas, tope_previo


def analizar_cv(texto_crudo):
    """Estructura el CV con el modelo. Devuelve el perfil o None.

    Sustituye al parseo por expresiones regulares, que daba resultados
    distintos según el CV viniera en PDF o en DOCX (el texto sale con
    saltos y tabulaciones diferentes y las secciones no se detectaban
    igual). El modelo lee el contenido, no el formato.
    """
    if not (texto_crudo or "").strip():
        return None
    # maxOutputTokens amplio: un CV completo en JSON es largo y el modelo
    # además razona antes de responder, del mismo presupuesto.
    salida = _llamar(f"Texto del CV:\n\n{texto_crudo[:14000]}", INSTRUCCIONES_ANALISIS, tope=6000)
    datos = _extraer_json(salida)
    if not isinstance(datos, dict):
        return None

    ENTRADAS = ("experiencia", "liderazgo", "educacion")
    LISTAS = ("perfil", "certificaciones", "proyectos", "logros")

    perfil = {"nombre": (datos.get("nombre") or "").strip()}
    contacto = datos.get("contacto") or {}
    perfil["contacto"] = {
        k: str(contacto.get(k, "") or "").strip()
        for k in ("ubicacion", "email", "telefono", "linkedin")
    }

    for clave in ENTRADAS:
        entradas = []
        for e in datos.get(clave) or []:
            if not isinstance(e, dict):
                entradas.append({"organizacion": str(e).strip()})
                continue
            logros = e.get("logros") or []
            if isinstance(logros, str):
                logros = [l for l in logros.splitlines() if l.strip()]
            entradas.append({
                "organizacion": str(e.get("organizacion") or e.get("institucion") or "").strip(),
                "lugar": str(e.get("lugar") or "").strip(),
                "cargo": str(e.get("cargo") or e.get("programa") or "").strip(),
                "fechas": str(e.get("fechas") or "").strip(),
                "logros": [re.sub(r"^\s*[-•·]\s*", "", str(l)).strip() for l in logros if str(l).strip()],
            })
        perfil[clave] = entradas

    competencias = []
    for c in datos.get("competencias") or []:
        if isinstance(c, dict):
            competencias.append({"categoria": str(c.get("categoria") or "").strip(),
                                 "items": str(c.get("items") or "").strip()})
        elif str(c).strip():
            competencias.append({"categoria": "", "items": str(c).strip()})
    perfil["competencias"] = competencias

    for clave in LISTAS:
        valor = datos.get(clave) or []
        if isinstance(valor, str):
            valor = [l for l in valor.splitlines() if l.strip()]
        perfil[clave] = [str(v).strip() for v in valor if str(v).strip()]

    # ¿Sacó algo de contenido? Si no, mejor caer al parseo por reglas.
    if not any(perfil.get(k) for k in ENTRADAS + LISTAS + ("competencias",)):
        return None

    # Vista plana para el código que redacta las respuestas del formulario.
    from harvard_template import a_secciones_planas

    perfil["secciones"] = a_secciones_planas(perfil)
    return perfil


INSTRUCCIONES_ANADIDO_ENTRADA = """Recibes un texto que una persona escribió para añadir a su CV, y lo devuelves estructurado.

Devuelve ÚNICAMENTE un objeto JSON válido, sin explicaciones ni bloques de código:

{"entradas": [{"organizacion": "", "lugar": "", "cargo": "", "fechas": "", "logros": ["", ""]}]}

REGLAS:
1. PROHIBIDO inventar. Solo reorganiza lo que la persona escribió. Si no menciona el lugar o las fechas, deja esos campos vacíos.
2. Los logros van como frases sueltas, sin el guion inicial, empezando por un verbo en pasado cuando el texto lo permita.
3. Si el texto describe varias experiencias, devuelve una entrada por cada una.
4. Mantén los acentos y el sentido original. Puedes mejorar la redacción, nunca los hechos."""


INSTRUCCIONES_ANADIDO_LINEAS = """Recibes un texto que una persona escribió para añadir a su CV, y lo devuelves limpio.

Devuelve ÚNICAMENTE un objeto JSON válido, sin explicaciones ni bloques de código:

{"lineas": ["línea 1", "línea 2"]}

REGLAS:
1. PROHIBIDO inventar. Solo reorganiza y pule lo que la persona escribió.
2. Una línea por idea. Sin viñetas ni guiones al inicio.
3. Mantén los acentos y el sentido original."""


def estructurar_anadido(texto, como_entrada):
    """Da forma al contenido que la persona añade a mano.

    `como_entrada` distingue las secciones con encabezado de dos líneas
    (experiencia, educación) de las que son texto suelto.
    Devuelve una lista, o None si no hay modelo o falla.
    """
    instrucciones = INSTRUCCIONES_ANADIDO_ENTRADA if como_entrada else INSTRUCCIONES_ANADIDO_LINEAS
    datos = _extraer_json(_llamar(f"Texto de la persona:\n\n{texto[:3000]}", instrucciones))
    if not isinstance(datos, dict):
        return None

    if como_entrada:
        entradas = []
        for e in datos.get("entradas") or []:
            if not isinstance(e, dict):
                continue
            logros = e.get("logros") or []
            if isinstance(logros, str):
                logros = [l for l in logros.splitlines() if l.strip()]
            entradas.append({
                "organizacion": str(e.get("organizacion") or "").strip(),
                "lugar": str(e.get("lugar") or "").strip(),
                "cargo": str(e.get("cargo") or "").strip(),
                "fechas": str(e.get("fechas") or "").strip(),
                "logros": [re.sub(r"^\s*[-•·]\s*", "", str(l)).strip() for l in logros if str(l).strip()],
            })
        return entradas or None

    lineas = datos.get("lineas") or []
    if isinstance(lineas, str):
        lineas = [l for l in lineas.splitlines() if l.strip()]
    return [str(l).strip() for l in lineas if str(l).strip()] or None


INSTRUCCIONES_ADAPTACION = """Adaptas un CV a una vacante concreta para que la persona destaque, SIN mentir.

Devuelve ÚNICAMENTE un objeto JSON válido, sin explicaciones ni bloques de código:

{
  "resumen": ["2 o 3 líneas de resumen profesional orientado a esta vacante"],
  "experiencia": ["líneas reordenadas, lo más relevante primero"],
  "habilidades": ["líneas reordenadas, lo que pide la vacante primero"],
  "cambios": ["qué cambiaste y por qué, en frases cortas para mostrárselo a la persona"]
}

REGLAS ABSOLUTAS:
1. PROHIBIDO inventar. No añadas herramientas, logros, empresas, cifras, títulos ni años que no estén en el CV original.
2. Adaptar significa REORDENAR y REFORMULAR lo que ya existe: poner delante lo relevante, usar las palabras del anuncio cuando describan algo que el CV ya dice.
3. El resumen puede reescribirse por completo, pero solo con hechos del CV.
4. Si la vacante pide algo que la persona NO tiene, no lo menciones. No lo inventes ni digas que lo tiene.
5. Conserva todas las experiencias del CV: reordénalas, no las borres.
6. Mantén el idioma del CV original."""


def adaptar_para_vacante(perfil, vacante):
    """Reordena y reenfoca el CV hacia una vacante. Devuelve dict o None.

    Nunca añade contenido: las instrucciones del modelo lo prohíben y el
    resultado se muestra a la persona con la lista de cambios para que
    los revise antes de usar el CV.
    """
    partes = [
        f"VACANTE: {vacante.get('titulo', '')}",
        f"Empresa: {vacante.get('empresa', '')}",
        f"Descripción: {vacante.get('descripcion', '')}",
    ]
    if vacante.get("requisitos"):
        partes.append("Requisitos: " + " | ".join(vacante["requisitos"][:12]))

    secciones = perfil.get("secciones", {})
    partes.append("\nCV ACTUAL:")
    for clave in ("resumen", "experiencia", "educacion", "habilidades", "idiomas", "certificaciones"):
        if secciones.get(clave):
            partes.append(f"\n[{clave}]\n" + "\n".join(secciones[clave]))

    datos = _extraer_json(_llamar("\n".join(partes), INSTRUCCIONES_ADAPTACION))
    if not isinstance(datos, dict):
        return None

    resultado = {"cambios": []}
    for clave in ("resumen", "experiencia", "habilidades"):
        valor = datos.get(clave)
        if isinstance(valor, str):
            valor = [l for l in valor.splitlines() if l.strip()]
        if isinstance(valor, list) and valor:
            resultado[clave] = [str(v).strip() for v in valor if str(v).strip()]
    cambios = datos.get("cambios")
    if isinstance(cambios, list):
        resultado["cambios"] = [str(c).strip() for c in cambios if str(c).strip()][:6]
    return resultado if len(resultado) > 1 else None


def redactar(enunciado, perfil, extras=None):
    """Redacta la respuesta a una pregunta.

    Devuelve (texto, falta). `falta` es la descripción del dato que hace
    falta cuando el CV no alcanza; en ese caso `texto` va vacío y quien
    llama debe preguntárselo a la persona.

    Ante cualquier fallo devuelve (None, None) para que el llamador use
    las reglas de respaldo en vez de quedarse sin respuesta.
    """
    nombre, detalle = proveedor()
    if not nombre:
        return None, None

    prompt = (
        f"CV de la persona:\n{_cv_en_texto(perfil, extras)}\n\n"
        f"Pregunta de la postulación:\n{enunciado}\n\n"
        "Redacta la respuesta siguiendo las reglas."
    )

    try:
        if nombre == "ollama":
            salida = _con_ollama(prompt, detalle)
        elif nombre == "gemini":
            salida = _con_gemini(prompt, os.environ["GEMINI_API_KEY"])
        else:
            salida = _con_groq(prompt, os.environ["GROQ_API_KEY"])
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return None, None

    salida = _limpiar_respuesta(salida)
    if not salida:
        return None, None

    if salida.upper().startswith(MARCA_FALTA):
        return "", salida[len(MARCA_FALTA):].strip() or "este dato"
    return salida[:480], None

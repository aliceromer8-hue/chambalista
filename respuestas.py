# -*- coding: utf-8 -*-
"""Redacción de respuestas a las preguntas de selección.

El CV en crudo no sirve como respuesta: a "¿qué estudias y dónde?" no se
contesta pegando la sección de educación, se contesta con una frase. Este
módulo extrae los datos del perfil y compone la respuesta.

Dos reglas que no se rompen:
- Solo se afirma lo que el CV respalda. Si algo no está (el distrito, por
  ejemplo), se pide a la persona en vez de inventarlo.
- Compromisos y consentimientos (disponibilidad, aceptar que el puesto es
  ad honorem) no se redactan solos: se le pregunta y se le explica qué
  está aceptando.
"""

import re

# Herramientas reconocidas. Sirve para cruzar lo que pide el anuncio con
# lo que el CV realmente dice, en vez de volcar la sección entera.
CATALOGO_HERRAMIENTAS = [
    "Canva", "CapCut", "Photoshop", "Illustrator", "InDesign", "Premiere Pro",
    "After Effects", "Figma", "Meta Business Suite", "Meta Ads", "Google Ads",
    "Google Analytics", "Google Colab", "Power BI", "Tableau", "Excel",
    "SPSS", "WordPress", "Mailchimp", "HubSpot", "Salesforce", "Notion",
    "Trello", "SQL", "Python", "TikTok", "Instagram", "LinkedIn Ads",
]

NIVELES = ["básico", "basico", "intermedio", "avanzado", "nativo", "experto"]


def _texto(perfil, clave):
    return " ".join(perfil.get("secciones", {}).get(clave, []))


def _limpiar(t):
    return re.sub(r"\s+", " ", t or "").strip()


# ---------------------------------------------------------------------------
# Extracción desde el CV
# ---------------------------------------------------------------------------

def _quitar_ciudad(nombre):
    """'Universidad X (USIL) Lima' -> 'Universidad X (USIL)'.

    El CV pone la ciudad en la misma línea que la institución. Si se deja,
    la respuesta queda como "estudio en Universidad X (USIL) Lima".
    """
    nombre = _limpiar(nombre)
    # Si hay paréntesis de siglas, cortar justo después.
    m = re.match(r"^(.*?\([A-ZÁÉÍÓÚÑ]{2,8}\))", nombre)
    if m:
        return m.group(1)
    # Si no, quitar una ciudad final tipo "Lima, PE" o "Miami, FL".
    return re.sub(r",?\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:,\s*[A-Z]{2})?\s*$", "", nombre).strip() or nombre


def extraer_estudios(perfil):
    """Saca carrera, casa de estudios y ciclo de la sección de educación."""
    # Se recorre línea por línea: cada entrada del CV es una línea, y
    # partir el texto unido por palabras clave cortaba nombres como
    # "San Ignacio University" justo a la mitad.
    lineas = perfil.get("secciones", {}).get("educacion", [])
    estudios = []

    for parte in lineas:
        parte = _limpiar(parte)
        if not parte:
            continue
        institucion = re.match(
            r"(.*?(?:Universidad|Instituto|University|Escuela|Politécnico)[^,\t|]*?)(?:\s{2,}|\t|,|\s+Carrera|\s+\d{4}|$)",
            parte,
        )
        carrera = re.search(r"[Cc]arrera\s+(?:en|de)\s+([^|\t\n·,]+?)(?:\s{2,}|\||\t|\d{4}|$)", parte)
        if not carrera:
            carrera = re.search(r"(?:Bachiller|Licenciatura|Egresad[oa])\s+(?:en|de)\s+([^|\t\n·,]+?)(?:\s{2,}|\||\t|\d{4}|$)", parte)
        ciclo = re.search(r"[Cc]iclo\s+(\d+)", parte)
        if institucion or carrera:
            estudios.append({
                "institucion": _quitar_ciudad(institucion.group(1)) if institucion else "",
                "carrera": _limpiar(carrera.group(1)) if carrera else "",
                "ciclo": ciclo.group(1) if ciclo else "",
                "en_curso": bool(re.search(r"presente|actualidad|actual", parte, re.I)),
            })
    return estudios


def extraer_herramientas(perfil):
    """Herramientas del CV, con su nivel cuando el CV lo declara."""
    texto = _texto(perfil, "habilidades") + " " + _texto(perfil, "resumen")
    encontradas = []
    for herramienta in CATALOGO_HERRAMIENTAS:
        patron = re.escape(herramienta).replace(r"\ ", r"\s+")
        m = re.search(patron, texto, re.I)
        if not m:
            continue
        # ¿El CV declara un nivel justo después? ("Excel Avanzado").
        # Se corta en el primer separador para no robarle el nivel al
        # siguiente ítem: sin esto, "Instagram · Idiomas: Español (nativo)"
        # dejaba a Instagram como "nativo".
        cola = re.split(r"[·\|:,;\n]", texto[m.end():m.end() + 22])[0].lower()
        nivel = next((n for n in NIVELES if n in cola), "")
        encontradas.append({"nombre": herramienta, "nivel": nivel})
    return encontradas


def herramientas_del_anuncio(enunciado):
    """Qué herramientas nombra la pregunta, para responder a esas."""
    return [h for h in CATALOGO_HERRAMIENTAS
            if re.search(re.escape(h).replace(r"\ ", r"\s+"), enunciado, re.I)]


def _lista(nombres):
    """['a','b','c'] -> 'a, b y c'"""
    nombres = [n for n in nombres if n]
    if not nombres:
        return ""
    if len(nombres) == 1:
        return nombres[0]
    return ", ".join(nombres[:-1]) + " y " + nombres[-1]


# ---------------------------------------------------------------------------
# Redacción por tipo de pregunta
# ---------------------------------------------------------------------------

def _responder_estudios(enunciado, perfil):
    estudios = extraer_estudios(perfil)
    if not estudios:
        return "", [{"clave": "estudios", "etiqueta": "¿Qué estudias y en qué universidad o instituto?", "tipo": "texto"}]

    # Si la pregunta acota el área (Marketing, Comunicaciones...), priorizar
    # la carrera que encaje; si no, la primera en curso.
    def encaja(e):
        return e["carrera"] and re.search(re.escape(e["carrera"].split()[0]), enunciado, re.I)

    elegido = next((e for e in estudios if encaja(e)), None) or \
              next((e for e in estudios if e["en_curso"]), estudios[0])

    frase = "Sí, actualmente estudio" if elegido["en_curso"] else "Estudié"
    if elegido["carrera"]:
        frase += f" {elegido['carrera']}"
    if elegido["institucion"]:
        frase += f" en {elegido['institucion']}"
    if elegido["ciclo"]:
        frase += f", cursando el ciclo {elegido['ciclo']}"
    frase += "."

    # Mencionar la segunda carrera si la hay: suma, no resta.
    otros = [e for e in estudios if e is not elegido and e["carrera"]]
    if otros:
        o = otros[0]
        frase += f" En paralelo llevo {o['carrera']}"
        if o["institucion"]:
            frase += f" en {o['institucion']}"
        frase += "."
    return frase, []


def _responder_herramientas(enunciado, perfil):
    mias = extraer_herramientas(perfil)
    if not mias:
        return "", [{"clave": "herramientas", "etiqueta": "¿Qué herramientas manejas y a qué nivel?", "tipo": "texto"}]

    pedidas = herramientas_del_anuncio(enunciado)
    nombres_mios = {h["nombre"]: h for h in mias}

    coinciden = [nombres_mios[p] for p in pedidas if p in nombres_mios]
    extras = [h for h in mias if h["nombre"] not in {c["nombre"] for c in coinciden}]

    def con_nivel(h):
        return f"{h['nombre']} ({h['nivel']})" if h["nivel"] else h["nombre"]

    partes = []
    if coinciden:
        partes.append(f"De las herramientas que mencionan, manejo {_lista([con_nivel(h) for h in coinciden])}.")
    if extras:
        encabezado = "Además trabajo con" if coinciden else "Manejo"
        partes.append(f"{encabezado} {_lista([con_nivel(h) for h in extras[:8]])}.")
    return " ".join(partes), []


def _responder_contacto(enunciado, perfil, extras):
    contacto = perfil.get("contacto", {})
    telefono = contacto.get("telefono", "")
    pide_distrito = re.search(r"distrito|residencia|d[oó]nde vives|ubicaci[oó]n", enunciado, re.I)
    # Solo mencionar el teléfono si la pregunta lo pide: a "¿en qué distrito
    # resides?" no se contesta con el número de celular.
    pide_telefono = re.search(r"celular|tel[eé]fono|n[uú]mero|whatsapp|contactarte|contacto", enunciado, re.I)
    distrito = _limpiar(extras.get("distrito", ""))

    faltantes = []
    if pide_distrito:
        # El distrito no está en el CV: se pide, no se inventa. El campo se
        # mantiene visible aunque ya esté lleno, para poder corregirlo.
        faltantes.append({
            "clave": "distrito",
            "etiqueta": "¿En qué distrito vives?",
            "tipo": "texto",
            "respondido": bool(distrito),
        })

    partes = []
    if pide_distrito and distrito:
        partes.append(f"Resido en {distrito}")
    if pide_telefono and telefono:
        partes.append(("mi celular de contacto es " if partes else "Mi celular de contacto es ") + telefono)
    texto = (", ".join(partes) + ".") if partes else ""
    return texto[0].upper() + texto[1:] if texto else "", faltantes


def _responder_disponibilidad(enunciado, extras):
    """Compromiso: se le pregunta, no se asume.

    La pregunta se devuelve siempre, respondida o no, para que la
    interfaz mantenga los botones y la persona pueda cambiar de opinión.
    """
    respuesta = extras.get("disponibilidad", "")
    lugar = ""
    m = re.search(r"en\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s]{2,25}?)\s+de\s+lunes", enunciado)
    if m:
        lugar = _limpiar(m.group(1))

    campo = {
        "clave": "disponibilidad",
        "etiqueta": f"¿Tienes disponibilidad para asistir{' a ' + lugar if lugar else ''} de lunes a viernes?",
        "tipo": "opciones",
        "opciones": ["Sí, tengo disponibilidad completa", "Sí, con algunas restricciones de horario", "No"],
        "respondido": bool(respuesta),
    }
    if not respuesta:
        return "", [campo]

    if respuesta.startswith("Sí, tengo"):
        texto = f"Sí, cuento con disponibilidad para asistir{' a ' + lugar if lugar else ''} de lunes a viernes."
    elif respuesta.startswith("Sí, con"):
        texto = (f"Sí, cuento con disponibilidad{' para ' + lugar if lugar else ''} de lunes a viernes, "
                 "coordinando el horario según mis clases.")
    else:
        texto = "Por el momento no cuento con esa disponibilidad."
    return texto, [campo]


def _responder_consentimiento(enunciado, extras):
    """Consentimiento: se le explica qué acepta y decide ella."""
    sin_pago = bool(re.search(r"ad honorem|sin remuneraci[oó]n|no remunerad", enunciado, re.I))
    aviso = ("⚠️ Ojo: al confirmar estás aceptando que estas prácticas son "
             "**sin pago**. Tu beneficio sería la experiencia, capacitación y "
             "certificación.") if sin_pago else \
            "Al confirmar aceptas las condiciones que indica la empresa."

    acepta = extras.get("consentimiento") == "acepto"
    campo = {
        "clave": "consentimiento",
        "etiqueta": "¿Confirmas que lo leíste y lo aceptas?",
        "tipo": "opciones",
        "opciones": ["Sí, confirmo y acepto", "No"],
        "aviso": aviso,
        "respondido": bool(extras.get("consentimiento")),
    }
    if not acepta:
        return "", [campo]
    return "Confirmo que he leído y comprendido las condiciones indicadas.", [campo]


# ---------------------------------------------------------------------------
# Punto de entrada
# ---------------------------------------------------------------------------

# Catálogo de "killer questions" que aparecen en los portales peruanos
# (Computrabajo, Bumeran, Indeed). Recogidas de formularios reales.
# Sirve para dos cosas: enriquecer el contexto que se le da al modelo y
# resolver directamente las que tienen respuesta en los datos guardados.
PREGUNTAS_FRECUENTES = {
    "documento": [
        "¿Cuál es tu número de DNI?", "Indica tu DNI", "Número de documento de identidad",
    ],
    "ubicacion": [
        "¿En qué distrito resides?", "Menciona tu distrito de residencia",
        "¿Cuánto tiempo demoras en llegar a nuestra sede?", "¿Vives cerca de…?",
        "¿Tienes disponibilidad para trasladarte a…?",
    ],
    "contacto": [
        "¿A qué número podemos contactarte por WhatsApp?", "Indica tu celular",
        "Confírmanos tu usuario de Instagram / TikTok", "¿Cuál es tu correo?",
    ],
    "estudios": [
        "¿Qué carrera cursas y en qué ciclo?", "¿En qué universidad o instituto estudias?",
        "¿Ya egresaste?", "¿Cuentas con grado de bachiller?",
        "¿Tienes certificado de estudios?", "¿Cuál es tu año de egreso?",
    ],
    "experiencia": [
        "¿Cuántos años de experiencia tienes en el puesto?",
        "Describe tu experiencia más relevante para este cargo",
        "¿Has trabajado antes en el rubro?", "¿Por qué te interesa este puesto?",
        "¿Por qué deberíamos contratarte?", "Cuéntanos sobre ti",
        "¿Cuál ha sido tu mayor logro profesional?",
    ],
    "herramientas": [
        "¿Qué herramientas manejas y a qué nivel?", "¿Manejas Excel? ¿Qué nivel?",
        "¿Dominas algún ERP o CRM?", "¿Qué nivel de inglés tienes?",
    ],
    "disponibilidad": [
        "¿Cuentas con disponibilidad inmediata?",
        "¿Tienes disponibilidad para trabajar de lunes a sábado?",
        "¿Puedes trabajar en horario rotativo?", "¿Aceptas trabajo presencial?",
        "¿Tienes disponibilidad para viajar?", "¿Desde cuándo podrías empezar?",
    ],
    "salario": [
        "¿Cuál es tu pretensión salarial?", "Indica tu expectativa salarial en soles",
        "¿Estás de acuerdo con el sueldo indicado?",
    ],
    "requisitos": [
        "¿Cuentas con licencia de conducir?", "¿Tienes movilidad propia?",
        "¿Cuentas con RUC?", "¿Tienes certificado de antecedentes penales?",
        "¿Estás afiliado a algún sistema de pensiones?", "¿Cuentas con carné de sanidad?",
    ],
    "consentimiento": [
        "Confirmo que las prácticas son ad honorem",
        "Acepto el tratamiento de mis datos personales",
        "Declaro que la información brindada es verídica",
        "Confirmo haber leído la descripción del puesto",
    ],
}


def _clave_para(descripcion):
    """Nombre de campo estable a partir de lo que el modelo dice que falta."""
    d = (descripcion or "").lower()
    for clave, patron in [
        ("distrito", r"distrito|residencia|d[oó]nde vive"),
        ("redes", r"instagram|tiktok|facebook|usuario|red social|@"),
        ("whatsapp", r"whatsapp"),
        ("edad", r"edad|a[ñn]os"),
        ("sueldo", r"sueldo|salario|pretensi[oó]n|remuneraci[oó]n"),
    ]:
        if re.search(patron, d):
            return clave
    return re.sub(r"\W+", "_", d)[:24] or "dato"


def _desde_datos_guardados(enunciado, extras):
    """¿La persona ya guardó este dato? Entonces se responde al momento.

    Evita una llamada al modelo y hace que el DNI, el distrito o la
    pretensión salarial se completen sin preguntar nada.
    """
    try:
        import datos_personales
    except ImportError:
        return None

    clave, valor = datos_personales.valor_para_campo(enunciado)
    if not clave:
        return None
    # `extras` (lo que escribió en esta sesión) manda sobre lo guardado.
    valor = _limpiar(extras.get(clave, "")) or valor
    if not valor:
        return None

    plantillas = {
        "dni": f"Mi DNI es {valor}.",
        "fecha_nacimiento": f"Mi fecha de nacimiento es {valor}.",
        "distrito": f"Resido en {valor}.",
        "direccion": f"Mi dirección es {valor}.",
        "pretension": f"Mi pretensión salarial es de S/ {valor}.",
        "disponibilidad": f"Mi disponibilidad para empezar es {valor}.",
        "redes": f"Mi usuario es {valor}.",
        "licencia": f"Licencia de conducir: {valor}.",
        "movilidad": f"Movilidad propia: {valor}.",
    }
    return plantillas.get(clave, f"{valor}.")


def _con_ia(enunciado, perfil, extras):
    """Intenta redactar con el modelo. Devuelve None si no hay o falla."""
    try:
        import redactor_ia
    except ImportError:
        return None
    texto, falta = redactor_ia.redactar(enunciado, perfil, extras)
    if texto is None and falta is None:
        return None  # sin proveedor o error: que decidan las reglas

    if falta:
        clave = _clave_para(falta)
        ya = _limpiar(extras.get(clave, ""))
        if ya:
            # La persona ya lo aportó: reintentar con ese dato en el contexto.
            texto2, falta2 = redactor_ia.redactar(enunciado, perfil, extras)
            if texto2:
                return texto2, [{"clave": clave, "etiqueta": falta.capitalize(),
                                 "tipo": "texto", "respondido": True}]
        return "", [{"clave": clave, "etiqueta": falta.capitalize(),
                     "tipo": "texto", "respondido": bool(ya)}]
    return texto, []


PATRON_CONSENTIMIENTO = r"confirmo|he le[ií]do|acepto|declaro|ad honorem|sin remuneraci[oó]n"
PATRON_DISPONIBILIDAD = r"disponibilidad|disponible|lunes a viernes|horario|movilizarte"


def es_decision_personal(enunciado):
    """¿Es una pregunta que solo puede responder la persona?

    Aceptar condiciones o comprometer disponibilidad no se delega: ni a las
    reglas ni al modelo. Se usa para excluirlas del lote enviado a la IA.
    """
    return bool(re.search(PATRON_CONSENTIMIENTO, enunciado, re.I)
                or re.search(PATRON_DISPONIBILIDAD, enunciado, re.I))


def redactar_varias(enunciados, perfil, extras=None):
    """Redacta varias preguntas de golpe. Devuelve {posicion: (texto, faltan)}.

    Las posiciones sin respuesta del modelo se devuelven como (None, None)
    para que quien llame use las reglas de respaldo en esa pregunta.
    """
    if not enunciados:
        return {}
    try:
        import redactor_ia
    except ImportError:
        return {}

    lote = redactor_ia.redactar_lote(enunciados, perfil, extras)
    if not lote:
        return {}

    salida = {}
    for pos, (texto, falta) in lote.items():
        if falta:
            clave = _clave_para(falta)
            salida[pos] = ("", [{"clave": clave, "etiqueta": falta.capitalize(),
                                 "tipo": "texto", "respondido": bool(_limpiar((extras or {}).get(clave, "")))}])
        else:
            salida[pos] = (texto, [])
    return salida


def redactar(clase, enunciado, perfil, extras=None):
    """Devuelve (texto_propuesto, datos_que_faltan) para una pregunta.

    `extras` trae lo que la persona ya respondió en la plataforma
    (distrito, disponibilidad, consentimiento, redes...).

    Orden: primero las guardas que NO se delegan a ningún modelo
    (consentimiento y disponibilidad), luego la IA si está configurada, y
    como respaldo las reglas escritas a mano.
    """
    extras = extras or {}

    # Estas dos no las contesta un modelo ni la plataforma: son decisiones
    # de la persona (aceptar condiciones, comprometer su tiempo).
    if re.search(r"confirmo|he le[ií]do|acepto|declaro|ad honorem|sin remuneraci[oó]n", enunciado, re.I):
        return _responder_consentimiento(enunciado, extras)
    if re.search(r"disponibilidad|disponible|lunes a viernes|horario|movilizarte", enunciado, re.I):
        return _responder_disponibilidad(enunciado, extras)

    # Datos que la persona guardó una vez: se responden al instante, sin
    # gastar una llamada al modelo ni volver a preguntárselos.
    guardado = _desde_datos_guardados(enunciado, extras)
    if guardado:
        return guardado, []

    con_ia = _con_ia(enunciado, perfil, extras)
    if con_ia is not None:
        return con_ia

    # Respaldo sin IA: reglas por tipo de pregunta.
    if clase == "estudios":
        return _responder_estudios(enunciado, perfil)
    if clase == "herramientas":
        return _responder_herramientas(enunciado, perfil)
    if clase == "contacto":
        return _responder_contacto(enunciado, perfil, extras)
    if clase == "experiencia":
        resumen = _limpiar(_texto(perfil, "resumen"))
        return (resumen[:450], []) if resumen else ("", [])
    return "", []

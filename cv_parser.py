# -*- coding: utf-8 -*-
"""Extracción de texto y parseo heurístico del CV.

Soporta PDF (pdfplumber) y DOCX (python-docx). El parseo es heurístico:
no usa IA, busca patrones comunes en CVs en español e inglés. La persona
siempre revisa y corrige los datos extraídos en el paso 2 del wizard.
"""

import re
from pathlib import Path

# ───────────────────────────────────────────────────────────────────────
# LA PLANTILLA
# ───────────────────────────────────────────────────────────────────────
# Esta es la taxonomía del CV, sacada midiendo el documento de referencia.
# El generador (harvard_template.py) la pinta y el parser la produce; si
# las dos no coinciden, el CV sale roto. Está escrita aquí porque es el
# contrato entre ambos.
#
# CABECERA
#     Nombre Apellido                                     centrado, negrita, 18 pt
#     Ciudad · correo · teléfono · linkedin               centrado, normal, 9.5 pt
#     ────────────────────────────────────────────        línea divisoria
#
# CADA SECCIÓN
#     TÍTULO EN MAYÚSCULAS                                negrita, 11 pt
#     ────────────────────────────────────────────        línea divisoria
#     (contenido, según el tipo de la sección)
#
# Las divisorias NO son un borde del título: son párrafos vacíos con
# borde inferior. Por eso hay nueve y no ocho.
#
# LOS CINCO TIPOS DE CONTENIDO
#
#   entradas        → experiencia, liderazgo, educación
#       Organización                             Ciudad, PE      ← org NEGRITA, lugar normal
#       Cargo o programa                    Mes 2022 – Mes 2023  ← los dos normales
#       Logro uno                                                ← viñeta
#       Logro dos                                                ← viñeta
#
#       La primera línea lleva QUIÉN y DÓNDE; la segunda, QUÉ HACÍAS y
#       CUÁNDO. Lo que va pegado al margen derecho está alineado con una
#       tabulación, no con espacios. Debajo, las funciones en viñetas.
#
#   competencias    → COMPETENCIAS CLAVE
#       Categoría: item · item · item                    ← categoría NEGRITA, resto normal
#
#   lineas_fecha    → CERTIFICACIONES RELEVANTES
#       Entidad · Nombre del certificado                     2025    ← todo negrita
#
#   texto           → PERFIL PROFESIONAL
#       Párrafo corrido, sin negrita.
#
#   texto_negrita   → PROYECTO EN DESARROLLO
#       Etiqueta: descripción                            ← etiqueta NEGRITA, resto normal
#
#   vinetas         → LOGROS DESTACADOS
#       Una línea por logro, con viñeta, sin negrita.
#
# QUÉ VA EN NEGRITA (y nada más)
#     · el nombre de la persona
#     · los títulos de sección
#     · la organización, no el cargo ni las fechas
#     · la categoría de una competencia, no sus items
#     · las certificaciones enteras
#     · la etiqueta de un proyecto
#
# Si una sección no encaja en ninguna de las ocho, NO se descarta ni se
# mete a la fuerza en otra: se conserva con su propio título y se pinta
# con el tipo que mejor le cuadre. Un CV puede traer PUBLICACIONES o
# REFERENCIAS y tienen que salir con el mismo formato que el resto.
# ───────────────────────────────────────────────────────────────────────

# Los títulos que se reconocen, en el orden en que se prueban. El orden
# importa: "certificaciones" tiene que probarse antes que "cursos", y
# "liderazgo" antes que "experiencia", o una se come a la otra.
#
# Antes esta tabla tenía seis entradas y "certificaciones" incluía
# "logros", "proyectos" y "voluntariado". El resultado: las cuatro
# secciones caían en la misma clave, la última pisaba a las anteriores, y
# un CV con certificados de verdad los perdía todos.
SECCIONES = {
    "perfil": [
        "perfil profesional", "perfil", "resumen profesional", "resumen",
        "sobre mí", "sobre mi", "acerca de mí", "objetivo profesional", "objetivo",
        "summary", "professional summary", "profile", "about me",
    ],
    "competencias": [
        "competencias clave", "competencias", "habilidades", "aptitudes",
        "conocimientos", "herramientas", "skills", "technical skills", "core skills",
    ],
    "idiomas": ["idiomas", "languages"],
    "liderazgo": [
        "liderazgo & voluntariado", "liderazgo y voluntariado", "liderazgo",
        "voluntariado", "actividades extracurriculares", "extracurriculares",
        "leadership", "volunteering",
    ],
    "experiencia": [
        "experiencia profesional", "experiencia laboral", "experiencia",
        "trayectoria", "work experience", "professional experience",
        "employment history",
    ],
    "educacion": [
        "educación", "educacion", "formación académica", "formacion academica",
        "formación", "estudios", "education", "academic background",
    ],
    "certificaciones": [
        "certificaciones relevantes", "certificaciones", "certificados",
        "cursos y certificaciones", "cursos", "certifications", "courses",
    ],
    "proyectos": [
        "proyecto en desarrollo", "proyectos en desarrollo", "proyectos",
        "proyecto", "projects", "portafolio",
    ],
    "logros": [
        "logros destacados", "logros", "reconocimientos", "premios",
        "achievements", "awards", "honors",
    ],
}

# Qué tipo de contenido lleva cada sección. Debe coincidir con SECCIONES
# de harvard_template.py; si no, el generador pinta otra cosa.
TIPO_DE_SECCION = {
    "perfil": "texto",
    "competencias": "competencias",
    "idiomas": "competencias",
    "experiencia": "entradas",
    "liderazgo": "entradas",
    "educacion": "entradas",
    "certificaciones": "lineas_fecha",
    "proyectos": "texto_negrita",
    "logros": "vinetas",
}

# Separador de las dos columnas. En DOCX es una tabulación de verdad; al
# extraer un PDF se convierte en un hueco de espacios, así que valen los dos.
COLUMNAS = re.compile(r"\t+|\s{3,}")

# Lo que hace que la parte derecha parezca una fecha y no un lugar.
PARECE_FECHA = re.compile(
    r"(19|20)\d{2}|presente|actualidad|\bactual\b"
    r"|\b(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)\b"
    r"|\b(jan|apr|aug|dec)\b", re.I)

# Datos que los portales suelen pedir y casi nunca están en el CV.
# La plataforma NO los completa: solo muestra la mini-alerta.
DATOS_SENSIBLES_PORTAL = [
    ("dni", r"\b\d{8}\b", "DNI / documento de identidad"),
    ("fecha_nacimiento", r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", "Fecha de nacimiento"),
    ("direccion", r"\b(av\.|avenida|jr\.|jirón|jiron|calle|mz\.|urb\.)\b", "Dirección exacta"),
    ("pretension", r"(pretensi[oó]n salarial|expectativa salarial|s/\.?\s*\d)", "Pretensión salarial"),
]


def extraer_texto(ruta):
    """Devuelve el texto plano del archivo (PDF o DOCX)."""
    ruta = Path(ruta)
    ext = ruta.suffix.lower()
    if ext == ".pdf":
        import pdfplumber
        with pdfplumber.open(ruta) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages)
    if ext in (".docx", ".doc"):
        from docx import Document
        doc = Document(ruta)
        partes = [p.text for p in doc.paragraphs]
        for tabla in doc.tables:
            for fila in tabla.rows:
                partes.extend(celda.text for celda in fila.cells)
        return "\n".join(partes)
    if ext == ".txt":
        return ruta.read_text(encoding="utf-8", errors="ignore")
    raise ValueError(f"Formato no soportado: {ext}. Sube un PDF o DOCX.")


def _detectar_seccion(linea):
    """Si la línea es un título de sección, devuelve (clave, título original).

    Devuelve (None, título) cuando parece un título pero no es ninguno de
    los conocidos: esa sección se conserva aparte con su propio nombre en
    vez de tirarse o meterse a la fuerza en otra.
    """
    bruta = linea.strip()
    if not bruta or len(bruta) > 46 or "\t" in bruta:
        return (None, None)

    limpia = re.sub(r"[^\wáéíóúñü& ]", " ", bruta.lower())
    limpia = re.sub(r"\s+", " ", limpia).strip()
    if not limpia:
        return (None, None)

    for clave, titulos in SECCIONES.items():
        for titulo in titulos:
            if limpia == titulo:
                return (clave, bruta)
    # Coincidencia por prefijo, solo si no deja cola larga: "EXPERIENCIA
    # PROFESIONAL" sí, pero "Experiencia liderando equipos de 5" no.
    for clave, titulos in SECCIONES.items():
        for titulo in titulos:
            if limpia.startswith(titulo) and len(limpia) - len(titulo) <= 12:
                return (clave, bruta)

    # ¿Parece un título aunque no lo conozcamos? En este formato los
    # títulos van en mayúsculas y no llevan puntuación final.
    letras = [c for c in bruta if c.isalpha()]
    if letras and sum(c.isupper() for c in letras) / len(letras) > .8 \
            and not bruta.endswith((".", ":", ",")) and len(bruta.split()) <= 5:
        return (None, bruta)
    return (None, None)


def _partir_columnas(linea):
    """('izquierda', 'derecha') si la línea tiene dos columnas; si no, (linea, '')."""
    trozos = COLUMNAS.split(linea.strip(), maxsplit=1)
    if len(trozos) == 2 and trozos[0].strip() and trozos[1].strip():
        return trozos[0].strip(), trozos[1].strip()
    return linea.strip(), ""


def _parsear_entradas(lineas):
    """Agrupa las líneas sueltas en entradas de dos cabeceras + logros.

    El patrón del formato, que es lo que hay que reconstruir:

        Organización                    Ciudad, PE     ← cabecera 1
        Cargo                      Dic 2022 – Ago 2023 ← cabecera 2
        Logro                                          ← funciones
        Logro

    Sin esto, cada línea llegaba suelta al generador, que la trataba como
    una organización con su propia negrita. De ahí que el CV convertido
    saliera con la ciudad, el puesto y las fechas apilados y todo en
    negrita: no era un problema de estilos, era que se había perdido la
    estructura antes de llegar a pintarla.
    """
    def vacia():
        return {"organizacion": "", "lugar": "", "cargo": "", "fechas": "", "logros": []}

    entradas = []
    i = 0
    while i < len(lineas):
        izq, der = _partir_columnas(lineas[i])

        # ¿La línea siguiente es una cabecera-2? Se reconoce porque su
        # columna derecha son fechas. Es la señal más fiable que hay:
        # el cargo puede parecer cualquier cosa, pero "Dic 2022 – Ago
        # 2023" alineado a la derecha solo aparece ahí.
        sig = _partir_columnas(lineas[i + 1]) if i + 1 < len(lineas) else ("", "")
        sig_es_cabecera = bool(sig[1]) and bool(PARECE_FECHA.search(sig[1]))

        if sig_es_cabecera:
            # Esta línea es la cabecera-1. Puede traer lugar o no: hay
            # CVs que ponen la ciudad y otros que solo el empleador.
            e = vacia()
            e["organizacion"], e["lugar"] = izq, ("" if PARECE_FECHA.search(der) else der)
            e["cargo"], e["fechas"] = sig
            entradas.append(e)
            i += 2
            continue

        if der:
            # Una sola línea con dos columnas. Si la derecha son fechas,
            # es una entrada compacta (organización + cuándo); si no, es
            # organización + lugar y el cargo no está.
            e = vacia()
            e["organizacion"] = izq
            if PARECE_FECHA.search(der):
                e["fechas"] = der
            else:
                e["lugar"] = der
            entradas.append(e)
            i += 1
            continue

        # Línea sin columnas: logro de la entrada abierta. Si no hay
        # ninguna abierta todavía, es una organización suelta.
        if entradas:
            entradas[-1]["logros"].append(izq)
        else:
            e = vacia()
            e["organizacion"] = izq
            entradas.append(e)
        i += 1
    return entradas


def _parsear_competencias(lineas):
    """'Categoría: item · item' → {categoria, items}. Sin categoría, todo items."""
    salida = []
    for linea in lineas:
        cat, sep, items = linea.partition(":")
        if sep and items.strip() and len(cat) < 40:
            salida.append({"categoria": cat.strip(), "items": items.strip()})
        else:
            salida.append({"categoria": "", "items": linea.strip()})
    return salida


def _parsear_lineas_fecha(lineas):
    """Certificaciones: se normaliza el separador a una tabulación."""
    salida = []
    for linea in lineas:
        izq, der = _partir_columnas(linea)
        salida.append(f"{izq}\t{der}" if der else izq)
    return salida


def _armar_seccion(clave, lineas):
    """Convierte las líneas crudas al modelo que espera el generador."""
    lineas = [l for l in (x.strip() for x in lineas) if l]
    if not lineas:
        return None
    tipo = TIPO_DE_SECCION.get(clave, "vinetas")
    if tipo == "entradas":
        return _parsear_entradas(lineas)
    if tipo == "competencias":
        return _parsear_competencias(lineas)
    if tipo == "lineas_fecha":
        return _parsear_lineas_fecha(lineas)
    return lineas          # texto, texto_negrita y vinetas van tal cual


def _extraer_contacto(texto):
    contacto = {}
    m = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", texto)
    if m:
        contacto["email"] = m.group(0)
    # El prefijo puede venir como +51, (+51) o (51). Se conserva tal cual
    # lo escribió la persona: es su dato, no nos toca reformatearlo.
    m = re.search(r"(\(\s*\+?51\s*\)[\s-]?|\+51[\s-]?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b", texto)
    if m:
        contacto["telefono"] = m.group(0).strip()
    m = re.search(r"linkedin\.com/in/[\w-]+", texto, re.I)
    if m:
        contacto["linkedin"] = m.group(0)

    # La ciudad. Se busca solo en las primeras líneas, que es donde va la
    # cabecera: más abajo hay ciudades de cada trabajo y se cogería la
    # equivocada. Sin esto se perdía "Lima, Perú" de la línea de contacto.
    cabecera = "\n".join(texto.splitlines()[:6])
    m = re.search(
        r"\b(Lima|Arequipa|Trujillo|Chiclayo|Piura|Cusco|Huancayo|Tacna|Iquitos|Callao"
        r"|Chimbote|Juliaca|Ica|Pucallpa|Cajamarca|Ayacucho|Puno|Tarapoto)"
        r"\s*,?\s*(Per[uú]|PE)?\b", cabecera, re.I)
    if m:
        ciudad = m.group(1).capitalize()
        contacto["ubicacion"] = f"{ciudad}, Perú" if m.group(2) else ciudad
    return contacto


def _extraer_nombre(lineas):
    """Heurística: el nombre suele ser la primera línea corta sin @ ni números."""
    for linea in lineas[:6]:
        limpia = linea.strip()
        if not limpia or "@" in limpia or re.search(r"\d", limpia):
            continue
        palabras = limpia.split()
        if 2 <= len(palabras) <= 5 and all(p[0].isupper() for p in palabras if p[0].isalpha()):
            return limpia.title() if limpia.isupper() else limpia
    return ""


def detectar_datos_faltantes(texto):
    """Devuelve la lista de datos que los portales pedirán y no están en el CV.

    No intenta extraerlos ni guardarlos: solo alimenta la mini-alerta del
    paso de postulación para que la persona sepa qué completar a mano.
    """
    faltantes = []
    for clave, patron, etiqueta in DATOS_SENSIBLES_PORTAL:
        if not re.search(patron, texto, re.I):
            faltantes.append({"clave": clave, "etiqueta": etiqueta})
    return faltantes


def extraer_texto_de_memoria(contenido, extension):
    """Igual que `extraer_texto` pero sobre bytes, sin escribir en disco.

    La versión web procesa los CV en memoria: no debe dejar archivos de
    otras personas en el servidor.
    """
    import io

    flujo = io.BytesIO(contenido)
    ext = extension.lower()
    if ext == ".pdf":
        import pdfplumber
        with pdfplumber.open(flujo) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages)
    if ext in (".docx", ".doc"):
        from docx import Document
        doc = Document(flujo)
        partes = [p.text for p in doc.paragraphs]
        for tabla in doc.tables:
            for fila in tabla.rows:
                partes.extend(celda.text for celda in fila.cells)
        return "\n".join(partes)
    if ext == ".txt":
        return contenido.decode("utf-8", errors="ignore")
    raise ValueError(f"Formato no soportado: {ext}")


def parsear_cv_desde_memoria(contenido, extension):
    """Parseo completo sobre bytes. Misma lógica que `parsear_cv`."""
    texto = extraer_texto_de_memoria(contenido, extension)
    return _parsear_texto(texto)


def parsear_cv(ruta):
    """Parsea el CV y devuelve un dict con los campos del perfil.

    Primero se intenta con el modelo: el parseo por expresiones regulares
    daba resultados distintos según el CV llegara en PDF o en DOCX, porque
    el texto sale con saltos y tabulaciones diferentes y los títulos de
    sección no se detectaban igual. El modelo lee el contenido y no
    depende del formato. Si no hay modelo o falla, se usan las reglas.
    """
    return _parsear_texto(extraer_texto(ruta))


def _parsear_texto(texto):
    """Núcleo compartido: del texto crudo al perfil estructurado."""
    lineas = [l.rstrip() for l in texto.splitlines()]

    try:
        import redactor_ia

        con_ia = redactor_ia.analizar_cv(texto)
    except ImportError:
        con_ia = None

    if con_ia and con_ia.get("secciones"):
        con_ia["datos_faltantes"] = detectar_datos_faltantes(texto)
        con_ia["analizado_con"] = "ia"
        # El modelo puede no dar con el contacto; las regex son fiables ahí.
        detectado = _extraer_contacto(texto)
        for clave, valor in detectado.items():
            if not con_ia["contacto"].get(clave):
                con_ia["contacto"][clave] = valor
        if not con_ia.get("nombre"):
            con_ia["nombre"] = _extraer_nombre(lineas)
        return con_ia

    perfil = {
        "nombre": _extraer_nombre(lineas),
        "contacto": _extraer_contacto(texto),
        "secciones_extra": [],
        "datos_faltantes": detectar_datos_faltantes(texto),
        "analizado_con": "reglas",
    }

    # Se recorre el CV guardando (clave, título, líneas) por sección. Se
    # acumula en lugar de asignar directamente porque un CV puede repetir
    # un título —"CURSOS" y "CERTIFICACIONES"— y antes el segundo borraba
    # al primero en silencio.
    bloques = []
    actual_clave, actual_titulo, buffer = None, None, []

    def cerrar():
        if buffer and (actual_clave or actual_titulo):
            bloques.append((actual_clave, actual_titulo, list(buffer)))

    for linea in lineas:
        clave, titulo = _detectar_seccion(linea)
        if titulo:                       # empieza una sección nueva
            cerrar()
            actual_clave, actual_titulo, buffer = clave, titulo, []
        elif actual_titulo is not None and linea.strip():
            buffer.append(linea)
    cerrar()

    for clave, titulo, lineas_bloque in bloques:
        contenido = _armar_seccion(clave or "logros", lineas_bloque)
        if not contenido:
            continue
        if clave:
            # Los idiomas son una competencia más, no una sección aparte.
            destino = "competencias" if clave == "idiomas" else clave
            if destino in perfil:
                perfil[destino] = list(perfil[destino]) + list(contenido)
            else:
                perfil[destino] = contenido
        else:
            # Sección que no conocemos: se conserva con su propio título.
            perfil["secciones_extra"].append({"titulo": titulo, "lineas": lineas_bloque})

    if not perfil["secciones_extra"]:
        del perfil["secciones_extra"]
    return perfil

# -*- coding: utf-8 -*-
"""Extracción de texto y parseo heurístico del CV.

Soporta PDF (pdfplumber) y DOCX (python-docx). El parseo es heurístico:
no usa IA, busca patrones comunes en CVs en español e inglés. La persona
siempre revisa y corrige los datos extraídos en el paso 2 del wizard.
"""

import re
from pathlib import Path

SECCIONES = {
    "experiencia": [
        "experiencia profesional", "experiencia laboral", "experiencia",
        "work experience", "professional experience", "employment history",
    ],
    "educacion": [
        "educación", "educacion", "formación académica", "formacion academica",
        "estudios", "education", "academic background",
    ],
    "habilidades": [
        "habilidades", "competencias", "skills", "conocimientos",
        "herramientas", "technical skills", "aptitudes",
    ],
    "idiomas": ["idiomas", "languages"],
    "resumen": [
        "resumen profesional", "resumen", "perfil profesional", "perfil",
        "sobre mí", "sobre mi", "summary", "profile", "about me", "objetivo",
    ],
    "certificaciones": [
        "certificaciones", "certificados", "certifications", "cursos",
        "logros", "achievements", "proyectos", "projects", "voluntariado",
    ],
}

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
    """Si la línea parece un título de sección, devuelve su clave."""
    limpia = re.sub(r"[^\wáéíóúñü ]", "", linea.lower()).strip()
    if not limpia or len(limpia) > 40:
        return None
    for clave, titulos in SECCIONES.items():
        for titulo in titulos:
            if limpia == titulo or limpia.startswith(titulo):
                return clave
    return None


def _extraer_contacto(texto):
    contacto = {}
    m = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", texto)
    if m:
        contacto["email"] = m.group(0)
    m = re.search(r"(\+?51[\s-]?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b", texto)
    if m:
        contacto["telefono"] = m.group(0).strip()
    m = re.search(r"linkedin\.com/in/[\w-]+", texto, re.I)
    if m:
        contacto["linkedin"] = m.group(0)
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
        "secciones": {},
        "datos_faltantes": detectar_datos_faltantes(texto),
        "analizado_con": "reglas",
    }

    actual = None
    buffer = []
    for linea in lineas:
        clave = _detectar_seccion(linea)
        if clave:
            if actual and buffer:
                perfil["secciones"][actual] = [l for l in buffer if l.strip()]
            actual, buffer = clave, []
        elif actual is not None:
            buffer.append(linea)
    if actual and buffer:
        perfil["secciones"][actual] = [l for l in buffer if l.strip()]

    return perfil

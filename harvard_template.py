# -*- coding: utf-8 -*-
"""Generador del CV en formato Harvard (.docx) y su vista previa.

La especificación es la plantilla de la oficina de carreras de Harvard,
no una aproximación. Lo que la define:

    UNA SOLA COLUMNA, orden cronológico inverso, sin foto, sin colores,
    sin tablas ni iconos. Serif (Times New Roman) a 10–12 pt. Todo eso
    no es estética: es lo que hace que un filtro automático lo lea sin
    equivocarse.

ESTRUCTURA

    Nombre Apellido                                   centrado, 18 pt, negrita
    Ciudad · correo · teléfono · linkedin             centrado, 9.5 pt
    ─────────────────────────────────────────────

    TÍTULO DE SECCIÓN                                 11 pt, negrita, versales
    ─────────────────────────────────────────────

    ORGANIZACIÓN                          Ciudad, PE  org en VERSALES negrita
    Cargo                        Mes Año – Mes Año    cargo en cursiva
    • Logro                                           viñeta
    • Logro

ORDEN DE SECCIONES

    Harvard: cabecera · EDUCATION · EXPERIENCE · LEADERSHIP & ACTIVITIES
    · SKILLS & INTERESTS. Educación primero porque para un estudiante es
    el dato que decide; habilidades al final porque es material de apoyo.

QUÉ VA EN NEGRITA, Y NADA MÁS

    el nombre · los títulos de sección · la organización · la categoría
    de una competencia · la entidad de un certificado · la etiqueta de un
    proyecto.

    NO van en negrita: la ciudad, el cargo (va en cursiva), las fechas,
    los logros, los items de una competencia ni el año de un certificado.

GEOMETRÍA

    A4 con márgenes de 0.75". La columna derecha se alinea con una
    tabulación derecha calculada al ancho del texto, para que las
    ciudades y las fechas terminen justo donde terminan las divisorias.
    Las divisorias son párrafos vacíos con borde inferior, no bordes del
    título: por eso hay una más que secciones.

El perfil se estructura por entradas (no por líneas sueltas) para poder
reproducir los encabezados de dos columnas. La taxonomía completa, con
qué va en cada línea, está en cv_parser.py, que es quien la produce.
"""

import html
import re
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, Twips

FUENTE = "Times New Roman"

# Geometría de la página, en twips (1440 por pulgada).
#
# A4 porque es lo que se imprime y se lee en Perú, y márgenes de 0.75",
# que es lo que pide la plantilla de Harvard.
ANCHO_A4 = 11906
ALTO_A4 = 16838
MARGEN = 1080                       # 0.75 pulgadas

# La tabulación derecha se CALCULA, no se fija a mano.
#
# Antes era un 9026 medido del CV de referencia. El problema: ese número
# dejaba las ciudades y las fechas 1.27 cm antes del margen, mientras que
# las líneas divisorias —que son bordes de párrafo— sí llegaban hasta el
# final. El resultado es que las líneas sobresalían por la derecha de todo
# lo demás, que es lo que se ve como "los subtítulos no están alineados".
#
# Derivándola del ancho de texto, la columna derecha termina exactamente
# donde terminan las divisorias, pase lo que pase con el tamaño de página.
TAB_DERECHA = Twips(ANCHO_A4 - 2 * MARGEN)

PT_NOMBRE = 18
PT_CONTACTO = 9.5
PT_SECCION = 11
PT_ENTRADA = 10.5
PT_CUERPO = 10.5

# Orden y títulos de las secciones, tal como aparecen en el CV original.
# El orden es el de la plantilla de Harvard, no uno cualquiera.
#
# Harvard ordena: cabecera · EDUCATION · EXPERIENCE · LEADERSHIP &
# ACTIVITIES · SKILLS & INTERESTS. Las dos decisiones que más se notan y
# que antes teníamos al revés:
#
#   EDUCACIÓN VA PRIMERO. Para alguien que estudia o acaba de egresar,
#   la carrera y el ciclo son el dato que decide si pasa el filtro. Un
#   reclutador de prácticas mira eso antes que nada.
#
#   HABILIDADES VA AL FINAL. Es material de apoyo: confirma lo que la
#   experiencia ya demostró. Ponerlo arriba empuja la experiencia hacia
#   abajo y hace que el CV se lea como una lista de herramientas.
#
# PERFIL es una desviación consciente: la plantilla de Harvard no lleva
# resumen, pero en Perú se espera y quitarlo sorprendería a la persona.
# Se queda arriba, que es donde tiene sentido si existe.
SECCIONES = [
    ("perfil", "PERFIL PROFESIONAL", "texto"),
    ("educacion", "EDUCACIÓN", "entradas"),
    ("experiencia", "EXPERIENCIA PROFESIONAL", "entradas"),
    ("liderazgo", "LIDERAZGO Y ACTIVIDADES", "entradas"),
    ("proyectos", "PROYECTO EN DESARROLLO", "texto_negrita"),
    ("certificaciones", "CERTIFICACIONES", "lineas_fecha"),
    ("logros", "LOGROS DESTACADOS", "vinetas"),
    ("competencias", "HABILIDADES E INTERESES", "competencias"),
]

# Claves del modelo plano antiguo -> claves del modelo estructurado, para
# seguir aceptando perfiles que vengan del parseo por reglas.
EQUIVALENCIAS = {
    "resumen": "perfil",
    "habilidades": "competencias",
    "idiomas": "competencias",
}


# ---------------------------------------------------------------------------
# Normalización del perfil
# ---------------------------------------------------------------------------

def _entrada(valor):
    """Convierte una entrada suelta en el dict de encabezado de dos líneas."""
    if isinstance(valor, dict):
        return {
            "organizacion": (valor.get("organizacion") or valor.get("institucion") or "").strip(),
            "lugar": (valor.get("lugar") or "").strip(),
            "cargo": (valor.get("cargo") or valor.get("programa") or "").strip(),
            "fechas": (valor.get("fechas") or "").strip(),
            "logros": [str(l).strip() for l in (valor.get("logros") or []) if str(l).strip()],
        }
    # Texto suelto: se usa como organización, sin segunda línea.
    return {"organizacion": str(valor).strip(), "lugar": "", "cargo": "", "fechas": "", "logros": []}


def _secciones_extra(perfil):
    """Secciones que la persona creó a mano, con su propio título."""
    salida = []
    for s in perfil.get("secciones_extra") or []:
        if not isinstance(s, dict):
            continue
        titulo = str(s.get("titulo") or "").strip()
        lineas = s.get("lineas") or []
        if isinstance(lineas, str):
            lineas = [l for l in lineas.splitlines() if l.strip()]
        limpias = []
        for l in lineas:
            if isinstance(l, dict):
                limpias.append(" · ".join(filter(None, [
                    l.get("organizacion", ""), l.get("cargo", ""), l.get("fechas", "")])))
                limpias.extend(f"- {x}" for x in (l.get("logros") or []))
            elif str(l).strip():
                limpias.append(str(l).strip())
        if titulo and limpias:
            salida.append({"titulo": titulo, "lineas": limpias})
    return salida


def normalizar(perfil):
    """Deja el perfil en el modelo estructurado que espera el generador.

    Acepta también el modelo plano `{"secciones": {"experiencia": [...]}}`
    que produce el parseo por reglas, para no romper CVs ya procesados.
    """
    datos = {"nombre": (perfil.get("nombre") or "").strip(), "contacto": {}, }

    contacto = perfil.get("contacto") or {}
    for clave in ("ubicacion", "email", "telefono", "linkedin"):
        datos["contacto"][clave] = str(contacto.get(clave, "") or "").strip()

    for clave, _titulo, _tipo in SECCIONES:
        datos[clave] = []

    # Modelo estructurado.
    for clave, _titulo, tipo in SECCIONES:
        valor = perfil.get(clave)
        if not valor:
            continue
        if tipo == "entradas":
            datos[clave] = [_entrada(v) for v in valor]
        elif tipo == "competencias":
            items = []
            for v in valor:
                if isinstance(v, dict):
                    items.append({"categoria": (v.get("categoria") or "").strip(),
                                  "items": (v.get("items") or "").strip()})
                else:
                    texto = str(v).strip()
                    if ":" in texto:
                        cat, resto = texto.split(":", 1)
                        items.append({"categoria": cat.strip(), "items": resto.strip()})
                    else:
                        items.append({"categoria": "", "items": texto})
            datos[clave] = items
        else:
            datos[clave] = [str(v).strip() for v in valor if str(v).strip()]

    # Modelo plano de respaldo.
    planas = perfil.get("secciones") or {}
    for origen, destino in list(EQUIVALENCIAS.items()) + [(k, k) for k, _, _ in SECCIONES]:
        lineas = planas.get(origen)
        if not lineas or datos.get(destino):
            continue
        _, _, tipo = next((s for s in SECCIONES if s[0] == destino), (None, None, "texto"))
        if tipo == "entradas":
            datos[destino] = [_entrada(l) for l in lineas]
        elif tipo == "competencias":
            datos[destino] = normalizar({"competencias": lineas})["competencias"]
        else:
            datos[destino] = [str(l).strip() for l in lineas if str(l).strip()]

    datos["secciones_extra"] = _secciones_extra(perfil)
    return datos


def a_secciones_planas(perfil):
    """Vista plana del perfil, para el código que redacta respuestas."""
    d = normalizar(perfil)
    planas = {}
    if d["perfil"]:
        planas["resumen"] = d["perfil"]
    if d["competencias"]:
        planas["habilidades"] = [
            f"{c['categoria']}: {c['items']}" if c["categoria"] else c["items"]
            for c in d["competencias"]
        ]
    for clave, destino in (("experiencia", "experiencia"), ("liderazgo", "experiencia"),
                           ("educacion", "educacion")):
        for e in d[clave]:
            cabecera = " · ".join(filter(None, [e["organizacion"], e["cargo"], e["fechas"], e["lugar"]]))
            planas.setdefault(destino, []).append(cabecera)
            planas[destino].extend(f"- {l}" for l in e["logros"])
    if d["certificaciones"]:
        planas["certificaciones"] = list(d["certificaciones"])
    if d["logros"]:
        planas.setdefault("certificaciones", []).extend(d["logros"])
    return planas


# ---------------------------------------------------------------------------
# DOCX
# ---------------------------------------------------------------------------

def _con_tab_derecha(parrafo):
    parrafo.paragraph_format.tab_stops.add_tab_stop(TAB_DERECHA, WD_TAB_ALIGNMENT.RIGHT)
    return parrafo


def _p(doc, *, antes=0, despues=0):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(antes)
    p.paragraph_format.space_after = Pt(despues)
    return p


def _run(p, texto, *, pt=PT_CUERPO, negrita=False, cursiva=False):
    r = p.add_run(texto)
    r.bold = negrita
    r.italic = cursiva
    r.font.size = Pt(pt)
    r.font.name = FUENTE
    return r


def _linea_divisoria(doc):
    """Párrafo vacío con borde inferior: la línea que separa secciones.

    El CV original NO pone el borde en el párrafo del título, sino en un
    párrafo vacío justo debajo (`bottom, single, sz=8, space=2`). Son 9 en
    total: uno tras la línea de contacto y uno tras cada título.
    """
    p = _p(doc, despues=2)
    pPr = p._p.get_or_add_pPr()
    pBdr = pPr.makeelement(qn("w:pBdr"), {})
    pBdr.append(pPr.makeelement(qn("w:bottom"), {
        qn("w:val"): "single", qn("w:sz"): "8",
        qn("w:space"): "2", qn("w:color"): "000000",
    }))
    pPr.append(pBdr)
    return p


def _titulo_seccion(doc, texto):
    p = _p(doc, antes=9, despues=1)
    _run(p, texto.upper(), pt=PT_SECCION, negrita=True)
    _linea_divisoria(doc)


def _encabezado_entrada(doc, entrada):
    """Las dos líneas con tabulación derecha."""
    if entrada["organizacion"] or entrada["lugar"]:
        p = _con_tab_derecha(_p(doc, despues=0))
        # La organización va en VERSALES. Es la marca de la plantilla de
        # Harvard —HARVARD UNIVERSITY, ORGANIZATION, NAME OF HIGH SCHOOL—
        # y hace que la vista salte de empleador en empleador sin leer.
        # Con el nombre en caja mixta, la línea del cargo pesa igual y
        # las entradas se funden unas con otras.
        _run(p, entrada["organizacion"].upper(), pt=PT_ENTRADA, negrita=True)
        if entrada["lugar"]:
            # El lugar va SIN negrita: en la línea solo destaca quién, no
            # dónde. Ponerlo en negrita igualaba el peso de la ciudad al
            # del empleador y la fila entera se leía como un bloque.
            _run(p, "\t" + entrada["lugar"], pt=PT_ENTRADA)
    if entrada["cargo"] or entrada["fechas"]:
        p = _con_tab_derecha(_p(doc, despues=1))
        # La cursiva es solo del cargo. Las fechas van redondas: son un
        # dato, no parte del nombre del puesto.
        _run(p, entrada["cargo"], pt=PT_ENTRADA, cursiva=True)
        if entrada["fechas"]:
            _run(p, "\t" + entrada["fechas"], pt=PT_ENTRADA)


def _vinetas(doc, lineas):
    for linea in lineas:
        p = doc.add_paragraph(style="List Paragraph")
        p.paragraph_format.space_after = Pt(1)
        # Sangría heredada del estilo, como en el CV original (que no la
        # fija por párrafo).
        pPr = p._p.get_or_add_pPr()
        numPr = pPr.makeelement(qn("w:numPr"), {})
        numPr.append(pPr.makeelement(qn("w:ilvl"), {qn("w:val"): "0"}))
        numPr.append(pPr.makeelement(qn("w:numId"), {qn("w:val"): "1"}))
        pPr.append(numPr)
        _run(p, re.sub(r"^\s*[•·\-\*]\s+", "", linea).strip())


def generar_docx(perfil, carpeta_salida, sufijo=None, puesto=None):
    """Genera el .docx con el formato del CV original.

    Solo reordena y reformatea lo que el perfil ya dice: nunca inventa.
    """
    d = normalizar(perfil)

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = FUENTE
    normal.font.size = Pt(PT_CUERPO)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FUENTE)

    # A4, no Carta. python-docx crea los documentos en tamaño Carta por
    # defecto (21.59 cm de ancho) y en Perú se imprime y se lee en A4
    # (21 cm). La diferencia son 328 twips de ancho de texto: suficiente
    # para que las fechas dejaran de caer donde terminan las divisorias.
    for s in doc.sections:
        s.page_width, s.page_height = Twips(11906), Twips(16838)
        s.top_margin = s.bottom_margin = Twips(MARGEN)
        s.left_margin = s.right_margin = Twips(MARGEN)

    # Cabecera.
    p = _p(doc, despues=1)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _run(p, d["nombre"] or "Nombre Apellido", pt=PT_NOMBRE, negrita=True)

    partes = [d["contacto"][k] for k in ("ubicacion", "email", "telefono", "linkedin") if d["contacto"][k]]
    if partes:
        p = _p(doc, despues=2)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _run(p, "  ·  ".join(partes), pt=PT_CONTACTO)
        _linea_divisoria(doc)

    # Secciones.
    for clave, titulo, tipo in SECCIONES:
        contenido = d.get(clave)
        if not contenido:
            continue
        _titulo_seccion(doc, titulo)

        if tipo == "entradas":
            for entrada in contenido:
                _encabezado_entrada(doc, entrada)
                if entrada["logros"]:
                    _vinetas(doc, entrada["logros"])
        elif tipo == "competencias":
            for c in contenido:
                p = _p(doc, despues=1)
                if c["categoria"]:
                    _run(p, f"{c['categoria']}: ", negrita=True)
                _run(p, c["items"])
        elif tipo == "lineas_fecha":
            # "Entidad · Certificación" + tabulación + año
            # Solo la ENTIDAD va en negrita —"Duolingo", "Stanford
            # University"—, no el nombre del certificado ni el año. Antes
            # se ponía la línea entera en negrita y una sección de cinco
            # certificados salía como cinco bloques compitiendo con los
            # títulos de sección.
            for linea in contenido:
                p = _con_tab_derecha(_p(doc, despues=1))
                m = re.match(r"^(.*?)\s*\t\s*(.+)$", linea) or re.match(r"^(.*?)\s{2,}(\d{4}[\d–\-]*)$", linea)
                izquierda, fecha = (m.group(1).strip(), m.group(2).strip()) if m else (linea, "")
                entidad, sep, resto = izquierda.partition("·")
                _run(p, entidad.strip() if sep else izquierda, negrita=True)
                if sep:
                    _run(p, f"  ·{resto}")
                if fecha:
                    _run(p, "\t" + fecha)
        elif tipo == "texto_negrita":
            # Como en el original: solo la etiqueta antes de los dos puntos
            # va en negrita ("Investigación: " + descripción normal).
            for linea in contenido:
                p = _p(doc, despues=1)
                etiqueta, _, resto = linea.partition(":")
                if resto.strip():
                    _run(p, f"{etiqueta.strip()}: ", negrita=True)
                    _run(p, resto.strip())
                else:
                    _run(p, linea, negrita=True)
        elif tipo == "vinetas":
            _vinetas(doc, contenido)
        else:
            # Sin justificar: el CV original no tiene ningún párrafo
            # justificado (comprobado sobre el archivo), y justificar
            # abre ríos de espacio en líneas largas.
            for linea in contenido:
                p = _p(doc, despues=1)
                _run(p, linea)

    # Secciones que la persona añadió, al final y con su propio título.
    for extra in d.get("secciones_extra") or []:
        _titulo_seccion(doc, extra["titulo"])
        vinetas = [l for l in extra["lineas"] if l.startswith("- ")]
        sueltas = [l for l in extra["lineas"] if not l.startswith("- ")]
        for linea in sueltas:
            p = _p(doc, despues=1)
            _run(p, linea)
        if vinetas:
            _vinetas(doc, vinetas)

    # Las propiedades del archivo, antes de guardarlo.
    #
    # python-docx pone de su cosecha «dc:creator: python-docx» y
    # «dc:description: generated by python-docx». Eso lo ve cualquiera con
    # clic derecho → Propiedades, y en el panel de detalles del
    # explorador sin abrir nada. Delata mucho más que el nombre.
    #
    # Se pone a la persona como autora porque lo es: el contenido es su
    # CV, y el sistema reordena y reformula pero no añade experiencia,
    # títulos ni herramientas que no consten. Que el documento diga quién
    # lo firma es más exacto que decir que lo escribió una librería.
    props = doc.core_properties
    props.author = d["nombre"] or ""
    props.last_modified_by = d["nombre"] or ""
    props.title = f"CV - {d['nombre']}" if d.get("nombre") else "CV"
    props.comments = ""
    props.category = ""
    props.keywords = ""
    props.subject = ""
    # La descripción hay que vaciarla a mano: es la que trae la firma.
    try:
        props.description = ""
    except (AttributeError, ValueError):
        pass

    if carpeta_salida is None:
        # Modo web: sin escribir en disco.
        import io

        buffer = io.BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        # Esta es la rama que usa la extensión para adjuntar, así que este
        # nombre es el que aparece en la bandeja de la empresa. `sufijo`
        # trae empresa y puesto, pero solo como SEMILLA: elige la forma,
        # no se escribe. Ver nombres_cv.py.
        import nombres_cv
        return buffer, nombres_cv.elegir(d["nombre"], semilla=sufijo, puesto=puesto)

    carpeta = Path(carpeta_salida)
    carpeta.mkdir(exist_ok=True)
    slug = re.sub(r"[^\w]+", "-", d["nombre"] or "candidato").strip("-")
    # En disco sí se pone el sufijo con empresa y puesto: esta carpeta es
    # de la persona, y aquí lo que hace falta es no pisar un CV con otro
    # y saber cuál mandó a dónde. Lo que la empresa recibe se nombra
    # arriba, en la rama de memoria.
    nombre = f"CV-{slug}-Harvard" + (f"-{sufijo}" if sufijo else "")
    ruta = carpeta / f"{nombre}.docx"
    doc.save(ruta)
    return ruta


# ---------------------------------------------------------------------------
# Vista previa en HTML
# ---------------------------------------------------------------------------

def documento_en_memoria(perfil, sufijo=None, puesto=None):
    """(buffer, nombre) del .docx sin tocar el disco. Para la versión web.

    `sufijo` lleva empresa y puesto cuando el CV va adaptado a una
    vacante: así la persona distingue en su carpeta de descargas cuál
    mandó a cada sitio, y la empresa recibe un archivo con un nombre que
    no parece genérico.
    """
    return generar_docx(perfil, None, sufijo=sufijo, puesto=puesto)


def render_html(perfil):
    """Réplica del .docx en HTML, para revisarlo sin abrir el Word."""
    d = normalizar(perfil)
    esc = html.escape
    out = ['<div class="cv-preview">']
    out.append(f'<h1>{esc(d["nombre"] or "Nombre Apellido")}</h1>')

    partes = [d["contacto"][k] for k in ("ubicacion", "email", "telefono", "linkedin") if d["contacto"][k]]
    if partes:
        out.append(f'<p class="cv-contacto">{esc("  ·  ".join(partes))}</p>')

    for clave, titulo, tipo in SECCIONES:
        contenido = d.get(clave)
        if not contenido:
            continue
        out.append(f"<h2>{esc(titulo)}</h2>")

        if tipo == "entradas":
            for e in contenido:
                if e["organizacion"] or e["lugar"]:
                    out.append(
                        '<p class="cv-fila"><span class="izq"><strong>'
                        f'{esc(e["organizacion"].upper())}</strong></span>'
                        f'<span class="der">{esc(e["lugar"])}</span></p>'
                    )
                if e["cargo"] or e["fechas"]:
                    out.append(
                        f'<p class="cv-fila"><span class="izq"><em>{esc(e["cargo"])}</em></span>'
                        f'<span class="der">{esc(e["fechas"])}</span></p>'
                    )
                if e["logros"]:
                    out.append("<ul>" + "".join(f"<li>{esc(l)}</li>" for l in e["logros"]) + "</ul>")
        elif tipo == "competencias":
            for c in contenido:
                prefijo = f"<strong>{esc(c['categoria'])}:</strong> " if c["categoria"] else ""
                out.append(f"<p>{prefijo}{esc(c['items'])}</p>")
        elif tipo == "lineas_fecha":
            for linea in contenido:
                m = re.match(r"^(.*?)\s*\t\s*(.+)$", linea) or re.match(r"^(.*?)\s{2,}(\d{4}[\d–\-]*)$", linea)
                if m:
                    out.append(
                        f'<p class="cv-fila"><span class="izq"><strong>{esc(m.group(1).strip())}</strong></span>'
                        f'<span class="der"><strong>{esc(m.group(2).strip())}</strong></span></p>'
                    )
                else:
                    out.append(f"<p><strong>{esc(linea)}</strong></p>")
        elif tipo == "texto_negrita":
            for linea in contenido:
                etiqueta, _, resto = linea.partition(":")
                if resto.strip():
                    out.append(f"<p><strong>{esc(etiqueta.strip())}:</strong> {esc(resto.strip())}</p>")
                else:
                    out.append(f"<p><strong>{esc(linea)}</strong></p>")
        elif tipo == "vinetas":
            out.append("<ul>" + "".join(f"<li>{esc(l)}</li>" for l in contenido) + "</ul>")
        else:
            for linea in contenido:
                out.append(f"<p>{esc(linea)}</p>")

    for extra in d.get("secciones_extra") or []:
        out.append(f"<h2>{esc(extra['titulo'].upper())}</h2>")
        vinetas = [l[2:] for l in extra["lineas"] if l.startswith("- ")]
        for linea in extra["lineas"]:
            if not linea.startswith("- "):
                out.append(f"<p>{esc(linea)}</p>")
        if vinetas:
            out.append("<ul>" + "".join(f"<li>{esc(v)}</li>" for v in vinetas) + "</ul>")

    out.append("</div>")
    return "".join(out)

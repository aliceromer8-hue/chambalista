# -*- coding: utf-8 -*-
"""Generador del CV en formato Harvard (.docx) y su vista previa.

El formato está calcado del CV real que usa el plugin `empleo-peru`
(«CV ALICE ROMERO 2026.docx»), medido directamente del archivo:

- Times New Roman en todo el documento (docDefaults del Word original).
- Márgenes de 1.91 cm en los cuatro lados.
- Nombre a 18 pt en negrita, centrado. Debajo, una línea de contacto a
  9.5 pt centrada con los datos separados por «  ·  ».
- Títulos de sección a 11 pt, negrita, MAYÚSCULAS. **Sin línea divisoria**
  (el CV original no la lleva, aunque el término «Harvard» suela asociarse
  a ella).
- Cada entrada de experiencia ocupa dos líneas con una tabulación
  DERECHA a 6.27" (9026 twips), que es lo que alinea el lugar y las
  fechas contra el margen:
      Organización                                    Lugar      (10.5 pt, negrita)
      Cargo                                    Mes Año – Mes Año  (cursiva)
  y debajo los logros como viñetas.
- Sin foto, sin colores, sin tablas: una sola columna, compatible con ATS.

El perfil se estructura por entradas (no por líneas sueltas) para poder
reproducir esos encabezados de dos columnas.
"""

import html
import re
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, Twips

FUENTE = "Times New Roman"
TAB_DERECHA = Twips(9026)   # medido del CV original: alinea al margen derecho

PT_NOMBRE = 18
PT_CONTACTO = 9.5
PT_SECCION = 11
PT_ENTRADA = 10.5
PT_CUERPO = 10.5

# Orden y títulos de las secciones, tal como aparecen en el CV original.
SECCIONES = [
    ("perfil", "PERFIL PROFESIONAL", "texto"),
    ("competencias", "COMPETENCIAS CLAVE", "competencias"),
    ("experiencia", "EXPERIENCIA PROFESIONAL", "entradas"),
    ("liderazgo", "LIDERAZGO & VOLUNTARIADO", "entradas"),
    ("educacion", "EDUCACIÓN", "entradas"),
    ("certificaciones", "CERTIFICACIONES RELEVANTES", "lineas_fecha"),
    ("proyectos", "PROYECTO EN DESARROLLO", "texto_negrita"),
    ("logros", "LOGROS DESTACADOS", "vinetas"),
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


def _titulo_seccion(doc, texto):
    # Sin borde inferior: el CV original no lleva línea divisoria.
    p = _p(doc, antes=9, despues=3)
    _run(p, texto.upper(), pt=PT_SECCION, negrita=True)


def _encabezado_entrada(doc, entrada):
    """Las dos líneas con tabulación derecha."""
    if entrada["organizacion"] or entrada["lugar"]:
        p = _con_tab_derecha(_p(doc, despues=0))
        _run(p, entrada["organizacion"], pt=PT_ENTRADA, negrita=True)
        if entrada["lugar"]:
            _run(p, "\t" + entrada["lugar"], pt=PT_ENTRADA, negrita=True)
    if entrada["cargo"] or entrada["fechas"]:
        p = _con_tab_derecha(_p(doc, despues=1))
        _run(p, entrada["cargo"], pt=PT_ENTRADA, cursiva=True)
        if entrada["fechas"]:
            _run(p, "\t" + entrada["fechas"], pt=PT_ENTRADA, cursiva=True)


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


def generar_docx(perfil, carpeta_salida, sufijo=None):
    """Genera el .docx con el formato del CV original.

    Solo reordena y reformatea lo que el perfil ya dice: nunca inventa.
    """
    d = normalizar(perfil)

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = FUENTE
    normal.font.size = Pt(PT_CUERPO)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FUENTE)

    for s in doc.sections:
        s.top_margin = s.bottom_margin = Cm(1.91)
        s.left_margin = s.right_margin = Cm(1.91)

    # Cabecera.
    p = _p(doc, despues=1)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _run(p, d["nombre"] or "Nombre Apellido", pt=PT_NOMBRE, negrita=True)

    partes = [d["contacto"][k] for k in ("ubicacion", "email", "telefono", "linkedin") if d["contacto"][k]]
    if partes:
        p = _p(doc, despues=4)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _run(p, "  ·  ".join(partes), pt=PT_CONTACTO)

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
            for linea in contenido:
                p = _con_tab_derecha(_p(doc, despues=1))
                m = re.match(r"^(.*?)\s*\t\s*(.+)$", linea) or re.match(r"^(.*?)\s{2,}(\d{4}[\d–\-]*)$", linea)
                if m:
                    _run(p, m.group(1).strip(), negrita=True)
                    _run(p, "\t" + m.group(2).strip(), negrita=True)
                else:
                    _run(p, linea, negrita=True)
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

    carpeta = Path(carpeta_salida)
    carpeta.mkdir(exist_ok=True)
    slug = re.sub(r"[^\w]+", "-", d["nombre"] or "candidato").strip("-")
    # El sufijo lleva empresa y puesto: así los CV adaptados no se
    # sobrescriben entre sí y queda historial por postulación.
    nombre = f"CV-{slug}-Harvard" + (f"-{sufijo}" if sufijo else "")
    ruta = carpeta / f"{nombre}.docx"
    doc.save(ruta)
    return ruta


# ---------------------------------------------------------------------------
# Vista previa en HTML
# ---------------------------------------------------------------------------

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
                        f'{esc(e["organizacion"])}</strong></span>'
                        f'<span class="der"><strong>{esc(e["lugar"])}</strong></span></p>'
                    )
                if e["cargo"] or e["fechas"]:
                    out.append(
                        f'<p class="cv-fila"><span class="izq"><em>{esc(e["cargo"])}</em></span>'
                        f'<span class="der"><em>{esc(e["fechas"])}</em></span></p>'
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

    out.append("</div>")
    return "".join(out)

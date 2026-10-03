# -*- coding: utf-8 -*-
"""El CV en formato Harvard, en PDF. Gratis y sin LibreOffice.

Para qué: Bumeran solo acepta el CV en PDF (medido en el sitio real el
2026-09-25), y muchas empresas lo piden así. Convertir el .docx a PDF en
Vercel no se puede gratis: no hay Word ni LibreOffice en una función. Así
que se DIBUJA el mismo CV con fpdf2, una librería de Python puro (gratis,
sin servicios externos), siguiendo las mismas medidas que harvard_template:
A4, márgenes de 0.75", Times, nombre a 18 pt, secciones a 11 pt con línea
debajo, entradas con la ciudad y las fechas alineadas a la derecha.

Las fuentes base del PDF (Times) cubren el castellano entero —á, é, ñ, ü,
¿, ¡—; los pocos signos tipográficos que no cubren (comillas curvas,
rayas, viñetas) se cambian por su equivalente simple.
"""

import re

from fpdf import FPDF

from harvard_template import SECCIONES, normalizar

MM_POR_PULGADA = 25.4
MARGEN = 0.75 * MM_POR_PULGADA          # 19.05 mm, como el .docx
PT = 0.3528                             # mm por punto

_SUSTITUTOS = {
    "•": "-", "–": "-", "—": "-", "‘": "'", "’": "'",
    "“": '"', "”": '"', "…": "...", " ": " ", "​": "",
    "→": "->", "™": "(TM)", "€": "EUR",
}


def _t(texto):
    """Texto apto para las fuentes base (latin-1), sin perder el castellano."""
    s = str(texto or "")
    for k, v in _SUSTITUTOS.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


class _Hoja(FPDF):
    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_margins(MARGEN, MARGEN, MARGEN)
        self.set_auto_page_break(True, MARGEN)
        self.ancho = self.w - 2 * MARGEN

    def letra(self, estilo="", pt=10.5):
        self.set_font("Times", estilo, pt)

    def fila(self, izq, der, estilo_izq="", estilo_der="", pt=10.5):
        """Texto a la izquierda y, en la misma línea, otro a la derecha."""
        alto = pt * PT * 1.35
        self.letra(estilo_der, pt)
        ancho_der = self.get_string_width(_t(der)) + 2 if der else 0
        self.letra(estilo_izq, pt)
        izq = _t(izq)
        # Si no cabe, se recorta la izquierda: nunca se pisan.
        while izq and self.get_string_width(izq) > self.ancho - ancho_der - 2:
            izq = izq[:-2].rstrip() + "…"[:0]
        y = self.get_y()
        self.set_x(MARGEN)
        self.cell(self.ancho - ancho_der, alto, izq, align="L")
        if der:
            self.letra(estilo_der, pt)
            self.set_xy(MARGEN + self.ancho - ancho_der, y)
            self.cell(ancho_der, alto, _t(der), align="R")
        self.set_xy(MARGEN, y + alto)

    def parrafo(self, texto, estilo="", pt=10.5, sangria=0.0):
        self.letra(estilo, pt)
        self.set_x(MARGEN + sangria)
        self.multi_cell(self.ancho - sangria, pt * PT * 1.35, _t(texto), align="J")
        self.set_x(MARGEN)

    def vineta(self, texto, pt=10.5):
        alto = pt * PT * 1.35
        y = self.get_y()
        self.set_fill_color(19, 19, 22)
        self.ellipse(MARGEN + 2.2, y + alto / 2 - 0.6, 1.2, 1.2, style="F")
        self.parrafo(texto, pt=pt, sangria=5)

    def seccion(self, titulo):
        self.ln(2.2)
        self.letra("B", 11)
        self.set_x(MARGEN)
        self.cell(self.ancho, 11 * PT * 1.3, _t(titulo.upper()), align="L")
        self.ln(11 * PT * 1.3)
        y = self.get_y() + 0.3
        self.set_line_width(0.25)
        self.line(MARGEN, y, MARGEN + self.ancho, y)
        self.set_y(y + 1.4)


def pdf_en_bytes(perfil):
    """Los bytes del PDF del CV. Mismo contenido y orden que el .docx."""
    d = normalizar(perfil)
    h = _Hoja()
    h.add_page()
    h.set_title(_t(d.get("nombre") or "CV"))

    # Cabecera: nombre centrado y el contacto debajo, con una línea.
    h.letra("B", 18)
    h.cell(h.ancho, 18 * PT * 1.25, _t(d.get("nombre") or "Nombre Apellido"), align="C")
    h.ln(18 * PT * 1.25)
    contacto = d.get("contacto") or {}
    partes = [contacto.get(k) for k in ("ubicacion", "email", "telefono", "linkedin") if contacto.get(k)]
    if partes:
        h.letra("", 9.5)
        h.multi_cell(h.ancho, 9.5 * PT * 1.35, _t("  ·  ".join(partes)), align="C")
    y = h.get_y() + 1
    h.set_line_width(0.3)
    h.line(MARGEN, y, MARGEN + h.ancho, y)
    h.set_y(y + 1.5)

    for clave, titulo, tipo in SECCIONES:
        contenido = d.get(clave)
        if not contenido:
            continue
        h.seccion(titulo)
        if tipo == "entradas":
            for e in contenido:
                if e.get("organizacion") or e.get("lugar"):
                    h.fila(str(e.get("organizacion") or "").upper(), e.get("lugar") or "", "B", "")
                if e.get("cargo") or e.get("fechas"):
                    h.fila(e.get("cargo") or "", e.get("fechas") or "", "I", "")
                for logro in e.get("logros") or []:
                    h.vineta(logro)
                h.ln(1)
        elif tipo == "competencias":
            for c in contenido:
                cat = c.get("categoria")
                h.parrafo(f"{cat}: {c.get('items', '')}" if cat else c.get("items", ""))
        elif tipo == "lineas_fecha":
            for linea in contenido:
                m = re.match(r"^(.*?)\s*\t\s*(.+)$", linea) or re.match(r"^(.*?)\s{2,}(\d{4}[\d–\-]*)$", linea)
                if m:
                    h.fila(m.group(1).strip(), m.group(2).strip(), "B", "B")
                else:
                    h.parrafo(linea, "B")
        elif tipo == "texto_negrita":
            for linea in contenido:
                h.parrafo(linea, "B" if ":" not in linea else "")
        elif tipo == "vinetas":
            for linea in contenido:
                h.vineta(linea)
        else:
            for linea in contenido:
                h.parrafo(linea)

    for extra in d.get("secciones_extra") or []:
        h.seccion(extra.get("titulo", ""))
        for linea in extra.get("lineas") or []:
            if linea.startswith("- "):
                h.vineta(linea[2:])
            else:
                h.parrafo(linea)

    return bytes(h.output())

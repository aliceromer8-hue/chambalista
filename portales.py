# -*- coding: utf-8 -*-
"""Búsqueda de vacantes en varios portales peruanos.

Antes la búsqueda estaba encerrada en una tabla de combinaciones
(tipo × área) que solo cubría cinco rubros. Ahora el término lo escribe
la persona tal cual («practicante de derecho», «cajero», «enfermera») y
se envía a cada portal en su propio formato de URL.

Portales:
- Computrabajo (pe.computrabajo.com)  — verificado, con sesión para postular
- Bumeran (bumeran.com.pe)            — listado público
- Indeed (pe.indeed.com)              — listado público

La postulación automática sigue siendo solo de Computrabajo: los demás
aportan vacantes a la lista y se abren en el navegador para postular a
mano. Se marca con `postulable` para que la interfaz lo distinga.
"""

import re
import unicodedata
from urllib.parse import quote_plus, urlencode

# Rangos de experiencia que la persona puede pedir. Se traducen a
# palabras que los portales entienden dentro del propio término.
# Solo "prácticas" modifica el término, porque «practicante de X» es como
# las empresas titulan realmente esas ofertas. Para los demás niveles el
# término va tal cual: anteponer un cargo genérico producía disparates
# («analista de psicólogo organizacional»), y los portales no indexan bien
# el nivel de todos modos.
NIVELES = [
    {"id": "cualquiera", "nombre": "Cualquier nivel", "prefijo": ""},
    {"id": "practicas", "nombre": "Prácticas", "prefijo": "practicante de"},
    {"id": "junior", "nombre": "Junior / primer empleo", "prefijo": ""},
    {"id": "semi", "nombre": "Semi-senior", "prefijo": ""},
    {"id": "senior", "nombre": "Senior / jefatura", "prefijo": ""},
]

# Sugerencias para el autocompletado. NO limitan la búsqueda: la persona
# puede escribir cualquier cosa y se usa tal cual.
SUGERENCIAS = [
    "Administración", "Agronomía", "Almacén y logística", "Arquitectura",
    "Atención al cliente", "Call center", "Cajero", "Chef y cocina",
    "Comercio exterior", "Community manager", "Contabilidad", "Construcción",
    "Análisis de datos", "Derecho", "Diseño gráfico", "Docencia",
    "Educación inicial", "Enfermería", "Finanzas", "Gastronomía",
    "Ingeniería civil", "Ingeniería industrial", "Ingeniería de sistemas",
    "Marketing digital", "Mecánica automotriz", "Medicina", "Nutrición",
    "Obstetricia", "Psicología", "Publicidad", "Recursos humanos",
    "Recepción", "Seguridad", "Seguros", "Soporte técnico", "Telemarketing",
    "Trabajo social", "Turismo y hotelería", "Ventas", "Veterinaria",
]

CIUDADES = [
    "Lima", "Arequipa", "Trujillo", "Chiclayo", "Piura", "Cusco",
    "Huancayo", "Iquitos", "Tacna", "Callao", "Chimbote", "Ica",
]


def _slug(texto):
    texto = unicodedata.normalize("NFKD", texto or "")
    texto = texto.encode("ascii", "ignore").decode()
    texto = re.sub(r"[^\w\s-]", "", texto.lower()).strip()
    return re.sub(r"[\s_]+", "-", texto)


def termino_busqueda(puesto, nivel="cualquiera"):
    """Construye la frase que se manda al portal.

    Si la persona escribió un puesto, manda ESO. El nivel solo añade un
    prefijo cuando el texto no lo trae ya («practicante de marketing» no
    se convierte en «practicante de practicante de marketing»).
    """
    puesto = (puesto or "").strip()
    if not puesto:
        return ""
    fila = next((n for n in NIVELES if n["id"] == nivel), NIVELES[0])
    prefijo = fila["prefijo"]
    if not prefijo:
        return puesto
    # ¿Ya lleva una palabra de nivel? Entonces no se toca.
    if re.search(r"practicant|asistent|analist|jefe|gerent|supervisor|senior|junior|trainee",
                 puesto, re.I):
        return puesto
    return f"{prefijo} {puesto}"


# ---------------------------------------------------------------------------
# URLs por portal
# ---------------------------------------------------------------------------

def url_computrabajo(termino, ciudad=None, pagina=1):
    ruta = f"trabajo-de-{_slug(termino)}"
    if ciudad:
        ruta += f"-en-{_slug(ciudad)}"
    url = f"https://pe.computrabajo.com/{ruta}"
    return url + ("?" + urlencode({"p": pagina}) if pagina > 1 else "")


def url_bumeran(termino, ciudad=None, pagina=1):
    ruta = f"empleos-busqueda-{_slug(termino)}"
    if ciudad:
        ruta += f"-en-{_slug(ciudad)}"
    url = f"https://www.bumeran.com.pe/{ruta}.html"
    return url + (f"?page={pagina}" if pagina > 1 else "")


def url_indeed(termino, ciudad=None, pagina=1):
    params = {"q": termino}
    if ciudad:
        params["l"] = ciudad
    if pagina > 1:
        params["start"] = (pagina - 1) * 10
    return "https://pe.indeed.com/jobs?" + urlencode(params, quote_via=quote_plus)


PORTALES = [
    {
        "id": "computrabajo",
        "nombre": "Computrabajo",
        "url": url_computrabajo,
        "postulable": True,
        "nota": "Busca y postula automáticamente.",
        "selectores": {
            "oferta": "article.box_offer[data-id]",
            "titulo": "h2 a.js-o-link",
            "empresa": "[offer-grid-article-company-url]",
            "ubicacion": "p.fs16.fc_base.mt5:not(.dFlex) span.mr10",
            "fecha": "p.fs13.fc_aux",
            "ya_postulado": "[applied-offer-tag]:not(.hide)",
            "id_attr": "data-id",
        },
    },
    {
        "id": "bumeran",
        "nombre": "Bumeran",
        "url": url_bumeran,
        "postulable": False,
        "nota": "Aporta vacantes; la postulación se abre en el navegador.",
        "selectores": {
            "oferta": "a[href*='/empleos/']",
            "titulo": "h2, h3",
            "empresa": "h3 + *, [class*='company']",
            "ubicacion": "[class*='location'], [class*='ubicacion']",
            "fecha": "[class*='date'], [class*='fecha']",
            "ya_postulado": ".no-existe",
            "id_attr": "href",
        },
    },
    {
        "id": "indeed",
        "nombre": "Indeed",
        "url": url_indeed,
        "postulable": False,
        "nota": "Aporta vacantes; la postulación se abre en el navegador.",
        "selectores": {
            "oferta": "div.job_seen_beacon, [data-testid='slider_item']",
            "titulo": "h2.jobTitle span, [id^='jobTitle']",
            "empresa": "[data-testid='company-name']",
            "ubicacion": "[data-testid='text-location']",
            "fecha": "[data-testid='myJobsStateDate']",
            "ya_postulado": ".no-existe",
            "id_attr": "data-jk",
        },
    },
]


def portal(id_portal):
    return next((p for p in PORTALES if p["id"] == id_portal), None)


def catalogo():
    """Datos que la interfaz necesita para pintar el buscador."""
    return {
        "niveles": NIVELES,
        "sugerencias": SUGERENCIAS,
        "ciudades": CIUDADES,
        "portales": [
            {"id": p["id"], "nombre": p["nombre"], "postulable": p["postulable"], "nota": p["nota"]}
            for p in PORTALES
        ],
    }

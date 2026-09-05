# -*- coding: utf-8 -*-
"""Qué puestos buscar, deducidos del CV.

El buscador libre está bien para quien ya sabe qué quiere. El problema es
el resto: alguien que acaba de subir su CV muchas veces no sabe cómo se
llama el puesto al que puede postular, y escribe "marketing" a secas, que
en Computrabajo devuelve desde practicante hasta gerente.

Lo que hace este módulo es cruzar dos cosas:

    MOMENTO DE CARRERA  ×  ÁREA  =  títulos concretos que sí existen

El momento importa más que el área, y es donde se equivocan las
sugerencias automáticas. A alguien en el ciclo 5 no se le ofrece
"Analista": no lo van a llamar y además no le corresponde. En el Perú la
escalera es bastante literal:

    ciclos 1-5      prácticas pre-profesionales
    ciclos 6 a fin  prácticas pre-profesionales de últimos ciclos
    egresado        prácticas profesionales, asistente
    bachiller       asistente, analista junior
    titulado o 2+   analista, ejecutivo, coordinador

Las prácticas pre-profesionales exigen estar matriculado; las
profesionales, haber egresado hace poco. No es una convención nuestra:
es cómo publican los avisos, y postular al escalón equivocado es la forma
más rápida de que no te respondan.

Nada de esto llama al modelo. Es lectura del CV con reglas, así que sale
instantáneo, gratis y se puede explicar: cada sugerencia viene con el
motivo, para que la persona la corrija si nos equivocamos.
"""
import re
import unicodedata


def _plano(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def texto_del_cv(perfil):
    """Aplana el perfil, venga estructurado o en secciones planas."""
    partes = []
    secciones = perfil.get("secciones") or {}
    for bloque in secciones.values():
        partes.extend(str(x) for x in (bloque or []))
    for clave in ("perfil", "competencias", "experiencia", "liderazgo",
                  "educacion", "certificaciones", "logros", "proyectos"):
        for e in perfil.get(clave) or []:
            if isinstance(e, str):
                partes.append(e)
            elif isinstance(e, dict):
                if e.get("categoria"):
                    partes.append(f"{e['categoria']} {e.get('items', '')}")
                else:
                    partes.append(" ".join(filter(None, [
                        e.get("organizacion"), e.get("cargo"), e.get("titulo"),
                        *(e.get("logros") or []),
                    ])))
    return " \n ".join(partes)


# ---------------------------------------------------------------------
# Momento de carrera
# ---------------------------------------------------------------------

ORDINALES = {
    "primer": 1, "segundo": 2, "tercer": 3, "cuarto": 4, "quinto": 5,
    "sexto": 6, "septimo": 7, "octavo": 8, "noveno": 9, "decimo": 10,
    "undecimo": 11, "duodecimo": 12,
    "i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6,
    "vii": 7, "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12,
    # En inglés. No es un adorno: muchos estudiantes de Derecho y
    # Negocios escriben el CV en inglés para postular a multinacionales,
    # y sin esto se les clasifica como "no sé en qué momento estás" y se
    # les ofrece asistente cuando les tocan prácticas.
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
    "eleventh": 11, "twelfth": 12,
}

# "ciclo" en español, "cycle" / "semester" / "year" en inglés.
_PERIODO = r"(?:ciclo|cycle|semester|semestre|year)"


def _ciclo(t):
    """El ciclo que cursa, si el CV lo dice. Devuelve None si no."""
    # "ciclo 11", "cycle 12", "semester 8"
    m = re.search(_PERIODO + r"\s*(?:n[°º]?\s*)?(\d{1,2})\b", t)
    if m:
        return int(m.group(1))
    # "11º ciclo", "8vo ciclo", "12th cycle", "12th-year"
    m = re.search(r"(\d{1,2})\s*(?:er|do|to|vo|mo|th|st|nd|rd|°|º)?\s*-?\s*" + _PERIODO, t)
    if m:
        return int(m.group(1))
    # "décimo ciclo", "twelfth cycle"
    largos = "|".join(k for k in ORDINALES if len(k) > 2)
    m = re.search(r"\b(" + largos + r")\s*-?\s*" + _PERIODO, t)
    if m:
        return ORDINALES[m.group(1)]
    return None


def _anios_experiencia(t):
    """Años de experiencia declarados, o los que se deducen de las fechas."""
    m = re.search(r"(\d{1,2})\s*a[nñ]os?\s*de\s*experiencia", t)
    if m:
        return int(m.group(1))
    # Rangos tipo "2023 - 2025" o "2023 - actualidad".
    total = 0
    for ini, fin in re.findall(r"(20\d{2})\s*[-–—a]{1,3}\s*(20\d{2}|actualidad|presente|actual)", t):
        cierre = 2026 if not fin.isdigit() else int(fin)
        total = max(total, cierre - int(ini))
    return total


def momento_de_carrera(perfil):
    """Dónde está la persona. Devuelve (clave, explicación para ella)."""
    t = _plano(texto_del_cv(perfil))
    ciclo = _ciclo(t)
    anios = _anios_experiencia(t)

    # Las mismas señales en los dos idiomas, por lo dicho arriba.
    titulado = bool(re.search(
        r"\btitulad|licenciad[oa]\b|colegiatura|\bmagister|\bmba\b|maestria"
        r"|\blicensed\b|\battorney\b|master'?s\s+degree", t))
    bachiller = bool(re.search(r"\bbachiller\b|\bbach\.|bachelor'?s?\s*(degree)?\b", t))
    egresado = bool(re.search(
        r"\begresad[oa]\b|\bconcluid[oa]s?\b|estudios\s+concluidos"
        r"|\bgraduated\b|\bgraduate\b(?!\s+student)", t))
    estudiando = bool(re.search(
        r"en\s+curso|cursando|actualmente\s+estudi|estudiante"
        r"|\bstudent\b|currently\s+studying|in\s+progress|undergraduate", t)) or ciclo is not None

    # El orden importa: lo más alto gana, salvo que siga matriculada.
    if estudiando and not (titulado or bachiller or egresado):
        if ciclo is None:
            return "estudiante", "Estás estudiando, así que te corresponden prácticas pre-profesionales."
        if ciclo <= 5:
            return "estudiante-inicio", (
                f"Estás en el ciclo {ciclo}. Te corresponden prácticas pre-profesionales; "
                "los avisos de últimos ciclos te van a filtrar.")
        return "estudiante-final", (
            f"Estás en el ciclo {ciclo}, que es lo que piden los avisos de "
            "«últimos ciclos». Prácticas pre-profesionales.")

    if titulado or anios >= 2:
        motivo = "Tienes título" if titulado else f"Tienes {anios} años de experiencia"
        return "profesional", f"{motivo}, así que ya puedes apuntar a analista o ejecutivo, no solo a asistente."

    if bachiller:
        return "bachiller", "Eres bachiller: te corresponden puestos de asistente y analista junior."

    if egresado:
        return "egresado", (
            "Egresaste. Puedes postular a prácticas profesionales —que son distintas "
            "de las pre-profesionales— y a puestos de asistente.")

    return "sin-determinar", (
        "No pude deducir en qué momento de tu carrera estás. Escribe tú el puesto, "
        "o añade tu ciclo o tu año de egreso al CV.")


# ---------------------------------------------------------------------
# Área
# ---------------------------------------------------------------------
# La palabra clave a la izquierda; a la derecha, cómo se llama el puesto
# en los avisos, que casi nunca es igual al nombre de la carrera.

AREAS = [
    ("Marketing", r"marketing|publicidad|branding|campa[nñ]as|redes sociales|community",
     ["Marketing", "Marketing Digital", "Investigación de Mercados", "Trade Marketing"]),
    ("Comunicaciones", r"comunicacion|periodis|audiovisual|contenidos|prensa",
     ["Comunicaciones", "Contenidos", "Comunicación Interna"]),
    ("Administración", r"administracion|gestion|procesos|asistente administrativ",
     ["Administración", "Gestión", "Procesos"]),
    ("Contabilidad", r"contabilidad|contable|tributari|sunat|plame|concar|finanzas|tesoreria",
     ["Contabilidad", "Finanzas", "Tesorería", "Tributación"]),
    ("Recursos Humanos", r"recursos humanos|\brrhh\b|reclutamiento|selecci[oó]n de personal|planillas",
     ["Recursos Humanos", "Reclutamiento y Selección", "Gestión del Talento"]),
    ("Ventas", r"\bventas\b|comercial|vendedor|ejecutivo comercial|telemarketing",
     ["Ventas", "Comercial", "Atención al Cliente"]),
    ("Logística", r"logistic|almacen|abastecimiento|compras|supply|distribucion|inventario",
     ["Logística", "Almacén", "Compras", "Abastecimiento"]),
    ("Sistemas", r"sistemas|software|desarrollo web|programacion|soporte tecnico|\bti\b|redes",
     ["Sistemas", "Soporte Técnico", "Desarrollo", "TI"]),
    ("Datos", r"analisis de datos|data|power bi|\bsql\b|estadistic|business intelligence",
     ["Análisis de Datos", "Business Intelligence"]),
    ("Diseño", r"dise[nñ]o grafic|illustrator|photoshop|figma|\bux\b|\bui\b",
     ["Diseño Gráfico", "Diseño UX/UI"]),
    ("Ingeniería Industrial", r"ingenieria industrial|mejora continua|lean|six sigma|calidad|produccion",
     ["Ingeniería Industrial", "Mejora Continua", "Calidad", "Producción"]),
    ("Ingeniería Civil", r"ingenieria civil|construccion|autocad|revit|obra|metrados",
     ["Ingeniería Civil", "Obras", "Costos y Presupuestos"]),
    ("Derecho", r"derecho|abogac|legal|juridic|notarial|\blaw\b|attorney",
     ["Derecho", "Legal", "Asuntos Corporativos", "Contrataciones con el Estado"]),
    ("Psicología", r"psicolog|clinica|organizacional",
     ["Psicología", "Psicología Organizacional"]),
    ("Salud", r"enfermeri|medicina|obstetric|nutricion|farmacia|tecnico en salud",
     ["Salud", "Enfermería", "Asistencia Médica"]),
    ("Educación", r"educacion|docencia|pedagog|profesor|tutor",
     ["Educación", "Docencia", "Tutoría"]),
    ("Turismo", r"turismo|hoteleria|gastronomia|cocina|restaurante",
     ["Turismo", "Hotelería", "Alimentos y Bebidas"]),
    ("Arquitectura", r"arquitectur|urbanis|sketchup",
     ["Arquitectura", "Diseño de Interiores"]),
]


def areas_del_cv(perfil, tope=3):
    """Las áreas que el CV respalda, de más a menos evidencia."""
    t = _plano(texto_del_cv(perfil))
    puntuadas = []
    for nombre, patron, puestos in AREAS:
        golpes = len(re.findall(patron, t))
        if golpes:
            puntuadas.append((golpes, nombre, puestos))
    puntuadas.sort(key=lambda x: -x[0])
    return [(n, p) for _, n, p in puntuadas[:tope]]


# ---------------------------------------------------------------------
# El cruce
# ---------------------------------------------------------------------

PREFIJOS = {
    "estudiante":        ["Practicante de"],
    "estudiante-inicio": ["Practicante de", "Apoyo en"],
    "estudiante-final":  ["Practicante de", "Asistente de"],
    "egresado":          ["Practicante Profesional de", "Asistente de"],
    "bachiller":         ["Asistente de", "Analista Junior de"],
    "profesional":       ["Analista de", "Coordinador de", "Analista Senior de"],
    "sin-determinar":    ["Asistente de"],
}

# "Ejecutivo" solo se dice en comercial. "Ejecutivo de Ingeniería
# Industrial" no lo publica nadie, y buscar eso no devuelve nada.
PREFIJO_POR_AREA = {
    ("profesional", "Ventas"): "Ejecutivo de",
    ("bachiller", "Ventas"): "Ejecutivo de",
}


def sugerir(perfil, tope=6):
    """Puestos que buscar, con el porqué de cada uno.

    Devuelve un dict listo para pintar en la interfaz. `puestos` va
    ordenado: primero el prefijo más probable cruzado con el área más
    respaldada por el CV.
    """
    clave, explicacion = momento_de_carrera(perfil)
    areas = areas_del_cv(perfil)

    if not areas:
        return {
            "momento": clave,
            "explicacion": explicacion,
            "puestos": [],
            "nota": ("Tu CV no menciona un área lo bastante claro como para sugerirte "
                     "puestos. Escribe tú el que buscas."),
        }

    prefijos = PREFIJOS[clave]
    puestos, vistos = [], set()

    # Se recorre por rondas para que la primera sugerencia de cada área
    # salga antes que la segunda de la primera área.
    for ronda in range(4):
        for i, (area, titulos) in enumerate(areas):
            if ronda >= len(titulos):
                continue
            # Siempre el mismo nivel para todas las áreas. Antes el
            # prefijo se elegía por la POSICIÓN del área, así que a la
            # misma persona se le ofrecía "Practicante de Marketing" y
            # "Asistente de Análisis de Datos" en la misma lista: el
            # nivel cambiaba según el área, que no significa nada y hace
            # dudar de si el resto también es al azar.
            prefijo = PREFIJO_POR_AREA.get((clave, area)) or prefijos[0]
            texto = f"{prefijo} {titulos[ronda]}"
            if texto.lower() in vistos:
                continue
            vistos.add(texto.lower())
            puestos.append({
                "texto": texto,
                "area": area,
                "razon": (f"tu CV respalda {area.lower()}" if ronda == 0
                          else f"otra salida dentro de {area.lower()}"),
            })
            if len(puestos) >= tope:
                return {"momento": clave, "explicacion": explicacion,
                        "puestos": puestos, "nota": ""}

    return {"momento": clave, "explicacion": explicacion, "puestos": puestos, "nota": ""}

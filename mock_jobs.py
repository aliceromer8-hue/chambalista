# -*- coding: utf-8 -*-
"""Vacantes de ejemplo — DATOS SIMULADOS.

IMPORTANTE: estas vacantes NO son reales. Son datos de prueba para
desarrollar y demostrar el flujo completo del wizard sin depender de
los portales. La versión real conectará primero con Computrabajo (el
flujo más simple, ya validado en el plugin original) y luego con
LinkedIn, Bumeran e Indeed — siempre con la sesión abierta por la
propia persona y revisión humana antes de cada envío.

La interfaz muestra un aviso visible de que son datos de demostración.
"""

MOCK = True  # la UI usa esta bandera para mostrar el aviso de simulación

VACANTES = [
    {
        "id": "ct-001",
        "portal": "Computrabajo",
        "titulo": "Practicante de Marketing Digital",
        "empresa": "Grupo Andino SAC",
        "ubicacion": "Lima (híbrido)",
        "tipo": "practicas",
        "area": "marketing",
        "descripcion": "Apoyo en gestión de redes sociales, reportes de métricas y coordinación de campañas. Deseable manejo de Canva y Meta Ads.",
        "keywords": ["redes sociales", "canva", "meta ads", "reportes"],
        "url": "https://www.computrabajo.com.pe/ofertas-de-trabajo/oferta-simulada-ct-001",
    },
    {
        "id": "ct-002",
        "portal": "Computrabajo",
        "titulo": "Analista Junior de Marketing",
        "empresa": "Retail Perú EIRL",
        "ubicacion": "Lima (presencial)",
        "tipo": "junior",
        "area": "marketing",
        "descripcion": "Análisis de campañas, seguimiento de KPIs y apoyo en trade marketing. Excel intermedio y experiencia de 1 año.",
        "keywords": ["kpis", "excel", "trade marketing"],
        "url": "https://www.computrabajo.com.pe/ofertas-de-trabajo/oferta-simulada-ct-002",
    },
    {
        "id": "ct-003",
        "portal": "Computrabajo",
        "titulo": "Practicante de Recursos Humanos",
        "empresa": "Servicios Corporativos SAC",
        "ubicacion": "Lima (remoto)",
        "tipo": "practicas",
        "area": "rrhh",
        "descripcion": "Apoyo en reclutamiento, filtro de CVs y coordinación de entrevistas.",
        "keywords": ["reclutamiento", "entrevistas", "atracción de talento"],
        "url": "https://www.computrabajo.com.pe/ofertas-de-trabajo/oferta-simulada-ct-003",
    },
    {
        "id": "ct-004",
        "portal": "Computrabajo",
        "titulo": "Asistente de Administración",
        "empresa": "Logística del Sur SA",
        "ubicacion": "Arequipa (presencial)",
        "tipo": "junior",
        "area": "administracion",
        "descripcion": "Gestión documental, facturación y soporte al área contable.",
        "keywords": ["facturación", "excel", "gestión documental"],
        "url": "https://www.computrabajo.com.pe/ofertas-de-trabajo/oferta-simulada-ct-004",
    },
    {
        "id": "ct-005",
        "portal": "Computrabajo",
        "titulo": "Practicante de Sistemas / TI",
        "empresa": "TechLima SAC",
        "ubicacion": "Lima (híbrido)",
        "tipo": "practicas",
        "area": "ti",
        "descripcion": "Soporte a usuarios, mantenimiento de inventario TI y apoyo en proyectos de datos con Python o SQL.",
        "keywords": ["python", "sql", "soporte"],
        "url": "https://www.computrabajo.com.pe/ofertas-de-trabajo/oferta-simulada-ct-005",
    },
    {
        "id": "ct-006",
        "portal": "Computrabajo",
        "titulo": "Diseñador(a) Gráfico Junior",
        "empresa": "Agencia Creativa Lima",
        "ubicacion": "Lima (remoto)",
        "tipo": "junior",
        "area": "diseno",
        "descripcion": "Piezas para redes, branding y apoyo audiovisual. Portafolio indispensable.",
        "keywords": ["illustrator", "photoshop", "branding", "portafolio"],
        "url": "https://www.computrabajo.com.pe/ofertas-de-trabajo/oferta-simulada-ct-006",
    },
]

AREAS = [
    {"id": "marketing", "nombre": "Marketing y Comunicaciones"},
    {"id": "rrhh", "nombre": "Recursos Humanos"},
    {"id": "administracion", "nombre": "Administración y Finanzas"},
    {"id": "ti", "nombre": "Tecnología / Sistemas"},
    {"id": "diseno", "nombre": "Diseño"},
]

PORTALES = [
    {"id": "computrabajo", "nombre": "Computrabajo", "activo": True,
     "nota": "Primer portal del piloto: flujo más simple, ya validado."},
    {"id": "linkedin", "nombre": "LinkedIn", "activo": False, "nota": "Próximamente."},
    {"id": "bumeran", "nombre": "Bumeran", "activo": False, "nota": "Próximamente."},
    {"id": "indeed", "nombre": "Indeed", "activo": False, "nota": "Próximamente."},
]


# Traduce la elección del wizard al término que se busca en el portal.
# Computrabajo indexa por slug de texto, así que la frase importa.
TERMINOS = {
    ("practicas", "marketing"): "practicante de marketing",
    ("practicas", "rrhh"): "practicante de recursos humanos",
    ("practicas", "administracion"): "practicante de administracion",
    ("practicas", "ti"): "practicante de sistemas",
    ("practicas", "diseno"): "practicante de diseno grafico",
    ("junior", "marketing"): "asistente de marketing",
    ("junior", "rrhh"): "asistente de recursos humanos",
    ("junior", "administracion"): "asistente administrativo",
    ("junior", "ti"): "analista de sistemas junior",
    ("junior", "diseno"): "diseñador grafico junior",
}


def termino_busqueda(tipo, area):
    """Frase de búsqueda para el portal según lo que eligió la persona."""
    if (tipo, area) in TERMINOS:
        return TERMINOS[(tipo, area)]
    nombre = next((a["nombre"] for a in AREAS if a["id"] == area), area or "")
    prefijo = "practicante de" if tipo == "practicas" else "asistente de"
    return f"{prefijo} {nombre}".strip()


def filtrar(tipo=None, area=None):
    resultado = VACANTES
    if tipo:
        resultado = [v for v in resultado if v["tipo"] == tipo]
    if area:
        resultado = [v for v in resultado if v["area"] == area]
    return resultado

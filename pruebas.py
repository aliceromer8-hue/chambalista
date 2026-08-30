# -*- coding: utf-8 -*-
"""Pruebas de la lógica del servidor, sin red ni modelo.

    python pruebas.py

Cubre lo que se rompe en silencio: deducir el momento de carrera desde
el CV. Si eso falla, a una persona de ciclo 4 le sugerimos puestos de
analista y no la va a llamar nadie — y no hay error en pantalla que lo
delate.
"""
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import respuestas
import sugerencias

fallos = 0


def titulo(t):
    print(f"\n{'=' * 70}\n{t}\n{'=' * 70}")


def check(nombre, condicion, detalle=""):
    global fallos
    if condicion:
        print(f"OK    {nombre}")
    else:
        fallos += 1
        print(f"FALLA {nombre}" + (f"  → {detalle}" if detalle else ""))


def perfil(*lineas, **secciones):
    base = {"resumen": list(lineas)}
    base.update(secciones)
    return {"secciones": base}


# ---------------------------------------------------------------------
titulo("MOMENTO DE CARRERA — el ciclo manda")
# ---------------------------------------------------------------------

casos = [
    ("ciclo 4 es inicio de carrera",
     perfil("Estudiante de Contabilidad, cuarto ciclo."), "estudiante-inicio"),
    ("ciclo 11 son últimos ciclos",
     perfil("Estudiante de Marketing, cursando el ciclo 11."), "estudiante-final"),
    ("'8vo ciclo' también se lee",
     perfil("Curso el 8vo ciclo de Administración."), "estudiante-final"),
    ("egresada no es estudiante",
     perfil("Egresada de Administración."), "egresado"),
    ("bachiller sube un escalón",
     perfil("Bachiller en Ingeniería Industrial."), "bachiller"),
    ("titulada llega a profesional",
     perfil("Licenciada en Psicología, colegiada."), "profesional"),
    ("cuatro años de experiencia bastan sin título",
     perfil("Especialista en logística.", ),
     "profesional"),
]
# El caso de los años necesita fechas en la experiencia.
casos[-1][1]["secciones"]["experiencia"] = ["Coordinadora de almacén (2021 - actualidad)"]

for nombre, p, esperado in casos:
    clave, _ = sugerencias.momento_de_carrera(p)
    check(nombre, clave == esperado, f"salió «{clave}», se esperaba «{esperado}»")

check("un CV sin pistas lo admite en vez de inventar",
      sugerencias.momento_de_carrera(perfil("Persona proactiva."))[0] == "sin-determinar")

# ---------------------------------------------------------------------
titulo("SUGERENCIAS — nunca por encima del momento")
# ---------------------------------------------------------------------

ali = perfil(
    "Estudiante de Marketing en la USIL, cursando el ciclo 11.",
    experiencia=["Practicante de Marketing Digital — campañas en Meta Ads."],
    habilidades=["Excel", "Meta Ads", "Google Analytics", "Canva"],
)
r = sugerencias.sugerir(ali)
textos = [p["texto"] for p in r["puestos"]]

check("a quien sigue en la U no se le ofrece analista",
      not any("Analista" in t for t in textos), str(textos))
check("tampoco coordinador ni jefe",
      not any(x in t for t in textos for x in ("Coordinador", "Jefe", "Gerente")))
check("sí se le ofrece practicante", any(t.startswith("Practicante") for t in textos))
check("acierta el área desde el CV", any("Marketing" in t for t in textos))
check("cada sugerencia trae su motivo", all(p.get("razon") for p in r["puestos"]))
check("la explicación menciona el ciclo", "11" in r["explicacion"])

titulada = perfil(
    "Licenciada en Ingeniería Industrial con 4 años de experiencia en logística.",
    experiencia=["Coordinadora de almacén y abastecimiento (2021 - actualidad)"],
)
tex = [p["texto"] for p in sugerencias.sugerir(titulada)["puestos"]]
check("a una titulada no se le ofrece practicante",
      not any("Practicante" in t for t in tex), str(tex))
check("a una titulada sí analista o coordinador",
      any(("Analista" in t or "Coordinador" in t) for t in tex), str(tex))
check("no inventa «Ejecutivo de Ingeniería Industrial»",
      not any(t.startswith("Ejecutivo de Ingenier") for t in tex), str(tex))

ventas = perfil("Bachiller en Administración.",
                experiencia=["Ejecutivo comercial, ventas corporativas."])
check("«Ejecutivo» sí se usa en ventas, que es donde se dice",
      any("Ejecutivo" in p["texto"] for p in sugerencias.sugerir(ventas)["puestos"]))

sin_area = perfil("Persona responsable y con ganas de aprender.")
check("sin área clara no se inventan puestos",
      sugerencias.sugerir(sin_area)["puestos"] == [])
check("y se le dice que escriba ella el puesto",
      "escribe" in sugerencias.sugerir(sin_area)["nota"].lower())

# ---------------------------------------------------------------------
titulo("CONSENTIMIENTO — el portón que va antes del modelo")
# ---------------------------------------------------------------------

frena = [
    "¿Acepta que las prácticas son ad honorem, sin remuneración?",
    "¿Está de acuerdo con la política de tratamiento de datos personales?",
    "¿Acepta los términos y condiciones del proceso de selección?",
    "¿Se compromete a permanecer mínimo 2 años en la empresa?",
    "¿Autoriza el descuento por planilla de los uniformes?",
    "¿Acepta trabajar los domingos sin pago de sobretiempo?",
    "Declaro bajo juramento no tener antecedentes penales.",
]
for e in frena:
    check(f"frena: {e[:52]}", respuestas.es_decision_personal(e))

pasan = [
    "¿Qué herramientas de análisis manejas?",
    "¿Cuál es tu nivel de inglés?",
    "¿Cuántos años de experiencia tiene en marketing?",
    "¿Cuál es su expectativa salarial?",
    "Número de DNI",
]
for e in pasan:
    check(f"deja pasar: {e[:52]}", not respuestas.es_decision_personal(e))

print(f"\n{'TODO OK' if fallos == 0 else f'{fallos} FALLO(S)'}")
sys.exit(1 if fallos else 0)

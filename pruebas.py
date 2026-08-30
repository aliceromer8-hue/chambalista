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

# ---------------------------------------------------------------------
titulo("EL .DOCX ADAPTADO — solo añade, nunca borra")
# ---------------------------------------------------------------------
import base64
import io
import re as _re
import zipfile

import app_web

cliente = app_web.app.test_client()

CV = {
    "nombre": "Alice Nicoll Romero León",
    "contacto": {"email": "a@b.pe", "telefono": "999888777", "ubicacion": "Lima, Perú"},
    "secciones": {
        "resumen": ["Estudiante de Marketing en la USIL, ciclo 11."],
        "experiencia": ["Practicante de Marketing Digital — Tienda Nube (2025)"],
        "educacion": ["USIL — Marketing, ciclo 11"],
        "habilidades": ["Excel intermedio", "Meta Ads", "Canva"],
    },
}


def pedir_docx(**extra):
    r = cliente.post("/api/cv/docx", json={"perfil": CV, **extra})
    return r.status_code, r.get_json()


def texto_del_docx(b64):
    crudo = base64.b64decode(b64)
    with zipfile.ZipFile(io.BytesIO(crudo)) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    return crudo, _re.sub(r"<[^>]+>", "", xml)


estado, j = pedir_docx(resumen=["Enfocada en investigación de mercados."],
                       competencias_extra=["Power BI"],
                       sufijo="Consultora-Andina")
check("el endpoint responde", estado == 200, str(j)[:120])
crudo, texto = texto_del_docx(j["base64"])

check("devuelve un .docx de verdad", crudo[:2] == b"PK")
check("el tamaño declarado coincide", j["bytes"] == len(crudo))
check("el nombre lleva la empresa", "Consultora-Andina" in j["nombre"], j["nombre"])
check("mete el resumen adaptado", "investigación de mercados" in texto)
check("mete la habilidad que ella confirmó", "Power BI" in texto)
check("y dice cuál añadió", j["anadidas"] == ["Power BI"], str(j["anadidas"]))

# Lo que no puede pasar nunca: que adaptar borre algo del CV original.
for pieza in ("Excel", "Meta Ads", "Canva", "Tienda Nube", "USIL", "Alice"):
    check(f"conserva «{pieza}» del CV original", pieza in texto)

_, j2 = pedir_docx()
_, texto2 = texto_del_docx(j2["base64"])
check("sin adaptación, no inventa habilidades", "Power BI" not in texto2)
check("sin adaptación, conserva todo", all(p in texto2 for p in ("Excel", "Meta Ads", "Canva")))
check("sin sufijo, el nombre queda limpio", "Consultora" not in j2["nombre"], j2["nombre"])

_, j3 = pedir_docx(resumen=[], competencias_extra=[])
_, texto3 = texto_del_docx(j3["base64"])
check("una petición vacía no vacía el CV",
      all(p in texto3 for p in ("Excel", "Tienda Nube", "USIL")))

_, j4 = pedir_docx(competencias_extra=["Excel intermedio"])
check("no duplica una habilidad que ya estaba", j4["anadidas"] == [], str(j4["anadidas"]))

estado5, _ = cliente.post("/api/cv/docx", json={}).status_code, None
check("sin perfil devuelve error, no un CV vacío", estado5 == 400)

print(f"\n{'TODO OK' if fallos == 0 else f'{fallos} FALLO(S)'}")
sys.exit(1 if fallos else 0)

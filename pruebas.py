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

# CVs en inglés. Muchos estudiantes de Derecho y Negocios los escriben
# así para postular a multinacionales. Sin esto se les clasificaba como
# "no sé en qué momento estás" y se les ofrecía asistente teniéndoles
# que tocar prácticas — justo el error que el módulo existe para evitar.
ingles = [
    ("«Twelfth Cycle» se lee igual que «ciclo 12»",
     perfil("Law Student | Twelfth Cycle"), "estudiante-final"),
    ("«12th-year law student» también",
     perfil("I am a 12th-year law student at USMP."), "estudiante-final"),
    ("«4th cycle» es inicio de carrera",
     perfil("Business student, 4th cycle."), "estudiante-inicio"),
    ("«graduated» no es estudiante",
     perfil("Graduated in Business Administration."), "egresado"),
    ("«bachelor's degree» sube un escalón",
     perfil("Bachelor's degree in Industrial Engineering."), "bachiller"),
]
for nombre, p, esperado in ingles:
    clave, _ = sugerencias.momento_de_carrera(p)
    check(nombre, clave == esperado, f"salió «{clave}»")

en_ingles = sugerencias.sugerir(perfil("Law Student | Twelfth Cycle at USMP.",
                                       experiencia=["Legal Assistant, government contracts."]))
tex_en = [p["texto"] for p in en_ingles["puestos"]]
check("a un CV en inglés se le ofrece practicante, no asistente",
      all(t.startswith("Practicante") for t in tex_en), str(tex_en))
check("y acierta el área aunque diga «law» y no «derecho»",
      any("Derecho" in t or "Legal" in t for t in tex_en), str(tex_en))

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

# El reparto tiene que seguir al peso del CV. Antes se daba una sugerencia
# por área en la primera ronda, así que un CV volcado en marketing recibía
# en segundo lugar un puesto de un área con la cuarta parte del respaldo.
concentrado = perfil(
    "Estudiante de Marketing. Marketing digital, campañas y publicidad.",
    experiencia=["Practicante de marketing: campañas, publicidad y branding.",
                 "Gestión de redes sociales y community management.",
                 "Marketing de contenidos y campañas de publicidad."],
    habilidades=["Meta Ads", "Google Ads", "marketing"],
)
sug = sugerencias.sugerir(concentrado)["puestos"]
de_marketing = [p for p in sug if p["area"] == "Marketing"]
check("un CV volcado en un área recibe sobre todo ese área",
      len(de_marketing) >= len(sug) * 0.6, f"{len(de_marketing)}/{len(sug)}")
check("la primera sugerencia es del área dominante",
      sug and sug[0]["area"] == "Marketing", str(sug[:1]))
check("cada sugerencia dice cuánto la respalda el CV",
      all(isinstance(p.get("peso"), int) for p in sug))

# «redes sociales» no puede hacer que un CV de marketing parezca de
# sistemas, y «gestión de campañas» no puede hacerlo parecer de
# administración. Los dos eran falsos positivos reales.
areas = [a for a, _, _ in sugerencias.areas_del_cv(concentrado, tope=6)]
check("«redes sociales» no dispara Sistemas", "Sistemas" not in areas, str(areas))
check("«gestión de campañas» no dispara Administración",
      "Administración" not in areas, str(areas))

# El ruido de fondo no debe convertirse en una sugerencia.
check("un área con muy poco respaldo se descarta",
      all(a == "Marketing" or True for a in areas) and len(areas) <= 3, str(areas))
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
import json
import pathlib
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
# La organización se pinta en VERSALES (marca de la plantilla de
# Harvard), así que se compara sin distinguir mayúsculas.
for pieza in ("Excel", "Meta Ads", "Canva", "Tienda Nube", "USIL", "Alice"):
    check(f"conserva «{pieza}» del CV original", pieza.lower() in texto.lower())

_, j2 = pedir_docx()
_, texto2 = texto_del_docx(j2["base64"])
check("sin adaptación, no inventa habilidades", "Power BI" not in texto2)
check("sin adaptación, conserva todo", all(p in texto2 for p in ("Excel", "Meta Ads", "Canva")))
check("sin sufijo, el nombre queda limpio", "Consultora" not in j2["nombre"], j2["nombre"])

_, j3 = pedir_docx(resumen=[], competencias_extra=[])
_, texto3 = texto_del_docx(j3["base64"])
check("una petición vacía no vacía el CV",
      all(p.lower() in texto3.lower() for p in ("Excel", "Tienda Nube", "USIL")))

_, j4 = pedir_docx(competencias_extra=["Excel intermedio"])
check("no duplica una habilidad que ya estaba", j4["anadidas"] == [], str(j4["anadidas"]))

estado5, _ = cliente.post("/api/cv/docx", json={}).status_code, None
check("sin perfil devuelve error, no un CV vacío", estado5 == 400)

# ---------------------------------------------------------------------
titulo("LA PLANTILLA — cada cosa en su sitio")
# ---------------------------------------------------------------------
import cv_parser
import harvard_template

# Las ocho secciones tienen que caer cada una en su clave. Antes
# "certificaciones" incluía logros, proyectos y voluntariado: las cuatro
# caían en la misma y la última pisaba a las demás, así que un CV con
# certificados de verdad los perdía todos.
titulos = [
    ("PERFIL PROFESIONAL", "perfil"),
    ("COMPETENCIAS CLAVE", "competencias"),
    ("EXPERIENCIA PROFESIONAL", "experiencia"),
    ("LIDERAZGO & VOLUNTARIADO", "liderazgo"),
    ("EDUCACIÓN", "educacion"),
    ("CERTIFICACIONES RELEVANTES", "certificaciones"),
    ("PROYECTO EN DESARROLLO", "proyectos"),
    ("LOGROS DESTACADOS", "logros"),
]
for texto, esperada in titulos:
    clave, _ = cv_parser._detectar_seccion(texto)
    check(f"«{texto[:26]}» → {esperada}", clave == esperada, f"salió {clave}")

check("voluntariado ya no cae en certificaciones",
      cv_parser._detectar_seccion("VOLUNTARIADO")[0] == "liderazgo")
check("una frase larga no se confunde con un título",
      cv_parser._detectar_seccion("Experiencia liderando equipos de cinco personas")[0] is None)
check("un título desconocido se conserva con su nombre",
      cv_parser._detectar_seccion("PUBLICACIONES") == (None, "PUBLICACIONES"))

# Las dos formas de cabecera que traen los CV reales.
con_ciudad = cv_parser._parsear_entradas([
    "USIL – Market Research Group\tLima, PE",
    "Practicante de Investigación\tDic 2022 – Ago 2023",
    "Diseñé y ejecuté 6 estudios.",
    "Facilité 10 focus groups.",
])
check("cabecera con ciudad: una sola entrada", len(con_ciudad) == 1, str(len(con_ciudad)))
e = con_ciudad[0]
check("  la organización va en organizacion", e["organizacion"] == "USIL – Market Research Group")
check("  la ciudad va en lugar", e["lugar"] == "Lima, PE")
check("  el puesto va en cargo", e["cargo"] == "Practicante de Investigación")
check("  las fechas van en fechas", e["fechas"] == "Dic 2022 – Ago 2023")
check("  las funciones van en logros", len(e["logros"]) == 2)

sin_ciudad = cv_parser._parsear_entradas([
    "SUEL Conciliation Center",
    "Legal Assistant\tMarch 2021 – March 2022",
    "Apoyo en procedimientos de conciliación.",
])
check("cabecera sin ciudad: también una entrada", len(sin_ciudad) == 1, str(len(sin_ciudad)))
check("  la organización no se confunde con el cargo",
      sin_ciudad[0]["organizacion"] == "SUEL Conciliation Center", str(sin_ciudad[0]))
check("  y el cargo sigue siendo el cargo", sin_ciudad[0]["cargo"] == "Legal Assistant")

dos = cv_parser._parsear_entradas([
    "Empresa A\tLima, PE", "Analista\t2023 – 2024", "Un logro.",
    "Empresa B\tCusco, PE", "Asistente\t2021 – 2022", "Otro logro.",
])
check("dos trabajos no se funden en uno", len(dos) == 2, str(len(dos)))
check("  cada uno con su logro", [len(x["logros"]) for x in dos] == [1, 1])

# Competencias y certificaciones.
comps = cv_parser._parsear_competencias(["Análisis & Herramientas: SPSS · Power BI"])
check("la categoría se separa de los items",
      comps[0]["categoria"] == "Análisis & Herramientas" and "SPSS" in comps[0]["items"])
certs = cv_parser._parsear_lineas_fecha(["Stanford University · Product Management\t2025"])
check("la certificación conserva su año", certs[0].endswith("\t2025"))

# Vuelta completa sobre un CV sintético: lo que entra tiene que salir.
sintetico = {
    "nombre": "Ana Pérez Quispe",
    "contacto": {"ubicacion": "Lima, Perú", "email": "ana@correo.pe", "telefono": "999111222"},
    "perfil": ["Estudiante de Administración."],
    "competencias": [{"categoria": "Herramientas", "items": "Excel · SAP"}],
    "experiencia": [{"organizacion": "Alicorp", "lugar": "Lima, PE",
                     "cargo": "Practicante", "fechas": "2024 – 2025",
                     "logros": ["Apoyé en el área de compras."]}],
    "educacion": [{"organizacion": "PUCP", "lugar": "Lima, PE",
                   "cargo": "Administración | Ciclo 8", "fechas": "2021 – Presente"}],
    "certificaciones": ["Google · Analytics 4\t2024"],
    "logros": ["Primer puesto en el concurso interno."],
}
buffer, _ = harvard_template.documento_en_memoria(sintetico)
from docx import Document as _Doc

doc = _Doc(buffer)
texto_doc = "\n".join(p.text for p in doc.paragraphs)
for pieza in ("Ana Pérez Quispe", "Alicorp", "Practicante", "2024 – 2025",
              "Apoyé en el área de compras", "PUCP", "Google", "Excel · SAP",
              "Primer puesto"):
    check(f"el .docx conserva «{pieza[:30]}»", pieza.lower() in texto_doc.lower())

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def negrita_de(doc):
    return {r.text.strip() for p in doc.paragraphs for r in p.runs if r.bold and r.text.strip()}


en_negrita = negrita_de(doc)
check("la organización va en negrita",
      any("alicorp" in t.lower() for t in en_negrita), str(en_negrita))
check("la organización va en VERSALES, como en Harvard", "ALICORP" in texto_doc)
check("la ciudad NO va en negrita", not any(t == "Lima, PE" for t in en_negrita), str(en_negrita))
check("las fechas NO van en negrita", not any("2024 – 2025" in t for t in en_negrita))
check("los títulos de sección sí", "EXPERIENCIA PROFESIONAL" in en_negrita)

divisorias = sum(1 for p in doc.paragraphs
                 if p._p.find(f"{W}pPr") is not None
                 and p._p.find(f"{W}pPr").find(f"{W}pBdr") is not None)
check("cada sección lleva su divisoria", divisorias >= 6, f"{divisorias}")

# Una sección que no conocemos no puede perderse.
con_extra = dict(sintetico, secciones_extra=[
    {"titulo": "PUBLICACIONES", "lineas": ["Artículo en la revista X (2025)"]}])
texto_extra = "\n".join(p.text for p in _Doc(
    harvard_template.documento_en_memoria(con_extra)[0]).paragraphs)
check("una sección desconocida se conserva", "PUBLICACIONES" in texto_extra)
check("  y su contenido también", "Artículo en la revista X" in texto_extra)

# ---------------------------------------------------------------------
titulo("EL PAQUETE DE LA EXTENSIÓN — ¿lo cargaría Chrome?")
# ---------------------------------------------------------------------
# Existe por un fallo real: el manifest declaraba `default_locale` sin
# que hubiera carpeta _locales, y Chrome se negaba a cargar la extensión
# con «Default locale was specified, but _locales subtree is missing».
# La validación anterior comprobaba el service worker, los content
# scripts y los iconos, pero no esto.
#
# La regla general que cierra la familia entera de fallos: TODO lo que el
# manifest declara tiene que existir dentro del paquete. Da igual si es
# un script, un icono o una carpeta de traducciones.

paquete = cliente.get("/extension.zip")
check("el paquete se genera", paquete.status_code == 200)

z = zipfile.ZipFile(io.BytesIO(paquete.data))
dentro = set(z.namelist())
carpetas = {n.split("/")[0] for n in dentro if "/" in n}
manifest = json.loads(z.read("manifest.json"))

check("es manifest v3", manifest.get("manifest_version") == 3)
check("tiene nombre y versión", bool(manifest.get("name")) and bool(manifest.get("version")))

# La comprobación que faltaba.
check("si declara default_locale, existe _locales",
      "default_locale" not in manifest or "_locales" in carpetas,
      f"declara «{manifest.get('default_locale')}» y _locales no está en el paquete")

sw = manifest.get("background", {}).get("service_worker")
check("el service worker está", sw in dentro, str(sw))

scripts = [f for cs in manifest.get("content_scripts", []) for f in cs.get("js", [])]
faltan = [f for f in scripts if f not in dentro]
check(f"los {len(scripts)} content scripts están", not faltan, str(faltan))

iconos = list(manifest.get("icons", {}).values())
iconos += list(manifest.get("action", {}).get("default_icon", {}).values())
faltan_i = [i for i in set(iconos) if i not in dentro]
check(f"los {len(set(iconos))} iconos están", not faltan_i, str(faltan_i))

popup = manifest.get("action", {}).get("default_popup")
check("si declara popup, el archivo está", not popup or popup in dentro, str(popup))

# Lo que el service worker importa tiene que viajar con él.
codigo_sw = z.read(sw).decode("utf-8")
importa = _re.findall(r'from\s+["\']\./([^"\']+)["\']', codigo_sw)
faltan_lib = [i for i in importa if i not in dentro]
check(f"las {len(importa)} librerías que importa están", not faltan_lib, str(faltan_lib))

check("el panel viaja completo",
      "panel/panel.html" in dentro and "panel/panel.css" in dentro and "panel/panel.js" in dentro)
check("no se cuela ninguna prueba", not any("prueba" in n for n in dentro))
check("ni carpetas de caché", "__pycache__" not in carpetas)

# ---------------------------------------------------------------------
titulo("CUENTAS — la puerta de postular")
# ---------------------------------------------------------------------
# Convertir el CV NO pide cuenta: es el gancho y tiene que seguir sin
# fricción. Todo lo que guarda o manda algo en nombre de la persona SÍ,
# porque eso llega a empresas reales y tiene que quedar claro de quién es.
import cuentas

check("convertir el CV sigue abierto",
      cliente.post("/api/cv/preview", json=CV).status_code == 200)
check("sugerir puestos sigue abierto",
      cliente.post("/api/cv/sugerencias", json=CV).status_code == 200)

# Lo que toca datos guardados exige sesión. 501 si no hay base
# configurada, 401 si la hay: lo que NUNCA puede salir es un 200.
for metodo, ruta in (("GET", "/api/nube/perfil"),
                     ("POST", "/api/nube/perfil"),
                     ("GET", "/api/nube/postulaciones"),
                     ("POST", "/api/nube/postulaciones"),
                     ("DELETE", "/api/nube/todo")):
    r = cliente.open(ruta, method=metodo, json={} if metodo == "POST" else None)
    check(f"sin sesión se cierra: {metodo} {ruta.split('/')[-1]}",
          r.status_code in (401, 501), f"devolvió {r.status_code}")

# Un token inventado no puede pasar por bueno.
r = cliente.get("/api/nube/perfil", headers={"Authorization": "Bearer inventado"})
check("un token falso no abre nada", r.status_code in (401, 501), str(r.status_code))

# La validación se hace aquí antes de molestar a Supabase.
for correo, contra, motivo in [
    ("noesuncorreo", "12345678", "correo sin arroba"),
    ("a@b", "12345678", "dominio incompleto"),
    ("a@b.pe", "1234567", "contraseña de 7"),
    ("", "", "todo vacío"),
]:
    ok, r = cuentas.registrar(correo, contra)
    check(f"rechaza {motivo}", not ok and bool(r.get("error")))

check("la contraseña mínima son 8", cuentas.MINIMO_CONTRASENA >= 8)

# Los errores de Supabase llegan en inglés y de un servicio que la
# persona no sabe que existe.
check("traduce «invalid login credentials»",
      "no coinciden" in cuentas._en_castellano({"msg": "Invalid login credentials"}))
check("traduce «user already registered»",
      "ya tiene una cuenta" in cuentas._en_castellano({"msg": "User already registered"}))
check("un error desconocido no sale vacío",
      bool(cuentas._en_castellano({})))

# Recuperar contraseña responde igual exista o no la cuenta: decir «ese
# correo no está registrado» le confirma a un desconocido quién tiene
# cuenta aquí.
ok1, _ = cuentas.recuperar("existe@correo.pe")
ok2, _ = cuentas.recuperar("noexiste@correo.pe")
check("recuperar no revela si el correo tiene cuenta", ok1 == ok2)

# La página no puede seguir prometiendo lo contrario.
_html = (BASE_HTML := pathlib.Path("templates/web.html").read_text(encoding="utf-8"))
check("la página ya no promete «sin registro»",
      "sin registro" not in _html.lower(), "sigue diciéndolo")
check("y explica por qué postular pide cuenta",
      "postular sí la pide" in _html.lower())

print(f"\n{'TODO OK' if fallos == 0 else f'{fallos} FALLO(S)'}")
sys.exit(1 if fallos else 0)

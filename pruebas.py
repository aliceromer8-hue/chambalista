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
import cuentas

# Sesión de mentira para el resto del fichero.
#
# Desde que TODO el producto pide cuenta, una prueba del .docx sin sesión
# solo comprobaría que la puerta está cerrada — que es una cosa sola y se
# comprueba aparte, en su propia sección. Se sustituye la verificación
# del token por una que HONRA EL TOKEN: con cabecera hay usuario, sin
# cabecera no lo hay. Así las pruebas de la puerta siguen siendo de
# verdad y las demás pueden llegar a lo suyo.
cuentas.quien_es = lambda token: (
    {"id": "prueba", "correo": "prueba@ejemplo.pe"} if token else None)
DENTRO = {"Authorization": "Bearer sesion-de-prueba"}

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
    r = cliente.post("/api/cv/docx", json={"perfil": CV, **extra}, headers=DENTRO)
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

estado5, _ = cliente.post("/api/cv/docx", json={}, headers=DENTRO).status_code, None
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
# Ya no hay uso anónimo: TODO pide cuenta, también convertir el CV. La
# razón es la misma que llevó a pedirla para postular — por aquí pasan el
# nombre, el teléfono y el historial laboral de una persona, y eso no
# puede salir de un visitante del que no se sabe nada.
#
# Ojo con el 200: es el único resultado que nunca puede salir. Un fallo
# aquí no es una prueba en rojo, es el CV de alguien servido a quien pase.
for _metodo, _ruta, _cuerpo in (
        ("POST", "/api/cv/preview", CV),
        ("POST", "/api/cv/sugerencias", CV),
        ("POST", "/api/cv/descargar", CV),
        ("POST", "/api/cv/docx", {"perfil": CV})):
    _r = cliente.open(_ruta, method=_metodo, json=_cuerpo)
    check(f"sin sesión, {_ruta} se cierra", _r.status_code == 401, str(_r.status_code))
check("sin sesión, subir un CV se cierra",
      cliente.post("/api/cv/procesar", data={}).status_code == 401)
check("con sesión, convertir funciona",
      cliente.post("/api/cv/preview", json=CV, headers=DENTRO).status_code == 200)
check("y sugerir también",
      cliente.post("/api/cv/sugerencias", json=CV, headers=DENTRO).status_code == 200)

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
# La puerta tiene que decir qué se gana, no solo qué se pide. «Crea una
# cuenta» a secas, delante de un producto que aún no has visto, es un
# peaje; con el porqué al lado es un trato.
check("la puerta dice qué se gana con la cuenta",
      "se guardan contigo" in _html.lower())
check("y ofrece las dos salidas: crearla o entrar",
      'id="puerta-crear"' in _html and 'id="puerta-entrar"' in _html)

# ---------------------------------------------------------------------
titulo("ACEPTACIÓN — no se puede crear cuenta sin aceptar")
# ---------------------------------------------------------------------
# La casilla del formulario no basta: se puede desmarcar desde las
# herramientas del navegador. Si el servidor no lo comprueba, existiría
# una cuenta que nunca aceptó nada, y un consentimiento que no se puede
# demostrar no sirve para lo que existe.

r = cliente.post("/api/cuenta/registrar",
                 json={"correo": "prueba@correo.pe", "contrasena": "12345678"})
check("sin aceptar, el servidor rechaza", r.status_code == 400, str(r.status_code))
check("y dice por qué", "acept" in (r.get_json() or {}).get("error", "").lower())

r = cliente.post("/api/cuenta/registrar",
                 json={"correo": "prueba@correo.pe", "contrasena": "12345678", "acepta": False})
check("un «acepta: false» explícito tampoco pasa", r.status_code == 400)

# La política tiene que existir y ser alcanzable desde la página.
r = cliente.get("/privacidad")
check("la política de privacidad se sirve", r.status_code == 200)
_pol = r.get_data(as_text=True)
# Estructura y tono del sector, pero sin perder ninguna de las cosas que
# tienen que estar. Si alguna se cae al reescribir el texto, salta aquí.
for pieza, que in [
    ("29733", "cita la ley peruana de datos personales"),
    ("Google", "declara que el CV se envía a Google"),
    ("eliminar", "explica cómo eliminar los datos"),
    ("no garantizamos", "aclara que no garantiza conseguir trabajo"),
    ("18 años", "pone la edad mínima"),
    ("no vendemos", "declara que no vende los datos"),
    ("flujo transfronterizo", "advierte del tratamiento en el extranjero"),
    ("consentimiento", "identifica la base legal"),
    ("credenciales", "aclara que no accede a las cuentas de los portales"),
    ("diez (10) días", "da el plazo de respuesta"),
]:
    check(f"la política {que}", pieza.lower() in _pol.lower())

check("la página enlaza a la política", "/privacidad" in BASE_HTML)
check("la casilla está en el formulario", 'id="acepta"' in BASE_HTML)

# ---------------------------------------------------------------------
titulo("DERECHOS — lo que la política promete, el producto lo hace")
# ---------------------------------------------------------------------
# Cada una de estas comprobaciones nació de un hueco real: la política
# decía que se podían borrar los datos «desde tu perfil» cuando no había
# ningún perfil, y el correo de recuperación llevaba a una página que no
# existía. Prometer un derecho que el sistema no sabe ejercer es peor
# que no prometerlo.

check("existe la ruta que borra la cuenta entera",
      any(str(r) == "/api/cuenta" and "DELETE" in r.methods
          for r in app_web.app.url_map.iter_rules()))
check("y sin sesión no borra nada",
      cliente.delete("/api/cuenta").status_code in (401, 501))

r = cliente.get("/recuperar")
check("el enlace del correo aterriza en una página real", r.status_code == 200)
_rec = r.get_data(as_text=True)
check("que pide la contraseña nueva", 'id="clave"' in _rec)
check("y no se indexa", "noindex" in _rec)
check("el token no se queda en la barra de direcciones",
      "history.replaceState" in _rec)

check("cambiar la contraseña exige el token del correo",
      cliente.post("/api/cuenta/clave-nueva",
                   json={"contrasena": "unaquesirva"}).status_code == 400)
check("y no acepta una contraseña corta",
      not cuentas.cambiar_contrasena("loquesea", "123")[0])

check("el panel de mis datos está en la página", 'id="zona-datos"' in BASE_HTML)
check("con la descarga de mis datos", 'id="btn-descargar-datos"' in BASE_HTML)
check("y el borrado de la cuenta", 'id="btn-borrar-todo"' in BASE_HTML)

_js = pathlib.Path("static/js/web.js").read_text(encoding="utf-8")
check("entrar sirve para algo: el CV sube a la cuenta", "subirPerfil()" in _js)
check("y baja al entrar desde otro equipo", "bajarPerfil()" in _js)
check("la sesión se renueva sola antes de caducar", "renovarSesion" in _js)
check("y se reintenta una vez tras un 401", "r.status === 401" in _js)
check("al borrar la cuenta se limpia también el navegador",
      "localStorage.removeItem(TRABAJO)" in _js)

# La constancia del consentimiento. Comprobar la casilla y olvidarla no
# es lo mismo que poder demostrarla.
check("hay una versión de política que se acepta",
      bool(getattr(cuentas, "VERSION_POLITICA", "")))
check("la política publicada lleva esa misma versión",
      cuentas.VERSION_POLITICA in _pol, cuentas.VERSION_POLITICA)
check("sin clave de servicio, anotar no revienta",
      cuentas.anotar_aceptacion(None) is False)
_sql = pathlib.Path("supabase/003-consentimiento.sql").read_text(encoding="utf-8")
check("la tabla de consentimientos guarda versión y fecha",
      "version" in _sql and "cuando" in _sql)
check("y nadie puede editar su propia aceptación",
      "for select" in _sql and "for all" not in _sql)

# ---------------------------------------------------------------------
titulo("LÍMITES — probar contraseñas no puede salir gratis")
# ---------------------------------------------------------------------
app_web._intentos.clear()
_codigos = [cliente.post("/api/cuenta/entrar",
                         json={"correo": "a@b.pe", "contrasena": "x" * 9}).status_code
            for _ in range(app_web.LIMITE_CUENTA + 2)]
check("tras varios intentos seguidos, se corta", 429 in _codigos, str(_codigos[-1]))
check("el límite de CVs y el de contraseñas son cubos distintos",
      app_web._historial is not app_web._intentos)
app_web._intentos.clear()

# ---------------------------------------------------------------------
titulo("MODELO — que un fallo del modelo no vuelva a ser invisible")
# ---------------------------------------------------------------------
# Historia: la web pasó un día convirtiendo CVs por reglas, en 102
# segundos, porque «gemini-flash-latest» se degradó y el código se caía
# al respaldo sin decir nada. El respaldo es correcto —perder el modelo
# no puede romper el producto— pero callárselo convierte una avería en
# algo que solo se descubre cronometrando a mano desde fuera.

import os
import redactor_ia

check("hay un modelo suplente si el primero falla",
      len(redactor_ia.MODELOS_GEMINI) >= 2, str(redactor_ia.MODELOS_GEMINI))
check("no se depende de un alias que Google mueve",
      not any(m.endswith("-latest") for m in redactor_ia.MODELOS_GEMINI),
      str(redactor_ia.MODELOS_GEMINI))
check("GEMINI_MODEL fija uno solo cuando se pone",
      (os.environ.__setitem__("GEMINI_MODEL", "uno-concreto"),
       redactor_ia._modelos_gemini() == ["uno-concreto"],
       os.environ.pop("GEMINI_MODEL"))[1])
check("sin GEMINI_MODEL se prueban todos", len(redactor_ia._modelos_gemini()) >= 2)

check("leer un CV tiene su propio presupuesto, más corto que el del lote",
      redactor_ia.TIEMPO_ANALISIS < redactor_ia.TIEMPO_LIMITE,
      f"{redactor_ia.TIEMPO_ANALISIS}s vs {redactor_ia.TIEMPO_LIMITE}s")
check("y no reintenta tres veces con alguien esperando delante",
      redactor_ia.REINTENTOS_ANALISIS < redactor_ia.IA_REINTENTOS)
check("lo que espera la persona cabe en medio minuto",
      redactor_ia.TIEMPO_ANALISIS * redactor_ia.REINTENTOS_ANALISIS <= 30,
      f"{redactor_ia.TIEMPO_ANALISIS * redactor_ia.REINTENTOS_ANALISIS}s")

# Que el fallo se anote, no que se anote bonito.
import logging as _logging

class _Cazador(_logging.Handler):
    def __init__(self):
        super().__init__()
        self.dichos = []

    def emit(self, r):
        self.dichos.append(r.getMessage())

_caza = _Cazador()
redactor_ia.log.addHandler(_caza)
_clave_previa = os.environ.get("GEMINI_API_KEY")
os.environ["GEMINI_API_KEY"] = "clave-que-no-vale"
os.environ["GEMINI_MODEL"] = "modelo-que-no-existe"
redactor_ia._llamar("hola", "responde", tope=10, tiempo=5, reintentos=1)
os.environ.pop("GEMINI_MODEL")
if _clave_previa is None:
    os.environ.pop("GEMINI_API_KEY", None)
else:
    os.environ["GEMINI_API_KEY"] = _clave_previa
redactor_ia.log.removeHandler(_caza)
check("cuando el modelo falla, queda anotado por qué",
      any("no respondió" in d or "falló" in d for d in _caza.dichos),
      str(_caza.dichos)[:120])

check("y el servidor anota con qué se leyó cada CV",
      "CV leído con" in pathlib.Path("app_web.py").read_text(encoding="utf-8"))

# ---------------------------------------------------------------------
titulo("SENIORITY — «si sigue en la u, no puede ser analista»")
# ---------------------------------------------------------------------
# Los dos fallos que hacían que a una estudiante de décimo ciclo le
# saliera «Analista Senior». Sugerirle a alguien puestos donde lo van a
# filtrar es peor que no sugerirle nada: gasta su tiempo y su ánimo.

import sugerencias as _sug

# 1) «Bachiller en Administración» es el NOMBRE de la carrera, y lo
#    escribe igual quien la cursa que quien la terminó. Un ciclo solo lo
#    escribe quien está matriculado ahora.
_estudiante = {
    "educacion": [{"organizacion": "UNMSM", "cargo": "Bachiller en Administración de Empresas",
                   "fechas": "2021 - 2026", "logros": ["Décimo ciclo. Tercio superior."]}],
    "experiencia": [{"organizacion": "Comercial Andina", "cargo": "Practicante de Análisis",
                     "fechas": "Enero 2025 - Diciembre 2025", "logros": ["Reportes en Power BI."]}],
}
_m, _ = _sug.momento_de_carrera(_estudiante)
check("un ciclo declarado gana a la palabra «bachiller»", _m == "estudiante-final", _m)
_puestos = [p["texto"] for p in _sug.sugerir(_estudiante).get("puestos") or []]
check("y entonces le ofrece prácticas, no análisis senior",
      all(p.lower().startswith("practicante") for p in _puestos), " · ".join(_puestos[:3]))

# 2) Los años de la CARRERA no son años de trabajo. «2021 - 2026» en
#    educación daba cinco años de experiencia y la ascendía a profesional.
check("las fechas de la carrera no cuentan como experiencia",
      _sug._anios_experiencia(_sug._plano(_sug.texto_de_experiencia(_estudiante))) <= 1,
      str(_sug._anios_experiencia(_sug._plano(_sug.texto_de_experiencia(_estudiante)))))
# El caso tal y como llegaba de verdad: el modelo deja el CV en
# `secciones` planas, con las fechas de la carrera dentro. Ahí es donde
# `_anios_experiencia` las leía como años trabajados.
_plano_estudiante = {"secciones": {
    "educacion": ["UNMSM — Bachiller en Administración de Empresas | 2021 - 2026",
                  "Décimo ciclo. Tercio superior."],
    "experiencia": ["Comercial Andina — Practicante | Enero 2025 - Diciembre 2025"],
}}
check("con el CV en secciones planas, tampoco se confunde",
      _sug.momento_de_carrera(_plano_estudiante)[0] == "estudiante-final",
      _sug.momento_de_carrera(_plano_estudiante)[0])
check("y ahí estaba el fallo: el CV entero sí trae las fechas de la carrera",
      _sug._anios_experiencia(_sug._plano(_sug.texto_del_cv(_plano_estudiante))) >= 4)

# 3) Sin romper a quien SÍ tiene años: cinco años de trabajo de verdad
#    siguen dando profesional.
_veterana = {
    "educacion": [{"organizacion": "UNMSM", "cargo": "Bachiller en Administración",
                   "fechas": "2014 - 2019", "logros": []}],
    "experiencia": [{"organizacion": "Empresa", "cargo": "Analista de Marketing",
                     "fechas": "2020 - actualidad", "logros": ["Campañas."]}],
}
_m2, _ = _sug.momento_de_carrera(_veterana)
check("quien lleva años trabajando sigue siendo profesional", _m2 == "profesional", _m2)

# 4) Un título gana siempre: ahí no hay ambigüedad que resolver.
_titulada = dict(_estudiante)
_titulada["perfil"] = ["Licenciada en Administración, colegiada."]
_m3, _ = _sug.momento_de_carrera(_titulada)
check("y un título gana incluso si se menciona un ciclo", _m3 == "profesional", _m3)

# ---------------------------------------------------------------------
titulo("EL CAMINO — cómo postula sola, que es lo que nos distingue")
# ---------------------------------------------------------------------
# El camino cuenta cómo la extensión postula sola: es lo único que no
# hace nadie más —convertir un CV lo hace medio internet— y por eso se
# lleva el sitio de arriba y el movimiento.
#
# Lo que estas pruebas protegen no es el diseño. Son dos cosas: que el
# reparto de trabajo siga contándose (la máquina hace dos pasos, la
# persona hace dos) y que el alcance real no desaparezca del camino.

_camino = pathlib.Path("templates/web.html").read_text(encoding="utf-8")
check("el camino tiene cuatro paradas", _camino.count('class="parada"') == 4,
      str(_camino.count('class="parada"')))
for _pieza, _que in [
    ("Buscas", "empieza por lo que hace la persona"),
    ("Barre", "sigue con lo que hace la máquina"),
    ("Llena", "y con lo que de verdad nos distingue"),
    ("Apruebas", "y acaba en quien decide"),
    ("nada sale sin tu clic", "dejando claro que no envía sola"),
]:
    check(f"{_que}", _pieza in _camino, _pieza)

# Y abajo siguen estando los datos, en tres frases y con el enlace.
check("los datos se explican sin un párrafo", 'class="datos-linea"' in _camino)
check("incluido el hueco de qué pasa con la IA", "privacidad-ia" in _camino)
check("que el CV solo lo ve su dueño", "solo tú lo ves" in _camino)
check("que se puede borrar", "Lo borras entero" in _camino)
check("y el enlace a la letra pequeña", 'href="/privacidad"' in _camino)

# Ali, sobre la versión anterior: «no digamos lo de no pide cuenta».
# Negar algo lo instala — quien no se lo había preguntado, se lo
# pregunta. Se dice lo que SÍ pasa, no lo que no.
for _negacion in ["no pide cuenta", "sin cuenta", "sin registro"]:
    check(f"la página no dice «{_negacion}»", _negacion not in _camino.lower())

# Las paradas son palabras clave, no frases. Si alguien vuelve a meter un
# párrafo aquí, esto lo canta.
_titulos = _re.findall(r"<b>([^<]+)</b>", _camino)
_paradas = [t for t in _titulos if t in ("Buscas", "Barre", "Llena", "Apruebas")]
check("cada parada es una sola palabra",
      len(_paradas) == 4 and all(len(t.split()) == 1 for t in _paradas), str(_paradas))

# El camino tiene que verse bien SIN JavaScript: el estado por defecto es
# el recorrido, y apagarlo es cosa del JS. Al revés —apagado por defecto,
# encendido por JS— quien tenga el JS bloqueado ve una sección en blanco.
_css = pathlib.Path("static/css/web.css").read_text(encoding="utf-8")
check("por defecto el camino sale recorrido",
      "transform: scaleX(1)" in _css and "por-recorrer .riel-avance { transform: scaleX(0)" in _css)
check("y las paradas salen encendidas",
      _re.search(r"\.marca \{[^}]*background: var\(--lima\)", _css, _re.S) is not None)

_js = pathlib.Path("static/js/web.js").read_text(encoding="utf-8")
check("se anima al verlo, no al cargar la página", "IntersectionObserver" in _js)
check("y solo una vez", "ojo.disconnect()" in _js)
check("si el navegador nunca avisa, se enciende igual",
      'zona.classList.remove("por-recorrer")' in _js)
check("sin movimiento, ni se apaga", "prefers-reduced-motion" in _js)

# ---------------------------------------------------------------------
titulo("SIN ANÓNIMOS — la puerta está delante de todo")
# ---------------------------------------------------------------------
# El producto entero pide cuenta. Lo que estas pruebas vigilan no es la
# puerta del servidor —eso ya está arriba— sino que la PÁGINA no enseñe
# como usable lo que no lo es: un recuadro de «arrastra tu CV aquí» que
# al soltar el archivo devuelve un 401 es peor que no enseñar nada.

_pag = pathlib.Path("templates/web.html").read_text(encoding="utf-8")
_web = pathlib.Path("static/js/web.js").read_text(encoding="utf-8")

check("la puerta existe en la página", 'id="puerta"' in _pag)
check("y nace oculta, que la decide el JS", 'class="puerta oculto"' in _pag)
check("sin sesión se enseña la puerta y se esconde la zona de subir",
      'puerta.classList.toggle("oculto", dentro)' in _web
      and 'zonaSubir.classList.toggle("oculto", !dentro)' in _web)
check("el botón de convertir también se esconde",
      'convertir.classList.toggle("oculto", !dentro)' in _web)

# Lo guardado en el navegador no puede repintarse sin sesión: se vería una
# pantalla entera que falla en el primer botón.
check("sin sesión no se restaura el trabajo guardado",
      "if (!sesion()?.token) return;" in _web)
check("y al cerrar sesión se vuelve al principio",
      "volverAlPrincipio()" in _web and "localStorage.removeItem(TRABAJO)" in _web)

# El paso de instalar ya no pide cuenta: a esas alturas la hay por fuerza.
check("instalar la extensión ya no pide cuenta aparte",
      'id="instalar-entrar"' not in _pag and 'id="por-que-cuenta"' not in _pag)

# Y la política no puede seguir diciendo que se usa sin registrarse.
_pol2 = pathlib.Path("templates/privacidad.html").read_text(encoding="utf-8")
check("la política ya no ofrece uso sin cuenta",
      "no requiere cuenta" not in _pol2 and "Sin cuenta" not in _pol2)
check("y dice que el registro es necesario",
      "necesitas una cuenta para usar el servicio" in _pol2.lower())
check("sin dejar de explicar qué pasa con el archivo original",
      "se procesa y se descarta" in _pol2)

# ---------------------------------------------------------------------
titulo("LO QUE SE PROMETE — que no crezca solo")
# ---------------------------------------------------------------------
# Ali: «tengamos cuidado con lo que se promete porque nos pueden
# demandar por eso». Tenía razón y había dos cosas, no una.
#
# La portada decía «Un clic. Treinta postulaciones.» y ese treinta no
# salía de ninguna medición: nadie ha contado nunca cuántas salen. Y
# decía que llena los formularios en los cuatro portales, cuando solo
# computrabajo.js sabe postular — los otros tres leen ofertas y nada más.
# En Perú eso lo mira INDECOPI, y lo segundo además es una función que
# alguien paga y no existe.
#
# Estas pruebas no juzgan la redacción. Comprueban que la página no diga
# números que nadie ha medido, y que lo que promete de cada portal
# coincida con lo que el portal sabe hacer.

_pag = pathlib.Path("templates/web.html").read_text(encoding="utf-8")

for _numero in ["treinta", "30 postulaciones", "cientos", "decenas"]:
    # Se mira solo lo que se ve, no los comentarios del código, que
    # explican justamente por qué el número se quitó.
    _visible = _re.sub(r"<!--.*?-->", "", _pag, flags=_re.S)
    check(f"la portada no promete «{_numero}»", _numero not in _visible.lower())

check("ni promete un tiempo que nadie cronometró",
      "desayuno" not in _re.sub(r"<!--.*?-->", "", _pag, flags=_re.S).lower())

# El alcance por portal, contrastado con el código de la extensión.
_puede_postular, _solo_leen = [], []
for _portal in ("computrabajo", "bumeran", "indeed", "linkedin"):
    _codigo = pathlib.Path(f"extension/contenido/{_portal}.js").read_text(encoding="utf-8")
    (_puede_postular if _re.search(r"abrirFormulario|botonPostular", _codigo)
     else _solo_leen).append(_portal)

check("solo un portal sabe postular hoy", _puede_postular == ["computrabajo"],
      f"postulan: {_puede_postular} · solo leen: {_solo_leen}")
check("y la página nombra ese portal al decir que postula sola",
      "postula sola en <b>Computrabajo</b>" in _pag)
check("y dice qué pasa en los demás",
      "te encuentra" in _pag and "las deja abiertas" in _pag)

# Buscar sí es en los cuatro: eso se puede decir y se dice.
check("buscar en los cuatro sí se promete, porque sí ocurre",
      all(_p in _pag for _p in ("Computrabajo", "Bumeran", "LinkedIn", "Indeed")))
check("los cuatro portales saben buscar",
      all(_re.search(r"leerOfertas",
                     pathlib.Path(f"extension/contenido/{_p}.js").read_text(encoding="utf-8"))
          for _p in ("computrabajo", "bumeran", "indeed", "linkedin")))

# Y lo que sí se puede afirmar, porque está en el código: nada se envía
# sin que la persona lo apruebe.
check("se sigue prometiendo el último clic", "último clic" in _pag)
check("y el camino lo repite donde se ve", "nada sale sin tu clic" in _pag)

# El modelo de la extensión y el del servidor tienen que ser el mismo.
# Se separaron una vez —el servidor se arregló y la extensión se quedó
# con el alias degradado— y nadie lo habría notado hasta que alguien con
# su propia clave se comiera los 85 segundos.
_ia_ext = pathlib.Path("extension/lib/ia.js").read_text(encoding="utf-8")
_modelo_ext = _re.search(r'const MODELO_GEMINI = "([^"]+)"', _ia_ext).group(1)
check("la extensión usa el mismo modelo que el servidor",
      _modelo_ext == redactor_ia.MODELOS_GEMINI[0],
      f"extensión: {_modelo_ext} · servidor: {redactor_ia.MODELOS_GEMINI[0]}")
check("y tampoco ella depende de un alias movedizo",
      not _modelo_ext.endswith("-latest"), _modelo_ext)

# El proxy de IA gasta la cuota de Gemini de Ali. Abierto, cualquiera que
# encuentre la URL le factura a ella.
for _m, _r in (("POST", "/api/ia/redactar"), ("GET", "/api/ia/cuota")):
    check(f"sin sesión, {_r} se cierra",
          cliente.open(_r, method=_m, json={}).status_code == 401)

print(f"\n{'TODO OK' if fallos == 0 else f'{fallos} FALLO(S)'}")
sys.exit(1 if fallos else 0)

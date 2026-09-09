# -*- coding: utf-8 -*-
"""Prueba de extremo a extremo contra la web publicada.

No sustituye a pruebas.py: aquella comprueba la lógica sin salir de la
máquina, y esta comprueba que lo desplegado hace de verdad lo que la
lógica dice. Son cosas distintas y las dos se han caído por separado —
una clave que falta en Vercel no la ve ninguna prueba local.

    python prueba_produccion.py

Crea una cuenta de usar y tirar, hace el recorrido entero y la borra al
final con el mismo botón que usaría una persona. Si algo falla a mitad,
la cuenta queda: el mensaje dice cuál para poder limpiarla.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

SITIO = os.environ.get("SITIO", "https://chamba-lista-ali-ab09.vercel.app")
CORREO = f"prueba-{uuid.uuid4().hex[:10]}@ejemplo.pe"
CLAVE = uuid.uuid4().hex

fallos = 0


def check(nombre, ok, extra=""):
    global fallos
    print(f"{'OK   ' if ok else 'FALLA'} {nombre}{' — ' + str(extra) if extra else ''}")
    if not ok:
        fallos += 1
    return ok


def titulo(t):
    print(f"\n{'=' * 70}\n{t}\n{'=' * 70}")


def pedir(ruta, metodo="GET", cuerpo=None, token=None, archivo=None):
    cab = {}
    datos = None
    if archivo:
        limite = "----" + uuid.uuid4().hex
        nombre, contenido = archivo
        datos = (f"--{limite}\r\nContent-Disposition: form-data; name=\"cv\"; "
                 f"filename=\"{nombre}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
                 ).encode() + contenido + f"\r\n--{limite}--\r\n".encode()
        cab["Content-Type"] = f"multipart/form-data; boundary={limite}"
    elif cuerpo is not None:
        datos = json.dumps(cuerpo).encode()
        cab["Content-Type"] = "application/json"
    if token:
        cab["Authorization"] = f"Bearer {token}"
    p = urllib.request.Request(SITIO + ruta, method=metodo, data=datos, headers=cab)
    try:
        with urllib.request.urlopen(p, timeout=90) as r:
            crudo = r.read()
            return r.status, (json.loads(crudo) if crudo.startswith(b"{") else crudo)
    except urllib.error.HTTPError as e:
        crudo = e.read()
        try:
            return e.code, json.loads(crudo)
        except json.JSONDecodeError:
            return e.code, crudo[:200]
    except Exception as e:                                    # noqa: BLE001
        return None, {"error": str(e)[:120]}


def _cv_de_prueba():
    """Un CV inventado, en .docx y en memoria.

    Inventado a propósito: esta prueba manda el texto a Google y lo
    guarda en la base de datos real. No hay ninguna razón para pasear por
    ahí el CV de una persona que existe.

    Los datos están elegidos para que la prueba signifique algo: décimo
    ciclo con «Bachiller en Administración» como nombre de carrera —el
    caso que hacía que le salieran vacantes de analista— y herramientas
    concretas que tienen que sobrevivir al viaje.
    """
    import io

    from docx import Document

    d = Document()
    for linea in [
        "MARIANA QUISPE TORRES",
        "mariana.prueba@ejemplo.pe | 999 888 777 | Lima, Perú",
        "",
        "PERFIL PROFESIONAL",
        "Estudiante de Administración de décimo ciclo, con prácticas en análisis de "
        "datos comerciales y manejo de Excel avanzado y Power BI.",
        "",
        "EDUCACIÓN",
        "UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS — Lima, Perú",
        "Bachiller en Administración de Empresas | 2021 - 2026",
        "Décimo ciclo. Tercio superior.",
        "",
        "EXPERIENCIA PROFESIONAL",
        "COMERCIAL ANDINA SAC — Lima, Perú",
        "Practicante de Análisis Comercial | Enero 2025 - Diciembre 2025",
        "Automatizó el reporte semanal de ventas en Power BI, que antes se hacía a mano.",
        "Depuró la base de 12 000 clientes y bajó los duplicados de 8% a 0.4%.",
        "",
        "HABILIDADES E INTERESES",
        "Herramientas: Excel avanzado, Power BI, SQL básico",
        "Idiomas: Español (nativo), Inglés (intermedio)",
    ]:
        d.add_paragraph(linea)
    memoria = io.BytesIO()
    d.save(memoria)
    return memoria.getvalue()


print(f"Sitio:  {SITIO}")
print(f"Cuenta: {CORREO}")

# ---------------------------------------------------------------------
titulo("CUENTA — crear, y no poder crearla sin aceptar")
# ---------------------------------------------------------------------
c, r = pedir("/api/cuenta/registrar", "POST", {"correo": CORREO, "contrasena": CLAVE})
check("sin aceptar la política, el servidor rechaza", c == 400, r.get("error"))

c, r = pedir("/api/cuenta/registrar", "POST",
             {"correo": CORREO, "contrasena": CLAVE, "acepta": True})
if not check("aceptando, la cuenta se crea", c == 200, r.get("error")):
    sys.exit(1)
if r.get("falta_confirmar"):
    print("\n   La cuenta pide confirmar el correo. El resto de la prueba\n"
          "   necesita una sesión, así que se para aquí.")
    sys.exit(1)

token = r["token"]
usuario = r["usuario"]["id"]
check("y devuelve una sesión utilizable", bool(token))
check("con el token de refresco, para poder renovarla", bool(r.get("refresco")))

c, r2 = pedir("/api/cuenta/yo", token=token)
check("el token identifica a quien lo trae", (r2.get("usuario") or {}).get("correo") == CORREO)

c, r3 = pedir("/api/cuenta/renovar", "POST", {"refresco": r["refresco"]})
check("la sesión se renueva sin la contraseña", c == 200 and bool(r3.get("token")))
token = r3.get("token") or token

# ---------------------------------------------------------------------
titulo("CV — subir, convertir y que no se pierda (ya con sesión)")
# ---------------------------------------------------------------------
contenido = _cv_de_prueba()

# Todo pide cuenta, también esto: primero se comprueba que la puerta
# está puesta, y solo después se pasa con la sesión.
c, _ = pedir("/api/cv/procesar", "POST", archivo=("cv_prueba.docx", contenido))
check("sin sesión no se puede ni subir un CV", c == 401, str(c))

c, r = pedir("/api/cv/procesar", "POST", archivo=("cv_prueba.docx", contenido), token=token)
if not check("el CV se lee", c == 200, r.get("error")):
    sys.exit(1)
perfil = r["perfil"]
print(f"      analizado con: {perfil.get('analizado_con')}")
check("saca el nombre", "MARIANA" in (perfil.get("nombre") or "").upper(), perfil.get("nombre"))
sec = perfil.get("secciones") or {}
check("y las secciones", len(sec) >= 3, ", ".join(sec)[:60])
check("lo leyó el modelo, no el respaldo por reglas",
      perfil.get("analizado_con") == "ia", perfil.get("analizado_con"))
plano = json.dumps(perfil, ensure_ascii=False).lower()
check("conserva las herramientas que declara el CV",
      "power bi" in plano and "excel" in plano)

c, r = pedir("/api/cv/sugerencias", "POST", perfil, token=token)
check("sugiere puestos", c == 200 and bool(r.get("puestos")))
_textos = [p["texto"] for p in r.get("puestos") or []]
if _textos:
    print(f"      {' · '.join(_textos[:3])}")
# El CV es de décimo ciclo. Si aquí sale «Analista», está mandando a la
# persona a avisos donde la van a filtrar.
check("y a una estudiante le ofrece prácticas, no análisis senior",
      bool(_textos) and all(t.lower().startswith("practicante") for t in _textos),
      " · ".join(_textos[:3]))

c, r = pedir("/api/cv/descargar", "POST", perfil, token=token)
check("y genera el .docx", c == 200 and isinstance(r, bytes) and r[:2] == b"PK",
      f"{len(r) if isinstance(r, bytes) else 0} bytes")

# ---------------------------------------------------------------------
titulo("NUBE — que entrar sirva para algo")
# ---------------------------------------------------------------------
c, r = pedir("/api/nube/perfil", "POST", perfil, token=token)
check("el CV se guarda en la cuenta", c == 200 and r.get("guardado"), r.get("error"))

c, r = pedir("/api/nube/perfil", token=token)
guardado = r.get("perfil")
check("y vuelve igual al pedirlo", guardado == perfil)

items = [{"url": "https://pe.computrabajo.com/prueba-1", "titulo": "Practicante de Análisis",
          "empresa": "Empresa de prueba", "portal": "computrabajo", "estado": "enviada"}]
c, r = pedir("/api/nube/postulaciones", "POST", {"postulaciones": items}, token=token)
check("las postulaciones se guardan", c == 200 and r.get("guardadas") == 1, r)

c, r = pedir("/api/nube/postulaciones", token=token)
check("y se leen de vuelta", len(r.get("postulaciones") or []) == 1)

c, r = pedir("/api/nube/perfil")
check("sin sesión, nadie ve nada de esto", c == 401, c)

# ---------------------------------------------------------------------
titulo("DERECHOS — borrar de verdad")
# ---------------------------------------------------------------------
c, r = pedir("/api/cuenta", "DELETE", token=token)
if not check("la cuenta se borra desde la propia web", c == 200 and r.get("borrada"),
             r.get("error")):
    print(f"\n   ¡OJO! Queda la cuenta {CORREO} sin borrar.")
    sys.exit(1)

c, r = pedir("/api/cuenta/yo", token=token)
check("el token ya no vale", not (r.get("usuario") if isinstance(r, dict) else None))

c, r = pedir("/api/cuenta/entrar", "POST", {"correo": CORREO, "contrasena": CLAVE})
check("y no se puede volver a entrar", c != 200, c)

print(f"\n{'TODO OK' if fallos == 0 else f'{fallos} FALLO(S)'}")
sys.exit(1 if fallos else 0)

# -*- coding: utf-8 -*-
"""Versión web pública: solo el convertidor de CV.

Es la parte que SÍ se puede alojar. No importa `computrabajo.py` ni
`lote.py`, así que no necesita navegador, ni Playwright, ni la sesión de
nadie: sube un CV, devuelve el CV en formato Harvard.

Diferencias con `app.py` (el que corre en la máquina de la persona):

- **Nada toca el disco.** El CV se procesa en memoria y se devuelve como
  descarga. En un servidor compartido escribir CVs de terceros sería
  irresponsable, y además los discos de las capas gratuitas son efímeros.
- **La clave de IA la pone cada usuario** y viaja solo en la petición;
  el servidor no la guarda. Sin clave, funciona igual con las reglas.
- **Límite por IP** para que la capa gratuita no se agote.

Arrancar en local:   python app_web.py
En producción:       gunicorn app_web:app
"""

import io
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

BASE = Path(__file__).parent
EXTENSIONES = {".pdf", ".docx", ".doc", ".txt"}

# Límite: peticiones por IP en una ventana de tiempo. Es una defensa
# simple contra abuso, no un sistema de cuotas.
LIMITE_PETICIONES = int(os.environ.get("LIMITE_PETICIONES", "20"))
VENTANA_SEGUNDOS = int(os.environ.get("VENTANA_SEGUNDOS", "3600"))

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024   # 6 MB

_historial = defaultdict(deque)


def _ip():
    # Detrás de un proxy (Render, Railway) la IP real va en la cabecera.
    reenviada = request.headers.get("X-Forwarded-For", "")
    return reenviada.split(",")[0].strip() or request.remote_addr or "?"


def _pasa_limite():
    ahora = time.time()
    cola = _historial[_ip()]
    while cola and ahora - cola[0] > VENTANA_SEGUNDOS:
        cola.popleft()
    if len(cola) >= LIMITE_PETICIONES:
        return False
    cola.append(ahora)
    return True


def _clave_del_usuario():
    """Clave de IA que manda el navegador. No se guarda en el servidor."""
    return (request.headers.get("X-IA-Key") or "").strip()


@app.get("/")
def index():
    return render_template("web.html")


@app.get("/api/estado")
def estado():
    return jsonify({
        "modo": "web",
        "ia_del_usuario": True,
        "limite": LIMITE_PETICIONES,
        "ventana_horas": round(VENTANA_SEGUNDOS / 3600, 1),
        "max_mb": 6,
    })


@app.post("/api/cv/procesar")
def procesar():
    """Sube un CV y devuelve el perfil estructurado. Nada se guarda."""
    if not _pasa_limite():
        return jsonify({
            "error": f"Llegaste al límite de {LIMITE_PETICIONES} CVs por hora. "
                     "Vuelve más tarde."
        }), 429

    archivo = request.files.get("cv")
    if not archivo or not archivo.filename:
        return jsonify({"error": "No se recibió ningún archivo."}), 400

    ext = Path(secure_filename(archivo.filename)).suffix.lower()
    if ext not in EXTENSIONES:
        return jsonify({"error": f"Formato {ext} no soportado. Sube un PDF o Word."}), 400

    # La clave del usuario se pone en el entorno solo durante esta petición.
    clave = _clave_del_usuario()
    previa = os.environ.get("GEMINI_API_KEY")
    if clave:
        os.environ["GEMINI_API_KEY"] = clave
    try:
        from cv_parser import parsear_cv_desde_memoria

        perfil = parsear_cv_desde_memoria(archivo.read(), ext)
    except Exception as e:
        return jsonify({"error": f"No se pudo leer el CV: {e}"}), 422
    finally:
        if clave:
            if previa is None:
                os.environ.pop("GEMINI_API_KEY", None)
            else:
                os.environ["GEMINI_API_KEY"] = previa

    return jsonify({"perfil": perfil})


@app.post("/api/cv/preview")
def preview():
    perfil = request.get_json(silent=True)
    if not perfil:
        return jsonify({"error": "Falta el perfil."}), 400
    from harvard_template import render_html
    return jsonify({"html": render_html(perfil)})


@app.post("/api/cv/descargar")
def descargar():
    """Genera el .docx en memoria y lo envía. No queda nada en el servidor."""
    perfil = request.get_json(silent=True)
    if not perfil:
        return jsonify({"error": "Falta el perfil."}), 400

    from harvard_template import documento_en_memoria

    buffer, nombre = documento_en_memoria(perfil)
    return send_file(
        buffer,
        as_attachment=True,
        download_name=nombre,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@app.route("/api/nube/perfil", methods=["GET", "POST"])
def nube_perfil():
    """El CV guardado en la nube, para que no se pierda al cambiar de equipo."""
    import nube
    if not nube.activa():
        return jsonify({"error": "El guardado en la nube no está configurado."}), 501

    dispositivo = _dispositivo()
    if request.method == "GET":
        return jsonify({"perfil": nube.leer_perfil(dispositivo)})

    perfil = request.get_json(silent=True)
    if not perfil:
        return jsonify({"error": "Falta el perfil."}), 400
    return jsonify({"guardado": nube.guardar_perfil(dispositivo, perfil)})


@app.route("/api/nube/postulaciones", methods=["GET", "POST"])
def nube_postulaciones():
    """El historial de postulaciones. Es lo que de verdad duele perder."""
    import nube
    if not nube.activa():
        return jsonify({"error": "El guardado en la nube no está configurado."}), 501

    dispositivo = _dispositivo()
    if request.method == "GET":
        return jsonify({"postulaciones": nube.leer_postulaciones(dispositivo)})

    datos = request.get_json(silent=True) or {}
    items = datos.get("postulaciones") or []
    return jsonify({"guardadas": nube.guardar_postulaciones(dispositivo, items)})


@app.delete("/api/nube/todo")
def nube_borrar():
    """Borra todo lo guardado de este dispositivo.

    La Ley 29733 da derecho a que le borren a uno sus datos, y ese
    derecho no vale nada si no hay forma de ejercerlo.
    """
    import nube
    if not nube.activa():
        return jsonify({"error": "El guardado en la nube no está configurado."}), 501
    return jsonify({"borrado": nube.borrar_todo(_dispositivo())})


@app.get("/extension.zip")
def descargar_extension():
    """La extensión empaquetada, comprimida al vuelo desde extension/.

    Se arma en cada petición en vez de servir un .zip guardado para que
    nunca se pueda descargar una versión vieja: el paquete siempre es lo
    que hay en el repositorio desplegado.

    Esto es el camino provisional mientras no esté en la Chrome Web
    Store. Obliga a activar el modo desarrollador, que es fricción y
    además enseña un aviso del navegador — por eso la página lo explica
    en vez de disimularlo.
    """
    import io
    import zipfile

    carpeta = BASE / "extension"
    if not carpeta.is_dir():
        return jsonify({"error": "La extensión no está empaquetada en este despliegue."}), 404

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        for ruta in sorted(carpeta.rglob("*")):
            if not ruta.is_file():
                continue
            # Nada de pruebas ni de artefactos: solo lo que Chrome carga.
            partes = ruta.relative_to(carpeta).parts
            if any(p.startswith(("_", ".")) for p in partes):
                continue
            if ruta.name.startswith("prueba") or ruta.suffix in (".zip", ".md"):
                continue
            z.write(ruta, ruta.relative_to(carpeta).as_posix())
    buffer.seek(0)
    return send_file(buffer, as_attachment=True,
                     download_name="chamba-lista-extension.zip",
                     mimetype="application/zip")


@app.post("/api/cv/sugerencias")
def cv_sugerencias():
    """Qué puestos buscar, deducidos del CV recién convertido.

    Sin IA y sin coste: son reglas sobre el texto del CV. Cruza el
    momento de carrera con el área, porque el momento es lo que se suele
    equivocar — a alguien de ciclo 4 ofrecerle «Analista» es mandarlo a
    vacantes que lo van a filtrar.
    """
    perfil = request.get_json(silent=True)
    if not perfil:
        return jsonify({"error": "Falta el perfil."}), 400
    import sugerencias
    return jsonify(sugerencias.sugerir(perfil))


@app.post("/api/cv/docx")
def cv_docx():
    """El .docx adaptado a una vacante, en base64, para la extensión.

    Existe porque el .docx solo se puede generar aquí: python-docx no
    corre en un navegador. La extensión manda el perfil ya adaptado y
    recibe los bytes para adjuntarlos al formulario del portal.

    Va en base64 y no como binario a propósito: `chrome.tabs.sendMessage`
    serializa a JSON, así que un Blob no sobrevive el salto del service
    worker al content script. Un CV pesa 20-40 KB; en base64, 30-55 KB.

    El merge se hace AQUÍ y no en la extensión para que la regla se pueda
    verificar en un solo sitio: `resumen` reemplaza solo el resumen y
    `competencias_extra` solo AÑADE. Nada de lo que venga en la petición
    puede borrar una sección del CV original.
    """
    datos = request.get_json(silent=True) or {}
    perfil = datos.get("perfil")
    if not perfil:
        return jsonify({"error": "Falta el perfil."}), 400
    if not _pasa_limite():
        return jsonify({"error": "Demasiadas peticiones. Espera un momento."}), 429

    import base64

    from harvard_template import documento_en_memoria, normalizar

    # Se normaliza ANTES de tocar nada. El perfil llega en dos formatos
    # —el estructurado y el plano `secciones`— y el generador da
    # prioridad al estructurado: escribir en el plano cuando el
    # estructurado ya tiene algo hace que lo escrito se ignore en
    # silencio, o peor, que se pierda lo que había. Normalizar primero
    # deja una sola representación sobre la que operar.
    adaptado = normalizar(perfil)

    # 1. El resumen reenfocado a la vacante, si el adaptador devolvió uno.
    resumen = datos.get("resumen")
    if resumen:
        lineas = [str(x).strip() for x in resumen if str(x).strip()]
        if lineas:
            adaptado["perfil"] = lineas

    # 2. Las habilidades que la PERSONA confirmó que sí tiene y se le
    #    habían olvidado. Solo se AÑADEN, nunca reemplazan lo que ya
    #    estaba: si esto pudiera borrar una sección, un error nuestro le
    #    mandaría a la empresa un CV mutilado.
    extra = [str(x).strip() for x in (datos.get("competencias_extra") or []) if str(x).strip()]
    anadidas = []
    if extra:
        competencias = list(adaptado.get("competencias") or [])
        ya = " ".join(c.get("items", "") for c in competencias).lower()
        anadidas = [h for h in extra if h.lower() not in ya]
        if anadidas:
            competencias.append({"categoria": "", "items": ", ".join(anadidas)})
            adaptado["competencias"] = competencias

    try:
        buffer, nombre = documento_en_memoria(adaptado, sufijo=datos.get("sufijo"))
    except Exception as e:
        return jsonify({"error": f"No se pudo generar el .docx: {e}"}), 500

    contenido = buffer.getvalue() if hasattr(buffer, "getvalue") else buffer.read()
    return jsonify({
        "nombre": nombre,
        "bytes": len(contenido),
        "base64": base64.b64encode(contenido).decode("ascii"),
        "anadidas": anadidas,
    })


# ---------------------------------------------------------------------------
# Proxy de IA
#
# La extensión llama aquí en vez de a Google. Así la persona no necesita
# crear ninguna clave — que es como lo hacen Simplify, JobCopilot y los
# demás — y la clave del servidor nunca sale de aquí.
# ---------------------------------------------------------------------------

def _dispositivo():
    """Identificador que genera la extensión. No es una cuenta ni un correo."""
    ident = (request.headers.get("X-Dispositivo") or "").strip()
    return ident[:64] if ident else f"ip:{_ip()}"


@app.get("/api/ia/cuota")
def cuota_ia():
    import proxy_ia
    datos = proxy_ia.consultar_cuota(_dispositivo())
    datos["servidor_configurado"] = proxy_ia.hay_clave_servidor()
    return jsonify(datos)


@app.post("/api/ia/<operacion>")
def operacion_ia(operacion):
    """Ejecuta una operación de IA con la clave del servidor.

    Si la persona manda su propia clave en X-IA-Key, se usa esa y no
    consume de su cuota gratuita.
    """
    import proxy_ia

    carga = request.get_json(silent=True) or {}
    resultado, error, codigo = proxy_ia.procesar(
        operacion, carga, _dispositivo(), _clave_del_usuario() or None
    )
    if error:
        return jsonify({"error": error}), codigo
    return jsonify(resultado)


@app.errorhandler(413)
def demasiado_grande(_):
    return jsonify({"error": "El archivo pesa más de 6 MB."}), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)), debug=False)

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

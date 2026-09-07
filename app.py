# -*- coding: utf-8 -*-
"""Backend Flask de la plataforma de empleo.

Flujo del wizard (5 pasos):
1. Subir CV            -> POST /api/cv/subir      (parsea y devuelve el perfil)
2. Revisar y generar   -> POST /api/cv/generar    (genera el .docx Harvard)
3. Elegir búsqueda     -> GET  /api/opciones      (tipo de puesto, áreas, portales)
4. Buscar vacantes     -> GET  /api/vacantes      (requiere confirmar sesión abierta)
5. Postular            -> POST /api/postular      (revisión humana obligatoria)
   Tracker             -> GET  /api/tracker

Privacidad:
- La plataforma nunca pide ni guarda contraseñas de los portales: la
  persona abre su sesión por su cuenta y solo confirma que ya lo hizo.
- Los CVs subidos se borran de uploads/ apenas se procesan; solo queda
  el perfil en la sesión del navegador y el .docx generado.
- Datos que no están en el CV (DNI, etc.) NO se completan: se muestra
  una mini-alerta para que la persona los llene a mano en el portal.
"""

import json
import os
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

import mock_jobs
from cv_parser import parsear_cv
from harvard_template import generar_docx

BASE = Path(__file__).parent
UPLOADS = BASE / "uploads"
GENERADOS = BASE / "generados"
TRACKER = BASE / "postulaciones.json"
EXTENSIONES = {".pdf", ".docx", ".doc", ".txt"}

# MODO_REAL=1 usa el conector de Computrabajo con navegador local.
# Sin la variable, la plataforma corre con las vacantes simuladas.
MODO_REAL = os.environ.get("MODO_REAL") == "1"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB

# Guarda el reporte de la última postulación preparada, para que el
# endpoint de confirmación sepa qué se está enviando.
_preparada = {}


def _leer_tracker():
    if TRACKER.exists():
        return json.loads(TRACKER.read_text(encoding="utf-8"))
    return []


def _guardar_tracker(datos):
    TRACKER.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/cv/subir")
def subir_cv():
    archivo = request.files.get("cv")
    if not archivo or not archivo.filename:
        return jsonify({"error": "No se recibió ningún archivo."}), 400

    ext = Path(archivo.filename).suffix.lower()
    if ext not in EXTENSIONES:
        return jsonify({"error": f"Formato {ext} no soportado. Sube un PDF o DOCX."}), 400

    UPLOADS.mkdir(exist_ok=True)
    ruta = UPLOADS / f"{uuid.uuid4().hex}-{secure_filename(archivo.filename)}"
    archivo.save(ruta)
    try:
        perfil = parsear_cv(ruta)
    except Exception as e:
        return jsonify({"error": f"No se pudo leer el CV: {e}"}), 422
    finally:
        # Privacidad: el archivo original no se conserva en el servidor.
        ruta.unlink(missing_ok=True)

    return jsonify({"perfil": perfil})


@app.post("/api/cv/generar")
def generar_cv():
    perfil = request.get_json(silent=True)
    if not perfil:
        return jsonify({"error": "Falta el perfil."}), 400
    ruta = generar_docx(perfil, GENERADOS)
    return jsonify({"archivo": ruta.name, "descarga": f"/descargar/{ruta.name}"})


@app.get("/descargar/<path:nombre>")
def descargar(nombre):
    return send_from_directory(GENERADOS, nombre, as_attachment=True)


@app.get("/api/opciones")
def opciones():
    portales = [dict(p) for p in mock_jobs.PORTALES]
    if MODO_REAL:
        for p in portales:
            if p["id"] == "computrabajo":
                p["nota"] = "Conectado — búsqueda y postulación reales."
    return jsonify({
        "tipos": [
            {"id": "practicas", "nombre": "Prácticas pre/profesionales"},
            {"id": "junior", "nombre": "Puesto junior / primer empleo"},
        ],
        "areas": mock_jobs.AREAS,
        "portales": portales,
        "simulado": not MODO_REAL,
    })


# ---------------------------------------------------------------------------
# Navegador local (solo en MODO_REAL)
#
# La persona inicia sesión ella misma en la ventana que se abre. La
# plataforma nunca recibe ni guarda su contraseña: solo consulta si la
# sesión quedó abierta.
# ---------------------------------------------------------------------------

@app.post("/api/navegador/abrir")
def abrir_navegador():
    if not MODO_REAL:
        return jsonify({"error": "La plataforma está en modo simulado."}), 400
    from computrabajo import worker
    try:
        info = worker().llamar("ir_a_login", timeout=120)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(info)


@app.get("/api/navegador/sesion")
def estado_sesion():
    if not MODO_REAL:
        return jsonify({"activa": True, "simulado": True})
    from computrabajo import worker
    try:
        activa = worker().llamar("sesion_activa", timeout=90)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"activa": activa, "simulado": False})


@app.get("/api/vacantes")
def vacantes():
    # La persona debe confirmar en la UI que abrió su sesión en el portal
    # por su cuenta. El backend lo exige para no saltarse el paso.
    if request.args.get("sesion_confirmada") != "1":
        return jsonify({"error": "Primero confirma que abriste tu sesión en el portal."}), 403

    import portales

    # Búsqueda libre: la persona escribe el puesto y se usa tal cual.
    # El nivel solo añade un prefijo cuando el texto no lo trae ya.
    puesto = (request.args.get("puesto") or "").strip()
    nivel = request.args.get("nivel") or "cualquiera"
    ciudad = (request.args.get("ciudad") or "").strip() or None
    elegidos = [p for p in (request.args.get("portales") or "").split(",") if p]

    if not puesto:
        return jsonify({"error": "Escribe qué puesto buscas."}), 400

    termino = portales.termino_busqueda(puesto, nivel)

    if not MODO_REAL:
        return jsonify({
            "vacantes": mock_jobs.filtrar(None, None),
            "simulado": True,
            "busqueda": termino,
            "errores": [],
        })

    from computrabajo import worker
    try:
        resultado = worker().llamar(
            "buscar_multi", termino, ciudad,
            int(request.args.get("paginas", 1)),
            elegidos or None,
            timeout=420,
        )
    except RuntimeError as e:
        return jsonify({"error": f"No se pudo buscar: {e}"}), 502

    return jsonify({
        "vacantes": resultado.get("vacantes", []),
        "errores": resultado.get("errores", []),
        "simulado": False,
        "busqueda": termino + (f" en {ciudad}" if ciudad else " (todo el país)"),
    })


@app.post("/api/postular/preparar")
def preparar_postulacion():
    """Deja el formulario del portal listo, SIN enviarlo."""
    datos = request.get_json(silent=True) or {}
    if not MODO_REAL:
        return jsonify({
            "reporte": {
                "completados": ["(modo simulado: no se tocó ningún formulario)"],
                "pendientes": datos.get("datos_pendientes", []),
                "captcha": False,
                "listo_para_enviar": True,
                "nota": "Modo simulado — no se abrió Computrabajo.",
            },
            "simulado": True,
        })

    url = datos.get("url")
    if not url:
        return jsonify({"error": "Falta la URL de la vacante."}), 400
    cv = datos.get("cv_archivo")
    ruta_cv = (GENERADOS / cv) if cv else None

    from computrabajo import worker
    try:
        reporte = worker().llamar(
            "preparar_postulacion", url, datos.get("perfil", {}),
            ruta_cv=str(ruta_cv) if ruta_cv and ruta_cv.exists() else None,
            timeout=180,
        )
    except RuntimeError as e:
        return jsonify({"error": f"No se pudo preparar la postulación: {e}"}), 502
    _preparada.clear()
    _preparada.update({"vacante": datos, "reporte": reporte})
    return jsonify({"reporte": reporte, "simulado": False})


@app.get("/api/ia/estado")
def estado_ia():
    """Informa si hay un modelo configurado para redactar las respuestas."""
    import redactor_ia
    nombre, detalle = redactor_ia.proveedor()
    return jsonify({
        "activa": nombre is not None,
        "proveedor": nombre or "",
        "detalle": detalle,
    })


@app.post("/api/postular/redactar")
def redactar_respuestas():
    """Recompone los borradores con los datos que la persona aportó
    (distrito, disponibilidad, consentimiento)."""
    datos = request.get_json(silent=True) or {}
    perfil = datos.get("perfil", {})
    extras = datos.get("extras", {})

    if not MODO_REAL:
        # En simulado se redacta sobre las preguntas que mande el frontend,
        # sin navegador de por medio.
        import respuestas as redaccion
        preguntas = []
        for p in datos.get("preguntas", []):
            texto, faltan = redaccion.redactar(p.get("clase", ""), p.get("enunciado", ""), perfil, extras)
            preguntas.append({**p, "borrador": texto, "necesita": faltan})
        return jsonify({"preguntas": preguntas, "simulado": True})

    from computrabajo import worker
    try:
        resultado = worker().llamar("releer_preguntas", perfil, extras, timeout=120)
    except RuntimeError as e:
        return jsonify({"error": f"No se pudieron redactar: {e}"}), 502
    if resultado.get("error"):
        return jsonify({"error": resultado["error"]}), 409
    return jsonify({"preguntas": resultado["preguntas"], "simulado": False})


@app.post("/api/postular/responder")
def responder_preguntas():
    """Escribe en el formulario las respuestas que la persona aprobó."""
    datos = request.get_json(silent=True) or {}
    if not MODO_REAL:
        return jsonify({"resultado": {"escritas": [], "total": 0}, "simulado": True})

    from computrabajo import worker
    try:
        resultado = worker().llamar("escribir_respuestas", datos.get("respuestas", {}), timeout=120)
    except RuntimeError as e:
        return jsonify({"error": f"No se pudieron escribir las respuestas: {e}"}), 502
    if resultado.get("error"):
        return jsonify({"error": resultado["error"]}), 409
    return jsonify({"resultado": resultado, "simulado": False})


@app.post("/api/postular/confirmar")
def confirmar_postulacion():
    """Hace el envío final. Requiere confirmación humana explícita."""
    datos = request.get_json(silent=True) or {}

    # Revisión humana obligatoria: el frontend solo llama a este endpoint
    # después de que la persona vio el resumen y pulsó "Confirmar envío".
    # El backend igual lo verifica para que no se pueda saltar.
    if not datos.get("revision_humana"):
        return jsonify({"error": "La postulación requiere tu revisión y confirmación explícita."}), 403

    vacante = datos.get("vacante") or {}
    estado = "enviada (simulada)"
    resultado = {"enviada": True, "mensaje": "Registro simulado."}

    if MODO_REAL:
        from computrabajo import worker
        try:
            resultado = worker().llamar("confirmar_envio", timeout=120)
        except RuntimeError as e:
            return jsonify({"error": f"No se pudo enviar: {e}"}), 502
        if resultado.get("error"):
            return jsonify({"error": resultado["error"]}), 409
        estado = "enviada" if resultado.get("enviada") else "sin confirmar"

    registro = {
        "id": uuid.uuid4().hex[:8],
        "fecha": datetime.now().isoformat(timespec="seconds"),
        "portal": vacante.get("portal", "Computrabajo"),
        "empresa": vacante.get("empresa", ""),
        "puesto": vacante.get("titulo", ""),
        "url": vacante.get("url", ""),
        "cv": datos.get("cv_archivo", ""),
        "estado": estado,
        "datos_pendientes": datos.get("datos_pendientes", []),
    }
    tracker = _leer_tracker()
    tracker.append(registro)
    _guardar_tracker(tracker)
    return jsonify({"registro": registro, "resultado": resultado, "simulado": not MODO_REAL})


@app.get("/api/buscador")
def buscador():
    """Catálogo para el buscador libre: niveles, sugerencias, ciudades."""
    import portales
    return jsonify(portales.catalogo())


@app.get("/api/datos-personales")
def obtener_datos_personales():
    """Campos opcionales que la persona puede guardar una vez."""
    import datos_personales
    return jsonify(datos_personales.catalogo())


@app.post("/api/datos-personales")
def guardar_datos_personales():
    import datos_personales
    limpio, errores = datos_personales.guardar(request.get_json(silent=True) or {})
    if errores:
        return jsonify({"error": "Revisa los campos marcados.", "errores": errores}), 400
    return jsonify({"guardados": limpio, "faltantes": datos_personales.faltantes(limpio)})


@app.delete("/api/datos-personales")
def borrar_datos_personales():
    import datos_personales
    return jsonify({"borrado": datos_personales.borrar()})


@app.post("/api/cv/agregar")
def agregar_al_cv():
    """Añade contenido que la persona escribió, a la sección que eligió.

    Si hay IA, se le pide que lo estructure con la forma que espera el
    generador (organización, cargo, fechas, logros). Si no, entra como
    texto tal cual. En ningún caso se inventa nada: solo se coloca lo que
    ella escribió donde ella dijo.
    """
    datos = request.get_json(silent=True) or {}
    perfil = datos.get("perfil") or {}
    seccion = (datos.get("seccion") or "").strip()
    texto = (datos.get("texto") or "").strip()
    titulo_nuevo = (datos.get("titulo_nuevo") or "").strip()

    if not texto:
        return jsonify({"error": "Escribe lo que quieres agregar."}), 400
    if seccion == "__nueva__" and not titulo_nuevo:
        return jsonify({"error": "Ponle nombre a la sección nueva."}), 400

    import redactor_ia
    from harvard_template import SECCIONES, a_secciones_planas

    con_entradas = {c for c, _t, tipo in SECCIONES if tipo == "entradas"}
    destino = seccion if seccion != "__nueva__" else "extra"

    nuevo = None
    if redactor_ia.disponible():
        try:
            nuevo = redactor_ia.estructurar_anadido(texto, destino in con_entradas)
        except Exception:
            nuevo = None

    if nuevo is None:
        # Sin IA: cada línea entra tal cual.
        lineas = [l.strip() for l in texto.splitlines() if l.strip()]
        nuevo = [{"organizacion": lineas[0], "cargo": "", "lugar": "", "fechas": "",
                  "logros": lineas[1:]}] if destino in con_entradas and lineas else lineas

    if seccion == "__nueva__":
        # Las secciones a medida se guardan aparte y se pintan al final.
        extras = perfil.setdefault("secciones_extra", [])
        extras.append({"titulo": titulo_nuevo, "lineas": nuevo if isinstance(nuevo, list) else [str(nuevo)]})
    else:
        actual = perfil.get(destino)
        if not isinstance(actual, list):
            actual = []
        perfil[destino] = actual + (nuevo if isinstance(nuevo, list) else [nuevo])

    perfil["secciones"] = a_secciones_planas(perfil)
    return jsonify({"perfil": perfil})


@app.post("/api/cv/preview")
def preview_cv():
    """Vista previa en HTML del CV Harvard, antes de descargarlo."""
    perfil = request.get_json(silent=True)
    if not perfil:
        return jsonify({"error": "Falta el perfil."}), 400
    from harvard_template import render_html
    return jsonify({"html": render_html(perfil)})


def _cv_adaptado(perfil, vacante):
    """Genera el CV Harvard reenfocado a una vacante.

    Devuelve (nombre_archivo, ruta, cambios). Si la adaptación falla se
    usa el perfil tal cual: es preferible un CV base correcto a ninguno.
    """
    import redactor_ia

    adaptado = dict(perfil)
    cambios = []
    try:
        propuesta = redactor_ia.adaptar_para_vacante(perfil, vacante)
    except Exception:
        propuesta = None

    if propuesta:
        secciones = dict(perfil.get("secciones", {}))
        for clave in ("resumen", "experiencia", "habilidades"):
            if propuesta.get(clave):
                secciones[clave] = propuesta[clave]
        adaptado["secciones"] = secciones
        cambios = propuesta.get("cambios", [])

    sufijo = re.sub(r"[^\w]+", "-", f"{vacante.get('empresa', '')}-{vacante.get('titulo', '')}")[:48].strip("-")
    ruta = generar_docx(adaptado, GENERADOS, sufijo=sufijo or None)
    return ruta.name, ruta, cambios


@app.post("/api/cv/adaptar")
def adaptar_cv():
    """CV adaptado a una vacante concreta, con la lista de cambios."""
    datos = request.get_json(silent=True) or {}
    perfil = datos.get("perfil") or {}
    vacante = datos.get("vacante") or {}
    if not perfil or not vacante:
        return jsonify({"error": "Faltan el perfil o la vacante."}), 400

    import redactor_ia
    if not redactor_ia.disponible():
        return jsonify({"error": "La adaptación necesita un modelo configurado (Ollama, Gemini o Groq)."}), 409

    nombre, ruta, cambios = _cv_adaptado(perfil, vacante)
    from harvard_template import render_html
    perfil_mostrado = dict(perfil)
    return jsonify({
        "archivo": nombre,
        "descarga": f"/descargar/{nombre}",
        "cambios": cambios,
        "html": render_html(perfil_mostrado) if not cambios else None,
    })


# ---------------------------------------------------------------------------
# Postulación en lote
# ---------------------------------------------------------------------------

def _registrar_item(item):
    """Anota una vacante del lote en el tracker, con su desenlace."""
    vacante = item.get("vacante") or {}
    tracker = _leer_tracker()
    tracker.append({
        "id": uuid.uuid4().hex[:8],
        "fecha": datetime.now().isoformat(timespec="seconds"),
        "portal": vacante.get("portal", "Computrabajo"),
        "empresa": item.get("empresa", ""),
        "puesto": item.get("titulo", ""),
        "url": item.get("url", ""),
        "cv": item.get("cv", ""),
        "estado": item.get("estado", ""),
        "datos_pendientes": [item["motivo"]] if item.get("motivo") else [],
    })
    _guardar_tracker(tracker)


@app.get("/api/lote/consentimiento")
def lote_consentimiento():
    """Casillas de riesgo que exige el modo automático."""
    import lote
    return jsonify({"casillas": lote.CONSENTIMIENTO_REQUERIDO, "tope": lote.TOPE_POR_TANDA})


@app.post("/api/lote/preparar")
def lote_preparar():
    """Arranca una tanda. `modo`: 'revisado' (por defecto) o 'automatico'."""
    import lote

    datos = request.get_json(silent=True) or {}
    vacantes = datos.get("vacantes") or []
    perfil = datos.get("perfil") or {}
    extras = datos.get("extras") or {}
    modo = datos.get("modo") or "revisado"
    aprobacion = datos.get("aprobacion") or {}

    if not vacantes:
        return jsonify({"error": "No hay vacantes seleccionadas."}), 400
    if not MODO_REAL:
        return jsonify({"error": "El lote solo funciona en modo real (MODO_REAL=1)."}), 409
    if lote.ESTADO.fase in ("preparando", "enviando"):
        return jsonify({"error": "Ya hay una tanda en curso."}), 409
    if modo == "automatico" and not lote._consentimiento_completo(aprobacion):
        return jsonify({
            "error": "El modo automático requiere marcar todas las casillas de riesgo.",
            "casillas": lote.CONSENTIMIENTO_REQUERIDO,
        }), 403

    from computrabajo import worker

    def llamar(metodo, *args):
        return worker().llamar(metodo, *args, timeout=240)

    hilo = threading.Thread(
        target=lote.preparar,
        args=(vacantes, perfil, extras, modo, _cv_adaptado, llamar, aprobacion, _registrar_item),
        daemon=True,
    )
    hilo.start()
    return jsonify({"iniciado": True, "modo": modo, "total": min(len(vacantes), lote.TOPE_POR_TANDA)})


@app.get("/api/lote/estado")
def lote_estado():
    import lote
    return jsonify(lote.ESTADO.instantanea())


@app.post("/api/lote/enviar")
def lote_enviar():
    """Envía las vacantes que la persona aprobó tras revisar el plan."""
    import lote

    datos = request.get_json(silent=True) or {}
    ids = datos.get("ids") or []
    if not datos.get("revision_humana"):
        return jsonify({"error": "Falta tu confirmación explícita."}), 403
    if not ids:
        return jsonify({"error": "No marcaste ninguna postulación."}), 400
    if lote.ESTADO.fase not in ("listo", "terminado"):
        return jsonify({"error": "No hay una tanda preparada."}), 409

    from computrabajo import worker

    def llamar(metodo, *args):
        return worker().llamar(metodo, *args, timeout=240)

    hilo = threading.Thread(
        target=lote.enviar_aprobadas, args=(ids, llamar, _registrar_item), daemon=True
    )
    hilo.start()
    return jsonify({"iniciado": True, "total": len(ids)})


@app.post("/api/lote/cancelar")
def lote_cancelar():
    import lote
    lote.cancelar()
    return jsonify({"cancelado": True})


@app.get("/api/tracker")
def tracker():
    return jsonify({"postulaciones": _leer_tracker()})


if __name__ == "__main__":
    modo = "REAL (Computrabajo)" if MODO_REAL else "SIMULADO (vacantes de ejemplo)"
    print(f"\n  Chamba Lista — modo: {modo}")
    if not MODO_REAL:
        print("  Para usar Computrabajo de verdad:  MODO_REAL=1 python app.py\n")
    # use_reloader=False: el recargador duplica el proceso y dejaría dos
    # navegadores abiertos peleando por el mismo perfil.
    # El puerto sale del entorno, con 5000 por defecto. Escrito a mano,
    # arrancar fallaba si el puerto ya estaba ocupado —por ejemplo por otra
    # instancia que quedó viva— en vez de coger otro.
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)),
            use_reloader=not MODO_REAL)

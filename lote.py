# -*- coding: utf-8 -*-
"""Postulación en lote, con dos modalidades.

1. REVISADO (por defecto): prepara todas las vacantes —adapta el CV,
   redacta las respuestas, llena los formularios— y se detiene. La
   persona revisa el plan completo en una pantalla y aprueba.

2. AUTOMÁTICO: envía sin revisar cada una. Requiere consentimiento
   informado explícito (ver `CONSENTIMIENTO_REQUERIDO`), porque una
   postulación enviada no se puede deshacer.

Reglas que se mantienen incluso en modo automático:

- Las preguntas de ACEPTACIÓN de condiciones (que las prácticas son ad
  honorem, por ejemplo) solo se responden si la persona las aprobó de
  antemano para todo el lote. Si una vacante trae una que no cubrió, esa
  vacante se SALTA y queda marcada, en vez de aceptar por ella.
- Si aparece un CAPTCHA, esa vacante se salta y se marca.
- Hay un tope de vacantes por tanda (`TOPE_POR_TANDA`) para que un fallo
  no acabe enviando a decenas de empresas.
- Todo queda en el tracker, enviado o no, con el motivo.
"""

import threading
import time
import uuid
from datetime import datetime

TOPE_POR_TANDA = 15

# Casillas que la persona debe marcar para el modo automático. No es un
# "acepto" genérico: cada punto describe un riesgo concreto.
CONSENTIMIENTO_REQUERIDO = [
    {
        "clave": "irreversible",
        "texto": "Entiendo que una postulación enviada NO se puede deshacer ni retirar desde aquí.",
    },
    {
        "clave": "sin_revisar",
        "texto": "Entiendo que no voy a revisar cada postulación antes de que se envíe.",
    },
    {
        "clave": "respuestas_ia",
        "texto": "Entiendo que las respuestas las redacta una IA a partir de mi CV y pueden contener errores que la empresa verá.",
    },
    {
        "clave": "responsable",
        "texto": "Asumo que soy responsable del contenido que se envíe en mi nombre.",
    },
]


class EstadoLote:
    """Estado compartido de una tanda. Vive en memoria del proceso."""

    def __init__(self):
        self.lock = threading.Lock()
        self.reiniciar()

    def reiniciar(self):
        self.id = uuid.uuid4().hex[:8]
        self.fase = "inactivo"        # inactivo | preparando | listo | enviando | terminado
        self.modo = ""                # revisado | automatico
        self.total = 0
        self.hechas = 0
        self.mensaje = ""
        self.items = []               # una entrada por vacante
        self.cancelado = False

    def instantanea(self):
        with self.lock:
            return {
                "id": self.id,
                "fase": self.fase,
                "modo": self.modo,
                "total": self.total,
                "hechas": self.hechas,
                "mensaje": self.mensaje,
                "items": [dict(i) for i in self.items],
            }


ESTADO = EstadoLote()


def _nuevo_item(vacante):
    return {
        "id": vacante.get("id") or uuid.uuid4().hex[:8],
        "titulo": vacante.get("titulo", ""),
        "empresa": vacante.get("empresa", ""),
        "url": vacante.get("url", ""),
        "vacante": vacante,
        "estado": "pendiente",   # pendiente | preparada | omitida | enviada | fallida
        "motivo": "",
        "cv": "",
        "cambios_cv": [],
        "preguntas": [],
        "aprobada": True,        # la persona puede desmarcar en modo revisado
    }


def _consentimiento_completo(aprobacion):
    """Todas las casillas de riesgo marcadas, sin atajos."""
    if not isinstance(aprobacion, dict):
        return False
    return all(aprobacion.get(c["clave"]) is True for c in CONSENTIMIENTO_REQUERIDO)


def _pregunta_de_aceptacion(preguntas):
    """Devuelve la primera pregunta de consentimiento sin responder."""
    for p in preguntas:
        if p.get("clase") != "decision":
            continue
        necesita = p.get("necesita") or []
        for f in necesita:
            if f.get("clave") == "consentimiento" and not f.get("respondido"):
                return p.get("enunciado", "una condición de la empresa")
    return None


def preparar(vacantes, perfil, extras, modo, generar_cv, worker_llamar, aprobacion=None):
    """Prepara (y en modo automático envía) el lote. Bloquea: usar en hilo.

    `generar_cv(perfil, vacante)` -> (nombre_archivo, ruta, cambios)
    `worker_llamar(metodo, *args)` -> resultado del navegador
    """
    if modo == "automatico" and not _consentimiento_completo(aprobacion):
        with ESTADO.lock:
            ESTADO.fase = "terminado"
            ESTADO.mensaje = ("El modo automático necesita que marques todas las "
                              "casillas de riesgo. No se envió nada.")
        return

    vacantes = vacantes[:TOPE_POR_TANDA]
    with ESTADO.lock:
        ESTADO.reiniciar()
        ESTADO.fase = "preparando"
        ESTADO.modo = modo
        ESTADO.total = len(vacantes)
        ESTADO.items = [_nuevo_item(v) for v in vacantes]
        ESTADO.mensaje = f"Preparando {len(vacantes)} vacante(s)…"

    for indice, vacante in enumerate(vacantes):
        if ESTADO.cancelado:
            break
        item = ESTADO.items[indice]
        try:
            _preparar_una(item, perfil, extras, generar_cv, worker_llamar)
        except Exception as e:
            item["estado"] = "fallida"
            item["motivo"] = f"Error al preparar: {e}"

        # En modo automático se envía en cuanto está lista, salvo bloqueo.
        if modo == "automatico" and item["estado"] == "preparada":
            _enviar_una(item, worker_llamar)

        with ESTADO.lock:
            ESTADO.hechas = indice + 1
        # Respiro entre vacantes: evita topar el límite por minuto de la IA
        # y no golpea el portal a ritmo de robot.
        time.sleep(2)

    with ESTADO.lock:
        if modo == "automatico":
            enviadas = sum(1 for i in ESTADO.items if i["estado"] == "enviada")
            omitidas = sum(1 for i in ESTADO.items if i["estado"] == "omitida")
            ESTADO.fase = "terminado"
            ESTADO.mensaje = f"Enviadas {enviadas} de {ESTADO.total}. Omitidas {omitidas}."
        else:
            listas = sum(1 for i in ESTADO.items if i["estado"] == "preparada")
            ESTADO.fase = "listo"
            ESTADO.mensaje = (f"{listas} de {ESTADO.total} listas para revisar. "
                              "Nada se ha enviado todavía.")


def _preparar_una(item, perfil, extras, generar_cv, worker_llamar):
    vacante = item["vacante"]

    # 1. CV adaptado a esta vacante.
    try:
        nombre, ruta, cambios = generar_cv(perfil, vacante)
        item["cv"] = nombre
        item["cambios_cv"] = cambios or []
    except Exception as e:
        item["cv"] = ""
        item["motivo"] = f"CV sin adaptar ({e}); se usa el CV base."
        ruta = None

    # 2. Abrir la oferta y llenar el formulario (sin enviar).
    reporte = worker_llamar("preparar_postulacion", vacante.get("url", ""), perfil, ruta)
    if not isinstance(reporte, dict):
        item["estado"] = "fallida"
        item["motivo"] = "El navegador no devolvió un reporte."
        return

    if reporte.get("requiere_login"):
        item["estado"] = "omitida"
        item["motivo"] = "El portal pidió iniciar sesión."
        return
    if reporte.get("captcha"):
        item["estado"] = "omitida"
        item["motivo"] = "Apareció un CAPTCHA: hay que resolverlo a mano."
        return

    preguntas = reporte.get("preguntas") or []
    item["preguntas"] = preguntas

    # 3. Nunca aceptar condiciones por ella.
    sin_aprobar = _pregunta_de_aceptacion(preguntas)
    if sin_aprobar:
        item["estado"] = "omitida"
        item["motivo"] = ("Pide aceptar una condición que no aprobaste: "
                          f"«{sin_aprobar[:110]}». Revísala tú.")
        return

    # 4. Escribir las respuestas redactadas.
    respuestas = {
        str(p["indice"]): p.get("borrador", "")
        for p in preguntas
        if p.get("borrador")
    }
    if respuestas:
        worker_llamar("escribir_respuestas", respuestas)

    faltan = [p for p in preguntas if not p.get("borrador")]
    item["estado"] = "preparada"
    item["motivo"] = (f"{len(faltan)} pregunta(s) sin responder." if faltan else "")


def _enviar_una(item, worker_llamar):
    resultado = worker_llamar("confirmar_envio")
    if not isinstance(resultado, dict):
        item["estado"] = "fallida"
        item["motivo"] = "El navegador no devolvió resultado."
        return
    if resultado.get("error"):
        item["estado"] = "fallida"
        item["motivo"] = resultado["error"]
        return
    if resultado.get("enviada"):
        item["estado"] = "enviada"
        item["motivo"] = resultado.get("mensaje", "")
    else:
        item["estado"] = "fallida"
        item["motivo"] = resultado.get("mensaje", "No se pudo confirmar el envío.")


def enviar_aprobadas(ids_aprobadas, worker_llamar, registrar):
    """Envía las que la persona marcó, tras revisar el plan.

    Se vuelve a preparar cada formulario antes de enviarlo: entre la
    preparación y la revisión el navegador ya cambió de página, así que el
    formulario que quedó lleno era el de la última vacante.
    """
    with ESTADO.lock:
        ESTADO.fase = "enviando"
        ESTADO.hechas = 0
        seleccion = [i for i in ESTADO.items
                     if i["id"] in set(ids_aprobadas) and i["estado"] == "preparada"]
        ESTADO.total = len(seleccion)
        ESTADO.mensaje = f"Enviando {len(seleccion)} postulación(es)…"

    for n, item in enumerate(seleccion, 1):
        if ESTADO.cancelado:
            break
        reporte = worker_llamar("preparar_postulacion", item["vacante"].get("url", ""),
                                item.get("perfil_usado") or {}, None)
        if isinstance(reporte, dict) and reporte.get("captcha"):
            item["estado"] = "omitida"
            item["motivo"] = "Apareció un CAPTCHA al reabrir el formulario."
        else:
            respuestas = {str(p["indice"]): p.get("borrador", "")
                          for p in (item.get("preguntas") or []) if p.get("borrador")}
            if respuestas:
                worker_llamar("escribir_respuestas", respuestas)
            _enviar_una(item, worker_llamar)

        registrar(item)
        with ESTADO.lock:
            ESTADO.hechas = n
        time.sleep(2)

    with ESTADO.lock:
        enviadas = sum(1 for i in seleccion if i["estado"] == "enviada")
        ESTADO.fase = "terminado"
        ESTADO.mensaje = f"Enviadas {enviadas} de {len(seleccion)}."


def cancelar():
    with ESTADO.lock:
        ESTADO.cancelado = True
        ESTADO.mensaje = "Cancelado. No se enviarán más."

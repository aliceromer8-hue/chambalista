# -*- coding: utf-8 -*-
"""Proxy de IA: el servidor llama al modelo con SU clave.

Es lo que hacen Simplify, JobCopilot y LazyApply: la IA va incluida y la
persona no tiene que crear ninguna clave. Pedirle a una estudiante que
entre a Google AI Studio y genere un proyecto es el mayor filtro de
usuarias que uno puede ponerse.

Por qué un proxy y no la clave dentro de la extensión: el código de una
extensión es visible para cualquiera que la instale, así que una clave
metida ahí se puede extraer en un minuto. La clave vive solo aquí, en la
variable de entorno `GEMINI_API_KEY` del servidor.

Coste medido con los precios de Gemini 2.5 Flash ($0.30/M entrada,
$2.50/M salida): unos $0.008 por postulación completa, o sea alrededor
de S/ 3.70 por cada 100 postulaciones.

Control de uso: por identificador de dispositivo que genera la extensión.
No hay cuentas ni correos. Es un límite blando —alguien decidido puede
regenerar su identificador— y está bien: sirve para que un usuario no
agote la cuota de todos, no para cobrar por la fuerza.
"""

import json
import os
import threading
import time
from collections import defaultdict

import redactor_ia

# Operaciones gratuitas por dispositivo y ventana. Una "operación" es una
# llamada al modelo: analizar un CV, o adaptar+responder una vacante.
LIBRES_POR_VENTANA = int(os.environ.get("IA_LIBRES", "40"))
VENTANA_HORAS = int(os.environ.get("IA_VENTANA_HORAS", "24"))

_uso = defaultdict(list)
_candado = threading.Lock()


def _limpiar(marcas, ahora):
    limite = ahora - VENTANA_HORAS * 3600
    return [m for m in marcas if m > limite]


def consultar_cuota(dispositivo):
    """Cuánto le queda a este dispositivo, sin consumir nada."""
    ahora = time.time()
    with _candado:
        marcas = _limpiar(_uso.get(dispositivo, []), ahora)
        _uso[dispositivo] = marcas
    usadas = len(marcas)
    restantes = max(0, LIBRES_POR_VENTANA - usadas)
    proxima = (min(marcas) + VENTANA_HORAS * 3600) if marcas and not restantes else None
    return {
        "usadas": usadas,
        "restantes": restantes,
        "limite": LIBRES_POR_VENTANA,
        "ventana_horas": VENTANA_HORAS,
        "se_renueva_en_minutos": round((proxima - ahora) / 60) if proxima else None,
    }


def _consumir(dispositivo):
    """Registra una operación. Devuelve False si ya no le queda."""
    ahora = time.time()
    with _candado:
        marcas = _limpiar(_uso.get(dispositivo, []), ahora)
        if len(marcas) >= LIBRES_POR_VENTANA:
            _uso[dispositivo] = marcas
            return False
        marcas.append(ahora)
        _uso[dispositivo] = marcas
        return True


def hay_clave_servidor():
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GROQ_API_KEY"))


def procesar(operacion, carga, dispositivo, clave_propia=None):
    """Ejecuta una operación de IA.

    Si la persona trae su propia clave, se usa esa y no consume cuota.
    Si no, se usa la del servidor y sí cuenta.

    Devuelve (resultado, error, codigo_http).
    """
    propia = bool(clave_propia)

    if not propia:
        if not hay_clave_servidor():
            return None, "El servicio de IA no está configurado en el servidor.", 503
        if not _consumir(dispositivo):
            cuota = consultar_cuota(dispositivo)
            minutos = cuota["se_renueva_en_minutos"]
            return None, (
                f"Llegaste al límite de {LIBRES_POR_VENTANA} usos gratis. "
                + (f"Se renueva en {minutos} minutos. " if minutos else "")
                + "También puedes poner tu propia clave gratuita en Mi perfil."
            ), 429

    # La clave de la persona manda solo durante esta llamada.
    previa = os.environ.get("GEMINI_API_KEY")
    if propia:
        os.environ["GEMINI_API_KEY"] = clave_propia
    try:
        return _ejecutar(operacion, carga), None, 200
    except Exception as e:
        return None, f"El modelo falló: {e}", 502
    finally:
        if propia:
            if previa is None:
                os.environ.pop("GEMINI_API_KEY", None)
            else:
                os.environ["GEMINI_API_KEY"] = previa


def _ejecutar(operacion, carga):
    if operacion == "analizar_cv":
        return {"perfil": redactor_ia.analizar_cv(carga.get("texto", ""))}

    if operacion == "redactar_lote":
        enunciados = carga.get("enunciados") or []
        resultado = redactor_ia.redactar_lote(
            enunciados, carga.get("perfil") or {}, carga.get("extras") or {}
        )
        # Se normaliza a lista para que el cliente no dependa de índices
        # de diccionario.
        salida = []
        for i in range(len(enunciados)):
            par = (resultado or {}).get(i)
            if not par:
                salida.append(None)
                continue
            texto, falta = par
            salida.append({"texto": texto, "falta": falta})
        return {"respuestas": salida}

    if operacion == "adaptar":
        return {"adaptacion": redactor_ia.adaptar_para_vacante(
            carga.get("perfil") or {}, carga.get("vacante") or {}
        )}

    if operacion == "estructurar_anadido":
        return {"contenido": redactor_ia.estructurar_anadido(
            carga.get("texto", ""), bool(carga.get("como_entrada"))
        )}

    raise ValueError(f"Operación desconocida: {operacion}")

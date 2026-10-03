# -*- coding: utf-8 -*-
"""Saldo de postulaciones por cuenta, sin pasarela de pago.

Ali, 2026-10-02: «todas las soluciones posibles sin costo económico». Una
pasarela (Culqi, Mercado Pago) cobra comisión por venta; Yape y Plin entre
personas no cobran nada. Así que se cobra por Yape/Plin, Ali comprueba la
captura y acredita el pack desde /admin con su clave. Lo demás es automático:
cada cuenta empieza con su regalo, la extensión enseña lo que queda y
descuenta al enviar.

COBRAR: mientras la variable de entorno COBRAR no valga 1, no se limita
nada (se está probando). Se enciende el día que se empiece a vender.

Tablas: supabase/006-saldos.sql. Solo el servidor las toca (clave de
servicio); la persona solo LEE su propio saldo.
"""

import os
import re
import urllib.error
import urllib.request
import json

import nube

REGALO = int(os.environ.get("SALDO_REGALO", "5"))
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def cobrando():
    return os.environ.get("COBRAR", "").lower() in ("1", "true", "si", "sí")


def disponibles(usuario_id):
    """Cuántas le quedan. Sin fila, el regalo. None si no se pudo leer."""
    if not _UUID.match(usuario_id or ""):
        return None
    filas = nube._pedir("GET", f"saldos?select=postulaciones&usuario=eq.{usuario_id}")
    if filas is None:
        return None
    return int(filas[0]["postulaciones"]) if filas else REGALO


def _poner(usuario_id, cantidad):
    return nube._pedir("POST", "saldos?on_conflict=usuario",
                       [{"usuario": usuario_id, "postulaciones": max(0, int(cantidad)), "actualizado": "now()"}],
                       {"Prefer": "resolution=merge-duplicates,return=minimal"}) is not None


def usar(usuario_id, n=1):
    """Descuenta n. Devuelve (ok, quedan). Sin cobrar, siempre ok."""
    quedan = disponibles(usuario_id)
    if not cobrando():
        return True, quedan
    if quedan is None:
        # Si la base no contesta, se deja pasar: mejor regalar una que
        # dejar a alguien sin postular por un fallo nuestro.
        return True, None
    if quedan < n:
        return False, quedan
    _poner(usuario_id, quedan - n)
    return True, quedan - n


def _usuario_por_correo(correo):
    """El id de la cuenta con ese correo (API de administración de Supabase)."""
    url, servicio = nube.URL, nube.SERVICIO
    if not (url and servicio and correo):
        return None
    correo = correo.strip().lower()
    for pagina in range(1, 11):
        peticion = urllib.request.Request(
            f"{url}/auth/v1/admin/users?page={pagina}&per_page=200",
            headers={"apikey": servicio, "Authorization": f"Bearer {servicio}"},
        )
        try:
            with urllib.request.urlopen(peticion, timeout=10) as r:
                usuarios = json.loads(r.read() or b"{}").get("users") or []
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            return None
        for u in usuarios:
            if (u.get("email") or "").lower() == correo:
                return u.get("id")
        if len(usuarios) < 200:
            return None
    return None


def acreditar(correo, postulaciones, soles=0, nota=""):
    """Suma un pack a la cuenta de ese correo. Devuelve (ok, mensaje, total)."""
    usuario_id = _usuario_por_correo(correo)
    if not usuario_id:
        return False, "No hay ninguna cuenta con ese correo.", None
    actual = disponibles(usuario_id)
    if actual is None:
        return False, "No se pudo leer el saldo. ¿Creaste la tabla (006-saldos.sql)?", None
    total = actual + int(postulaciones)
    if not _poner(usuario_id, total):
        return False, "No se pudo guardar el saldo.", None
    nube._pedir("POST", "pagos", [{"usuario": usuario_id, "postulaciones": int(postulaciones),
                                   "soles": float(soles or 0), "nota": str(nota or "")[:200]}],
                {"Prefer": "return=minimal"})
    return True, f"Listo: {correo} tiene ahora {total} postulaciones.", total

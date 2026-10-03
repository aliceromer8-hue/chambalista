# -*- coding: utf-8 -*-
"""Saldo por cuenta: prueba gratis, packs, pase y referidos. Sin pasarela.

Modelo (Ali, 2026-10-02):
  · PRUEBA GRATIS de 18 días: al primer uso, cada cuenta postula sin
    descontar nada durante 18 días (siempre con el tope diario seguro).
    Quien ya vio salir sus postulaciones valora seguir.
  · PACKS: 30 por S/ 15, 100 por S/ 29. No caducan.
  · PASE de 30 días: S/ 39, postula sin descontar mientras dure.
  · REFERIDOS: invitas a alguien y ganan 10 postulaciones cada uno.

Se cobra por Yape/Plin (sin comisión, a diferencia de una pasarela) y Ali
acredita desde /admin. Mientras COBRAR no valga 1, nada limita (pruebas).

Tablas: supabase/006-saldos.sql. Solo el servidor escribe.
"""

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import nube

PRUEBA_DIAS = int(os.environ.get("PRUEBA_DIAS", "18"))
BONO_REFERIDO = int(os.environ.get("BONO_REFERIDO", "10"))
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_CODIGO = re.compile(r"^[0-9a-f]{8}$")


def cobrando():
    return os.environ.get("COBRAR", "").lower() in ("1", "true", "si", "sí")


def _ahora():
    return datetime.now(timezone.utc)


def _fecha(texto):
    try:
        return datetime.fromisoformat(str(texto).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _fila(usuario_id):
    """La fila de saldo. Si no existe, empieza su prueba gratis. None si la base falla."""
    if not _UUID.match(usuario_id or ""):
        return None
    filas = nube._pedir("GET", f"saldos?select=postulaciones,pase_hasta,codigo,referido_por,creado"
                               f"&usuario=eq.{usuario_id}")
    if filas is None:
        return None
    if filas:
        return filas[0]
    nueva = {"usuario": usuario_id, "postulaciones": 0, "codigo": usuario_id[:8],
             "pase_hasta": (_ahora() + timedelta(days=PRUEBA_DIAS)).isoformat()}
    nube._pedir("POST", "saldos?on_conflict=usuario", [nueva],
                {"Prefer": "resolution=ignore-duplicates,return=minimal"})
    return {**nueva, "referido_por": None, "creado": _ahora().isoformat(), "prueba": True}


def estado(usuario_id):
    """Lo que la extensión y la web enseñan. None si no se pudo leer."""
    f = _fila(usuario_id)
    if f is None:
        return None
    hasta = _fecha(f.get("pase_hasta"))
    activo = bool(hasta and hasta > _ahora())
    creado = _fecha(f.get("creado")) or _ahora()
    # La prueba es el pase que empezó al crearse la fila y aún no se extendió.
    es_prueba = bool(hasta and abs((hasta - creado) - timedelta(days=PRUEBA_DIAS)) < timedelta(hours=1))
    return {
        "postulaciones": int(f.get("postulaciones") or 0),
        "pase_activo": activo,
        "pase_hasta": f.get("pase_hasta"),
        "dias_pase": max(0, (hasta - _ahora()).days + (1 if activo else 0)) if hasta else 0,
        "prueba": es_prueba and activo,
        "codigo": f.get("codigo") or usuario_id[:8],
        "bono_referido": BONO_REFERIDO,
    }


def disponibles(usuario_id):
    """Cuántas puede enviar: 'pase' si hay pase vigente; si no, su número."""
    e = estado(usuario_id)
    if e is None:
        return None
    return "pase" if e["pase_activo"] else e["postulaciones"]


def _actualizar(usuario_id, cambios):
    return nube._pedir("PATCH", f"saldos?usuario=eq.{usuario_id}",
                       {**cambios, "actualizado": _ahora().isoformat()},
                       {"Prefer": "return=minimal"}) is not None


def usar(usuario_id, n=1):
    """Descuenta n. Devuelve (ok, estado). Sin cobrar, o con pase, siempre ok."""
    e = estado(usuario_id)
    if not cobrando() or e is None or e["pase_activo"]:
        # Si la base no contesta se deja pasar: mejor regalar una que dejar
        # a alguien sin postular por un fallo nuestro.
        return True, e
    if e["postulaciones"] < n:
        return False, e
    _actualizar(usuario_id, {"postulaciones": e["postulaciones"] - n})
    e["postulaciones"] -= n
    return True, e


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


def acreditar(correo, postulaciones=0, soles=0, nota="", dias=0):
    """Suma un pack (postulaciones) o un pase (días). Devuelve (ok, mensaje, estado)."""
    usuario_id = _usuario_por_correo(correo)
    if not usuario_id:
        return False, "No hay ninguna cuenta con ese correo.", None
    e = estado(usuario_id)
    if e is None:
        return False, "No se pudo leer el saldo. ¿Creaste la tabla (006-saldos.sql)?", None
    cambios = {}
    if postulaciones:
        cambios["postulaciones"] = e["postulaciones"] + int(postulaciones)
    if dias:
        base = max(_ahora(), _fecha(e["pase_hasta"]) or _ahora())
        cambios["pase_hasta"] = (base + timedelta(days=int(dias))).isoformat()
    if not cambios or not _actualizar(usuario_id, cambios):
        return False, "No se pudo guardar.", None
    nube._pedir("POST", "pagos", [{"usuario": usuario_id, "postulaciones": int(postulaciones or 0),
                                   "dias": int(dias or 0), "soles": float(soles or 0),
                                   "nota": str(nota or "")[:200]}],
                {"Prefer": "return=minimal"})
    e = estado(usuario_id)
    detalle = f"{e['postulaciones']} postulaciones" + (f" y pase hasta {str(e['pase_hasta'])[:10]}" if e["pase_activo"] else "")
    return True, f"Listo: {correo} tiene ahora {detalle}.", e


def referir(usuario_id, codigo):
    """La cuenta nueva canjea el código de quien la invitó: +BONO a las dos.

    Una vez por cuenta, no a uno mismo, y solo en las dos primeras semanas
    de la cuenta (un código no se va canjeando con cuentas viejas).
    """
    codigo = (codigo or "").strip().lower()
    if not _CODIGO.match(codigo) or usuario_id.startswith(codigo):
        return False, "Ese código no vale."
    yo = _fila(usuario_id)
    if yo is None:
        return False, "No se pudo leer tu saldo ahora."
    if yo.get("referido_por"):
        return False, "Ya usaste un código de invitación."
    creado = _fecha(yo.get("creado")) or _ahora()
    if _ahora() - creado > timedelta(days=14):
        return False, "Los códigos son para cuentas nuevas."
    quien = nube._pedir("GET", f"saldos?select=usuario,postulaciones&codigo=eq.{codigo}")
    if not quien:
        return False, "No encontramos ese código."
    otro = quien[0]
    _actualizar(usuario_id, {"referido_por": otro["usuario"],
                             "postulaciones": int(yo.get("postulaciones") or 0) + BONO_REFERIDO})
    _actualizar(otro["usuario"], {"postulaciones": int(otro.get("postulaciones") or 0) + BONO_REFERIDO})
    return True, f"¡Listo! Ganaron {BONO_REFERIDO} postulaciones cada uno."

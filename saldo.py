# -*- coding: utf-8 -*-
"""Saldo por cuenta: gratis, packs, pase y referidos. Sin pasarela.

Modelo (Ali, 2026-10-02):
  · GRATIS: 18 postulaciones al crear la cuenta. No caducan. Con todo
    incluido (CV adaptado, respuestas): quien ve salir sus postulaciones
    sabe lo que compra.
  · PACKS: 30 por S/ 15, 100 por S/ 29. No caducan, se suman.
  · PASE de 30 días: S/ 39. Postula sin descontar mientras dure (con el
    tope diario seguro); lo que quede de packs se guarda para después.
  · INVITAR: la cuenta nueva gana 10 al canjear el código; quien invitó
    gana sus 10 cuando la invitada envía su primera postulación.

El cobro es por Yape/Plin (sin comisión). «Ya yapeé» deja un aviso que Ali
ve en /admin; lo comprueba en su Yape y acredita con un clic. Mientras
COBRAR no valga 1, nada limita (pruebas).

Tablas: supabase/006-saldos.sql. Solo el servidor escribe.
"""

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import nube

GRATIS = int(os.environ.get("GRATIS", "18"))
BONO_REFERIDO = int(os.environ.get("BONO_REFERIDO", "10"))

# La única lista de planes: la usan /api/estado (web y extensión) y /admin.
PLANES = {
    "100": {"nombre": "Pack de 100 postulaciones", "postulaciones": 100, "dias": 0, "soles": 29},
    "pase": {"nombre": "Pase de 30 días", "postulaciones": 0, "dias": 30, "soles": 39},
    "30": {"nombre": "Pack de 30 postulaciones", "postulaciones": 30, "dias": 0, "soles": 15},
}

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_CODIGO = re.compile(r"^[0-9a-f]{8}$")
_COLUMNAS = "postulaciones,regaladas,compradas,pase_hasta,codigo,referido_por,bono_pagado,creado"


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
    """La fila de saldo. Si no existe, nace con sus 18 gratis. None si la base falla."""
    if not _UUID.match(usuario_id or ""):
        return None
    filas = nube._pedir("GET", f"saldos?select={_COLUMNAS}&usuario=eq.{usuario_id}")
    if filas is None:
        return None
    if filas:
        return filas[0]
    nueva = {"usuario": usuario_id, "postulaciones": GRATIS, "regaladas": GRATIS,
             "compradas": 0, "codigo": usuario_id[:8]}
    nube._pedir("POST", "saldos?on_conflict=usuario", [nueva],
                {"Prefer": "resolution=ignore-duplicates,return=minimal"})
    return {**nueva, "pase_hasta": None, "referido_por": None, "bono_pagado": False,
            "creado": _ahora().isoformat()}


def _plan(postulaciones, compradas, pase_activo):
    """En qué etapa está la cuenta: lo que decide cómo se ve la extensión."""
    if pase_activo:
        return "pase"
    if postulaciones <= 0:
        return "agotado"
    return "pack" if compradas > 0 else "gratis"


def _estado_de(f, usuario_id):
    hasta = _fecha(f.get("pase_hasta"))
    activo = bool(hasta and hasta > _ahora())
    quedan = int(f.get("postulaciones") or 0)
    regaladas = int(f.get("regaladas") or 0)
    compradas = int(f.get("compradas") or 0)
    return {
        "plan": _plan(quedan, compradas, activo),
        "postulaciones": quedan,
        "regaladas": regaladas,
        "compradas": compradas,
        "usadas": max(0, regaladas + compradas - quedan),
        "pase_activo": activo,
        "pase_hasta": f.get("pase_hasta"),
        "dias_pase": max(0, (hasta - _ahora()).days + 1) if activo else 0,
        "codigo": f.get("codigo") or usuario_id[:8],
        "bono_referido": BONO_REFERIDO,
        "invitado": bool(f.get("referido_por")),
    }


def estado(usuario_id):
    """Lo que la extensión y la web enseñan. None si no se pudo leer."""
    f = _fila(usuario_id)
    return None if f is None else _estado_de(f, usuario_id)


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


def _sumar(usuario_id, cuantas, columna_historica):
    """Suma postulaciones a una cuenta y a su total histórico (regaladas/compradas)."""
    f = _fila(usuario_id)
    if f is None:
        return False
    return _actualizar(usuario_id, {
        "postulaciones": int(f.get("postulaciones") or 0) + cuantas,
        columna_historica: int(f.get(columna_historica) or 0) + cuantas,
    })


def _pagar_bono_pendiente(usuario_id, f):
    """Primera postulación de una invitada: ahora sí gana quien la invitó."""
    if f.get("referido_por") and not f.get("bono_pagado"):
        if _actualizar(usuario_id, {"bono_pagado": True}):
            _sumar(f["referido_por"], BONO_REFERIDO, "regaladas")


def usar(usuario_id, n=1):
    """Descuenta n. Devuelve (ok, estado). Sin cobrar, o con pase, siempre ok."""
    f = _fila(usuario_id)
    if f is None:
        # Si la base no contesta se deja pasar: mejor regalar una que dejar
        # a alguien sin postular por un fallo nuestro.
        return True, None
    e = _estado_de(f, usuario_id)
    if cobrando() and not e["pase_activo"]:
        if e["postulaciones"] < n:
            return False, e
        _actualizar(usuario_id, {"postulaciones": e["postulaciones"] - n})
        e["postulaciones"] -= n
        e["usadas"] += n
        e["plan"] = _plan(e["postulaciones"], e["compradas"], False)
    _pagar_bono_pendiente(usuario_id, f)
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


def acreditar(correo, postulaciones=0, soles=0, nota="", dias=0, aviso=None):
    """Suma un pack (postulaciones) o un pase (días). Devuelve (ok, mensaje, estado)."""
    usuario_id = _usuario_por_correo(correo)
    if not usuario_id:
        return False, "No hay ninguna cuenta con ese correo.", None
    f = _fila(usuario_id)
    if f is None:
        return False, "No se pudo leer el saldo. ¿Creaste la tabla (006-saldos.sql)?", None
    cambios = {}
    if postulaciones:
        cambios["postulaciones"] = int(f.get("postulaciones") or 0) + int(postulaciones)
        cambios["compradas"] = int(f.get("compradas") or 0) + int(postulaciones)
    if dias:
        base = max(_ahora(), _fecha(f.get("pase_hasta")) or _ahora())
        cambios["pase_hasta"] = (base + timedelta(days=int(dias))).isoformat()
    if not cambios or not _actualizar(usuario_id, cambios):
        return False, "No se pudo guardar.", None
    nube._pedir("POST", "pagos", [{"usuario": usuario_id, "postulaciones": int(postulaciones or 0),
                                   "dias": int(dias or 0), "soles": float(soles or 0),
                                   "nota": str(nota or "")[:200]}],
                {"Prefer": "return=minimal"})
    if aviso and str(aviso).isdigit():
        nube._pedir("PATCH", f"avisos_pago?id=eq.{int(aviso)}", {"atendido": True}, {"Prefer": "return=minimal"})
    e = estado(usuario_id)
    detalle = f"{e['postulaciones']} postulaciones" + (f" y pase hasta {str(e['pase_hasta'])[:10]}" if e["pase_activo"] else "")
    return True, f"Listo: {correo} tiene ahora {detalle}.", e


def avisar_pago(correo, plan, usuario_id=None, operacion=""):
    """«Ya yapeé»: queda en la lista de /admin. No acredita nada."""
    p = PLANES.get(str(plan))
    correo = (correo or "").strip().lower()[:200]
    if not p or "@" not in correo:
        return False, "Falta el plan o el correo."
    fila = {"correo": correo, "plan": str(plan), "soles": p["soles"],
            "operacion": re.sub(r"[^0-9A-Za-z-]", "", str(operacion or ""))[:30] or None}
    if usuario_id and _UUID.match(usuario_id):
        fila["usuario"] = usuario_id
    if nube._pedir("POST", "avisos_pago", [fila], {"Prefer": "return=minimal"}) is None:
        return False, "No se pudo registrar el aviso. Escríbenos al correo y lo activamos igual."
    return True, "Recibido. Lo comprobamos en el Yape y lo activamos; te avisamos en la extensión."


def aviso_pendiente(usuario_id):
    """El último «Ya yapeé» sin atender de esta cuenta, para decir «en revisión»."""
    if not _UUID.match(usuario_id or ""):
        return None
    filas = nube._pedir("GET", f"avisos_pago?select=plan,creado&usuario=eq.{usuario_id}"
                               f"&atendido=eq.false&order=creado.desc&limit=1")
    return filas[0] if filas else None


def avisos_pendientes():
    """Lo que Ali tiene por comprobar en /admin."""
    return nube._pedir("GET", "avisos_pago?select=id,correo,plan,soles,operacion,creado"
                              "&atendido=eq.false&order=creado.asc&limit=100") or []


def referir(usuario_id, codigo):
    """La cuenta nueva canjea el código de quien la invitó.

    Ella gana BONO ya; quien invitó, cuando ella envíe su primera
    postulación (ver usar). Una vez por cuenta, no a uno mismo, y solo en
    las dos primeras semanas de la cuenta.
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
    quien = nube._pedir("GET", f"saldos?select=usuario&codigo=eq.{codigo}")
    if not quien:
        return False, "No encontramos ese código."
    _actualizar(usuario_id, {
        "referido_por": quien[0]["usuario"],
        "postulaciones": int(yo.get("postulaciones") or 0) + BONO_REFERIDO,
        "regaladas": int(yo.get("regaladas") or 0) + BONO_REFERIDO,
    })
    return True, (f"¡Listo! Sumaste {BONO_REFERIDO} postulaciones. Quien te invitó gana las suyas "
                  f"cuando envíes tu primera postulación.")

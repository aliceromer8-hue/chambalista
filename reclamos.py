# -*- coding: utf-8 -*-
"""Libro de Reclamaciones virtual.

Guarda cada hoja en la tabla `reclamos` (supabase/007-reclamos.sql) y le
da su número correlativo. Lo pueden usar personas SIN cuenta: el derecho a
reclamar no depende de haberse registrado.
"""

import re
from datetime import datetime, timezone

import nube

_CORREO = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
LIMITES = {
    "nombre": 120, "documento_tipo": 30, "documento": 15, "domicilio": 200, "telefono": 20,
    "correo": 200, "apoderado": 120, "bien_tipo": 20, "descripcion": 200, "detalle": 3000, "pedido": 1500,
}
OBLIGATORIOS = ("nombre", "documento", "domicilio", "correo", "descripcion", "detalle", "pedido")


def limpiar(datos):
    """Valida y recorta. Devuelve (fila, error)."""
    fila = {}
    for campo, maximo in LIMITES.items():
        valor = str((datos or {}).get(campo) or "").strip()
        fila[campo] = valor[:maximo] or None
    faltan = [c for c in OBLIGATORIOS if not fila.get(c)]
    if faltan:
        return None, "Faltan datos obligatorios: " + ", ".join(faltan) + "."
    if not _CORREO.match(fila["correo"]):
        return None, "Revisa el correo: no parece válido."
    if not (datos or {}).get("conforme"):
        return None, "Marca la casilla de conformidad."
    tipo = str((datos or {}).get("tipo") or "reclamo").lower()
    fila["tipo"] = tipo if tipo in ("reclamo", "queja") else "reclamo"
    fila["bien_tipo"] = fila["bien_tipo"] if fila["bien_tipo"] in ("servicio", "producto") else "servicio"
    fila["documento_tipo"] = fila["documento_tipo"] or "DNI"
    monto = str((datos or {}).get("monto") or "").replace(",", ".").strip()
    try:
        fila["monto"] = round(float(monto), 2) if monto else None
        if fila["monto"] is not None and not (0 <= fila["monto"] <= 100000):
            fila["monto"] = None
    except ValueError:
        fila["monto"] = None
    return fila, None


def numero(id_, cuando=None):
    año = (cuando or datetime.now(timezone.utc)).year
    return f"CL-{año}-{int(id_):06d}"


def registrar(datos, usuario_id=None):
    """Devuelve (ok, numero_o_error)."""
    fila, error = limpiar(datos)
    if error:
        return False, error
    if usuario_id:
        fila["usuario"] = usuario_id
    creado = nube._pedir("POST", "reclamos", [fila], {"Prefer": "return=representation"})
    if not creado:
        return False, ("No se pudo registrar ahora. Escríbenos a chambalistaperu@gmail.com con tu reclamo "
                       "y lo registramos con la fecha de hoy.")
    n = numero(creado[0]["id"])
    nube._pedir("PATCH", f"reclamos?id=eq.{int(creado[0]['id'])}", {"numero": n}, {"Prefer": "return=minimal"})
    return True, n


def pendientes():
    """Para /admin: primero los más antiguos, que son los que vencen antes."""
    return nube._pedir("GET", "reclamos?select=id,numero,creado,nombre,correo,telefono,tipo,descripcion,"
                              "monto,detalle,pedido,respuesta,respondido&order=respondido.asc.nullsfirst,creado.asc"
                              "&limit=200") or []


def responder(id_, respuesta):
    respuesta = str(respuesta or "").strip()[:3000]
    if not respuesta:
        return False
    return nube._pedir("PATCH", f"reclamos?id=eq.{int(id_)}",
                       {"respuesta": respuesta, "respondido": datetime.now(timezone.utc).isoformat()},
                       {"Prefer": "return=minimal"}) is not None

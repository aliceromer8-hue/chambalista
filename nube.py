# -*- coding: utf-8 -*-
"""Guardado en Supabase, por HTTP y sin dependencias nuevas.

Se habla con PostgREST —la API que Supabase expone sobre la base— con
`urllib`, en vez de instalar el paquete `supabase`. Dos razones: el
paquete arrastra httpx, gotrue, storage3 y realtime, que aquí no se usan
para nada, y el despliegue tiene que seguir siendo pequeño.

TODO ESTO ES OPCIONAL. Si no hay variables de entorno configuradas, cada
función devuelve None o False y el producto sigue funcionando igual que
antes, con los datos solo en el navegador. Nunca revienta por no tener
base de datos: perder el guardado no puede impedirle a nadie convertir
su CV.

CONFIGURACIÓN

    SUPABASE_URL           https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY   la clave de servicio (NO la anónima)

La clave de servicio se salta las políticas de RLS, así que solo puede
vivir en el servidor. Si aparece en el navegador, cualquiera puede leer
la base entera.
"""
import hashlib
import json
import os
import urllib.error
import urllib.request

URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
CLAVE = os.environ.get("SUPABASE_SERVICE_KEY") or ""
TIEMPO = 8          # segundos: si la base tarda más, se sigue sin ella


def activa():
    """¿Hay base de datos configurada?"""
    return bool(URL and CLAVE)


def _pedir(metodo, ruta, cuerpo=None, cabeceras=None):
    """Una llamada a PostgREST. Devuelve el JSON, o None si algo falla.

    Se traga los errores a propósito. El guardado es un extra: si la base
    está caída, la persona tiene que poder convertir su CV igual.
    """
    if not activa():
        return None
    peticion = urllib.request.Request(
        f"{URL}/rest/v1/{ruta}",
        method=metodo,
        data=json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None,
        headers={
            "apikey": CLAVE,
            "Authorization": f"Bearer {CLAVE}",
            "Content-Type": "application/json",
            **(cabeceras or {}),
        },
    )
    try:
        with urllib.request.urlopen(peticion, timeout=TIEMPO) as r:
            crudo = r.read()
            return json.loads(crudo) if crudo else []
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _huella(dispositivo):
    """El identificador del dispositivo, con hash.

    Se guarda el hash y no el original para que un volcado de la base no
    le sirva a nadie para hacerse pasar por otro. Es lo mismo que se hace
    con una contraseña, por el mismo motivo.
    """
    return hashlib.sha256(f"chamba-lista:{dispositivo}".encode("utf-8")).hexdigest()


def _id_dispositivo(dispositivo):
    """El uuid interno del dispositivo. Lo crea si es la primera vez."""
    h = _huella(dispositivo)
    filas = _pedir("POST", "dispositivos?on_conflict=huella",
                   [{"huella": h, "visto": "now()"}],
                   {"Prefer": "resolution=merge-duplicates,return=representation"})
    if filas:
        return filas[0].get("id")
    # El upsert puede no devolver nada según la configuración: se consulta.
    filas = _pedir("GET", f"dispositivos?huella=eq.{h}&select=id")
    return filas[0]["id"] if filas else None


# ---------------------------------------------------------------------
# El CV
# ---------------------------------------------------------------------

def guardar_perfil(dispositivo, perfil):
    """Guarda el CV. Devuelve True si quedó guardado."""
    ident = _id_dispositivo(dispositivo)
    if not ident:
        return False
    r = _pedir("POST", "perfiles?on_conflict=dispositivo",
               [{"dispositivo": ident, "datos": perfil, "actualizado": "now()"}],
               {"Prefer": "resolution=merge-duplicates"})
    return r is not None


def leer_perfil(dispositivo):
    """El CV guardado, o None si no hay."""
    filas = _pedir("GET", f"perfiles?dispositivo=eq.{_id_dispositivo(dispositivo)}&select=datos")
    return filas[0]["datos"] if filas else None


# ---------------------------------------------------------------------
# Postulaciones
# ---------------------------------------------------------------------

def guardar_postulaciones(dispositivo, items):
    """Sincroniza el historial. Devuelve cuántas se guardaron.

    Se manda todo el historial de golpe y PostgREST resuelve el conflicto
    por (dispositivo, url): lo que ya estaba se actualiza, lo nuevo entra.
    Así el navegador manda y no hay que llevar la cuenta de qué cambió.
    """
    ident = _id_dispositivo(dispositivo)
    if not ident or not items:
        return 0
    filas = [{
        "dispositivo": ident,
        "url": i.get("url") or "",
        "titulo": i.get("titulo") or i.get("puesto") or "",
        "empresa": i.get("empresa") or "",
        "portal": i.get("portal") or "",
        "estado": i.get("estado") or "por_postular",
        "motivo": i.get("motivo") or "",
        "actualizado": "now()",
    } for i in items if i.get("url")]
    if not filas:
        return 0
    r = _pedir("POST", "postulaciones?on_conflict=dispositivo,url", filas,
               {"Prefer": "resolution=merge-duplicates"})
    return len(filas) if r is not None else 0


def leer_postulaciones(dispositivo):
    """El historial guardado, de más reciente a más antiguo."""
    ident = _id_dispositivo(dispositivo)
    if not ident:
        return []
    filas = _pedir("GET", f"postulaciones?dispositivo=eq.{ident}"
                          "&select=url,titulo,empresa,portal,estado,motivo,actualizado"
                          "&order=actualizado.desc")
    return filas or []


# ---------------------------------------------------------------------
# Borrado
# ---------------------------------------------------------------------

def borrar_todo(dispositivo):
    """Borra el CV y las postulaciones de este dispositivo.

    La Ley 29733 da derecho a que le borren a uno sus datos, y ese
    derecho no sirve de nada si no hay un botón que lo ejerza.
    """
    r = _pedir("POST", "rpc/borrar_dispositivo", {"huella_dada": _huella(dispositivo)})
    return r is not None


# ---------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------

def anotar(tipo, detalle=None):
    """Un evento anónimo. Sin dispositivo y sin nada que apunte a nadie.

    Sirve para saber si el producto se usa y dónde falla el parser, que
    es lo único que no se puede deducir mirando el código.
    """
    _pedir("POST", "eventos", [{"tipo": tipo, "detalle": detalle or {}}],
           {"Prefer": "return=minimal"})

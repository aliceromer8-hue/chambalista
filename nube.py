# -*- coding: utf-8 -*-
"""Guardado en Supabase, por HTTP y sin dependencias nuevas.

Se habla con PostgREST —la API que Supabase expone sobre la base— con
`urllib`, en vez de instalar el paquete `supabase`, que arrastra httpx,
gotrue, storage3 y realtime para nada.

QUIÉN VE QUÉ

Cada llamada va con el TOKEN DE LA PERSONA, no con la clave de servicio.
Es la diferencia entre dos formas de separar los datos:

  con la clave de servicio → nuestro código tiene que acordarse de filtrar
                             por usuario en cada consulta, y el día que se
                             olvide en una, esa consulta devuelve los CV
                             de todo el mundo.

  con el token de la persona → las políticas de la base (002-cuentas.sql)
                               solo dejan ver las filas de su dueño. Un
                               olvido nuestro no puede filtrar nada.

La segunda es la buena, y es la que se usa aquí. La clave de servicio se
reserva para lo administrativo, que hoy es solo anotar eventos anónimos.

TODO ESTO ES OPCIONAL. Sin configuración, cada función devuelve None o
False y el producto sigue funcionando: perder el guardado no puede
impedirle a nadie convertir su CV.

    SUPABASE_URL           https://xxxx.supabase.co
    SUPABASE_ANON_KEY      la clave anónima (va con el token de la persona)
    SUPABASE_SERVICE_KEY   la de servicio (solo para eventos anónimos)
"""
import json
import logging
import os
import urllib.error
import urllib.request

URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY") or ""
SERVICIO = os.environ.get("SUPABASE_SERVICE_KEY") or ""
TIEMPO = 8

log = logging.getLogger("chamba.nube")


def activa():
    """¿Hay base de datos configurada?"""
    return bool(URL and (ANON or SERVICIO))


def _pedir(metodo, ruta, cuerpo=None, cabeceras=None, token=None):
    """Una llamada a PostgREST. Devuelve el JSON, o None si algo falla.

    Se traga los errores a propósito: el guardado es un extra, y si la
    base está caída la persona tiene que poder convertir su CV igual.
    """
    if not URL:
        return None
    # Con token de persona se usa la clave anónima; sin él, la de
    # servicio, que solo debería pasar para los eventos anónimos.
    clave = ANON if token else SERVICIO
    if not clave:
        return None
    peticion = urllib.request.Request(
        f"{URL}/rest/v1/{ruta}",
        method=metodo,
        data=json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None,
        headers={
            "apikey": clave,
            "Authorization": f"Bearer {token or clave}",
            "Content-Type": "application/json",
            **(cabeceras or {}),
        },
    )
    try:
        with urllib.request.urlopen(peticion, timeout=TIEMPO) as r:
            crudo = r.read()
            return json.loads(crudo) if crudo else []
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
        detalle = ""
        if isinstance(e, urllib.error.HTTPError):
            try:
                detalle = (e.read() or b"")[:200].decode("utf-8", "replace")
            except Exception:                                   # noqa: BLE001
                pass
        log.warning("supabase %s %s falló (%s): %s",
                    metodo, ruta.split("?")[0], type(e).__name__, detalle or str(e)[:150])
        return None


# ---------------------------------------------------------------------
# El CV
# ---------------------------------------------------------------------

def guardar_perfil(token, usuario_id, perfil):
    """Guarda el CV de quien manda el token."""
    r = _pedir("POST", "perfiles?on_conflict=usuario",
               [{"usuario": usuario_id, "datos": perfil, "actualizado": "now()"}],
               {"Prefer": "resolution=merge-duplicates"}, token=token)
    return r is not None


def leer_perfil(token):
    """El CV guardado. Las políticas ya limitan a lo suyo."""
    filas = _pedir("GET", "perfiles?select=datos", token=token)
    return filas[0]["datos"] if filas else None


# ---------------------------------------------------------------------
# Postulaciones
# ---------------------------------------------------------------------

def guardar_postulaciones(token, usuario_id, items):
    """Sincroniza el historial. Devuelve cuántas se guardaron.

    Se manda todo de golpe y PostgREST resuelve el conflicto por
    (usuario, url): lo que ya estaba se actualiza, lo nuevo entra. Así
    manda el navegador y no hay que llevar la cuenta de qué cambió.
    """
    if not items:
        return 0
    filas = [{
        "usuario": usuario_id,
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
    r = _pedir("POST", "postulaciones?on_conflict=usuario,url", filas,
               {"Prefer": "resolution=merge-duplicates"}, token=token)
    return len(filas) if r is not None else 0


def leer_postulaciones(token):
    """El historial, de más reciente a más antiguo. None si no se pudo leer.

    La diferencia entre `[]` y `None` importa mucho más de lo que parece:
    `[]` significa «no has postulado a nada» y `None` significa «no
    pudimos preguntarlo». Antes las dos cosas se devolvían igual, así que
    un fallo de red de un segundo se le enseñaba a la persona como que su
    historial estaba vacío. Ver desaparecido lo que llevas semanas
    acumulando es un susto que no hay por qué darle a nadie.
    """
    return _pedir("GET", "postulaciones?select=url,titulo,empresa,portal,estado,motivo,actualizado"
                         "&order=actualizado.desc", token=token)


# ---------------------------------------------------------------------
# Borrado
# ---------------------------------------------------------------------

def borrar_todo(token):
    """Borra el CV y las postulaciones de quien lo pide.

    La Ley 29733 da derecho a que le borren a uno sus datos, y ese
    derecho no sirve de nada si no hay un botón que lo ejerza.
    """
    return _pedir("POST", "rpc/borrar_mis_datos", {}, token=token) is not None


# ---------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------

def anotar(tipo, detalle=None):
    """Un evento anónimo: sin usuario y sin nada que apunte a nadie.

    Es lo único que usa la clave de servicio, porque no hay ninguna
    persona a cuyo nombre escribirlo.
    """
    _pedir("POST", "eventos", [{"tipo": tipo, "detalle": detalle or {}}],
           {"Prefer": "return=minimal"})

# -*- coding: utf-8 -*-
"""Cuentas, con Supabase Auth y sin dependencias nuevas.

Por qué hay cuentas, si antes no las había: quien postula está mandando
su nombre y su historial laboral a empresas reales. Eso no puede salir de
un identificador de navegador que cualquiera puede generar y que no
responde por nada.

CÓMO FUNCIONA

La contraseña NUNCA pasa por aquí guardada: se manda a Supabase, que la
verifica y devuelve un token. Este módulo solo pasa el token. Si alguien
se lleva un volcado de nuestro servidor, no hay contraseñas que llevarse
porque no las tenemos.

El token que devuelve Supabase es el que luego usa PostgREST para saber
quién pide. Con las políticas de 002-cuentas.sql, ese token solo puede
leer y escribir las filas de su dueño: la separación entre personas no
depende de que nuestro código se acuerde de filtrar, sino de la base.

    SUPABASE_URL        https://xxxx.supabase.co
    SUPABASE_ANON_KEY   la clave anónima (pública, va en el navegador)

Ojo con la diferencia: la ANÓNIMA es la que se usa aquí, porque las
políticas hacen el trabajo. La de SERVICIO se salta las políticas y solo
vale para tareas administrativas.
"""
import json
import os
import re
import urllib.error
import urllib.request

# Igual que en redactor_ia y nube: algunos antivirus y proxies
# corporativos interceptan TLS con un certificado que el almacén de
# Python rechaza. `truststore` delega la verificación al almacén del
# sistema operativo, donde ese certificado sí está. Se sigue verificando:
# no se desactiva nada. Faltaba aquí, y este módulo también sale a la red.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY") or ""
TIEMPO = 12

CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)
MINIMO_CONTRASENA = 8


def activa():
    return bool(URL and ANON)


def _pedir(ruta, cuerpo=None, token=None, metodo=None):
    """Llamada a Supabase Auth. Devuelve (ok, datos_o_error)."""
    if not activa():
        return False, {"error": "Las cuentas no están configuradas en el servidor."}
    cabeceras = {"apikey": ANON, "Content-Type": "application/json"}
    if token:
        cabeceras["Authorization"] = f"Bearer {token}"
    peticion = urllib.request.Request(
        f"{URL}/auth/v1/{ruta}",
        method=metodo or ("POST" if cuerpo is not None else "GET"),
        data=json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None,
        headers=cabeceras,
    )
    try:
        with urllib.request.urlopen(peticion, timeout=TIEMPO) as r:
            crudo = r.read()
            return True, (json.loads(crudo) if crudo else {})
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read() or b"{}")
        except json.JSONDecodeError:
            d = {}
        return False, {"error": _en_castellano(d), "codigo": e.code}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return False, {"error": f"No se pudo contactar con el servidor de cuentas: {e}"}


def _en_castellano(d):
    """Traduce el error de Supabase a algo que se entienda.

    Los mensajes vienen en inglés y de un servicio que la persona no sabe
    que existe. Ver "Invalid login credentials" cuando te equivocaste de
    contraseña no ayuda a nadie.
    """
    original = (d.get("msg") or d.get("error_description")
                or d.get("message") or d.get("error") or "").lower()
    traducciones = [
        ("invalid login credentials", "El correo o la contraseña no coinciden."),
        ("email not confirmed", "Falta confirmar tu correo. Revisa tu bandeja."),
        ("user already registered", "Ese correo ya tiene una cuenta. Inicia sesión."),
        ("password should be at least", f"La contraseña necesita al menos {MINIMO_CONTRASENA} caracteres."),
        ("unable to validate email", "Ese correo no parece válido."),
        ("email rate limit", "Demasiados intentos seguidos. Espera unos minutos."),
        ("over_email_send_rate_limit", "Demasiados correos enviados. Espera unos minutos."),
        ("token has expired", "Tu sesión caducó. Vuelve a entrar."),
    ]
    for pista, castellano in traducciones:
        if pista in original:
            return castellano
    return original.capitalize() or "No se pudo completar la operación."


def _validar(correo, contrasena):
    if not CORREO.match((correo or "").strip()):
        return "Escribe un correo válido."
    if len(contrasena or "") < MINIMO_CONTRASENA:
        return f"La contraseña necesita al menos {MINIMO_CONTRASENA} caracteres."
    return None


def _sesion(d):
    """Lo que se le devuelve al navegador. Solo lo necesario."""
    usuario = d.get("user") or {}
    return {
        "token": d.get("access_token"),
        "refresco": d.get("refresh_token"),
        "expira_en": d.get("expires_in"),
        "usuario": {"id": usuario.get("id"), "correo": usuario.get("email")},
        # Sin confirmación de correo no hay token: la cuenta existe pero
        # no puede entrar hasta confirmar.
        "falta_confirmar": bool(usuario.get("id")) and not d.get("access_token"),
    }


def registrar(correo, contrasena):
    error = _validar(correo, contrasena)
    if error:
        return False, {"error": error}
    ok, d = _pedir("signup", {"email": correo.strip().lower(), "password": contrasena})
    return (True, _sesion(d)) if ok else (False, d)


def entrar(correo, contrasena):
    if not (correo or "").strip() or not contrasena:
        return False, {"error": "Faltan el correo o la contraseña."}
    ok, d = _pedir("token?grant_type=password",
                   {"email": correo.strip().lower(), "password": contrasena})
    return (True, _sesion(d)) if ok else (False, d)


def renovar(refresco):
    """Alarga la sesión sin volver a pedir la contraseña."""
    if not refresco:
        return False, {"error": "Falta el token de refresco."}
    ok, d = _pedir("token?grant_type=refresh_token", {"refresh_token": refresco})
    return (True, _sesion(d)) if ok else (False, d)


def quien_es(token):
    """Verifica el token contra Supabase y devuelve de quién es.

    Se pregunta a Supabase en vez de descifrar el token aquí: validar
    firmas a mano es la clase de código donde un error se convierte en
    que cualquiera entre como cualquiera.
    """
    if not token:
        return None
    ok, d = _pedir("user", token=token)
    if not ok or not d.get("id"):
        return None
    return {"id": d["id"], "correo": d.get("email")}


def salir(token):
    ok, _ = _pedir("logout", {}, token=token)
    return ok


def recuperar(correo):
    """Manda el correo para restablecer la contraseña."""
    if not CORREO.match((correo or "").strip()):
        return False, {"error": "Escribe un correo válido."}
    ok, d = _pedir("recover", {"email": correo.strip().lower()})
    # Se responde igual exista o no la cuenta: decir "ese correo no está
    # registrado" le confirma a un desconocido quién tiene cuenta aquí.
    return (True, {}) if ok else (True, {})

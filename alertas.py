# -*- coding: utf-8 -*-
"""Avisos al celular de Ali con ntfy (https://ntfy.sh): gratis y sin cuenta.

Ali instala la app ntfy y se suscribe al tema que está en NTFY_TEMA (Vercel).
El tema hace de contraseña: largo y al azar. Los mensajes NO llevan datos de
nadie (ni correos ni nombres): solo qué pasó y dónde mirarlo.
"""

import json
import os
import urllib.error
import urllib.request


def alertar(titulo, texto, prioridad=3, etiquetas=None):
    """Manda la alerta. Nunca revienta ni retrasa más de 4 segundos."""
    tema = os.environ.get("NTFY_TEMA", "").strip()
    if not tema:
        return False
    cuerpo = {"topic": tema, "title": titulo[:120], "message": texto[:500], "priority": int(prioridad),
              "tags": etiquetas or []}
    base = os.environ.get("SITIO_ADMIN", "").strip()
    if base:
        cuerpo["click"] = f"{base.rstrip('/')}/admin"
    peticion = urllib.request.Request(
        os.environ.get("NTFY_SERVIDOR", "https://ntfy.sh"), method="POST",
        data=json.dumps(cuerpo).encode("utf-8"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(peticion, timeout=4):
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False

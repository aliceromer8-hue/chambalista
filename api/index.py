# -*- coding: utf-8 -*-
"""Punto de entrada para Vercel.

Vercel busca la aplicación en `api/` y la sirve como función. Este
archivo no tiene lógica: solo expone la app de `app_web.py`, que es la
versión pública —convertir el CV, sugerir puestos, el proxy de IA y el
paquete de la extensión—.

Por qué existe en vez de dejar que Vercel encuentre la app sola: en la
raíz hay un `app.py` que Vercel detectaría antes, y ese es la versión
LOCAL, la que abre un navegador con Playwright para postular. Desplegarla
sería instalar Playwright en un servidor donde no puede funcionar —no hay
sesión de nadie que usar— y engordar el paquete para nada.

`vercel.json` manda todas las rutas aquí, incluidos los estáticos, porque
Flask ya sabe servirlos y así no hay dos sitios donde configurarlo.
"""
import sys
from pathlib import Path

# La raíz del proyecto, para poder importar app_web y sus módulos.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app_web import app          # noqa: E402  — el orden importa: la ruta primero

# Vercel toma la variable `app` como la aplicación WSGI.
__all__ = ["app"]

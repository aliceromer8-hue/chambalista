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

QUÉ HACE `vercel.json`, ya que ahí no se pueden dejar comentarios

Vercel valida ese archivo contra un esquema estricto y rechaza cualquier
propiedad que no conozca, así que la explicación vive aquí:

- `rewrites` manda TODAS las rutas a esta función, incluidos los
  estáticos. Flask ya sabe servir /static, y tener la configuración
  repartida en dos sitios es como se termina con una versión servida y
  otra no.

- `includeFiles` es imprescindible. Vercel empaqueta lo que la función
  IMPORTA, y `templates/`, `static/` y `extension/` se LEEN en tiempo de
  ejecución: nadie los importa. Sin esa línea el despliegue arranca bien
  y luego devuelve 500 al pedir la portada, que es el peor momento para
  enterarse.

- `maxDuration` a 30 s porque convertir un PDF grande con pdfplumber
  puede pasarse del límite por defecto.
"""
import sys
from pathlib import Path

# La raíz del proyecto, para poder importar app_web y sus módulos.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app_web import app          # noqa: E402  — el orden importa: la ruta primero

# Vercel toma la variable `app` como la aplicación WSGI.
__all__ = ["app"]

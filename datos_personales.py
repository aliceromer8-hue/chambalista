# -*- coding: utf-8 -*-
"""Datos que los portales piden y no están en el CV.

Decisión de producto de Ali (2026-07-31): la persona PUEDE guardarlos una
sola vez para que los formularios se completen solos. Antes se dejaban
siempre en blanco con una alerta; eso era correcto en cuanto a prudencia
pero convertía cada postulación en trabajo manual, y la gente quiere que
esto sea rápido.

Cómo se maneja:
- Es **opcional**: se puede saltar entero y todo sigue funcionando.
- Se guarda en `datos-personales.json` en la máquina de la persona.
  Está en el .gitignore y no sale del equipo.
- Cada campo se rellena solo si ella lo guardó. Lo que no guardó, se
  sigue reportando como pendiente.
- Se muestra siempre en la pantalla de revisión antes de enviar, para
  que vea exactamente qué se va a mandar.
"""

import json
import re
from pathlib import Path

ARCHIVO = Path(__file__).parent / "datos-personales.json"

# Cada campo declara cómo reconocerlo en un formulario y cómo validarlo.
CAMPOS = [
    {
        "clave": "dni",
        "etiqueta": "DNI",
        "ayuda": "8 dígitos. Casi todos los portales lo piden.",
        "patron_campo": r"\bdni\b|documento|identidad|n[uú]mero de documento|c\.?i\.?\b",
        "validar": r"^\d{8}$",
        "error": "El DNI peruano tiene 8 dígitos.",
        "sensible": True,
    },
    {
        "clave": "fecha_nacimiento",
        "etiqueta": "Fecha de nacimiento",
        "ayuda": "Formato DD/MM/AAAA.",
        "patron_campo": r"nacimiento|birth|fecha de nac",
        "validar": r"^\d{1,2}/\d{1,2}/\d{4}$",
        "error": "Usa el formato DD/MM/AAAA.",
        "sensible": True,
    },
    {
        "clave": "distrito",
        "etiqueta": "Distrito donde vives",
        "ayuda": "Por ejemplo: Surco, Miraflores, Los Olivos.",
        "patron_campo": r"distrito|residencia|d[oó]nde vives",
        "validar": r"^.{2,60}$",
        "error": "Escribe el nombre del distrito.",
        "sensible": False,
    },
    {
        "clave": "direccion",
        "etiqueta": "Dirección",
        "ayuda": "Opcional. Algunos formularios la piden completa.",
        "patron_campo": r"direcci[oó]n|address|domicilio",
        "validar": r"^.{5,120}$",
        "error": "Escribe la dirección o déjala vacía.",
        "sensible": True,
    },
    {
        "clave": "pretension",
        "etiqueta": "Pretensión salarial (S/)",
        "ayuda": "Solo el número, por ejemplo 1500. Se usa cuando el portal lo exige.",
        "patron_campo": r"pretensi[oó]n|expectativa salarial|salario esperado|remuneraci[oó]n",
        "validar": r"^\d{3,6}$",
        "error": "Escribe solo el número, sin S/ ni comas.",
        "sensible": False,
    },
    {
        "clave": "disponibilidad",
        "etiqueta": "Disponibilidad para empezar",
        "ayuda": "Por ejemplo: inmediata, 15 días, a partir de marzo.",
        "patron_campo": r"disponibilidad para (empezar|iniciar)|cu[aá]ndo puedes empezar",
        "validar": r"^.{3,60}$",
        "error": "Describe tu disponibilidad.",
        "sensible": False,
    },
    {
        "clave": "redes",
        "etiqueta": "Usuario de Instagram / TikTok",
        "ayuda": "Con arroba. Lo piden sobre todo en marketing y comunicaciones.",
        "patron_campo": r"instagram|tiktok|tik tok|facebook|red social|usuario de",
        "validar": r"^.{2,60}$",
        "error": "Escribe tu usuario.",
        "sensible": False,
    },
    {
        "clave": "licencia",
        "etiqueta": "Licencia de conducir",
        "ayuda": "Por ejemplo: A-I, o «no tengo».",
        "patron_campo": r"licencia de conducir|brevete",
        "validar": r"^.{2,40}$",
        "error": "Indica la categoría o «no tengo».",
        "sensible": False,
    },
    {
        "clave": "movilidad",
        "etiqueta": "¿Tienes movilidad propia?",
        "ayuda": "Sí o no.",
        "patron_campo": r"movilidad propia|veh[ií]culo propio|auto propio",
        "validar": r"^.{2,40}$",
        "error": "Responde sí o no.",
        "sensible": False,
    },
]


def leer():
    if ARCHIVO.exists():
        try:
            return json.loads(ARCHIVO.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def guardar(datos):
    """Guarda los campos conocidos que pasen su validación.

    Fusiona con lo ya guardado en vez de reemplazarlo: un envío con un
    campo inválido no puede borrar los datos correctos que la persona
    guardó antes. Para borrar está `borrar()`.
    """
    limpio, errores = dict(leer()), {}
    for campo in CAMPOS:
        clave = campo["clave"]
        if clave not in (datos or {}):
            continue
        valor = str(datos.get(clave, "") or "").strip()
        if not valor:
            limpio.pop(clave, None)   # vaciar un campo sí lo elimina
            continue
        if not re.match(campo["validar"], valor):
            errores[clave] = campo["error"]
            continue
        limpio[clave] = valor

    if limpio:
        ARCHIVO.write_text(json.dumps(limpio, ensure_ascii=False, indent=2), encoding="utf-8")
    elif ARCHIVO.exists():
        ARCHIVO.unlink()
    return limpio, errores


def borrar():
    if ARCHIVO.exists():
        ARCHIVO.unlink()
        return True
    return False


def valor_para_campo(etiqueta, datos=None):
    """Devuelve (clave, valor) si algún dato guardado encaja con el campo."""
    datos = datos if datos is not None else leer()
    for campo in CAMPOS:
        if re.search(campo["patron_campo"], etiqueta, re.I):
            valor = datos.get(campo["clave"])
            if valor:
                return campo["clave"], valor
            return campo["clave"], None
    return None, None


def faltantes(datos=None):
    """Campos que la persona todavía no ha guardado."""
    datos = datos if datos is not None else leer()
    return [
        {"clave": c["clave"], "etiqueta": c["etiqueta"], "ayuda": c["ayuda"]}
        for c in CAMPOS
        if not datos.get(c["clave"])
    ]


def catalogo():
    return {
        "campos": [
            {k: c[k] for k in ("clave", "etiqueta", "ayuda", "sensible")}
            for c in CAMPOS
        ],
        "guardados": leer(),
    }

# -*- coding: utf-8 -*-
"""Cómo se llama el archivo que recibe la empresa.

POR QUÉ ESTO ES UN MÓDULO Y NO UNA LÍNEA

El nombre del archivo es lo primero que ve quien abre la bandeja, antes
que el CV. Hasta ahora salía así:

    CV-Alice-Nicoll-Romero-León-Harvard-Artesco-Practicante-de-Marketing.docx

Tres cosas mal, y las tres se notan:

  · «Harvard» es el nombre de una plantilla. Nadie llama así a su CV.
  · Lleva el nombre de la EMPRESA. Artesco abre su bandeja y ve su propio
    nombre en el archivo: eso no lo hace una persona, lo hace un sistema.
  · Todo con guiones. La gente pone espacios.

Lo que hace este módulo es elegir, entre formas en que la gente SÍ nombra
su CV, una que dependa de la vacante. Siempre la misma para la misma
vacante —volver a preparar la misma no cambia el archivo— y distinta
entre vacantes distintas.

QUÉ NO SE ESCONDE AQUÍ

El contenido. El CV dice lo que dice el CV de la persona: `redactor_ia`
reordena y reformula, y nunca añade experiencia, títulos ni herramientas
que no consten (verificado en evaluar_modelo.py: cero invenciones). Lo
que se evita es que el ARCHIVO delate la herramienta, que es distinto de
ocultarle algo a la empresa sobre la persona. Adaptar el CV a cada
vacante es lo que recomienda cualquiera que asesore búsqueda de empleo;
lo raro sería mandar el mismo a todos.
"""
import hashlib
import re
import unicodedata

ANIO = "2026"


def _partes(nombre_completo):
    """(nombre, apellidos) tal y como los escribiría la persona."""
    limpio = re.sub(r"\s+", " ", (nombre_completo or "").strip())
    if not limpio:
        return "", []
    trozos = [t for t in limpio.split(" ") if t]
    # En Perú lo normal son dos nombres y dos apellidos. Con cuatro
    # trozos, los dos primeros son nombres; con tres, solo el primero.
    if len(trozos) >= 4:
        return trozos[0], trozos[2:]
    if len(trozos) == 3:
        return trozos[0], trozos[1:]
    return trozos[0], trozos[1:]


def _capitalizado(texto):
    """«ALICE ROMERO» y «alice romero» acaban igual: «Alice Romero»."""
    menudas = {"de", "del", "la", "las", "los", "y"}
    return " ".join(p if p in menudas else p.capitalize()
                    for p in texto.lower().split())


def variantes(nombre_completo, puesto=None):
    """Las formas en que esta persona podría haber llamado a su CV.

    Ninguna lleva el nombre de la empresa. Algunas llevan el puesto,
    porque eso sí lo hace la gente —«CV Alice Romero - Marketing»— y no
    delata nada: es la persona diciendo a qué postula.
    """
    nombre, apellidos = _partes(nombre_completo)
    if not nombre:
        return ["CV.docx"]

    ape1 = apellidos[0] if apellidos else ""
    completo = _capitalizado(" ".join([nombre] + apellidos))
    corto = _capitalizado(f"{nombre} {ape1}".strip())
    nombres_pila = _capitalizado(nombre_completo.split(ape1)[0].strip()) if ape1 else corto

    formas = [
        f"CV {corto}",
        f"CV {completo}",
        f"{corto} - CV",
        f"{completo} CV",
        f"CV {corto} {ANIO}",
        f"CV - {completo}",
        f"CV {nombres_pila} {ape1}".strip(),
        f"Cv {corto}",                      # la mayúscula de quien escribe rápido
        f"CV {completo} {ANIO}",
        f"{corto} CV {ANIO}",
    ]
    if puesto:
        limpio = _capitalizado(re.sub(r"[^\w\s]+", " ", puesto))
        limpio = re.sub(r"\s+", " ", limpio).strip()[:38]
        if limpio:
            formas += [f"CV {corto} - {limpio}", f"CV {corto} ({limpio})"]
    return formas


def elegir(nombre_completo, semilla=None, puesto=None):
    """Un nombre de archivo, estable para la misma semilla.

    La semilla es empresa+puesto de la vacante, y NO se escribe: solo
    decide cuál de las formas toca. Así preparar dos veces la misma
    vacante da el mismo archivo —si cambiara, la empresa vería dos CV con
    nombres distintos de la misma persona— y dos vacantes distintas dan
    formas distintas.
    """
    formas = variantes(nombre_completo, puesto=puesto)
    if not semilla:
        return _sanear(formas[0])
    digesto = hashlib.sha256(semilla.encode("utf-8")).digest()
    return _sanear(formas[digesto[0] % len(formas)])


def _sanear(nombre):
    """Quita lo que Windows no admite en un nombre de archivo."""
    nombre = unicodedata.normalize("NFC", nombre)
    nombre = re.sub(r'[<>:"/\|?*]', "", nombre).strip(" .")
    return f"{nombre or 'CV'}.docx"

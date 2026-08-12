# Chamba Lista — extensión de Chrome

La automatización de postulaciones, corriendo **dentro del navegador de la persona**.

## Por qué extensión y no una web

Postular necesita la sesión que la persona abrió en el portal. Un servidor en la nube no la tiene, y las alternativas son malas: pedirle la contraseña (que es justo lo que este proyecto no hace) o levantar un navegador remoto por usuario (caro, y te convierte en custodio de sesiones ajenas).

La extensión corre en su navegador, con las sesiones que ya tiene. Nunca ve una contraseña.

## Instalar mientras se desarrolla

1. Abre `chrome://extensions`
2. Activa **Modo de desarrollador** (arriba a la derecha)
3. **Cargar descomprimida** → elige esta carpeta `extension/`
4. Fija el icono en la barra

## Cómo se usa

1. **Mi perfil** → carga tu CV. Se procesa en el convertidor web y el resultado queda en tu navegador.
2. Pega tu clave de [Google AI Studio](https://aistudio.google.com/apikey) (gratis). Sin ella funciona, con respuestas más simples.
3. Guarda los datos que los portales piden y no están en el CV (DNI, distrito…). Todo opcional.
4. **Buscar** → escribe el puesto. Las vacantes salen como tarjetas.
5. Por cada una: **Ver y postular** abre el formulario, lo llena y redacta las respuestas. Tú revisas y confirmas.
6. O **Preparar todas y revisar** para hacerlo en tanda.

## Lo que no hace, y no es un olvido

- **No pide contraseñas.** La sesión la abres tú en el portal.
- **No acepta condiciones por ti.** Si una vacante pide confirmar que las prácticas son ad honorem, se detiene y te lo muestra con el aviso de que es sin pago. Ni siquiera en modo automático.
- **No inventa.** Las instrucciones del modelo prohíben añadir datos que no estén en el CV; cuando falta algo, te lo pide.
- **No rellena tu DNI** si no lo guardaste tú antes.
- **No resuelve CAPTCHAs.** Te pasa el control.

## Arquitectura

```
manifest.json          Manifest V3
background.js          Service worker: orquesta pestañas y el lote
contenido/
  comun.js             Utilidades del DOM (rellenar, leer enunciados, CAPTCHA)
  computrabajo.js      Selectores y acciones del portal
lib/
  portales.js          URLs y selectores por portal
  datos.js             Campos personales opcionales y su validación
  respuestas.js        Clasificación de preguntas y redacción
  ia.js                Gemini / Groq con la clave de la persona
  almacen.js           chrome.storage: perfil, datos, tracker
popup/                 La interfaz
```

**Dónde tocar si un portal cambia su web:** `lib/portales.js` y el objeto `SEL` de `contenido/computrabajo.js`. Los selectores de Computrabajo están verificados contra el sitio real (2026-07-29).

## Estado

| Función | Estado |
|---|---|
| Buscar en Computrabajo | Listo |
| Postular con revisión | Listo, falta probarlo con sesión real |
| Lote (revisado y automático) | Listo, falta probarlo con sesión real |
| Historial y exportar CSV | Listo |
| Bumeran, Indeed, LinkedIn | Pendiente: hay que escribir sus selectores |

El CV en formato Harvard lo genera el servicio web (`app_web.py`), porque generar un .docx en el navegador sería pesado sin ganar nada.

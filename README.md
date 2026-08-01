# Chamba Lista — plataforma de empleo con CV Harvard

Plataforma web para que **cualquier persona** (no solo tú con el plugin 💅) pueda:

1. **Subir su CV** (PDF o Word) → se parsea y se borra del servidor de inmediato.
2. **Revisar los datos extraídos** y generar su **CV en formato Harvard** (.docx): una columna, Times New Roman, nombre centrado, secciones en mayúsculas con línea divisoria, sin foto ni colores — el formato más compatible con ATS.
3. **Elegir qué busca**: prácticas o puesto junior, y el área.
4. **Aviso de privacidad + portales**: la persona debe abrir su sesión en el portal **por su cuenta** — la plataforma nunca pide contraseñas. Solo confirma con un checkbox que ya lo hizo (el backend lo exige).
5. **Postular con revisión humana obligatoria**: ve el resumen de la vacante + el CV que se usará + la mini-alerta de datos que el portal pedirá y no están en el CV (DNI, fecha de nacimiento, dirección, pretensión salarial) — esos datos **no se completan automáticamente**. Solo tras marcar "revisé y confirmo" se registra en el tracker.

## Dos modos

| Modo | Cómo se activa | Qué hace |
|------|----------------|----------|
| **Simulado** (por defecto) | `python app.py` | Vacantes de ejemplo de `mock_jobs.py`, con banner de aviso. Sirve para probar el wizard sin tocar el portal. |
| **Real** | `MODO_REAL=1 python app.py` | Búsqueda y postulación reales en Computrabajo vía navegador local. |

| Fase | Portal | Estado |
|------|--------|--------|
| 1 | Computrabajo | **Conectado** — búsqueda real y preparación de postulación |
| 2 | Bumeran | Pendiente |
| 3 | Indeed | Pendiente |
| 4 | LinkedIn | Pendiente (el más restrictivo) |

## Cómo correrlo

```
pip install -r requirements.txt
python -m playwright install chromium
```

Modo simulado:

```
python app.py
```

Modo real (Computrabajo):

```
MODO_REAL=1 python app.py
```

Abre http://localhost:5000

## Cómo funciona el modo real

El navegador corre **en la máquina de la persona**, no en un servidor, con un perfil persistente en `perfil_navegador/`. Eso resuelve el problema de la sesión: la persona inicia sesión una vez en esa ventana y las cookies se quedan en su propio equipo. La plataforma nunca ve, pide ni guarda su contraseña — solo consulta si la sesión quedó abierta.

En el paso 4 aparecen dos botones: **Abrir Computrabajo** (lanza el navegador en la pantalla de acceso) y **Verificar mi sesión** (comprueba si ya entró).

La postulación va en dos tiempos, a propósito:

1. **Preparar** — abre la oferta, pulsa "Postularme", adjunta el CV Harvard y llena los campos que sí están en el CV. **No envía nada.** Devuelve un reporte de qué completó y qué queda pendiente.
2. **Responder las preguntas de selección** (si la vacante las tiene) — ver abajo.
3. **Confirmar** — solo después de que la persona revisó el formulario en el navegador y marcó la casilla. El backend devuelve 403 si falta esa confirmación.

### Preguntas de selección

Muchas vacantes añaden preguntas abiertas propias ("¿qué estudias y dónde?", "¿tienes disponibilidad para ir a La Molina?"). El conector las detecta y **redacta una respuesta**, no vuelca el CV en crudo. La redacción vive en `respuestas.py`.

La diferencia importa: a *"¿Actualmente estudias Marketing? Menciona cuál y en qué universidad"* no se contesta pegando la sección de educación, se contesta con una frase.

| Tipo de pregunta | Qué hace la plataforma |
|------------------|------------------------|
| Estudios | Extrae carrera, casa de estudios y ciclo → *"Sí, actualmente estudio Marketing en la USIL, cursando el ciclo 11."* |
| Herramientas | Cruza las que **pide el anuncio** con las que el CV declara, con nivel si lo dice → *"De las herramientas que mencionan, manejo Photoshop, Illustrator y Premiere Pro. Además trabajo con Meta Ads, Excel (avanzado)…"* |
| Distrito + celular | El celular sale del CV; **el distrito se pregunta**, no se inventa → *"Resido en Surco, mi celular de contacto es …"* |
| Disponibilidad, horarios, viajar | **Se le pregunta** con opciones concretas y se redacta según lo que elija |
| Aceptar condiciones, ad honorem | **Se le explica qué está aceptando** (con aviso de que es sin pago) y decide ella |

Los campos que la persona respondió siguen visibles para poder corregirlos, y sus ediciones manuales sobreviven a las recomposiciones. Nada se escribe en el portal hasta que pulsa "Escribir respuestas en el formulario", y se envía exactamente el texto que dejó.

### Redacción con IA (`redactor_ia.py`)

Cada vacante inventa sus propias preguntas ("confírmanos tu usuario de TikTok", "¿por qué te interesa el puesto?") y no hay reglas que las cubran todas. Por eso la redacción se delega a un modelo cuando hay uno configurado. **Sin modelo la plataforma sigue funcionando** con las reglas de `respuestas.py`, pero las preguntas poco comunes quedan vacías — la interfaz lo avisa.

Tres opciones **gratuitas**, se detecta automáticamente la que esté disponible:

| Opción | Cómo se activa | Privacidad |
|--------|----------------|------------|
| **Ollama** (local) | Instalar de [ollama.com](https://ollama.com), luego `ollama pull llama3.2` | El CV **nunca sale de la máquina** |
| **Gemini** | `GEMINI_API_KEY=...` — clave gratis en [aistudio.google.com](https://aistudio.google.com/apikey) | El CV se envía a Google |
| **Groq** | `GROQ_API_KEY=...` — clave gratis en [console.groq.com](https://console.groq.com/keys) | El CV se envía a Groq |

En PowerShell (`&&` y `VAR=valor python` son sintaxis de bash y **no funcionan** ahí):

```powershell
$env:GEMINI_API_KEY = "tu-clave"
$env:MODO_REAL = "1"
python app.py
```

**Notas sobre Gemini que costaron un rato de depuración:**

- El modelo por defecto es `gemini-flash-latest`. Pedir `gemini-2.0-flash` por su nombre exacto devuelve `429 · limit: 0` con claves nuevas, aunque el alias `latest` sí tenga cuota gratuita.
- `maxOutputTokens` está en 2000 a propósito: estos modelos razonan antes de responder y ese razonamiento sale del mismo presupuesto. Con un tope bajo se agota pensando y devuelve texto truncado o vacío.
- Al parsear se descartan los fragmentos marcados `thought`: son el razonamiento, no la respuesta.
- Si el equipo tiene un antivirus o proxy que intercepta TLS, Python falla con `CERTIFICATE_VERIFY_FAILED: Basic Constraints of CA cert not marked critical`. Por eso se usa `truststore`, que delega la verificación al almacén de Windows. **No se desactiva la verificación** — el CV viaja por esa conexión.

Ollama es la única consistente con la promesa de privacidad del proyecto (nada sale del equipo). Las otras dos son más fáciles de arrancar pero mandan el CV a un tercero, que es algo a decidir conscientemente si la plataforma se abre a más gente.

**Lo que el modelo nunca decide.** Las preguntas de disponibilidad y de aceptación de condiciones se resuelven **antes** de llamarlo y no se le envían: las responde la persona con botones. Verificado con una prueba que cuenta las llamadas al modelo para esas preguntas (deben ser cero).

**Lo que el modelo no puede inventar.** Las instrucciones le prohíben usar datos que no estén en el CV. Cuando falta algo, debe responder `FALTA_DATO: <qué falta>`, y la plataforma convierte eso en un campo para que la persona lo escriba.

### Cosas que el conector nunca hace

- **No rellena la pantalla de login.** Si el portal redirige al acceso (sesión caída, por ejemplo), detecta que no es el formulario de postulación y aborta sin escribir nada. Sin esta guarda, los datos de la persona terminarían en el formulario de acceso y el "enviar" haría clic sobre un login.
- **No completa datos sensibles** que no estén en el CV (DNI, fecha de nacimiento, dirección, pretensión salarial): los reporta como pendientes.
- **No resuelve CAPTCHAs.** Si aparece uno, oculta el botón de envío y devuelve el control a la persona.
- **No envía nada por su cuenta**, en ningún caso.

### Notas técnicas

- Computrabajo devuelve **403 a navegadores headless**. Por eso el navegador se lanza siempre visible, que además es lo que permite a la persona intervenir.
- Playwright (API síncrona) exige usar el navegador siempre desde el mismo hilo, y Flask atiende cada request en uno distinto. Por eso `computrabajo.py` tiene un `WorkerNavegador`: un hilo dedicado que es dueño del navegador y recibe órdenes por una cola.
- Los selectores del portal están agrupados en `SELECTORES` (verificados contra el sitio real el 2026-07-29). Si Computrabajo cambia su maquetación, ese es el único sitio que hay que tocar.

## Estructura

```
empleo-plataforma/
├── app.py                # backend Flask con todos los endpoints
├── cv_parser.py          # extracción de texto + parseo heurístico del CV
├── harvard_template.py   # generador del .docx en formato Harvard
├── computrabajo.py       # conector real (Playwright) + worker de navegador
├── respuestas.py         # redacción de las preguntas de selección desde el CV
├── redactor_ia.py        # redacción con modelo (Ollama / Gemini / Groq), opcional
├── lote.py               # postulación en lote: modo revisado y modo automático
├── mock_jobs.py          # vacantes de ejemplo + taxonomía de áreas y términos
├── requirements.txt
├── templates/index.html  # wizard de 5 pasos
├── static/css/style.css
├── static/js/app.js
├── uploads/              # CVs subidos (se borran tras procesarlos)
├── generados/            # CVs Harvard generados, listos para descargar
├── perfil_navegador/     # perfil de Chromium con la sesión (solo modo real)
└── postulaciones.json    # tracker (se crea con la primera postulación)
```

## El formato Harvard, medido del CV real

`harvard_template.py` no reproduce un "formato Harvard" genérico: está **calcado del CV que usa el plugin** (`CV ALICE ROMERO 2026.docx`), medido directamente del XML del Word:

| Elemento | Valor |
|----------|-------|
| Tipografía | Times New Roman (de los `docDefaults`, no del tema) |
| Márgenes | 1.91 cm en los cuatro lados |
| Nombre | 18 pt, negrita, centrado |
| Línea de contacto | 9.5 pt, centrada, separada por `  ·  ` |
| Títulos de sección | 11 pt, negrita, MAYÚSCULAS, **sin línea divisoria** |
| Entradas | 10.5 pt, dos líneas con **tabulación derecha a 9026 twips (6.27")** |
| Viñetas | estilo `List Paragraph`, sangría 0.63 cm |

Lo de "sin línea divisoria" es deliberado y va contra lo que suele asociarse al formato Harvard: el CV original no la lleva, y la fidelidad manda. Verificado que el `.docx` generado tiene **0 párrafos con borde**.

La tabulación derecha es lo que produce el encabezado de dos columnas característico:

```
USIL – Market Research Group (GRIM)                              Lima, PE      ← negrita
Practicante de Investigación de Mercados          Dic 2022 – Ago 2023          ← cursiva
  • Diseñé y ejecuté más de 6 estudios de comportamiento del consumidor…
```

Al procesar el CV original, el generado sale con **23 párrafos con tabulación** — exactamente los mismos que el original.

### Secciones, en el orden del CV original

`PERFIL PROFESIONAL` · `COMPETENCIAS CLAVE` · `EXPERIENCIA PROFESIONAL` · `LIDERAZGO & VOLUNTARIADO` · `EDUCACIÓN` · `CERTIFICACIONES RELEVANTES` · `PROYECTO EN DESARROLLO` · `LOGROS DESTACADOS`

En `COMPETENCIAS CLAVE` y `PROYECTO EN DESARROLLO`, solo la etiqueta anterior a los dos puntos va en negrita («**Análisis & Herramientas:** SPSS · Power BI…»), igual que el original.

### El modelo de datos es estructurado, no plano

Para poder alinear el lugar y las fechas a la derecha, el perfil guarda **entradas**, no líneas sueltas:

```python
{"organizacion": "Zero West Street", "lugar": "Lima, PE (Remoto)",
 "cargo": "Social Media Marketing Manager (Freelance)",
 "fechas": "Jul 2024 – Dic 2024", "logros": ["Lideré el lanzamiento…"]}
```

`normalizar()` acepta también el modelo plano antiguo, y `a_secciones_planas()` produce la vista plana que necesita el código que redacta las respuestas del formulario. El análisis con IA extrae directamente esta estructura y separa el trabajo remunerado (`experiencia`) del voluntariado (`liderazgo`).

## Postulación en lote (`lote.py`)

Dos modalidades, ambas con un tope de **15 vacantes por tanda** para que un fallo no acabe escribiendo a decenas de empresas.

**Modo revisado** (por defecto). Prepara todo —CV adaptado por vacante, respuestas redactadas, formulario llenado— y se detiene. La persona ve el plan completo con una casilla por vacante y envía las que marque.

**Modo automático.** Envía sin revisar cada una. Detrás de un consentimiento informado: cuatro casillas que describen un riesgo concreto cada una (es irreversible, no vas a revisar, las respuestas las redacta una IA y pueden tener errores, eres responsable del contenido). El backend exige los cuatro valores en `True` booleano — verificado que `"true"` como cadena **no** pasa.

**Lo que el modo automático sigue sin hacer**, y es deliberado:

- Si una vacante pide **aceptar condiciones** que la persona no aprobó de antemano (que las prácticas son ad honorem, por ejemplo), esa vacante se **salta y se marca**. No se acepta por ella.
- Si aparece un **CAPTCHA**, se salta y se marca.
- Todo queda en el tracker, enviado o no, con el motivo.

Entre vacante y vacante hay una pausa de 2 segundos: evita topar el límite por minuto de la capa gratuita de la IA y no golpea el portal a ritmo de robot.

## CV adaptado por vacante

`POST /api/cv/adaptar` reordena y reenfoca el CV hacia una vacante concreta: reescribe el resumen orientado al puesto, sube lo relevante al inicio y usa las palabras del anuncio donde el CV ya las respalda. Devuelve además la **lista de cambios** para que la persona vea qué se movió y por qué.

Las instrucciones del modelo prohíben inventar: no puede añadir herramientas, logros, empresas, cifras ni títulos que no estén en el CV, y si la vacante pide algo que la persona no tiene, no lo menciona. Cada CV adaptado se guarda con el nombre de la empresa y el puesto, así que no se sobrescriben y queda historial.

## Vista previa del CV

Tras generar el CV, `POST /api/cv/preview` devuelve el mismo contenido en HTML con el formato Harvard (Times New Roman, nombre centrado, secciones en mayúsculas con línea) para revisarlo sin abrir el Word. El paso 3 no avanza hasta que la persona confirma que está bien.

## Principios no negociables

- **Privacidad**: nunca se piden ni guardan contraseñas de portales; los CVs subidos se eliminan tras procesarse.
- **Verdad del perfil**: el CV Harvard solo reordena y reformatea lo que el CV original dice — nunca inventa contenido.
- **Revisión humana**: ninguna postulación se envía sin confirmación explícita de la persona (el backend rechaza envíos sin ella).
- **Transparencia**: los datos que falten en el CV se avisan, no se rellenan.

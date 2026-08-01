# Cómo llevar esto a la web para otras personas

El problema y las salidas reales, evaluadas. Escrito el 2026-07-31.

## El nudo

Postular necesita **la sesión que la persona abrió en su navegador**. Un servidor en la nube no la tiene. Todo lo demás (leer el CV, convertirlo a Harvard, redactar respuestas, buscar vacantes) sí se puede alojar sin problema.

Por eso la respuesta no es «web sí» o «web no», sino **qué parte va a la web**.

## Lo que sí se puede alojar hoy, sin condiciones

| Función | ¿Alojable? | Por qué |
|---|---|---|
| Subir CV → formato Harvard → descargar | **Sí** | Procesar un archivo. No necesita sesión de nadie. |
| Vista previa del CV | **Sí** | Solo render. |
| Adaptar el CV a una vacante | **Sí** | Texto + modelo. |
| Redactar respuestas de formularios | **Sí** | Texto + modelo. |
| Buscar vacantes | **A medias** | Se puede raspar sin sesión, pero desde una IP de datacenter los portales bloquean rápido. |
| **Postular** | **No** | Necesita la sesión de la persona. |

**Conclusión:** el convertidor de CV puede ser una web pública desde ya, y es la pieza más valiosa y más compartible. La postulación se queda local.

## El problema del modelo (y por qué Gemini solo no basta)

Si la web usa **una sola clave** (la de la dueña del proyecto):

- La capa gratuita de Gemini se agota en horas con varios usuarios.
- Cualquiera puede quemar la cuota.
- Si se pasa a pago, cada CV procesado cuesta dinero de su bolsillo.

Opciones evaluadas:

### 1. Cada persona pone su propia clave — **recomendada para empezar**

La web pide una clave gratuita de Google AI Studio (o Groq) y la guarda **en el navegador de la persona** (`localStorage`), nunca en el servidor. Cada quien gasta su propia cuota.

- ✅ Coste cero para el proyecto, sin límite de usuarios.
- ✅ Ningún dato de facturación pasa por el servidor.
- ❌ Fricción: hay que sacar una clave. Se mitiga con un instructivo de 3 pasos y capturas.

### 2. «Conectar con Google» (OAuth) — **no resuelve lo que parece**

Iniciar sesión con Google **no da acceso a la API de Gemini**. El OAuth de Google identifica a la persona; para usar Gemini hace falta un proyecto de Google Cloud con facturación, que la persona tendría que crear igual. Sirve para identificar usuarios, no para repartir cuota de IA.

Sí serviría para: recordar el perfil entre dispositivos, guardar el historial de postulaciones. Eso es otra funcionalidad, no la del modelo.

### 3. Modelo propio en el servidor (Ollama alojado)

Un servidor con un modelo pequeño (Llama 3.2 3B, Qwen 2.5 7B) atendiendo a todos.

- ✅ Sin claves, sin fricción para el usuario.
- ✅ Los CV no salen hacia un tercero.
- ❌ Necesita una máquina con RAM suficiente: ~15–40 USD/mes. No hay capa gratuita realista.
- ❌ Calidad algo menor que Gemini Flash en redacción en español.

**Cuándo tiene sentido:** cuando haya usuarios de verdad y se sepa cuántos. Antes, no.

### 4. Sin modelo (solo reglas)

`respuestas.py` ya funciona sin IA. Las respuestas salen más pobres, pero el CV Harvard sale igual de bien porque el formato es determinista.

**Sirve como modo degradado:** la web funciona para todos sin clave, y quien ponga la suya obtiene mejores respuestas.

## Plan recomendado, por fases

**Fase 1 — hoy.** Landing en GitHub Pages (`docs/`, ya está) + repo público con el código. La gente descarga y corre local. Coste: cero.

**Fase 2 — convertidor de CV alojado.** Solo los endpoints que no necesitan navegador: `/api/cv/subir`, `/api/cv/generar`, `/api/cv/preview`, `/api/cv/adaptar`. En Render o Railway, capa gratuita. Con clave propia de cada usuario guardada en su navegador, y modo sin-IA como respaldo.

Requisitos técnicos para esa fase:
- Quitar `computrabajo.py` y `lote.py` del despliegue (no se importan si no hay `MODO_REAL`).
- No escribir nada en disco: procesar el CV en memoria y devolverlo. Hoy ya se borra el subido, pero `generados/` persiste — en la web debe ir a un buffer.
- Límite de tamaño (ya está en 10 MB) y de peticiones por IP.
- Aviso de privacidad visible: qué se procesa, que no se guarda nada, y que si la persona pone su clave, su CV viaja a Google.

**Fase 3 — cuenta de usuario (opcional).** «Entrar con Google» para guardar perfil e historial entre dispositivos. Requiere base de datos y, al guardar CVs de terceros, cumplir la Ley 29733 de Protección de Datos Personales (Perú): finalidad declarada, consentimiento, derecho de supresión.

**Fase 4 — postulación.** Sigue siendo local. Se puede empaquetar con PyInstaller para que sea un ejecutable de doble clic, sin pedirle a nadie que instale Python.

## Lo que NO se debe hacer

- **Pedir la contraseña del portal.** Rompe la única garantía real del proyecto.
- **Alojar un navegador por usuario** para que inicien sesión ahí dentro: caro, y convierte al proyecto en custodio de sesiones ajenas.
- **Compartir una sola clave de IA** entre todos los usuarios de una web pública.

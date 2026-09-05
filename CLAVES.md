# Dónde van las claves

Regla única: **una clave nunca se escribe en el código, ni en un chat, ni
en un commit.** Va en una variable de entorno y nada más. Si una clave
aparece alguna vez fuera de ahí, se anula y se crea otra — no se intenta
"borrarla" del sitio donde apareció, porque en un historial no se puede.

## Las claves que usa el proyecto

| Variable | Para qué | Dónde se saca |
|---|---|---|
| `GEMINI_API_KEY` | Que la IA lea el CV y redacte las respuestas | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — gratis |
| `SUPABASE_URL` | Guardar el CV y el historial | Panel de Supabase → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | Lo mismo | Igual. **La de servicio**, no la anónima |

Una clave de Gemini válida **empieza por `AIza`** y tiene unos 39
caracteres. Si lo que copiaste empieza por otra cosa, no es la clave: es
un token de sesión y no va a funcionar.

`SUPABASE_SERVICE_KEY` se salta las políticas de seguridad de la base.
Solo puede vivir en el servidor. Si acaba en el navegador, cualquiera
puede leer los CV y los DNI de todo el mundo.

## En tu máquina

Crea un archivo `.env` en esta carpeta:

```
GEMINI_API_KEY=AIza...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

`.env` está en el `.gitignore`, así que no se sube nunca. Para cargarlo:

```bash
set -a && . ./.env && set +a          # Git Bash
```

En PowerShell, una por una:

```powershell
$env:GEMINI_API_KEY = "AIza..."
```

## En Vercel

Panel del proyecto → Settings → Environment Variables. Se añaden ahí, no
en ningún archivo del repositorio. Después hay que volver a desplegar
para que las tome.

## Comprobar que funciona

```bash
python evaluar_modelo.py
```

Sin clave, verifica solo el bloqueo de consentimiento y no gasta nada.
Con clave, juzga al modelo: si inventa, si se calla teniendo el dato, si
se va al inglés. El veredicto sale al final.

## Si una clave se filtra

1. Anularla donde se creó. Primero eso, antes que nada.
2. Crear otra y ponerla en la variable de entorno.
3. En Gemini, revisar el consumo por si alguien la usó.

No hace falta reescribir el historial de git si la clave nunca se
commiteó: con anularla basta, porque deja de servir para nada.

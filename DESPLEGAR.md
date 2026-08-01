# Poner Chamba Lista en línea — paso a paso

Coste total: **cero**. Tiempo: unos 20 minutos.

## 1. Subir el código a GitHub

El repositorio ya está inicializado y con los commits hechos. Falta crear el repo remoto y empujar. Desde PowerShell:

```powershell
cd "C:\Users\alice\OneDrive\Escritorio\Claude modo girlie\empleo-plataforma"
```

Crea el repositorio en [github.com/new](https://github.com/new) con el nombre `chamba-lista`, **sin** marcar «Add a README». Luego:

```powershell
git remote add origin https://github.com/TU-USUARIO/chamba-lista.git
```

```powershell
git push -u origin main
```

Te pedirá tu usuario y un token (no la contraseña). El token se saca en GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token, con permiso `repo`.

**Antes de empujar, comprueba que no sube nada personal:**

```powershell
git status --short
```

No debe aparecer `perfil_navegador/`, `datos-personales.json`, `postulaciones.json` ni ningún `.docx`. El `.gitignore` ya los bloquea, pero míralo igual: ahí están las cookies de tu sesión de Computrabajo.

## 2. La landing en GitHub Pages

En el repo → **Settings** → **Pages** → en «Source» elige `Deploy from a branch`, rama `main`, carpeta **`/docs`**. Guardar.

En un par de minutos queda en `https://TU-USUARIO.github.io/chamba-lista/`.

## 3. El convertidor de CV en Render

1. Entra a [render.com](https://render.com) y crea la cuenta (no pide tarjeta).
2. **New** → **Web Service** → conecta tu GitHub y elige `chamba-lista`.
3. Render lee `render.yaml` solo. Verifica que quede así:
   - Build: `pip install -r requirements-web.txt`
   - Start: `gunicorn app_web:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`
   - Plan: **Free**
4. **Create Web Service**.

Queda en `https://chamba-lista.onrender.com`.

**Lo que hay que saber del plan gratuito:** el servicio se duerme tras 15 minutos sin visitas y la siguiente carga tarda ~30 segundos. Para no perder gente, la landing debería avisar («la primera carga tarda unos segundos») o usar un pinger gratuito como UptimeRobot cada 10 minutos.

## 4. Conectar la landing con la app

En `docs/index.html`, cambia el bloque de instalación por un botón que apunte a la URL de Render. La landing es para explicar; la app es donde se convierte el CV.

## 5. Cobrar (cuando quieras activarlo)

Ver [MONETIZACION.md](MONETIZACION.md). Resumen: Yape micronegocios **sin comisión**, QR en la página, confirmación por WhatsApp. Cero desarrollo.

---

## Qué se despliega y qué no

| Archivo | ¿Va a la web? | Por qué |
|---|---|---|
| `app_web.py` | **Sí** | Solo convierte CVs. Sin navegador, sin disco. |
| `harvard_template.py`, `cv_parser.py`, `respuestas.py`, `redactor_ia.py` | **Sí** | Procesan texto. |
| `app.py` | No | Es la versión local completa. |
| `computrabajo.py`, `lote.py`, `portales.py` | No | Necesitan Playwright y la sesión de la persona. |

Por eso `requirements-web.txt` no incluye Playwright: el despliegue queda pequeño y arranca rápido dentro de los límites de la capa gratuita.

## Comprobar antes de publicar

```powershell
python app_web.py
```

Abre http://localhost:5001, sube un CV y descárgalo. Verificado que con esto **no se escribe nada** en `uploads/` ni en `generados/`: el CV se procesa en memoria y se devuelve.

# Pendientes (todo gratis) — guardado el 2026-10-02

Lo que ya está en el código (0.9.0) necesita estos pasos fuera del código.
Ninguno cuesta dinero.

1. **Groq** — crear clave en https://console.groq.com (sin tarjeta) y ponerla
   en Vercel → Environment Variables como `GROQ_API_KEY`.
2. **Vercel → Environment Variables**:
   - `CRON_SECRET`: cualquier texto largo (solo el cron llama a /api/mantener).
   - `ADMIN_CLAVE`: clave de /admin, mínimo 12 caracteres.
   - `PAGO_YAPE` y `PAGO_TITULAR`: número y nombre para Yape/Plin.
   - `COBRAR=1`: SOLO el día que se empiece a vender (antes no limita nada).
   - Luego, redesplegar.
3. **Supabase → SQL Editor**: ejecutar `supabase/005-uso-ia.sql` y
   `supabase/006-saldos.sql` (saldos con 18 gratis, pagos y avisos «Ya yapeé»).
   Cuando alguien pulse «Ya yapeé»: abrir /admin, «Ver avisos», comprobar el
   monto en tu Yape y pulsar «Ya lo vi en mi Yape: activar».
4. **Correos de la cuenta**: SMTP gratis (Brevo, 300/día, o Gmail de
   chambalistaperu@gmail.com con contraseña de aplicación) en Supabase →
   Authentication → SMTP Settings.
5. **GitHub**: poner el repositorio en privado (Settings → Change visibility).
6. **Edge Add-ons**: publicar la extensión gratis en Microsoft Partner Center.
   Chrome Web Store ($5, pago único) cuando haya tarjeta.
7. **Dominio**: renombrar el proyecto de Vercel a `chambalista` →
   `chambalista.vercel.app` (gratis).
8. **Prueba real**: dar el OK para una tanda real corta (topes, esperas, CV
   adaptado subido) y para probar la subida de CV en Computrabajo.

---

# Auditoría de salida — 2026-11-04 (producción en 0.9.0)

Pruebas: Python y JS en TODO OK. Producción responde (web, privacidad, zip,
base de datos viva). Sin claves en el código ni en el historial de git.

## Bloquea el cobro (hacer antes de abrir)
1. **Supabase**: correr `006-saldos.sql` (y 005). No se pudo verificar desde la PC de Ali.
2. **Vercel**: `PAGO_YAPE`, `PAGO_TITULAR` (hoy vacíos: nadie puede pagar), `ADMIN_CLAVE`
   (sin ella /admin no activa nada), `CRON_SECRET`, `GROQ_API_KEY`, `COBRAR=1`. Redesplegar.
3. **Correos de registro**: SMTP propio en Supabase. Con el correo por defecto de Supabase el
   límite de envíos es muy bajo y los registros del primer día se pueden quedar sin correo.
   Mirar Authentication → «Confirm email» y decidir si se exige.
4. **Tanda real corta** con el motor nuevo (topes, esperas, CV adaptado): nunca se probó con envíos reales.
5. **IA**: `IA_LIBRES` es 40 llamadas/24 h por persona y cada postulación gasta ~2 → ~20 al día,
   no las 50 del titular. Subirlo (variable `IA_LIBRES`) y vigilar el tope global de la capa gratis.

## Importante
6. Política/Términos: no mencionan pagos, saldo, invitaciones, precios ni devoluciones, y dicen
   «se te consulta antes» cuando el producto ya responde solo. Falta Libro de Reclamaciones.
7. Repo GitHub público → privado.
8. Vercel Hobby limita a uso no comercial: revisar antes de cobrar.
9. La landing tiene `X-Robots-Tag: noindex` (no sale en Google).
10. No renombrar el dominio de Vercel: la extensión instalada apunta al actual.

## Menor
- `PACKS` en `verificados.js` (5/30/100) es una constante vieja sin uso.
- Saldo: leer-y-escribir no atómico; el descuento lo dispara la extensión (se puede manipular).
- Bumeran y LinkedIn siguen sin envío real verificado.

---

# LANZAMIENTO — checklist en orden (2026-11-05, versión 1.0.0)

## A. Vercel → Settings → Environment Variables (luego Redeploy)
| Variable | Qué poner |
|---|---|
| `PAGO_YAPE` | tu número de Yape (ej. 987 654 321) |
| `PAGO_TITULAR` | el nombre que aparece en tu Yape |
| `ADMIN_CLAVE` | una clave larga inventada (mín. 12). Generarla: `python -c "import secrets;print(secrets.token_urlsafe(24))"` y guardarla en tu gestor de contraseñas |
| `CRON_SECRET` | otra clave larga cualquiera |
| `GROQ_API_KEY` | console.groq.com → API Keys (gratis, sin tarjeta) |
| `COBRAR` | `1` el día que empieces a cobrar |
| `LOGIN_GOOGLE` | `1` cuando termines el paso C |
| `EMPRESA_NOMBRE`, `EMPRESA_RUC`, `EMPRESA_DOMICILIO` | titular del servicio (salen en la política y en el Libro de Reclamaciones) |
| `DOMINIO_PUBLICO` | `https://chambalista.vercel.app` cuando agregues ese dominio |
| `IA_LIBRES` / `IA_LIBRES_PAGO` | opcional: 60 y 400 por defecto |
| `GEMINI_FACTURACION` | `1` solo si activas facturación en Gemini (lo usarían solo quienes pagan) |

## B. Supabase → SQL Editor
Correr, en orden: `005-uso-ia.sql`, `006-saldos.sql`, `007-reclamos.sql`.

## C. Entrar con Google
1. console.cloud.google.com → APIs y servicios → Pantalla de consentimiento (Externo, nombre «Chamba Lista»,
   correo de soporte, enlaces a /privacidad y /terminos).
2. Credenciales → Crear ID de cliente OAuth → Aplicación web → URI de redireccionamiento autorizado:
   `https://rjxxrpuxkigfxwqjlvzi.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Sign In / Providers → Google → pegar Client ID y Client Secret → activar.
4. Supabase → Authentication → URL Configuration → Redirect URLs: agregar
   `https://chamba-lista-ali-ab09.vercel.app/**` y `https://chambalista.vercel.app/**`.
5. Vercel: `LOGIN_GOOGLE=1` y redesplegar.

## D. Correos de registro
Supabase → Authentication → SMTP Settings → Brevo (gratis) o Gmail con contraseña de aplicación.

## E. Dominio
Vercel → Settings → Domains → agregar `chambalista.vercel.app` como producción. Esto quita el
`noindex` (la web aparece en Google). Avisar para cambiar `extension/lib/servidor.js` ANTES de subir a la tienda.

## F. Chrome Web Store
Todo en `tienda/FICHA-CHROME-WEB-STORE.md`. Paquete: `tienda/chamba-lista-1.0.0.zip`.

## G. Google Search Console (gratis)
search.google.com/search-console → agregar el dominio → enviar `/sitemap.xml`.

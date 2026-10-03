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

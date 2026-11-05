# Ficha para la Chrome Web Store — Chamba Lista 1.0.2

Todo listo para copiar y pegar en https://chrome.google.com/webstore/devconsole
(cuenta de desarrollador: pago único de USD 5 y verificación de identidad).

## Antes de subir (en este orden)

1. **Dominio**: en Vercel → Settings → Domains, agrega `chambalista.vercel.app`
   y márcalo como dominio de producción. Avísame: cambio una línea
   (`extension/lib/servidor.js`) y regenero el ZIP, así la versión de la
   tienda nace con la dirección definitiva. Si subes antes, cambiarla después
   obliga a otra revisión de Google.
2. **Paquete**: `tienda/chamba-lista-1.0.2.zip` (sin archivos de prueba).

## Ficha de la tienda

**Nombre** (máx. 75): Chamba Lista — postula sin escribir lo mismo mil veces

**Resumen** (máx. 132):
Postula a prácticas y primer empleo en Perú con tu CV reenfocado a cada vacante. Busca, llena y envía por ti.

**Categoría**: Productividad → Flujo de trabajo y planificación · **Idioma**: Español (Latinoamérica)

**Descripción**:

Chamba Lista busca vacantes de prácticas y primer empleo en Computrabajo,
Bumeran, LinkedIn e Indeed, adapta tu CV a cada una y llena la postulación
por ti. Tú decides si la envía sola o si te avisa antes para darle el visto
bueno.

• Tu CV en formato Harvard, adaptado a lo que pide cada vacante.
• Responde las preguntas de selección con lo que dice tu CV (no inventa nada).
• Te dice qué vacantes encajan mejor contigo y cuánto te tomaría llegar.
• Topes diarios y pausas para cuidar tus cuentas en los portales.
• Seguimiento de todas tus postulaciones en un solo lugar.
• Tus primeras 12 postulaciones son gratis.

Trabaja con las sesiones que ya abriste en cada portal: nunca te pide ni
guarda tus contraseñas de Computrabajo, Bumeran, LinkedIn ni Indeed.
Tu DNI y tus datos para postular se quedan solo en tu navegador.

Chamba Lista no está afiliada a Computrabajo, Bumeran, LinkedIn ni Indeed.

**Imágenes**:
- Icono 128×128: `extension/iconos/128.png`
- Mosaico pequeño 440×280: `tienda/promo-pequena-440x280.png`
- Marquesina 1400×560: `tienda/promo-grande-1400x560.png`
- Capturas 1280×800 (mínimo 1, ideal 3–5) — **las tomas tú** con la extensión
  abierta en una ventana de 1280×800: (1) portada con el titular, (2) lista de
  vacantes con los colores de encaje, (3) una tanda en vivo con confeti,
  (4) Mi perfil con tu CV en formato Harvard. No muestres datos reales de nadie.

**Sitio web**: https://chamba-lista-ali-ab09.vercel.app (o el dominio nuevo)
**Correo de soporte**: chambalistaperu@gmail.com

## Pestaña «Prácticas de privacidad»

**Propósito único** (single purpose):
Ayudar a la persona a postular a ofertas de empleo: adapta su CV a cada vacante
y completa y envía sus postulaciones en los portales de empleo que ella elige.

**Justificación de permisos**:
- `storage`: guardar en el navegador la sesión de la cuenta, el CV convertido,
  los datos para postular (que nunca salen de ahí salvo hacia el portal) y el
  historial de postulaciones.
- `activeTab`: leer la vacante abierta en la pestaña actual cuando la persona
  lo pide desde el panel.
- `scripting`: completar el formulario de postulación en la pestaña del portal
  y volver a cargar el script en pestañas que ya estaban abiertas al instalar.
- Permisos de host:
  - `pe.computrabajo.com`, `candidato.pe.computrabajo.com`, `bumeran.com.pe`,
    `www.bumeran.com.pe`, `pe.indeed.com`, `smartapply.indeed.com`,
    `www.linkedin.com`: buscar vacantes, leer sus preguntas y completar y
    enviar la postulación en el portal que la persona eligió.
  - `chamba-lista-ali-ab09.vercel.app`, `chambalista.vercel.app`: nuestro
    servidor (cuenta, saldo y la IA que adapta el CV) y el puente que trae la
    sesión iniciada en la web.
  - `api.groq.com`, `generativelanguage.googleapis.com`: solo si la persona
    pone su propia clave de IA en Mi perfil (opcional).

**¿Usa código remoto?** No. Todo el JavaScript va dentro del paquete.

**Datos que recopila** (marcar):
- [x] Información personal identificable (nombre, correo, DNI y dirección que la
  persona escribe para postular)
- [x] Información de autenticación (la contraseña de la cuenta de Chamba Lista,
  solo para iniciar sesión; nunca la de los portales)
- [x] Contenido del sitio web (texto de la vacante y del formulario de postulación)
- [ ] Información de salud · [ ] Información financiera y de pagos
- [ ] Comunicaciones personales · [ ] Ubicación · [ ] Historial web · [ ] Actividad del usuario

**Certificaciones** (marcar las tres):
- No vendo ni transfiero datos a terceros fuera de los casos de uso permitidos.
- No uso ni transfiero datos para fines ajenos al propósito único.
- No uso ni transfiero datos para determinar solvencia crediticia ni préstamos.

**URL de la política de privacidad**: https://chamba-lista-ali-ab09.vercel.app/privacidad

## Mensaje para el revisor (campo opcional)

La extensión solo actúa en los portales de empleo cuando la persona lanza una
tanda desde su panel. Respeta topes diarios y pausas entre envíos, nunca pide
contraseñas de los portales y por defecto puede avisar antes de cada envío.
Para probarla: crear una cuenta gratis en el sitio web, iniciar sesión en
Computrabajo y pulsar «Buscar» en la pestaña Vacantes.

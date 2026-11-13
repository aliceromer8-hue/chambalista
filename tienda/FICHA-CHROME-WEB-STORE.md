# Ficha para la Chrome Web Store — Chamba Lista 1.0.7

Para copiar y pegar en https://chrome.google.com/webstore/devconsole
Archivos de esta carpeta: `chamba-lista-1.0.7.zip`, `promo-pequena-440x280.png`,
`promo-grande-1400x560.png` y la carpeta `capturas` (5 imágenes de 1280×800).
El icono está en `..\extension\iconos\128.png`.

El dominio oficial (`chamba-lista.vercel.app`) ya está puesto en la extensión: no hay nada
que cambiar antes de subir.

---

## 1. Ficha de la tienda

**Nombre** (máx. 75):
Chamba Lista — postula sin escribir lo mismo mil veces

**Resumen** (máx. 132):
Postula a prácticas y primer empleo en Perú con tu CV reenfocado a cada vacante. Busca, llena y envía por ti.

**Categoría**: Productividad · **Idioma**: Español (Latinoamérica)

**Descripción** (copia desde la línea de abajo hasta el final del bloque):

```
¿Buscas prácticas o tu primer empleo en Perú? ¿Te cansaste de llenar el mismo formulario una y otra vez?

Chamba Lista hace la parte pesada: busca vacantes, reenfoca tu CV a cada una, responde las preguntas de selección y llena el formulario por ti. Tú decides si la envía sola o si te avisa antes para darle tu visto bueno.

CÓMO FUNCIONA
1. Crea tu cuenta gratis y sube tu CV (PDF o Word).
2. Entra tú a cada portal, como siempre, y listo: queda conectado.
3. Busca: te mostramos las vacantes ordenadas por cuánto encajan contigo y cuánto te tomaría llegar desde tu distrito.
4. Elige las que quieras (o todas) y pulsa postular.

QUÉ HACE POR TI
• Postula en Computrabajo e Indeed: llena el formulario con tu CV y tus datos. En Bumeran y LinkedIn la ayuda está en etapa de pruebas.
• Reenfoca tu CV a cada vacante: reordena y reformula lo que ya dice, sin inventar experiencia ni cifras.
• Responde las preguntas de selección usando tu CV.
• Te muestra tu avance en vivo y guarda el seguimiento de todas tus postulaciones.
• Cuida tus cuentas: topes diarios (hasta 50 en total) y pausas entre envíos.

TÚ MANDAS
• Elige entre «postula sola» o «avísame antes de enviar».
• Las herramientas que tu CV no menciona (por ejemplo SPSS o Power BI) solo se agregan si tú las marcas como que las manejas. Tú respondes por tu CV.
• Puedes pausar o cancelar una tanda cuando quieras.

PRIVACIDAD
Funciona con las sesiones que ya abriste en cada portal: nunca te pide ni guarda tus contraseñas de Computrabajo, Indeed, Bumeran ni LinkedIn. Tu DNI y tus datos para postular se quedan en tu navegador. No vendemos tus datos.

PRECIO
Tus primeras 12 postulaciones son gratis. Después puedes comprar más: sin suscripción, pagas una sola vez con Yape o Plin y no caducan.

Necesitas una cuenta gratuita de Chamba Lista. Chamba Lista no está afiliada a Computrabajo, Indeed, Bumeran ni LinkedIn.
```

**Imágenes**
- Icono 128×128: `extension\iconos\128.png`
- Mosaico pequeño 440×280: `promo-pequena-440x280.png`
- Marquesina 1400×560: `promo-grande-1400x560.png`
- Capturas 1280×800, en este orden (carpeta `capturas`):
  1. `1-portada-y-guia.png` · 2. `2-vacantes-con-encaje.png` · 3. `3-tanda-en-vivo.png` ·
  4. `4-mi-perfil-tu-plan.png` · 5. `5-herramientas-que-manejas.png`

**Sitio web**: https://chamba-lista.vercel.app
**Correo de soporte**: chambalistaperu@gmail.com
**Publicador (nombre visible)**: Chamba Lista

---

## 2. Pestaña «Prácticas de privacidad»

**Propósito único**:
Ayudar a la persona a postular a ofertas de empleo: reenfoca su CV a cada vacante y completa y envía sus postulaciones en los portales de empleo que ella elige.

**Justificación de permisos**:

- `storage`: guardar en el navegador la sesión de la cuenta, el CV convertido, los datos para postular
  (que solo salen hacia el portal donde la persona postula) y el historial de postulaciones.
- `activeTab`: leer la vacante abierta en la pestaña actual cuando la persona lo pide desde el panel.
- `scripting`: completar el formulario de postulación en la pestaña del portal y volver a cargar el
  script en pestañas del portal que ya estaban abiertas al instalar la extensión.
- Permisos de host:
  - Portales de empleo: `pe.computrabajo.com`, `candidato.pe.computrabajo.com`, `pe.indeed.com`,
    `smartapply.indeed.com`, `bumeran.com.pe`, `www.bumeran.com.pe`, `www.linkedin.com`. Buscar
    vacantes, leer sus preguntas y completar y enviar la postulación en el portal que la persona eligió.
    La extensión solo actúa ahí cuando la persona lo pide desde su panel.
  - `chamba-lista.vercel.app` y `chamba-lista-ali-ab09.vercel.app` (dirección anterior del mismo servicio):
    nuestro servidor (cuenta, saldo, y la IA que reenfoca el CV y redacta las respuestas) y el puente que
    trae a la extensión la sesión iniciada en la web.
  - `api.groq.com`, `generativelanguage.googleapis.com`: solo si la persona pone su propia clave de IA en
    Mi perfil (opcional).

**¿Usa código remoto?** No. Todo el JavaScript va dentro del paquete.

**Datos que recopila** (marcar):
- [x] Información personal identificable (nombre, correo, y el DNI, fecha de nacimiento y distrito que la
  persona escribe para completar los formularios)
- [x] Información de autenticación (la contraseña de la cuenta de Chamba Lista, solo para iniciar
  sesión; nunca las de los portales)
- [x] Contenido del sitio web (texto de la vacante y de las preguntas del formulario de postulación)
- [x] Información financiera y de pagos (solo el número de operación del Yape, opcional, que la persona
  escribe para que podamos activar su compra; nunca datos de tarjeta ni de banca)
- [ ] Información de salud · [ ] Comunicaciones personales · [ ] Ubicación · [ ] Historial web ·
  [ ] Actividad del usuario

**Certificaciones** (marcar las tres):
- No vendo ni transfiero datos a terceros fuera de los casos de uso permitidos.
- No uso ni transfiero datos para fines ajenos al propósito único.
- No uso ni transfiero datos para determinar solvencia crediticia ni préstamos.

**URL de la política de privacidad**: https://chamba-lista.vercel.app/privacidad

---

## 3. Distribución

- **Visibilidad**: para el piloto, «verificadores de confianza» (solo las personas que pongas en la lista
  ven e instalan la extensión) o «Unlisted» (solo con el enlace). Después se pasa a pública.
- **Regiones**: solo los países donde la vas a ofrecer (Perú y, si quieres, Latinoamérica).

---

## 4. Mensaje para el revisor (campo opcional)

La extensión solo actúa en los portales de empleo cuando la persona lanza una tanda desde su panel.
Respeta topes diarios y pausas entre envíos, nunca pide contraseñas de los portales, y puede avisar antes
de cada envío.

Para probarla: crear una cuenta gratuita en https://chamba-lista.vercel.app (también se puede entrar con
correo y contraseña), abrir el panel de la extensión y subir un CV. Probar el envío real requiere una
cuenta propia en Computrabajo o Indeed; sin ella, el revisor puede comprobar el panel, la carga del CV, la
búsqueda de vacantes y el modo «te avisa antes de enviar» (que no envía nada sin confirmación).

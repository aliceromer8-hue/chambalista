# Cómo generar ingresos con esto

Números reales, buscados el 2026-07-31. Sin optimismo de más: si algo no da plata, lo digo.

## Primero, la mala noticia: los anuncios no van a funcionar

Es la opción que preferías, y por eso hay que mirarla de frente.

**AdSense en Perú paga entre 0.80 y 1.80 dólares por cada 1000 visitas** (CPM general; el nicho de empleo no es de los caros). Traducido:

| Visitas al mes | Ingreso mensual aproximado |
|---|---|
| 1 000 | S/ 3 – 7 |
| 10 000 | S/ 30 – 70 |
| 50 000 | S/ 150 – 350 |
| 100 000 | S/ 300 – 700 |

Para sacar **S/ 500 al mes con anuncios necesitas unas 100 000 visitas mensuales**. Eso es un sitio grande, con meses o años de posicionamiento. Y en 2026 los RPM cayeron más porque las respuestas con IA en Google se quedan con el clic.

Hay un problema añadido: esta herramienta se usa **una vez cada varios meses** (cuando alguien busca trabajo). No genera visitas recurrentes como un blog. Es el peor perfil posible para vivir de anuncios.

**Conclusión:** los anuncios pueden ser un extra más adelante, nunca el ingreso principal.

## La buena noticia: hay un hueco de precio evidente

Los generadores de CV que existen cobran **entre 16 y 25 dólares al mes** (Enhancv 16.50, Novoresume 21.99, la mayoría 23–25). Eso son **S/ 60 a 95 mensuales**. Para un estudiante peruano buscando prácticas es impensable.

Nadie está atendiendo ese mercado a precio peruano. Ahí está tu oportunidad, y no necesita tráfico masivo: necesita **conversión**.

## Cómo lo hacen los que ya venden esto

Se verificó: **ninguno pide una clave de IA**. Simplify, JobCopilot, LazyApply y AIApply la incluyen en el precio. JobCopilot cobra $8.90 por semana por 20 postulaciones diarias; LazyApply, de $99 a $999 al año.

Y tiene sentido, porque **pedir la clave es el mayor filtro de usuarias posible**. La persona que busca prácticas no es desarrolladora: mandarla a Google AI Studio a crear un proyecto hace que abandone ahí mismo.

### Lo que cuesta incluirla

Con Gemini 2.5 Flash a $0.30 por millón de tokens de entrada y $2.50 de salida, y el consumo real medido en este proyecto:

| Operación | Coste |
|---|---|
| Analizar un CV | ~$0.004 (S/ 0.015) |
| Adaptar el CV + responder las preguntas de una vacante | ~$0.008 (S/ 0.03) |
| **100 postulaciones completas** | **~$1.00 (S/ 3.70)** |

Cobrando S/ 12 por 100 postulaciones, el coste es S/ 3.70 y el margen S/ 8.30 — un 69%. La IA se puede incluir sin problema.

### Cómo está construido

`proxy_ia.py` recibe la petición de la extensión y llama al modelo con la clave del servidor. La clave no puede ir dentro de la extensión: su código es visible para cualquiera que la instale.

El uso se controla por identificador de dispositivo que genera la extensión — sin cuentas ni correos. Es un límite blando (alguien decidido lo regenera) y está bien: sirve para que un usuario no agote la cuota de todos.

Quien tenga su propia clave puede usarla y entonces no consume cuota. Ese camino sigue existiendo porque no cuesta nada mantenerlo.

**El único gasto real:** una clave de Gemini con facturación activada, porque la capa gratuita se agota con varios usuarios. Al pagarse por uso, si nadie usa la herramienta no pagas nada.

## El modelo que recomiendo

**Gratis:** convertir el CV al formato Harvard y descargarlo. Sin registro, sin límite. Esto es el gancho y es lo que la gente va a compartir.

**De pago — S/ 12 por una vez, o S/ 25 al mes:**

- CV adaptado a cada vacante (lo que de verdad sube las probabilidades)
- Búsqueda en los tres portales con las vacantes que encajan con tu CV
- Las respuestas de los formularios redactadas
- La herramienta de postulación para instalar

**Por qué S/ 12 y no S/ 5:** por debajo de S/ 10 la gente no percibe valor y tú necesitas volumen imposible. S/ 12 es un menú, es una decisión fácil para alguien que lleva semanas buscando trabajo, y con 100 ventas al mes son S/ 1 200.

**Por qué el pago único primero:** la suscripción implica cobros recurrentes, gestión de bajas y soporte. El pago único con Yape es inmediato y no tiene mantenimiento.

### La matemática que importa

Si de cada 100 personas que convierten su CV gratis, **3 pagan** (una conversión freemium normal es 2–5 %):

| Personas que usan el gratis / mes | Pagan (3 %) | Ingreso a S/ 12 |
|---|---|---|
| 300 | 9 | S/ 108 |
| 1 000 | 30 | S/ 360 |
| 3 000 | 90 | S/ 1 080 |
| 10 000 | 300 | S/ 3 600 |

Compáralo con la tabla de anuncios: con **1 000 visitas** los anuncios te dan S/ 5 y el freemium S/ 360. Setenta veces más.

## Cómo cobrar sin pagar comisiones

En Perú tienes una ventaja que no existe en otros países:

- **Yape para micronegocios: sin comisión.** Solo necesitas tu QR o tu número.
- **Plin Negocios: sin comisión.**
- El QR interoperable del BCRP recibe de ambos con un solo código.
- Yape Empresa (perfil empresa) cobra 2.95 %, así que **quédate en micronegocios** mientras el volumen sea bajo.
- Las pasarelas con tarjeta cobran 3.44–3.99 % + IGV. No las necesitas para empezar.

**El flujo más simple posible, sin programar una pasarela:**

1. La persona convierte su CV gratis.
2. Ve el botón «Desbloquear todo — S/ 12».
3. Se le muestra tu QR de Yape y un botón de WhatsApp con el mensaje ya escrito.
4. Paga, te manda la captura por WhatsApp.
5. Le respondes con un código de acceso.

Es manual, sí. Pero a 30 ventas al mes son 30 mensajes, y **el coste es cero**. Cuando el volumen moleste, ahí sí se automatiza con Culqi o Mercado Pago (que integran Yape y Plin de forma nativa).

## Qué cuesta tenerlo en línea

| Concepto | Coste |
|---|---|
| Hosting del convertidor (Render, capa gratuita) | **S/ 0** |
| Landing (GitHub Pages) | **S/ 0** |
| Dominio .com | ~S/ 45 al año (opcional; Render da subdominio gratis) |
| IA | **S/ 0** — cada usuario pone su clave gratuita, o se usa el modo sin IA |
| Cobros con Yape micronegocios | **S/ 0** |

**Coste total para arrancar: cero.**

Advertencias sobre el hosting, porque cambió en 2026:

- **Render** es la única de las tres grandes con capa gratuita sin tarjeta. El servicio se duerme tras 15 minutos sin visitas y tarda ~30 s en despertar. Molesto pero tolerable.
- **Railway** ya no es gratis: da 5 dólares de crédito de prueba.
- **Fly.io** quitó la capa gratuita a las cuentas nuevas.
- **Vercel Hobby prohíbe el uso comercial.** Si vas a monetizar, no lo uses: te pueden cerrar la cuenta.

## Plan de las próximas dos semanas

**Semana 1 — poner el gratis en línea.** Desplegar `app_web.py` en Render (ya está listo: `render.yaml` y `requirements-web.txt` incluidos). Publicar la landing en GitHub Pages. Contar visitas con Plausible o el propio panel de Render.

**Semana 2 — validar que alguien paga.** Añadir el botón de S/ 12 con tu QR de Yape. No hace falta automatizar nada. Si en dos semanas no paga nadie, el problema es el precio o el mensaje, y lo sabrás gastando cero.

**Difusión, gratis:** grupos de Facebook de empleo en Perú, subreddits r/PERU y r/peruanos, TikTok mostrando el antes y el después de un CV (tu terreno), y las bolsas de trabajo de universidades e institutos.

## Otras vías, ordenadas por lo que rinden

1. **Institutos y universidades.** Su oficina de empleabilidad paga por una herramienta para sus alumnos. Un instituto con 500 estudiantes a S/ 500 al semestre supera a meses de ventas sueltas. Requiere reuniones, no código.
2. **Servicio hecho por ti.** «Te dejo el CV listo por S/ 30.» Lo haces con la herramienta en 10 minutos. Es lo que más rápido te da plata mientras el producto crece.
3. **Freemium** (lo de arriba). Escala solo, pero necesita tráfico.
4. **Anuncios.** Cuando pases de 30 000 visitas al mes, y como complemento.

Lo honesto: **la opción 2 es la que te da ingresos esta semana**, y las otras construyen algo que dure. No son excluyentes.

---

Fuentes de los números: [AdSense RPM por país 2026](https://adstimate.com/blog/adsense-rpm-by-country.html) · [Caída de RPM en 2026](https://advantrise.com/adsense-in-2026-rpms-crashed-ai-took-the-clicks-and-publishers-are-leaving) · [Precios de generadores de CV 2026](https://resufit.com/blog/best-ai-resume-builders-2026-pricing-features-ats-comparison/) · [Pasarelas de pago en Perú 2026](https://blog.riqra.com/posts/pasarelas-pago-online-peru) · [Yape micronegocios](https://www.yape.com.pe/productos/micronegocios) · [Comparativa de capas gratuitas 2026](https://agentdeals.dev/hosting-free-tier-comparison-2026)

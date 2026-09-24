// Panel de Chamba Lista: se abre en su propia pestaña.
//
// Solo pinta y recoge decisiones. Toda la lógica de buscar, rellenar y
// enviar vive en background.js y en los content scripts.

import { NIVELES, CIUDADES, LISTA_PORTALES, queHace } from "../lib/portales.js";
import * as almacen from "../lib/almacen.js";
import * as datos from "../lib/datos.js";
import * as ia from "../lib/ia.js";
import * as coincidencia from "../lib/coincidencia.js";
import * as sesion from "../lib/sesion.js";
import { PACK_MAYOR, TOPE_POR_TANDA } from "../lib/verificados.js";
import { SERVIDOR } from "../lib/servidor.js";

const $ = (s) => document.querySelector(s);
const enviar = (msg) => chrome.runtime.sendMessage(msg);
const escapar = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const estado = {
  // ¿Hay sesión de Chamba Lista? Sin ella, el CV adaptado, la IA y la
  // medición devuelven 401 y el panel no podría explicar por qué.
  conCuenta: false,
  perfil: null, vacantes: [], vacanteAbierta: null, reporte: null,
  respuestasPersona: {}, aprobacion: {},
};

// Estado de sesión de cada portal. Se consulta al arrancar y tras pulsar
// «Iniciar sesión»; el resto de la interfaz lo lee de aquí.
let sesionesCache = [];

// Portales en los que la persona acaba de pulsar «Iniciar sesión» y
// todavía no hemos visto la sesión. Sin esto, pulsaba, se iba a la
// pestaña del portal, entraba, volvía al panel y seguía viendo el punto
// rojo un rato — sin saber si el producto estaba roto o ella iba lenta.
// Un «conectando…» que no miente no cuesta nada y quita esa duda.
const conectando = new Set();

/**
 * Consola de actividad: la máquina cuenta lo que va haciendo.
 *
 * No es decoración. Buscar en cuatro portales y preparar una tanda tarda
 * minutos, y sin esto la persona ve una barra avanzar sin saber qué pasa
 * ni por qué tarda. Narrarlo es lo que hace que se entienda que el
 * trabajo lo está haciendo la web y no ella.
 */
const consola = {
  lineas: [],
  escribir(texto, definitiva = false) {
    const c = $("#consola");
    if (!c) return;
    // La última línea se reemplaza mientras la etapa sigue en curso.
    if (!definitiva && this.lineas.length && this.lineas.at(-1).viva) {
      this.lineas.at(-1).texto = texto;
    } else {
      this.lineas.push({ texto, viva: !definitiva });
    }
    if (definitiva && this.lineas.length) this.lineas.at(-1).viva = false;
    this.lineas = this.lineas.slice(-8);
    c.innerHTML = this.lineas.map((l, i) =>
      `<p class="${i < this.lineas.length - 1 ? "apagado" : ""}">` +
      `<span class="marca-linea">›</span><span>${escapar(l.texto)}</span></p>`).join("");
    c.scrollTop = c.scrollHeight;
  },
  limpiar() { this.lineas = []; const c = $("#consola"); if (c) c.innerHTML = ""; },
};

/** Aviso flotante. Antes las acciones se completaban en silencio y no
 *  quedaba claro si habían funcionado. */
function avisar(texto, tipo = "") {
  let cont = document.getElementById("avisos");
  if (!cont) {
    cont = document.createElement("div");
    cont.id = "avisos";
    document.body.appendChild(cont);
  }
  const el = document.createElement("div");
  el.className = `flotante ${tipo}`;
  el.textContent = texto;
  cont.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/**
 * La fecha de una postulación, en corto.
 *
 * `new Date(x).toLocaleDateString()` pinta «Invalid Date» —así, en
 * inglés— en cuanto el registro no trae fecha o la trae rota. Puede
 * pasar con un registro viejo o con uno que baje de la nube, y aparece
 * en la tarjeta de una postulación de verdad. Mejor no decir nada que
 * decir «Invalid Date».
 */
function fechaCorta(valor) {
  if (!valor) return "";
  const f = new Date(valor);
  return Number.isNaN(f.getTime()) ? "" : f.toLocaleDateString("es-PE");
}

// ---------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------
function irA(vista) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("activa", t.dataset.vista === vista));
  document.querySelectorAll(".vista").forEach((v) => v.classList.toggle("oculto", v.id !== `vista-${vista}`));
  if (vista === "inicio") pintarInicio();
  if (vista === "pipeline") pintarPipeline();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => irA(t.dataset.vista)));
document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => irA(b.dataset.ir)));

// ---------------------------------------------------------------------
// Inicio: kanban de cifras, gráfico y últimos movimientos
// ---------------------------------------------------------------------
async function pintarInicio() {
  pintarCuenta();
  const r = await almacen.tracker.resumen();

  pintarPortada(r);

  $("#kanban-resumen").innerHTML = almacen.ETAPAS.map((e) =>
    `<div class="etapa ${e.id}"><b>${r.porEtapa[e.id] || 0}</b><span>${e.nombre}</span></div>`,
  ).join("");

  $("#m-semana").textContent = r.estaSemana;
  // `== null` cubre null Y undefined: con `=== null` un undefined se
  // colaba y pintaba «undefined%».
  $("#m-tasa").textContent = r.tasaRespuesta == null ? "—" : `${r.tasaRespuesta}%`;
  $("#m-entrevistas").textContent = r.entrevistas;
  dibujarGrafico(r.serie);

  const lista = (await almacen.tracker.listar()).slice(0, 6);
  $("#ultimos").innerHTML = lista.length
    ? lista.map((p) => {
        const f = fechaCorta(p.fecha);
        return `<div class="portal-fila"><span class="punto ${p.etapa}"></span>` +
          `<span><strong>${escapar(p.puesto || "—")}</strong>` +
          `<div class="nota">${escapar(p.empresa || "")}</div></span>` +
          `<span class="estado nota">${f}</span></div>`;
      }).join("")
    : `<p class="vacio">Todavía no has postulado a nada.</p>`;

  if (estado.vacantes.length) pintarDestacadas();
}

/**
 * El titular de la portada, escrito desde los números de verdad.
 *
 * Estaba a mano en dos sitios del JS y otro del HTML, y decía «cien»
 * mientras el código mandaba quince. Un número que el propio producto
 * desmiente es exactamente lo que no podemos permitirnos.
 *
 * Así que lo escribe la única fuente que manda —`verificados.js`— y
 * dice lo que sea verdad ese día:
 *
 *   · Si una tanda ya cubre el pack entero, promete el clic: es cierto.
 *   · Si no, promete lo que SÍ se cumple siempre: que no escribes
 *     ninguna. Que es además el motivo real por el que alguien paga.
 *
 * El día que suba TOPE_POR_TANDA a cien —una línea, después de activar
 * facturación en Gemini— el titular cambia solo.
 */
function titularPortada() {
  const cuantas = enLetra(PACK_MAYOR);
  if (TOPE_POR_TANDA >= PACK_MAYOR) {
    return `Un clic.<br>${cuantas} postulaciones.`;
  }
  return `${cuantas} postulaciones.<br>Sin escribir ninguna.`;
}

/**
 * El número del titular, en palabra.
 *
 * «Cien postulaciones» y «100 postulaciones» no se leen igual en un
 * titular: el dígito parece un dato de tabla y la palabra parece una
 * promesa. Si el pack cambiara a uno que no está en la lista, se cae al
 * dígito — feo, pero nunca en blanco ni mal escrito.
 */
function enLetra(n) {
  return { 5: "Cinco", 15: "Quince", 20: "Veinte", 30: "Treinta",
           50: "Cincuenta", 100: "Cien" }[n] || String(n);
}

/**
 * El recorrido, en orden: cuenta → CV → portales → buscar.
 *
 * Es ESTRICTO a propósito. Antes cada pantalla dejaba tocar su contenido
 * aunque faltara el paso anterior, y el resultado era un error: sin
 * cuenta se podía subir el CV, `/api/cv/procesar` devolvía 401 y la
 * persona se quedaba en «Mi perfil» con un mensaje de sesión caducada
 * —de una sesión que nunca existió—. Ali lo vivió como «se crashea».
 *
 * Así que cada paso tiene su cartel, y lo que depende de un paso que
 * aún no está hecho no se enseña: se enseña el cartel y su botón.
 */
const PASOS = {
  cuenta: {
    titulo: "Entra a tu cuenta",
    boton: "Entrar",
    hacer: () => { irA("inicio"); setTimeout(() => $("#acceso-correo")?.focus(), 50); },
  },
  cv: {
    titulo: "Sube tu CV",
    boton: "Subir mi CV",
    hacer: () => { irA("perfil"); $("#archivo-cv")?.click(); },
  },
  portales: {
    titulo: "Conecta dónde quieres que busque",
    boton: "Elegir portales",
    hacer: () => { irA("inicio"); $("#portada")?.scrollIntoView({ behavior: "smooth", block: "start" }); },
  },
};

/** El paso que toca ahora. Un solo cálculo: con dos, el tooltip y la
 *  pantalla llegaron a decir pasos distintos. */
function queFalta(etapa) {
  return [PASOS.cuenta, PASOS.cv, PASOS.portales][etapa] || null;
}

/** Desde qué etapa sirve cada pestaña. Antes de eso se ve el cartel y
 *  NADA del contenido: ni botones que acaben en 401, ni listas vacías. */
const SIRVE_DESDE = { perfil: 1, vacantes: 3, pipeline: 3 };

/**
 * Pone el cartel del paso siguiente en cada pestaña, y tapa el
 * contenido de las que todavía no sirven.
 *
 * «Mi perfil» se abre en cuanto hay cuenta, aunque falte el CV: ahí es
 * justo donde se sube. El resto espera a que el recorrido llegue.
 */
function pintarGuias(etapa) {
  const falta = queFalta(etapa);

  for (const [vista, desde] of Object.entries(SIRVE_DESDE)) {
    const el = $(`#vista-${vista}`);
    if (!el) continue;
    el.querySelector(".guia")?.remove();
    el.classList.toggle("cerrada", etapa < desde);
    if (!falta) continue;

    const caja = document.createElement("div");
    caja.className = "guia";
    caja.innerHTML = `
      <div>
        <span class="guia-paso">Paso ${etapa + 1} de 3</span>
        <b>${escapar(falta.titulo)}</b>
      </div>
      <button class="boton primario" type="button">${escapar(falta.boton)}</button>`;
    caja.querySelector("button").addEventListener("click", falta.hacer);
    el.prepend(caja);
  }
}




/**
 * El nombre con el que se saluda: el de la CUENTA, nunca el del CV.
 *
 * Antes salía del CV —en mayúsculas, como lo escribe el formato
 * Harvard— y si alguien entraba con su cuenta y cargaba el CV de otra
 * persona, el panel pasaba a llamarla como esa persona. La identidad es
 * la cuenta; el CV es un documento que se usa.
 *
 * Sin nombre en la cuenta no se inventa ninguno: se saluda sin nombre.
 */
function nombreCuenta({ completo = false } = {}) {
  const n = (estado.usuario?.nombre || "").trim();
  if (!n) return "";
  const bien = n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return completo ? bien : bien.split(/\s+/)[0];
}

/**
 * La tarjeta de un portal en la portada: punto de estado, nombre, qué
 * hace, y un botón. Sale de aquí para usarla en dos sitios: al conectar
 * el primero (etapa 2) y para añadir más cuando ya hay uno (etapa 3).
 */
function filaPortal(p) {
  return `
        <div class="portal-tarjeta${p.sesion ? " conectado" : ""}">
          <span class="marca-punto ${p.sesion ? "si" : conectando.has(p.id) ? "esperando" : "no"}"></span>
          <span class="portal-texto">
            <span class="portal-nombre">${escapar(p.nombre)}</span>
            <span class="portal-chip ${queHace(p).tono}" title="${queHace(p).etiqueta}">${queHace(p).etiqueta}</span>
          </span>
          <!-- «Conectar» y no «Entrar»: «Entrar» ya es el botón de la
               cuenta de Chamba Lista, y dos «Entrar» que hacen cosas
               distintas en dos pantallas seguidas se confunden. -->
          <button class="boton ${p.sesion ? "secundario" : "primario"}" data-portada-acceso="${p.id}">
            ${p.sesion ? "Abrir" : conectando.has(p.id) ? "Esperando…" : "Conectar"}
          </button>
          ${conectando.has(p.id) && !p.sesion
            ? `<span class="portal-aviso">Entra en la pestaña que se abrió. Esto se marca solo.</span>`
            : ""}
        </div>`;
}

/** Los botones «Conectar» de las tarjetas que haya dentro de `raiz`. */
function conectarBotonesPortal(raiz) {
  raiz.querySelectorAll("[data-portada-acceso]").forEach((b) => {
    b.addEventListener("click", async () => {
      const cual = b.dataset.portadaAcceso;
      conectando.add(cual);
      pintarInicio();                       // el punto pasa a ámbar ya
      await enviar({ accion: "abrirAcceso", portal: cual });
      avisar("Inicia sesión en la pestaña que se abrió. Esto se marca solo.");
      vigilarConexiones();
    });
  });
}

/**
 * La portada cambia según en qué punto está la persona. El panel entero
 * se comporta como una landing cuando es nueva —una sola cosa que hacer,
 * el resto atenuado— y se convierte en tablero cuando ya está lista.
 *
 * 0. Sin cuenta    → entrar. Es lo primero porque sin sesión el CV
 *                    adaptado, la IA y la medición devuelven 401, y la
 *                    persona lo ve como «no funciona» sin más pista.
 * 1. Sin CV        → titular grande y un único botón: cargar el CV.
 * 2. Con CV        → elegir dónde buscar e iniciar sesión en los portales.
 * 3. Todo listo    → la portada se encoge a una franja y manda el tablero.
 *
 * La etapa 0 faltaba. sesion.js tenía `entrar` y `hayCuenta` desde que se
 * añadieron las cuentas, pero el panel no los llamaba nunca: no había
 * ningún sitio donde iniciar sesión. Todo lo que necesita cuenta fallaba
 * en silencio y el panel seguía enseñando la portada como si nada.
 */
function pintarPortada(resumen) {
  const portada = $("#portada");
  const acciones = $("#portada-acciones");
  const tablero = $("#tablero");
  const conectados = sesionesCache.filter((p) => p.sesion === true);

  const etapa = !estado.conCuenta ? 0 : !estado.perfil ? 1 : !conectados.length ? 2 : 3;

  portada.classList.toggle("compacta", etapa === 3);

  // El sello «15 por tanda» solo cuando ya significa algo.
  //
  // En la primera pantalla flotaba junto a un titular que promete cien
  // postulaciones: dos numeros peleandose antes de que la persona haya
  // hecho nada. Y el 15 no le sirve de nada a quien todavia no tiene CV
  // — solo la hace dudar del 100. A partir de la etapa 2 si informa,
  // porque ya esta a punto de lanzar una tanda.
  $("#sello")?.classList.toggle("oculto", etapa < 2);

  // Las pestañas que aun no tienen contenido: marcadas, NO bloqueadas.
  //
  // Primero se deshabilitaban. Estaba mal: quien pulsa una pestaña
  // apagada no aprende nada, solo choca contra una pared. Ahora se
  // entra igual y la pantalla explica que falta y trae el boton para
  // resolverlo — la curiosidad acaba en el sitio correcto en vez de en
  // un callejon.
  //
  // El punto al lado del nombre avisa antes de pulsar, y el title lo
  // dice con palabras para quien llegue con el teclado o con lector.
  //
  // Cuáles y desde cuándo lo dice SIRVE_DESDE. Sin cuenta se marcan
  // todas menos Inicio, que es donde se entra.
  for (const tab of document.querySelectorAll(".menu .tab")) {
    const pendiente = etapa < (SIRVE_DESDE[tab.dataset.vista] ?? 0);
    tab.disabled = false;
    tab.classList.toggle("pendiente", pendiente);
    if (pendiente) tab.title = queFalta(etapa)?.titulo || "";
    else tab.removeAttribute("title");
  }

  pintarGuias(etapa);
  // El tablero: se enseña cuando hay algo que enseñar, y no antes.
  //
  // Antes se dejaba SIEMPRE visible, atenuado al 38 % y sin poder
  // tocarlo. O sea cinco columnas con «0» y dos tarjetas vacías,
  // fantasmales, ocupando la pantalla entera para decir que todavía no
  // se puede usar. Eso no es un estado vacío: es ruido con opacidad.
  const sinNada = resumen.total === 0;
  tablero.classList.toggle("oculto", etapa !== 3 || sinNada);
  tablero.classList.remove("esperando");
  $("#kanban-resumen").classList.toggle("oculto", etapa !== 3 || sinNada);

  // Y en su lugar, cuando ya está todo listo pero aún no ha postulado a
  // nada, una sola cosa que hacer. Con los puestos ya propuestos: pedirle
  // que escriba qué buscar es pedirle trabajo justo cuando el producto
  // existe para ahorrárselo.
  $("#arranque").classList.toggle("oculto", !(etapa === 3 && sinNada));
  if (etapa === 3 && sinNada) pintarArranque();

  if (etapa === 0) {
    $("#portada-titulo").innerHTML = titularPortada();
    $("#portada-bajada").textContent =
      "Entra con tu cuenta de Chamba Lista.";
    acciones.innerHTML = `
      <form class="acceso-panel" id="form-acceso" style="width:100%">
        <input type="email" id="acceso-correo" placeholder="tu@correo.com"
               autocomplete="email" required>
        <input type="password" id="acceso-clave" placeholder="tu contraseña"
               autocomplete="current-password" required minlength="8">
        <p class="nota aviso-acceso oculto" id="acceso-error"></p>
        <button class="boton primario" type="submit" id="acceso-enviar">Entrar</button>
        <button class="enlace" type="button" id="acceso-crear">No tengo cuenta todavía</button>
      </form>`;

    $("#acceso-crear").addEventListener("click", () => {
      chrome.tabs.create({ url: sesion.URL_CUENTA, active: true });
      avisar("Crea tu cuenta en la web y vuelve aquí a entrar.");
    });

    $("#form-acceso").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const boton = $("#acceso-enviar");
      const error = $("#acceso-error");
      boton.disabled = true;
      error.classList.add("oculto");
      const r = await sesion.entrar($("#acceso-correo").value.trim(),
                                    $("#acceso-clave").value);
      boton.disabled = false;
      if (r.error) {
        error.textContent = r.error;
        error.classList.remove("oculto");
        return;
      }
      estado.conCuenta = true;
      estado.usuario = r.usuario || null;
      avisar(`Hola, ${r.usuario?.correo || "de nuevo"}.`);
      await pintarInicio();
    });
    return;
  }

  if (etapa === 1) {
    $("#portada-titulo").innerHTML = titularPortada();
    $("#portada-bajada").textContent =
      "Sube tu CV y empezamos.";
    acciones.innerHTML =
      `<button class="boton primario" id="p-cv">Subir mi CV y empezar</button>` +
      `<span class="nota">PDF o Word · listo en unos segundos</span>`;
    $("#p-cv").addEventListener("click", () => { irA("perfil"); $("#archivo-cv").click(); });
    return;
  }

  if (etapa === 2) {
    const nombre = nombreCuenta();
    $("#portada-titulo").innerHTML = `Listo${nombre ? `, ${escapar(nombre)}` : ""}.<br>¿Dónde buscamos?`;
    // Sin negaciones. «Nunca vemos tu contraseña» planta justo la idea
    // de que podríamos verla: negar algo lo instala. Se dice lo que SÍ
    // pasa, que además es lo que la persona necesita saber para actuar.
    $("#portada-bajada").textContent =
      "Conecta un portal para empezar a postular.";

    // Uno primero, los demás después.
    //
    // Antes se pedían cuatro sesiones seguidas antes de ver una sola
    // vacante. Cuatro peajes delante de alguien que todavía no ha visto
    // funcionar nada es el sitio perfecto para abandonar — y encima
    // sobra: con un portal conectado ya se busca y se postula.
    //
    // Primero va el que tiene la postulación COMPROBADA, no el primero
    // de la lista. Si mañana se verifica Bumeran, este orden se ajusta
    // solo desde verificados.js.
    const ordenados = [...sesionesCache].sort((a2, b2) => {
      const peso = (p) => (p.sesion ? 0 : queHace(p).tono === "bien" ? 1 : 2);
      return peso(a2) - peso(b2);
    });
    const primeros = ordenados.filter((p) => p.sesion).length
      ? ordenados                       // ya conectó alguno: se ven todos
      : ordenados.slice(0, 1);
    const resto = primeros.length === ordenados.length ? [] : ordenados.slice(1);



    acciones.innerHTML = `<div class="portales-portada" style="width:100%">`
      + primeros.map(filaPortal).join("")
      + (resto.length
        ? `<details class="mas-portales"${resto.some((p) => conectando.has(p.id)) ? " open" : ""}>
             <summary><span class="mas-signo" aria-hidden="true">+</span> Añadir otro portal
               <small>${resto.map((p) => escapar(p.nombre)).join(" · ")}</small></summary>
             <div class="portales-portada">${resto.map(filaPortal).join("")}</div>
           </details>`
        : "")
      + `</div>`;
    conectarBotonesPortal(acciones);
    return;
  }

  // Etapa 3: ya está todo listo. La portada resume y deja pasar.
  const cuantas = resumen.total;
  const nombreCorto = nombreCuenta();
  $("#portada-titulo").textContent = cuantas
    // «postulación» pierde la tilde en plural: no se puede pegar «es».
    ? `Llevas ${cuantas} ${cuantas === 1 ? "postulación" : "postulaciones"}`
    : `Todo listo${nombreCorto ? `, ${nombreCorto}` : ""}. ¿Qué buscamos hoy?`;
  $("#portada-bajada").textContent = cuantas
    ? `${resumen.entrevistas} en entrevista · ${conectados.length} ${conectados.length === 1 ? "portal conectado" : "portales conectados"}`
    : `${conectados.length} ${conectados.length === 1 ? "portal conectado" : "portales conectados"}. Escribe el puesto que buscas y empezamos.`;
  // Los portales que faltan, a mano. Antes, conectado el primero, la
  // opción de añadir los demás desaparecía de Inicio y solo quedaba en
  // Mi perfil, donde nadie la buscaba.
  const sinConectar = sesionesCache.filter((p) => !p.sesion);
  acciones.innerHTML = `<button class="boton primario" id="p-buscar">Buscar y postular</button>`
    + (sinConectar.length
      ? `<details class="mas-portales"${sinConectar.some((p) => conectando.has(p.id)) ? " open" : ""}>
           <summary><span class="mas-signo" aria-hidden="true">+</span> Conectar más portales
             <small>${sinConectar.map((p) => escapar(p.nombre)).join(" · ")}</small></summary>
           <div class="portales-portada">${sinConectar.map(filaPortal).join("")}</div>
         </details>`
      : "");
  $("#p-buscar").addEventListener("click", () => irA("vacantes"));
  conectarBotonesPortal(acciones);
  $("#sello").innerHTML = `${resumen.porEtapa.enviada || 0}<small>enviadas</small>`;
}

/** Línea de los últimos 14 días. Sin librerías: es un path y punto. */
function dibujarGrafico(serie) {
  const svg = $("#grafico");

  // Sin ninguna postulación, una línea plana pegada al suelo parece un
  // error. Mejor decir que todavía no hay nada que graficar.
  if (!serie.some((v) => v > 0)) {
    svg.innerHTML =
      `<line x1="0" y1="60" x2="300" y2="60" stroke="var(--linea)" ` +
      `stroke-width="1.5" stroke-dasharray="4 5"/>` +
      `<text x="150" y="34" text-anchor="middle" fill="var(--tinta-3)" ` +
      `font-size="12" font-family="system-ui, sans-serif">` +
      `Tus postulaciones aparecerán aquí</text>`;
    return;
  }

  const max = Math.max(1, ...serie);
  const puntos = serie.map((v, i) => [
    (i / (serie.length - 1)) * 300,
    68 - (v / max) * 60,
  ]);
  const linea = puntos.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linea} L300,70 L0,70 Z`;
  const [ux, uy] = puntos[puntos.length - 1];

  svg.innerHTML =
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="var(--acento)" stop-opacity=".3"/>` +
    `<stop offset="100%" stop-color="var(--acento)" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${area}" fill="url(#g)"/>` +
    `<path d="${linea}" fill="none" stroke="var(--acento)" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
    `<circle cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="4.5" fill="var(--acento)"/>`;
}

function pintarDestacadas() {
  const top = coincidencia.ordenar(estado.vacantes, estado.perfil).slice(0, 3);
  $("#destacadas").innerHTML = `<div class="rejilla-vacantes">${top.map(tarjetaVacante).join("")}</div>`;
  conectarTarjetas($("#destacadas"));
}

// ---------------------------------------------------------------------
// Vacantes
// ---------------------------------------------------------------------
function iniciarBuscador() {
  $("#nivel").innerHTML = NIVELES.map((n) => `<option value="${n.id}">${n.nombre}</option>`).join("");
  $("#ciudades").innerHTML = CIUDADES.map((c) => `<option value="${escapar(c)}">`).join("");
  $("#portales").innerHTML = LISTA_PORTALES.map((p) =>
    `<label class="chk-portal"><input type="checkbox" class="chk-p" value="${p.id}" checked>` +
    `<span>${p.nombre}</span>` +
    `<span class="portal-chip">${queHace(p).etiqueta}</span></label>`,
  ).join("");
}

function tarjetaVacante(v, i) {
  const e = v.encaje || {};
  const clase = e.puntaje === null || e.puntaje === undefined ? "bajo"
    : e.puntaje >= 70 ? "alto" : e.puntaje >= 40 ? "" : "bajo";
  const encaje = e.puntaje == null ? "" : `<span class="encaje ${clase}">${e.puntaje}% encaje</span>`;
  const etiquetas = (e.coincidencias || []).slice(0, 5)
    .map((c) => `<span class="etiqueta">${escapar(c)}</span>`).join("");

  const retardo = Math.min(i || 0, 8) * 45;
  return `<article class="vacante marcada" data-id="${escapar(v.id)}" style="animation-delay:${retardo}ms">
    <div class="arriba">
      <input type="checkbox" class="chk-v" checked>
      <div style="flex:1;min-width:0">
        <h3>${escapar(v.titulo)}</h3>
        <div class="meta">${escapar([v.empresa, v.ubicacion].filter(Boolean).join(" · "))}</div>
        ${v.publicado ? `<div class="meta">${escapar(v.publicado)}</div>` : ""}
      </div>
      ${encaje}
    </div>
    ${etiquetas ? `<div class="etiquetas">${etiquetas}</div>` : ""}
    <div class="pie">
      <span class="portal-chip">${escapar(v.portal)}</span>
      <button class="boton secundario chico btn-abrir" style="margin-left:auto">
        ${v.postulable === false ? "Abrir en el portal" : "Ver y postular"}
      </button>
    </div>
  </article>`;
}

function conectarTarjetas(raiz) {
  raiz.querySelectorAll(".vacante").forEach((el) => {
    const v = estado.vacantes.find((x) => x.id === el.dataset.id);
    el.querySelector(".btn-abrir")?.addEventListener("click", () => abrirVacante(v));
    el.querySelector(".chk-v")?.addEventListener("change", (ev) => {
      el.classList.toggle("marcada", ev.target.checked);
      actualizarCuenta();
    });
  });
}

function actualizarCuenta() {
  const n = $("#lista-vacantes").querySelectorAll(".chk-v:checked").length;
  $("#cuenta-marcadas").textContent = `${n} marcada(s) de ${estado.vacantes.length}`;
  $("#btn-lote-auto").textContent = n ? `Postular a las ${n}` : "Postular a todas";
  $("#acciones-lote").classList.toggle("oculto", !estado.vacantes.length);
}

// Enter en cualquiera de los campos lanza la búsqueda.
["#puesto", "#ciudad"].forEach((sel) => {
  $(sel).addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-buscar").click(); });
});

$("#btn-buscar").addEventListener("click", async () => {
  const puesto = $("#puesto").value.trim();
  if (!puesto) {
    // Volver sin decir nada hace que el boton parezca roto: pulsas y no
    // pasa nada, y no sabes si falla el producto o te falta a ti algo.
    $("#resumen-busqueda").textContent = "Escribe qué puesto buscas y le damos.";
    $("#puesto").focus();
    return;
  }
  const boton = $("#btn-buscar");
  boton.disabled = true;
  boton.textContent = "Buscando…";
  const elegidos = [...document.querySelectorAll(".chk-p:checked")].map((c) => c.value);
  $("#progreso").classList.remove("oculto");
  consola.limpiar();
  consola.escribir(`Buscando «${puesto}»…`, true);
  elegidos.forEach((id) => {
    const p = LISTA_PORTALES.find((x) => x.id === id);
    if (p) consola.escribir(`Entrando a ${p.nombre}…`, true);
  });
  $("#relleno").style.width = "35%";
  $("#resumen-busqueda").textContent = "";
  // Esqueletos: recorrer los portales tarda, y una pantalla en blanco
  // durante 10 segundos se siente como que algo se rompió.
  $("#lista-vacantes").innerHTML = Array.from({ length: 6 },
    () => `<div class="esqueleto"></div>`).join("");

  try {
    const prefs = { puesto, ciudad: $("#ciudad").value.trim(), nivel: $("#nivel").value };
    await almacen.preferencias.guardar({ ...prefs, portales: elegidos });
    const r = await enviar({ accion: "buscar", ...prefs, portales: elegidos });
    if (r?.error) throw new Error(r.error);

    // Primero, solo las del tema que buscó; después, ordenadas por
    // encaje con el CV. Antes solo se ordenaba, y «Practicante de Diseño
    // Gráfico» salía buscando marketing (y encima arriba).
    const todas = estado.perfil
      ? coincidencia.ordenar(r.vacantes || [], estado.perfil)
      : (r.vacantes || []);
    // Las que ya postuló con Chamba Lista, fuera. El portal marca las
    // suyas y el fondo ya las descarta, pero no siempre las marca (Indeed
    // y Bumeran no lo hacían nunca); lo que pasó por aquí lo sabemos seguro.
    const yaPostuladas = [];
    for (const v of [...todas]) {
      if (await almacen.tracker.yaPostulado(v.url)) {
        yaPostuladas.push(v);
        todas.splice(todas.indexOf(v), 1);
      }
    }
    estado.yaPostuladasOcultas = yaPostuladas.length;
    const delTema = todas.filter((v) => coincidencia.relacionada(v, puesto));
    estado.fueraDeTema = todas.filter((v) => !coincidencia.relacionada(v, puesto));
    // Si el filtro se lo come todo, se enseña todo: mejor ruido que nada.
    if (!delTema.length) estado.fueraDeTema = [];
    estado.vacantes = delTema.length ? delTema : todas;

    if (!estado.vacantes.length) {
      $("#lista-vacantes").innerHTML = `<div class="vacio-guiado" style="grid-column:1/-1">
        <span class="emoji">🔍</span>
        <h3>Sin resultados para «${escapar(r.termino)}»</h3>
        <p>Prueba con un término más corto («marketing» en vez de «practicante de marketing digital»),
           quita la ciudad para buscar en todo el país, o revisa que tengas sesión en los portales.</p>
      </div>`;
    } else {
      $("#lista-vacantes").innerHTML = estado.vacantes.map(tarjetaVacante).join("");
      conectarTarjetas($("#lista-vacantes"));
    }
    actualizarCuenta();

    $("#relleno").style.width = "100%";
    consola.escribir(`${estado.vacantes.length} vacantes encontradas.`, true);
    if (estado.perfil) consola.escribir("Ordenadas por lo que encaja con tu CV.", true);
    setTimeout(() => $("#progreso").classList.add("oculto"), 1400);

    const fallos = (r.errores || []).map((e) => `${e.portal}: ${e.error}`).join(" · ");
    $("#resumen-busqueda").textContent =
      // Si por lo que sea no vuelve el término, se usa lo que la persona
      // escribió. «undefined» en pantalla no puede pasar nunca.
      `${estado.vacantes.length} vacante(s) para «${r.termino || $("#puesto").value.trim() || "tu búsqueda"}».` +
      // Con cero resultados no hay nada que ordenar: decir «ordenadas por
      // encaje» ahi no informa de nada y suena a respuesta automatica.
      (estado.vacantes.length === 0 ? ""
        : estado.perfil ? " Ordenadas por encaje con tu CV."
        : " Carga tu CV para ordenarlas por encaje.") +
      (fallos ? ` — ${fallos}` : "");

    if (estado.yaPostuladasOcultas) {
      $("#resumen-busqueda").append(
        ` Ocultamos ${estado.yaPostuladasOcultas} a ${estado.yaPostuladasOcultas === 1 ? "la" : "las"} que ya postulaste.`);
    }
    // Se dice cuántas se quitaron por no ser del tema, y se pueden ver:
    // el filtro puede equivocarse y la persona decide.
    if (estado.fueraDeTema?.length) {
      const ver = document.createElement("button");
      ver.className = "enlace";
      ver.textContent = `Ver también ${estado.fueraDeTema.length} de otros temas`;
      ver.addEventListener("click", () => {
        estado.vacantes = [...estado.vacantes, ...estado.fueraDeTema];
        estado.fueraDeTema = [];
        $("#lista-vacantes").innerHTML = estado.vacantes.map(tarjetaVacante).join("");
        conectarTarjetas($("#lista-vacantes"));
        actualizarCuenta();
        ver.remove();
      });
      $("#resumen-busqueda").append(" ", ver);
    }
  } catch (e) {
    $("#resumen-busqueda").textContent = `No se pudo buscar: ${e.message}`;
  } finally {
    boton.disabled = false;
    boton.textContent = "Buscar";
  }
});

// ---------------------------------------------------------------------
// Una vacante: preparar, revisar, enviar
// ---------------------------------------------------------------------
async function abrirVacante(vacante) {
  if (!vacante) return;
  estado.vacanteAbierta = vacante;
  estado.respuestasPersona = {};
  $("#modal").classList.remove("oculto");
  $("#modal-contenido").innerHTML =
    `<h2>${escapar(vacante.titulo)}</h2><p class="nota">${escapar(vacante.empresa)}</p>` +
    `<p class="nota">Abriendo el formulario y redactando las respuestas…</p>`;

  estado.reporte = await enviar({ accion: "prepararUna", vacante, respuestasPersona: {} });
  pintarModal();
}

function pintarModal() {
  const v = estado.vacanteAbierta;
  const r = estado.reporte || {};
  const c = $("#modal-contenido");
  const cab = `<h2>${escapar(v.titulo)}</h2><p class="nota">${escapar([v.empresa, v.ubicacion].filter(Boolean).join(" · "))}</p>`;

  if (r.soloLectura || r.error || r.requiereLogin || r.captcha) {
    c.innerHTML = cab + `<div class="aviso alerta">${escapar(r.nota || r.error)}</div>`;
    return;
  }
  // El portal postuló solo al entrar (oferta sin preguntas). Se dice
  // tal cual: ya está enviada, no hay nada más que hacer.
  if (r.enviadaDirecto) {
    c.innerHTML = cab + `<div class="aviso"><strong>Postulación enviada.</strong><br>`
      + `<span class="nota">${escapar(r.nota)}</span></div>`;
    pintarInicio();
    return;
  }

  let html = cab;

  // El CV. Se dice lo que pasó de verdad, no lo que se intentó.
  //
  // Antes esto ponía «CV adaptado a esta vacante» siempre que el modelo
  // devolviera cambios, aunque el archivo que le llegaba a la empresa
  // fuera el viejo del portal. Ahora el aviso depende de si el adjunto
  // quedó puesto, que es lo único que la empresa llega a ver.
  if (r.cv?.adjuntado) {
    const extra = r.cv.anadidas?.length
      ? `<br><span class="nota">Incluye ${r.cv.anadidas.map(escapar).join(", ")}, que confirmaste tú.</span>`
      : "";
    const cambios = r.cambiosCV?.length
      ? `<br>${r.cambiosCV.map(escapar).join("<br>")}`
      : "";
    html += `<div class="aviso"><strong>Se adjuntó tu CV adaptado a esta vacante.</strong><br>`
          + `<span class="nota">${escapar(r.cv.archivo)}</span>${cambios}${extra}</div>`;
  } else if (r.cv) {
    html += `<div class="aviso alerta"><strong>Vas a postular con el CV que ya tienes en el portal.</strong><br>`
          + `${escapar(r.cv.nota || "No se pudo adjuntar el CV adaptado.")}</div>`;
  }
  // Cuántas quedaron escritas en el formulario del portal, y cuántas
  // esperan a que las contestes tú. Es lo primero que se comprueba
  // mirando el portal, así que se dice sin tener que ir a mirarlo.
  const total = (r.preguntas || []).length;
  if (total) {
    const faltan = r.preguntas.filter((q) => !q.texto).length;
    html += `<div class="aviso"><strong>${r.escritas || 0} de ${total} preguntas ya están escritas en el formulario.</strong>`
          + (faltan ? `<br><span class="nota">${faltan === 1 ? "Una la contestas" : `${faltan} las contestas`} tú aquí abajo.</span>` : "")
          + `</div>`;
  }
  if (r.completados?.length) {
    html += `<p class="nota">Se completaron solos ${r.completados.length} campo(s) del formulario.</p>`;
  }
  if (r.pendientes?.length) {
    html += `<div class="aviso alerta">El portal pide datos que no tenemos: <strong>${r.pendientes.map(escapar).join(", ")}</strong>. ` +
            `Guárdalos en <em>Mi perfil</em> o escríbelos en la página.</div>`;
  }
  // Donde se ve el formulario. En LinkedIn el envío lo das tú allí, así
  // que ese es EL botón; en el resto sirve para revisar antes de enviar.
  const soloRevisado = Boolean(LISTA_PORTALES.find((p) => p.id === (v.portalId || ""))?.soloRevisado);
  html += `<div class="fila-botones ver-formulario">
      <button class="boton ${soloRevisado ? "primario" : "secundario"}" id="btn-ver-form">
        ${soloRevisado ? `Ir a ${escapar(v.portal || "LinkedIn")} a enviar` : "Ver el formulario"}</button>
      <button class="enlace" id="btn-rellenar-pantalla">¿Pasaste a otra pantalla del formulario? Rellenarla</button>
    </div>`;

  html += `<div id="preguntas"></div>
    <label class="confirmar${soloRevisado ? " oculto" : ""}"><input type="checkbox" id="chk-revision">
      <span>Revisé el formulario en la página del portal y confirmo el envío</span></label>
    <button class="boton primario${soloRevisado ? " oculto" : ""}" id="btn-enviar" disabled>Enviar postulación</button>
    <p class="nota" id="estado-envio"></p>`;
  c.innerHTML = html;

  $("#btn-ver-form").addEventListener("click", async () => {
    // Lo que ya contestó en el panel viaja al formulario antes de verlo.
    const r2 = await enviar({ accion: "mostrarFormulario", respuestas: respuestasDelPanel() });
    if (r2?.error) avisar(r2.error);
  });
  $("#btn-rellenar-pantalla").addEventListener("click", async () => {
    const b = $("#btn-rellenar-pantalla");
    b.disabled = true;
    b.textContent = "Rellenando esta pantalla…";
    const r2 = await enviar({ accion: "rellenarPantalla", respuestasPersona: {} });
    if (r2?.error) {
      avisar(r2.error);
      b.disabled = false;
      b.textContent = "¿Pasaste a otra pantalla del formulario? Rellenarla";
      return;
    }
    estado.reporte = { ...estado.reporte, preguntas: r2.preguntas, escritas: r2.escritas };
    pintarModal();
    avisar(`${r2.escritas} de ${(r2.preguntas || []).length} preguntas escritas en esta pantalla.`, "bien");
  });

  pintarPreguntas(r.preguntas || []);

  /**
   * El boton de enviar depende de DOS cosas, no de una.
   *
   * Antes solo miraba la casilla de revision. Pero las preguntas de
   * consentimiento —«¿aceptas practicas no remuneradas?»— se dejan en
   * blanco A PROPOSITO: no las contesta el modelo, las contesta la
   * persona. El problema es que nada se lo decia. Marcaba la casilla,
   * el boton se activaba, y se enviaba la postulacion con la pregunta
   * vacia.
   *
   * O sea que la proteccion funcionaba a medias: evitaba que
   * respondieramos nosotros, pero no que la respuesta se fuera vacia.
   * Segun el formulario, eso es una postulacion descartada o —peor— un
   * silencio que el portal interpreta como un si.
   */
  function revisarSiPuedeEnviar() {
    const sinContestar = [...$("#preguntas").querySelectorAll("textarea")]
      .filter((t) => !t.value.trim());
    const revisado = $("#chk-revision").checked;
    $("#btn-enviar").disabled = !revisado || sinContestar.length > 0;

    const nota = $("#estado-envio");
    if (sinContestar.length) {
      nota.textContent = sinContestar.length === 1
        ? "Falta contestar una pregunta. Esa la decides tú, no la respondemos por ti."
        : `Faltan ${sinContestar.length} preguntas. Esas las decides tú.`;
      nota.classList.add("falta");
    } else {
      nota.textContent = "";
      nota.classList.remove("falta");
    }
    // Se marca cual falta, para no tener que buscarla.
    for (const t of $("#preguntas").querySelectorAll("textarea")) {
      t.closest(".pregunta")?.classList.toggle("sin-contestar", !t.value.trim());
    }
  }

  $("#chk-revision").addEventListener("change", revisarSiPuedeEnviar);
  $("#preguntas").addEventListener("input", revisarSiPuedeEnviar);
  revisarSiPuedeEnviar();
  $("#btn-enviar").addEventListener("click", enviarUna);
}

function pintarPreguntas(preguntas) {
  const cont = $("#preguntas");
  cont.innerHTML = "";
  preguntas.forEach((q, n) => {
    const pendientes = (q.necesita || []).filter((x) => !x.respondido);
    const div = document.createElement("div");
    div.className = "pregunta";
    div.innerHTML = `<p class="enunciado"><strong>${n + 1}.</strong> ${escapar(q.enunciado)} ` +
      (pendientes.length ? `<span class="marca-etq falta">falta que respondas</span>`
        : q.texto ? `<span class="marca-etq">redactado</span>` : "") + `</p>` +
      (q.avisoCuota ? `<div class="aviso alerta">${escapar(q.avisoCuota)}</div>` : "");

    (q.necesita || []).forEach((f) => {
      if (f.aviso) {
        div.insertAdjacentHTML("beforeend",
          `<div class="aviso alerta">${escapar(f.aviso).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</div>`);
      }
      div.insertAdjacentHTML("beforeend", `<p class="nota">${escapar(f.etiqueta)}</p>`);
      if (f.tipo === "opciones") {
        const g = document.createElement("div");
        g.className = "opciones";
        f.opciones.forEach((op) => {
          const b = document.createElement("button");
          b.className = "opcion" + (estado.respuestasPersona[f.clave] === op ? " elegida" : "");
          b.textContent = op;
          b.addEventListener("click", () => {
            estado.respuestasPersona[f.clave] = op;
            reRedactar();
          });
          g.appendChild(b);
        });
        div.appendChild(g);
      } else {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = estado.respuestasPersona[f.clave] || "";
        inp.placeholder = "Escríbelo y sal del campo";
        inp.style.cssText = "width:100%;padding:8px 11px;border:1px solid var(--linea);border-radius:6px;font:inherit;background:var(--tarjeta);color:var(--tinta)";
        inp.addEventListener("change", () => {
          estado.respuestasPersona[f.clave] = inp.value.trim();
          reRedactar();
        });
        div.appendChild(inp);
      }
    });

    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.dataset.indice = q.indice;
    ta.value = q.texto || q.actual || "";
    if (q.max) ta.maxLength = Number(q.max);
    ta.placeholder = pendientes.length ? "Responde arriba y aparece aquí, o escríbelo tú." : "Revisa o corrige.";
    div.appendChild(ta);
    cont.appendChild(div);
  });
}

async function reRedactar() {
  // Se conserva lo que la persona haya editado a mano.
  const editados = {};
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    const orig = (estado.reporte.preguntas.find((q) => String(q.indice) === ta.dataset.indice) || {}).texto || "";
    if (ta.value.trim() && ta.value.trim() !== orig.trim()) editados[ta.dataset.indice] = ta.value.trim();
  });
  // Solo se vuelve a leer y redactar ESTA pantalla. Antes se preparaba
  // la postulación entera otra vez: volvía a la ficha y volvía a pulsar
  // «Postularme» por cada opción elegida — lento, y en Computrabajo, un
  // viaje de ida y vuelta a la página de preguntas cada vez.
  const r = await enviar({ accion: "rellenarPantalla", respuestasPersona: estado.respuestasPersona });
  if (r?.error) { avisar(r.error); return; }
  estado.reporte = { ...estado.reporte, preguntas: r.preguntas, escritas: r.escritas };
  pintarPreguntas(estado.reporte.preguntas || []);
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    if (editados[ta.dataset.indice]) ta.value = editados[ta.dataset.indice];
  });
}

/** Lo que la persona dejó escrito en el panel, por posición. */
function respuestasDelPanel() {
  const respuestas = {};
  document.querySelectorAll("#preguntas textarea").forEach((ta) => {
    if (ta.value.trim()) respuestas[ta.dataset.indice] = ta.value.trim();
  });
  return respuestas;
}

async function enviarUna() {
  const boton = $("#btn-enviar");
  boton.disabled = true;
  boton.textContent = "Enviando…";
  const respuestas = respuestasDelPanel();
  const r = await enviar({ accion: "enviarUna", vacante: estado.vacanteAbierta, respuestas });
  const est = $("#estado-envio");
  if (r?.enviada) {
    est.textContent = r.mensaje;
    avisar("Postulación enviada", "bien");
    pintarInicio();
  } else {
    const d = r?.diagnostico || {};
    est.innerHTML = `⚠️ ${escapar(r?.mensaje || r?.error || "No se pudo confirmar.")}` +
      (d.botonPulsado ? `<br>Botón que se pulsó: <code>${escapar(d.botonPulsado)}</code>` : "") +
      (d.errores?.length ? `<br>El portal pide: ${escapar(d.errores.join(" · "))}` : "");
    boton.disabled = false;
  }
  boton.textContent = "Enviar postulación";
}

$("#btn-cerrar-modal").addEventListener("click", () => $("#modal").classList.add("oculto"));
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").classList.add("oculto"); });

// ---------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------
$("#btn-lote-revisar").addEventListener("click", () => arrancarLote("revisado"));

$("#btn-lote-auto").addEventListener("click", async () => {
  const { casillas } = await enviar({ accion: "consentimiento" });
  $("#casillas").innerHTML = "";

  // Antes de pedirle que asuma riesgos, decirle qué va a pasar de verdad.
  //
  // El lote automático salta los portales que no envían solos —LinkedIn,
  // porque su §8.2 prohíbe la automatización y lo que se arriesga es la
  // cuenta de la persona. El fondo lo hace bien y las marca «omitida»,
  // pero nadie se lo decía ANTES: marcabas las cuatro casillas contando
  // con enviar diez y salían siete, sin explicación hasta el final.
  const marcadas = estado.vacantes.filter((v) => v.marcada !== false);
  const seSaltan = marcadas.filter((v) => {
    const cfg = LISTA_PORTALES.find((p) => p.id === (v.portalId || "")) || {};
    return cfg.soloRevisado;
  });
  // LinkedIn envía en automático por decisión de Ali, con el riesgo de
  // cuenta asumido. Se dice ANTES, junto a las casillas: es información
  // para decidir, no un susto.
  const deLinkedin = marcadas.filter((v) => (v.portalId || "") === "linkedin").length;
  const avisoPrevio = $("#aviso-lote") || (() => {
    const p = document.createElement("p");
    p.id = "aviso-lote";
    p.className = "nota";
    $("#bloque-riesgo").insertBefore(p, $("#casillas"));
    return p;
  })();
  if (seSaltan.length) {
    const cuales = [...new Set(seSaltan.map((v) => v.portal))].join(" y ");
    const iran = marcadas.length - seSaltan.length;
    avisoPrevio.textContent =
      `De las ${marcadas.length} marcadas, ${seSaltan.length === 1 ? "una es" : `${seSaltan.length} son`} `
      + `de ${cuales} y no se ${seSaltan.length === 1 ? "envía sola" : "envían solas"}: `
      + `${seSaltan.length === 1 ? "queda preparada" : "quedan preparadas"} para que `
      + `${seSaltan.length === 1 ? "la mandes" : "las mandes"} tú. `
      + (iran === 0 ? "No se enviará ninguna automáticamente."
                    : iran === 1 ? "Se enviará una." : `Se enviarán ${iran}.`);
    avisoPrevio.classList.remove("oculto");
  } else if (deLinkedin) {
    avisoPrevio.textContent =
      `${deLinkedin === 1 ? "Una es" : `${deLinkedin} son`} de LinkedIn. LinkedIn puede limitar `
      + "las cuentas que postulan en automático.";
    avisoPrevio.classList.remove("oculto");
  } else {
    avisoPrevio.textContent = "";
    avisoPrevio.classList.add("oculto");
  }

  casillas.forEach((c) => {
    const l = document.createElement("label");
    const i = document.createElement("input");
    i.type = "checkbox";
    i.addEventListener("change", () => {
      estado.aprobacion[c.clave] = i.checked;
      $("#btn-confirmar-auto").disabled = !casillas.every((x) => estado.aprobacion[x.clave]);
    });
    l.appendChild(i);
    l.insertAdjacentHTML("beforeend", `<span>${escapar(c.texto)}</span>`);
    $("#casillas").appendChild(l);
  });
  $("#bloque-riesgo").classList.remove("oculto");
});

$("#btn-cancelar-auto").addEventListener("click", () => {
  $("#bloque-riesgo").classList.add("oculto");
  estado.aprobacion = {};
  $("#btn-confirmar-auto").disabled = true;
});
$("#btn-confirmar-auto").addEventListener("click", () => {
  $("#bloque-riesgo").classList.add("oculto");
  arrancarLote("automatico");
});

async function arrancarLote(modo) {
  consola.limpiar();
  const marcadas = [...$("#lista-vacantes").querySelectorAll(".vacante")]
    .filter((el) => el.querySelector(".chk-v")?.checked)
    .map((el) => estado.vacantes.find((v) => v.id === el.dataset.id))
    .filter(Boolean);
  if (!marcadas.length) return;

  consola.escribir(
    modo === "automatico"
      ? `Postulando a ${marcadas.length} vacantes. No tienes que hacer nada.`
      : `Preparando ${marcadas.length} vacantes. Las revisas antes de enviarlas.`, true);
  await enviar({
    accion: "lotePreparar", vacantes: marcadas, modo,
    aprobacion: estado.aprobacion, respuestasPersona: estado.respuestasPersona,
  });
  $("#progreso").classList.remove("oculto");
  seguirLote();
}

let temporizador = null;
function seguirLote() {
  clearInterval(temporizador);
  temporizador = setInterval(async () => {
    const s = await enviar({ accion: "loteEstado" });
    if (!s) return;
    $("#texto-progreso").textContent = `${s.hechas} de ${s.total}`;
    $("#relleno").style.width = s.total ? `${Math.round((s.hechas / s.total) * 100)}%` : "0";

    // Se narra cada vacante conforme se resuelve, con su desenlace.
    const hechos = (s.items || []).filter((i) => i.estado !== "pendiente");
    hechos.slice(consola.lineas.length ? undefined : 0).forEach(() => {});
    const yaContadas = consola.lineas.filter((l) => l.contada).length;
    hechos.slice(yaContadas).forEach((i) => {
      const desenlace = {
        enviada: "enviada ✓", preparada: "lista para revisar",
        omitida: "omitida", fallida: "no se pudo",
      }[i.estado] || i.estado;
      consola.escribir(`${i.empresa || i.titulo} — ${desenlace}`, true);
      if (consola.lineas.at(-1)) consola.lineas.at(-1).contada = true;
    });
    if (s.fase === "listo" || s.fase === "terminado") {
      clearInterval(temporizador);
      $("#progreso").classList.add("oculto");
      pintarResultadoLote(s);
      pintarInicio();
    }
  }, 1500);
}

function pintarResultadoLote(s) {
  const iconos = { enviada: "✅", omitida: "⏭️", fallida: "❌", preparada: "📝", pendiente: "⏳" };
  $("#lista-vacantes").innerHTML = s.items.map((i) =>
    `<article class="vacante" data-id="${escapar(i.id)}">
      <div class="arriba"><div style="flex:1;min-width:0">
        <h3>${iconos[i.estado] || ""} ${escapar(i.titulo)}</h3>
        <div class="meta">${escapar(i.empresa || "")}</div>
      </div></div>
      ${i.motivo ? `<p class="nota" style="color:var(--ambar)">${escapar(i.motivo)}</p>` : ""}
      ${s.modo === "revisado" && i.estado === "preparada"
        ? `<div class="pie"><button class="boton secundario chico btn-abrir" style="margin-left:auto">Revisar y enviar</button></div>` : ""}
    </article>`).join("");

  $("#lista-vacantes").querySelectorAll(".vacante").forEach((el) => {
    const i = s.items.find((x) => x.id === el.dataset.id);
    el.querySelector(".btn-abrir")?.addEventListener("click", () => abrirVacante(i));
  });
  $("#resumen-busqueda").textContent = s.mensaje;
  $("#acciones-lote").classList.add("oculto");
}

$("#btn-cancelar-lote").addEventListener("click", () => enviar({ accion: "loteCancelar" }));

// ---------------------------------------------------------------------
// Pipeline: columnas con arrastre
// ---------------------------------------------------------------------
async function pintarPipeline() {
  const lista = await almacen.tracker.listar();
  $("#columnas").innerHTML = almacen.ETAPAS.map((e) => {
    const suyas = lista.filter((p) => p.etapa === e.id);
    return `<div class="columna" data-etapa="${e.id}">
      <header><span class="punto ${e.id}"></span>${e.nombre}<span class="conteo">${suyas.length}</span></header>
      ${suyas.map((p) => {
        const f = fechaCorta(p.fecha);
        return `<div class="ficha" draggable="true" data-id="${escapar(p.id)}">
          <strong>${escapar(p.puesto || "—")}</strong>
          <div class="sub">${escapar([p.empresa, f].filter(Boolean).join(" · "))}</div>
          ${p.motivo ? `<div class="motivo">${escapar(p.motivo)}</div>` : ""}
          <select class="mover">
            ${almacen.ETAPAS.map((x) =>
              `<option value="${x.id}"${x.id === e.id ? " selected" : ""}>${x.nombre}</option>`).join("")}
          </select>
        </div>`;
      }).join("") || `<p class="vacio" style="font-size:12px">Vacío</p>`}
    </div>`;
  }).join("");

  conectarArrastre();
}

function conectarArrastre() {
  let arrastrada = null;

  document.querySelectorAll(".ficha").forEach((f) => {
    f.addEventListener("dragstart", () => { arrastrada = f; f.classList.add("arrastrando"); });
    f.addEventListener("dragend", () => { f.classList.remove("arrastrando"); arrastrada = null; });
    // El menú sirve de alternativa accesible al arrastre.
    f.querySelector(".mover")?.addEventListener("change", async (e) => {
      await almacen.tracker.moverEtapa(f.dataset.id, e.target.value);
      avisar("Movida de etapa", "bien");
      pintarPipeline();
    });
  });

  document.querySelectorAll(".columna").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("encima"); });
    col.addEventListener("dragleave", () => col.classList.remove("encima"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("encima");
      if (!arrastrada) return;
      await almacen.tracker.moverEtapa(arrastrada.dataset.id, col.dataset.etapa);
      avisar("Movida de etapa", "bien");
      pintarPipeline();
    });
  });
}

$("#btn-exportar").addEventListener("click", async () => {
  const lista = await almacen.tracker.listar();
  const filas = [["fecha", "etapa", "puesto", "empresa", "portal", "motivo", "url"]];
  lista.forEach((r) => filas.push([r.fecha, r.etapa, r.puesto, r.empresa, r.portal, r.motivo, r.url]));
  const csv = filas.map((f) => f.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "chamba-lista-postulaciones.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  avisar("CSV descargado", "bien");
});

// ---------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------
$("#btn-cargar-cv").addEventListener("click", () => $("#archivo-cv").click());

// Cerrar sesión. Vuelve al paso 1 del recorrido y lo dice: quien sale
// tiene que ver que salió, no encontrarse el panel igual que antes.
//
// El CV guardado en este navegador se borra también. Si no, quien entra
// después con OTRA cuenta en el mismo ordenador se encuentra el CV de la
// persona anterior ya cargado — y postula con él.
$("#btn-salir").addEventListener("click", async () => {
  await sesion.salir();
  await almacen.perfil.borrar();
  estado.conCuenta = false;
  estado.usuario = null;
  estado.perfil = null;
  pintarPerfil();
  await pintarInicio();
  irA("inicio");
  avisar("Sesión cerrada.");
});

$("#form-nombre").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const valor = $("#input-nombre").value.trim();
  if (!valor) return;
  const boton = $("#form-nombre button");
  boton.disabled = true;
  const r = await sesion.ponerNombre(valor);
  boton.disabled = false;
  if (r.error) { avisar(r.error); return; }
  estado.usuario = r.usuario;
  $("#input-nombre").value = "";
  avisar(`Listo, ${nombreCuenta()}.`, "bien");
  await pintarInicio();
});

$("#btn-cambiar-nombre").addEventListener("click", () => {
  $("#form-nombre").classList.remove("oculto");
  $("#btn-cambiar-nombre").classList.add("oculto");
  $("#input-nombre").value = nombreCuenta({ completo: true });
  $("#input-nombre").focus();
});

async function pintarCuenta() {
  const u = estado.usuario || await sesion.usuario();
  if (u) estado.usuario = u;
  const hay = Boolean(estado.conCuenta && u);
  $("#cuenta-linea").classList.toggle("oculto", !hay);
  if (hay) {
    const nombre = nombreCuenta({ completo: true });
    $("#cuenta-quien").textContent = nombre || u.correo || "tu cuenta";
    $("#cuenta-correo").textContent = nombre ? u.correo || "" : "";
    // Sin nombre, el campo se ofrece solo: es la única forma de que el
    // panel sepa cómo llamarte, y esconderlo detrás de un botón es
    // garantizar que nadie lo ponga.
    $("#form-nombre").classList.toggle("oculto", Boolean(nombre));
    $("#btn-cambiar-nombre").classList.toggle("oculto", !nombre);
  }
  pintarQuienSoy();
}

$("#archivo-cv").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  // Se vacía YA. Si no, elegir el mismo archivo otra vez tras un error
  // no dispara `change` y el botón parece muerto — que es exactamente
  // como se ve un cuelgue desde fuera.
  e.target.value = "";
  if (!f) return;

  // Sin cuenta no se intenta. El servidor contestaría 401 y el mensaje
  // hablaría de una «sesión caducada» que nunca existió.
  if (!(await sesion.hayCuenta())) {
    estado.conCuenta = false;
    avisar("Primero entra a tu cuenta.");
    await pintarInicio();
    irA("inicio");
    return;
  }

  const caja = $("#estado-perfil");
  caja.textContent = `Leyendo ${f.name}…`;
  let perfil;
  try {
    const fd = new FormData();
    fd.append("cv", f);
    const clave = await almacen.claveIA.obtener();
    // Por conCuenta: /api/cv/procesar pide sesión. Con fetch pelado el
    // servidor no ve token y responde «Inicia sesión para continuar» a
    // quien ya entró, que es exactamente lo que le pasaba a Ali.
    const r = await sesion.conCuenta("/api/cv/procesar", {
      method: "POST", body: fd, headers: clave ? { "X-IA-Key": clave } : {},
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      throw new Error("Tu sesión de Chamba Lista caducó. Vuelve a entrar arriba.");
    }
    if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
    if (!j.perfil || typeof j.perfil !== "object") {
      throw new Error("No pudimos leer ese archivo. Prueba con el PDF o el Word original.");
    }
    perfil = j.perfil;
    estado.perfil = perfil;
    await almacen.perfil.guardar(perfil);
  } catch (err) {
    // Sin coletillas sobre el estado del servidor: «si el servicio está
    // dormido» no significa nada para quien lo lee y encima suele ser
    // falso — casi siempre el problema es otro. El mensaje del servidor
    // ya explica qué pasa.
    caja.textContent = err.message;
    avisar(err.message);
    return;
  }

  // A partir de aquí el CV YA está guardado. Si algo falla al pintar,
  // no es que la subida fallara — decirle «error» a quien ya tiene su CV
  // dentro la hace subirlo otra vez, y otra. Se anota y se sigue.
  try {
    pintarPerfil();
    await pintarInicio();   // cargar el CV cambia de etapa

    // Y se VUELVE al recorrido.
    //
    // Aquí estaba el callejón sin salida que encontró Ali. El botón de la
    // portada te trae a «Mi perfil» para abrir el selector de archivo; el
    // CV se cargaba bien, la portada avanzaba a «¿dónde buscamos?»... y
    // esa portada está en la pestaña de Inicio, que la persona ya no
    // está mirando. Se quedaba en Mi perfil, con el CV cargado y sin un
    // solo botón que dijera «sigue por aquí».
    //
    // Subir el CV no es el final de nada: es el paso uno de cuatro. Así
    // que al terminar se vuelve a donde está el paso dos.
  } catch (err) {
    console.error("[panel] el CV se guardó pero falló al pintar:", err);
  }
  avisar("CV cargado", "bien");
  irA("inicio");
  $("#portada")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

/**
 * Una línea que dice quién eres, arriba del todo.
 *
 * El panel sabía tu nombre y tu carrera desde que subes el CV y no lo
 * enseñaba en ninguna parte. Ver tu propio nombre es lo que convierte una
 * herramienta en TU herramienta, y de paso confirma de un vistazo que el
 * CV que va a mandar es el tuyo y no uno viejo.
 */
function pintarQuienSoy() {
  const caja = $("#quien-soy-panel");
  if (!caja) return;
  const u = estado.usuario;
  if (!estado.conCuenta || !u) { caja.classList.add("oculto"); return; }

  // Arriba, QUIÉN es: la cuenta. Sin nombre puesto, el correo.
  const nombre = nombreCuenta({ completo: true }) || u.correo || "Tu cuenta";
  $("#quien-inicial").textContent = nombre[0].toUpperCase();
  $("#quien-nombre").textContent = nombre;

  // Debajo, con QUÉ CV postula. Es otra cosa y se dice aparte.
  const p = estado.perfil;
  const est = (p?.educacion || [])[0] || {};
  const linea = p
    ? ([est.cargo, est.organizacion].filter(Boolean).join(" · ") || "CV cargado")
    : "Sin CV todavía";
  $("#quien-linea").textContent = linea.length > 58 ? linea.slice(0, 57) + "…" : linea;
  caja.classList.remove("oculto");
}

function pintarPerfil() {
  pintarQuienSoy();
  const p = estado.perfil;
  if (!p) {
    $("#estado-perfil").textContent = "Sin CV cargado. Cárgalo para adaptar tu CV y responder los formularios.";
    $("#resumen-cv").innerHTML = "";
    return;
  }
  const cuenta = (k) => (p[k] || []).length;
  $("#estado-perfil").textContent = `${p.nombre || "CV cargado"} — leído ${p.analizado_con === "ia" ? "con IA" : "con reglas"}.`;
  $("#resumen-cv").innerHTML = [
    ["experiencia", "experiencias"], ["liderazgo", "de liderazgo"],
    ["educacion", "estudios"], ["certificaciones", "certificaciones"],
  ].filter(([k]) => cuenta(k)).map(([k, etq]) =>
    `<div class="portal-fila"><strong>${cuenta(k)}</strong><span class="nota">${etq}</span></div>`).join("");
}

$("#btn-guardar-clave").addEventListener("click", async () => {
  const v = $("#clave-ia").value.trim();
  if (v) await almacen.claveIA.guardar(v);
  else await almacen.claveIA.borrar();
  $("#clave-ia").value = "";
  $("#clave-ia").placeholder = v ? "Clave guardada ✓" : "Pega tu clave";
  avisar(v ? "Clave guardada" : "Clave borrada", "bien");
  pintarCuota();
});

async function pintarCuota() {
  const linea = $("#estado-cuota");
  if (await almacen.claveIA.obtener()) {
    linea.textContent = "Usando tu propia clave. No consumes cuota.";
    return;
  }
  const c = await ia.cuota();
  if (!c) {
    linea.textContent = "IA incluida.";
    return;
  }
  if (!c.servidor_configurado) {
    linea.textContent = "El servidor aún no tiene IA configurada. Puedes poner tu propia clave abajo.";
    return;
  }
  // La cuota viene de la red y puede llegar a medias. Sin esto se leía
  // «te quedan 3 de undefined usos en undefined h», que además de feo
  // hace dudar de todo lo demás que diga el panel.
  if (c.restantes > 0 && c.limite && c.ventana_horas) {
    linea.textContent = `IA incluida — te quedan ${c.restantes} de ${c.limite} usos `
      + `en ${c.ventana_horas} h.`;
  } else if (c.restantes > 0) {
    linea.textContent = `IA incluida — te quedan ${c.restantes} usos.`;
  } else {
    linea.textContent = "Sin usos gratis por ahora"
      + (c.se_renueva_en_minutos ? `, se renuevan en ${c.se_renueva_en_minutos} min` : "") + ".";
  }
}

/**
 * Los campos de datos personales, cada uno con el control que le toca.
 *
 * Escribir es el enemigo. Un desplegable se contesta de un toque, no se
 * escribe mal y sale redactado igual siempre — que es lo que acaba
 * leyendo la empresa. Lo que se GUARDA sigue siendo una cadena de texto,
 * así que las plantillas y las respuestas no se enteran de nada.
 */
async function pintarCamposDatos() {
  const guardados = await almacen.datosPersonales.obtener();
  $("#campos-datos").innerHTML = datos.CAMPOS.map((c) => {
    const v = guardados[c.clave] || "";
    const cabecera = `<label>${escapar(c.etiqueta)}`
      + (c.sensible ? `<span class="sensible">sensible</span>` : "")
      + `<span class="ayuda"> ${escapar(c.ayuda)}</span></label>`;

    if (c.tipo === "opciones") {
      // «A partir de una fecha» abre un selector de fecha de verdad, que
      // es lo que pedía Ali: una fecha no se escribe, se elige.
      const enLista = c.opciones.includes(v);
      const fecha = !enLista && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
      const elegida = fecha ? c.conFecha : v;
      return `<div class="campo-dato">${cabecera}
        <select data-clave="${c.clave}" data-tipo="opciones">
          <option value="">Sin responder</option>
          ${c.opciones.map((o) =>
            `<option value="${escapar(o)}"${o === elegida ? " selected" : ""}>${escapar(o)}</option>`).join("")}
        </select>
        ${c.conFecha ? `<input type="date" class="fecha-extra ${fecha ? "" : "oculto"}"
           data-fecha-de="${c.clave}" value="${escapar(fecha)}">` : ""}
      </div>`;
    }

    if (c.tipo === "red") {
      // Guardado como «Instagram: @alice». Se parte para reeditarlo.
      const corte = v.indexOf(":");
      const red = corte > 0 ? v.slice(0, corte).trim() : c.opciones[0];
      const usuario = corte > 0 ? v.slice(corte + 1).trim() : v;
      return `<div class="campo-dato">${cabecera}
        <div class="par-red">
          <select data-red-de="${c.clave}">
            ${c.opciones.map((o) =>
              `<option value="${escapar(o)}"${o === red ? " selected" : ""}>${escapar(o)}</option>`).join("")}
          </select>
          <input type="text" data-usuario-de="${c.clave}" value="${escapar(usuario)}"
                 placeholder="@tuusuario">
        </div>
      </div>`;
    }

    return `<div class="campo-dato">${cabecera}
      <input type="text" data-clave="${c.clave}" value="${escapar(v)}" placeholder="Opcional"></div>`;
  }).join("");

  // El selector de fecha aparece solo cuando toca.
  $("#campos-datos").querySelectorAll("select[data-tipo=opciones]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const campo = datos.CAMPOS.find((c) => c.clave === sel.dataset.clave);
      const fecha = $("#campos-datos").querySelector(`[data-fecha-de="${sel.dataset.clave}"]`);
      if (campo?.conFecha && fecha) fecha.classList.toggle("oculto", sel.value !== campo.conFecha);
    });
  });
}

$("#btn-guardar-datos").addEventListener("click", async () => {
  // Se recoge de los tres tipos de control y todo sale como cadena, que
  // es lo que espera `datos.validar` y todo lo que hay debajo.
  const crudo = {};
  const zona = $("#campos-datos");

  zona.querySelectorAll("input[data-clave]").forEach((i) => {
    if (i.value.trim()) crudo[i.dataset.clave] = i.value.trim();
  });

  zona.querySelectorAll("select[data-clave]").forEach((sel) => {
    if (!sel.value) return;
    const campo = datos.CAMPOS.find((c) => c.clave === sel.dataset.clave);
    const fecha = zona.querySelector(`[data-fecha-de="${sel.dataset.clave}"]`);
    // Si eligió «a partir de una fecha», lo que vale es la fecha.
    crudo[sel.dataset.clave] = (campo?.conFecha && sel.value === campo.conFecha && fecha?.value)
      ? fecha.value
      : sel.value;
  });

  zona.querySelectorAll("select[data-red-de]").forEach((sel) => {
    const usuario = zona.querySelector(`[data-usuario-de="${sel.dataset.redDe}"]`);
    const escrito = (usuario?.value || "").trim();
    if (escrito) crudo[sel.dataset.redDe] = `${sel.value}: ${escrito}`;
  });
  const { limpio, errores } = datos.validar(crudo);
  if (Object.keys(errores).length) {
    $("#estado-datos").textContent = Object.values(errores).join(" · ");
    avisar("Revisa los campos marcados", "mal");
    return;
  }
  await almacen.datosPersonales.guardar(limpio);
  const n = Object.keys(limpio).length;
  $("#estado-datos").textContent = `Guardados ${n} dato(s), solo en tu navegador.`;
  avisar(`${n} dato(s) guardados`, "bien");
});

$("#btn-borrar-datos").addEventListener("click", async () => {
  if (!confirm("¿Borrar todos los datos guardados en este navegador?")) return;
  await almacen.datosPersonales.borrar();
  await pintarCamposDatos();
  $("#estado-datos").textContent = "Borrados.";
});

// El fondo avisa en cuanto detecta la sesión en un portal. Puede llegar
// a los diez segundos o a los tres minutos: lo que no puede es obligar a
// la persona a adivinar cuándo mirar.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.aviso !== "sesionPortal") return;
  conectando.delete(msg.portal);
  revisarSesion().then(() => {
    const p = sesionesCache.find((x) => x.id === msg.portal);
    avisar(p ? `${p.nombre}: conectado.` : "Portal conectado.", "bien");
    pintarInicio();
  });
});

/**
 * Mientras haya un portal «conectando», se mira cada pocos segundos.
 *
 * El fondo avisa cuando ve la sesión, pero si el panel no estaba abierto
 * en ese instante el aviso se pierde. Esto es la red: cada 4 s, y se
 * para sola en cuanto no queda nada por conectar (o a los 10 minutos).
 */
let relojConexiones = null;
function vigilarConexiones() {
  if (relojConexiones) return;
  const fin = Date.now() + 10 * 60 * 1000;
  relojConexiones = setInterval(async () => {
    if (!conectando.size || Date.now() > fin) {
      clearInterval(relojConexiones);
      relojConexiones = null;
      return;
    }
    await revisarSesion();
    let nuevos = 0;
    for (const p of sesionesCache) if (p.sesion && conectando.delete(p.id)) nuevos++;
    if (nuevos) {
      avisar("Portal conectado.", "bien");
      pintarInicio();
    }
  }, 4000);
}

async function revisarSesion() {
  const chip = $("#estado-sesion");
  const r = await enviar({ accion: "sesionPortales" });
  sesionesCache = r?.portales || [];
  const conectados = sesionesCache.filter((p) => p.sesion === true).length;
  const total = sesionesCache.length;

  // No tener portales conectados TODAVIA no es una averia: es el estado
  // normal de quien acaba de entrar. En rojo y arriba del todo era lo
  // primero que veia, y decia «algo va mal» cuando lo que pasaba es que
  // aun no habia empezado. Rojo solo cuando hubo sesion y se perdio.
  const habiaConectado = sesionesCache.some((p) => p.abierto);
  chip.textContent = conectados
    ? `${conectados} de ${total} conectados`
    : (habiaConectado ? "sesión caída" : "sin portales aún");
  chip.className = "estado-sesion "
    + (conectados ? "ok" : habiaConectado ? "mal" : "neutro");
  pintarPortales();
  // Conectar un portal cambia de etapa: la portada debe reaccionar.
  if (!$("#vista-inicio").classList.contains("oculto")) pintarInicio();
}

/**
 * Lo único que hay que hacer cuando ya está todo listo y no has
 * postulado a nada todavía.
 *
 * Los puestos los propone el servidor a partir del CV —la misma
 * deducción que ya sabe que quien está en ciclo 11 busca prácticas y no
 * jefaturas— así que aquí no hay que escribir nada: se elige y ya.
 * Escribir es el enemigo; cada campo vacío es una excusa para cerrar la
 * pestaña.
 */
let sugerenciasPedidas = false;

async function pintarArranque() {
  const caja = $("#arranque");
  const nombre = nombreCuenta();
  if (!caja.dataset.pintado) {
    caja.innerHTML = `
      <article class="tarjeta arranque-tarjeta">
        <p class="antetitulo">Ya está todo listo</p>
        <h2 id="arranque-titulo">${nombre ? `${escapar(nombre)}, ` : ""}busca tu primer puesto</h2>
        <p class="pista" id="arranque-pista">Elige uno y empezamos. Puedes cambiarlo cuando quieras.</p>
        <div class="arranque-puestos" id="arranque-puestos"></div>
        <button class="boton secundario" id="arranque-otro">Prefiero escribirlo yo</button>
      </article>`;
    caja.dataset.pintado = "1";
    $("#arranque-otro").addEventListener("click", () => {
      irA("vacantes");
      $("#puesto").focus();
    });
  }
  if (sugerenciasPedidas || !estado.perfil) return;
  sugerenciasPedidas = true;
  try {
    const r = await sesion.conCuenta("/api/cv/sugerencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.perfil),
    });
    if (!r.ok) return;
    const { puestos = [], explicacion = "" } = await r.json();
    if (explicacion) $("#arranque-pista").textContent = explicacion;
    $("#arranque-puestos").innerHTML = puestos.slice(0, 4).map((p) => `
      <button class="chip-puesto" data-puesto="${escapar(p.texto)}">
        <b>${escapar(p.texto)}</b><span>${escapar(p.razon || "")}</span>
      </button>`).join("");
    $("#arranque-puestos").querySelectorAll("[data-puesto]").forEach((b) => {
      b.addEventListener("click", () => {
        // Un clic: se pone el puesto y se busca. Sin escribir nada.
        irA("vacantes");
        $("#puesto").value = b.dataset.puesto;
        $("#btn-buscar").click();
      });
    });
  } catch { /* sin sugerencias se puede escribir igual */ }
}

/** Tarjeta de portales: estado y botón para iniciar sesión en cada uno. */
function pintarPortales() {
  const cont = $("#lista-portales");
  if (!cont) return;
  cont.innerHTML = sesionesCache.map((p) => {
    const etiqueta = p.sesion === true ? "conectado"
      : p.sesion === false ? "sin sesión"
      : "sin abrir";
    const clase = p.sesion === true ? "ok" : p.sesion === false ? "mal" : "";
    return `<div class="portal-fila">
      <strong>${escapar(p.nombre)}</strong>
      <span class="portal-chip">${queHace(p).etiqueta}</span>
      <span class="estado-sesion ${clase}" style="margin-left:auto">${etiqueta}</span>
      <button class="boton chico" data-acceso="${p.id}">
        ${p.sesion === true ? "Abrir" : "Iniciar sesión"}
      </button>
    </div>`;
  }).join("");

  cont.querySelectorAll("[data-acceso]").forEach((b) => {
    b.addEventListener("click", async () => {
      await enviar({ accion: "abrirAcceso", portal: b.dataset.acceso });
      avisar("Inicia sesión en la pestaña que se abrió, luego vuelve aquí.");
      // Se revisa al rato: para entonces ya debería haber entrado.
      setTimeout(revisarSesion, 12000);
    });
  });
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
(async () => {
  iniciarBuscador();
  const prefs = await almacen.preferencias.obtener();
  $("#puesto").value = prefs.puesto || "";
  $("#ciudad").value = prefs.ciudad || "";
  $("#nivel").value = prefs.nivel || "cualquiera";

  estado.perfil = await almacen.perfil.obtener();
  pintarPerfil();
  if (await almacen.claveIA.obtener()) $("#clave-ia").placeholder = "Clave guardada ✓";

  await pintarCamposDatos();
  // Las sesiones primero: la etapa de la portada depende de ellas y si
  // no, se pinta la etapa equivocada durante un instante.
  // Lo primero: ¿hay cuenta? La portada entera depende de ello.
  // El puente puede haber traído la sesión de la web mientras el panel
  // estaba cerrado, así que esto se lee después de que corra.
  estado.conCuenta = await sesion.hayCuenta();
  if (estado.conCuenta) {
    const u = await sesion.verificar();
    // Token muerto: mejor pedir la contraseña que fallar en cada botón.
    if (!u) estado.conCuenta = false;
    else estado.usuario = u;
  }
  await revisarSesion();
  await pintarInicio();
  pintarCuota();
  pintarTope();
  pintarVersion();
})();


/**
 * Qué versión está corriendo Chrome AHORA MISMO.
 *
 * No es un adorno. La extensión se carga descomprimida desde una carpeta
 * del disco, así que actualizar el repositorio y actualizar lo que Chrome
 * ejecuta son dos cosas distintas, y desde fuera se ven iguales: el panel
 * se abre, todo parece normal, y el fallo que ya estaba arreglado sigue
 * ahí. Se puede perder una tarde entera así.
 *
 * Por eso el número sale de `getManifest()` —el manifest que Chrome tiene
 * cargado de verdad— y nunca de una constante escrita aquí: una constante
 * diría la versión nueva aunque Chrome siguiera con el código viejo,
 * que es exactamente la mentira que esto existe para no contar.
 */
function pintarVersion() {
  const donde = document.querySelector("#version-extension");
  if (!donde) return;
  avisarSiHayVersionNueva();
  try {
    donde.textContent = `Chamba Lista ${chrome.runtime.getManifest().version}`;
  } catch {
    // Sin manifest no hay nada honesto que decir: mejor un pie vacío.
    donde.closest(".pie-version")?.remove();
  }
}


// El sello de la portada lo escribe el código, no la plantilla.
//
// Puesto a mano decía «30 por tanda» cuando TOPE_POR_TANDA son 15: el
// doble de lo que el producto hace. Un número en la portada que el
// propio código desmiente es de lo poco que se puede reclamar sin
// discusión, y evitarlo cuesta ocho líneas.
async function pintarTope() {
  const sello = document.querySelector("#sello-tope");
  if (!sello) return;
  try {
    const { tope } = await enviar({ accion: "consentimiento" });
    if (tope) sello.textContent = tope;
    else sello.closest(".sello")?.remove();
  } catch {
    // Antes que enseñar un número inventado, no enseñar ninguno.
    sello.closest(".sello")?.remove();
  }
}


// Al volver al panel se vuelve a comprobar las sesiones.
//
// El fondo avisa cuando ve la sesión, pero el panel puede estar cerrado
// en ese momento —lo normal es que la persona se vaya a la pestaña del
// portal— y ese aviso se pierde. Esto es la red: al volver a mirar el
// panel, se mira de nuevo. Sin esto, quien cierra el panel mientras
// entra al portal vuelve y lo ve igual de desconectado que antes.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  revisarSesion().then(() => {
    for (const p of sesionesCache) if (p.sesion) conectando.delete(p.id);
    pintarInicio();
  });
});


/**
 * Si la versión cargada es más vieja que la publicada, se dice arriba.
 *
 * La extensión se carga descomprimida desde una carpeta: bajar la nueva
 * y que Chrome la ejecute son dos pasos distintos, y el segundo se olvida.
 * Ali probó un arreglo que su Chrome no había cargado y vio el fallo de
 * antes. Sin este aviso, eso le va a pasar a cualquiera.
 */
async function avisarSiHayVersionNueva() {
  try {
    const actual = chrome.runtime.getManifest().version;
    const r = await fetch(`${SERVIDOR}/api/estado`);
    const publicada = (await r.json()).version_extension;
    if (!publicada || !esMasNueva(publicada, actual)) return;
    const aviso = document.createElement("div");
    aviso.className = "aviso-version";
    aviso.innerHTML = `<b>Hay una versión nueva (${escapar(publicada)}).</b> `
      + `Tienes la ${escapar(actual)}. Descárgala en la web y recárgala en chrome://extensions.`;
    document.querySelector("main")?.prepend(aviso);
  } catch { /* sin red no se avisa: no es motivo para molestar */ }
}

function esMasNueva(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

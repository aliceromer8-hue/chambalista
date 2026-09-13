// Selectores y URLs de los portales.
//
// Los de Computrabajo están verificados contra el sitio real (2026-07-29)
// leyendo el DOM de una página de resultados y de una oferta. Si el portal
// cambia su maquetación, este es el único archivo que hay que tocar.

export const NIVELES = [
  { id: "cualquiera", nombre: "Cualquier nivel", prefijo: "" },
  { id: "practicas", nombre: "Prácticas", prefijo: "practicante de" },
  { id: "junior", nombre: "Junior / primer empleo", prefijo: "" },
  { id: "semi", nombre: "Semi-senior", prefijo: "" },
  { id: "senior", nombre: "Senior / jefatura", prefijo: "" },
];

export const CIUDADES = [
  "Lima", "Arequipa", "Trujillo", "Chiclayo", "Piura", "Cusco",
  "Huancayo", "Iquitos", "Tacna", "Callao", "Chimbote", "Ica",
];

function slug(texto) {
  return (texto || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");
}

// El puesto que escribe la persona se usa TAL CUAL. Solo "prácticas"
// antepone algo, porque «practicante de X» es como titulan esas ofertas.
// Anteponer cargos genéricos en los demás niveles producía disparates
// («analista de psicólogo organizacional»).
export function terminoBusqueda(puesto, nivel = "cualquiera") {
  const limpio = (puesto || "").trim();
  if (!limpio) return "";
  const fila = NIVELES.find((n) => n.id === nivel) || NIVELES[0];
  if (!fila.prefijo) return limpio;
  if (/practicant|asistent|analist|jefe|gerent|supervisor|senior|junior|trainee/i.test(limpio)) {
    return limpio;
  }
  return `${fila.prefijo} ${limpio}`;
}

export const PORTALES = {
  computrabajo: {
    id: "computrabajo",
    nombre: "Computrabajo",
    postulable: true,
    base: "https://pe.computrabajo.com",
    acceso: "https://candidato.pe.computrabajo.com/acceso/",
    url(termino, ciudad, pagina = 1) {
      let ruta = `trabajo-de-${slug(termino)}`;
      if (ciudad) ruta += `-en-${slug(ciudad)}`;
      const u = `${this.base}/${ruta}`;
      return pagina > 1 ? `${u}?p=${pagina}` : u;
    },
    sel: {
      oferta: "article.box_offer[data-id]",
      titulo: "h2 a.js-o-link",
      empresa: "[offer-grid-article-company-url]",
      ubicacion: "p.fs16.fc_base.mt5:not(.dFlex) span.mr10",
      fecha: "p.fs13.fc_aux",
      yaPostulado: "[applied-offer-tag]:not(.hide)",
      urlPostular: "[data-href-offer-apply]",
      siguiente: "span[title='Siguiente'][data-path]",
      sinSesion: "a.js_login",
      detalleTitulo: "h1",
      detalleDesc: "p.mbB",
      detalleRequisitos: "ul.mbB li",
      botonPostular: "a.b_primary",
    },
  },

  bumeran: {
    id: "bumeran",
    nombre: "Bumeran",
    // Postula desde el 2026-09-11. Ojo: a diferencia de Computrabajo,
    // Bumeran no acepta un CV adjunto en la vacante — usa el del perfil
    // de la persona. Ver el bloque «Postular» en contenido/bumeran.js.
    postulable: true,
    base: "https://www.bumeran.com.pe",
    acceso: "https://www.bumeran.com.pe/login",
    url(termino, ciudad, pagina = 1) {
      let ruta = `empleos-busqueda-${slug(termino)}`;
      if (ciudad) ruta += `-en-${slug(ciudad)}`;
      const u = `${this.base}/${ruta}.html`;
      return pagina > 1 ? `${u}?page=${pagina}` : u;
    },
    sel: {
      oferta: "a[href*='/empleos/']",
      titulo: "h2, h3",
      empresa: "[class*='company'], h3 + *",
      ubicacion: "[class*='location'], [class*='ubicacion']",
      fecha: "[class*='date'], [class*='fecha']",
    },
  },

  linkedin: {
    id: "linkedin",
    nombre: "LinkedIn",
    // Rellena, pero NO envía. LinkedIn prohíbe la automatización en su
    // §8.2 y desde finales de 2025 restringe cuentas por ello; lo que
    // detectan son extensiones que tocan el DOM. Lo que se arriesga es
    // la cuenta de la persona, no la nuestra, y su perfil de LinkedIn es
    // su vida laboral entera.
    //
    // Su política sí admite extensiones que ayudan al propio usuario
    // mientras no envíen sin revisión. Eso es lo que se hace.
    postulable: true,
    soloRevisado: true,

    // El más restrictivo de los cuatro: aquí solo se busca. Postular se
    // hace a mano en la oferta.
    base: "https://www.linkedin.com",
    acceso: "https://www.linkedin.com/login",
    url(termino, ciudad) {
      const p = new URLSearchParams({ keywords: termino });
      if (ciudad) p.set("location", `${ciudad}, Perú`);
      return `${this.base}/jobs/search/?${p}`;
    },
  },

  indeed: {
    id: "indeed",
    nombre: "Indeed",
    // El formulario vive en smartapply.indeed.com y es de varios pasos;
    // el manifest declara ese dominio. Ojo: muchas vacantes mandan al
    // ATS del empleador, y esas no se pueden completar desde aquí.
    postulable: true,

    base: "https://pe.indeed.com",
    acceso: "https://secure.indeed.com/auth?hl=es_PE&co=PE",
    url(termino, ciudad, pagina = 1) {
      const p = new URLSearchParams({ q: termino });
      if (ciudad) p.set("l", ciudad);
      if (pagina > 1) p.set("start", String((pagina - 1) * 10));
      return `${this.base}/jobs?${p}`;
    },
    sel: {
      oferta: "div.job_seen_beacon, [data-testid='slider_item']",
      titulo: "h2.jobTitle span, [id^='jobTitle']",
      empresa: "[data-testid='company-name']",
      ubicacion: "[data-testid='text-location']",
      fecha: "[data-testid='myJobsStateDate']",
    },
  },
};

export const LISTA_PORTALES = Object.values(PORTALES);


/**
 * Qué sabe hacer este portal, dicho en dos palabras.
 *
 * Los cuatro ponían «postula» y no es verdad de todos:
 *
 *   computrabajo  postula y está comprobado con una postulación real
 *   bumeran       tiene el código, sin comprobar todavía
 *   indeed        igual
 *   linkedin      rellena y NO envía — por decisión, no por falta de
 *                 código: su §8.2 prohíbe la automatización y lo que se
 *                 arriesga es la cuenta de la persona
 *
 * Enseñar «postula» en los cuatro es prometer en la propia interfaz algo
 * que tres de ellos no hacen.
 */
export function queHace(portal) {
  // Se mira la CONFIGURACIÓN por id, no lo que venga en el objeto: el
  // fondo devuelve los portales con solo unos pocos campos —id, nombre,
  // postulable, sesión— y `soloRevisado` no viaja ahí. Fiarse del objeto
  // que llega hacía que LinkedIn se anunciara como «postula (en
  // pruebas)» cuando no envía nunca.
  const cfg = PORTALES[portal?.id] || portal || {};
  if (!cfg.postulable) return { etiqueta: "solo busca", tono: "neutro" };
  if (cfg.soloRevisado) return { etiqueta: "rellena, envías tú", tono: "aviso" };
  if (VERIFICADOS.includes(cfg.id)) return { etiqueta: "postula", tono: "bien" };
  return { etiqueta: "postula (en pruebas)", tono: "aviso" };
}

// Se copia aquí en vez de importar verificados.js para no arrastrar otro
// módulo a los content scripts, que cargan portales.js.
const VERIFICADOS = ["computrabajo"];

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
    postulable: false,
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
    postulable: false,
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
    postulable: false,
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

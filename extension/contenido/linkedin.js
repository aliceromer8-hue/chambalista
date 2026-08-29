// Content script de LinkedIn: solo lectura del listado de empleos.
//
// LinkedIn es el más restrictivo de los cuatro y el que más vigila la
// automatización, así que aquí NO se postula ni se rellena nada: se lee
// la lista y la persona abre la oferta para aplicar por su cuenta.
//
// Sus clases llevan hashes que cambian, así que se prefieren atributos
// estables (`data-job-id`, `data-occludable-job-id`) y estructura.

(() => {
  const texto = (raiz, sel) => {
    const e = raiz.querySelector(sel);
    return e ? e.innerText.replace(/\s+/g, " ").trim() : "";
  };

  // Sin sesión, LinkedIn muestra los enlaces de acceso o el muro de registro.
  function haySesion() {
    if (!document.querySelector("body")) return false;
    if (document.querySelector(".authwall, [data-test-id='auth-wall']")) return false;
    if (document.querySelector("a[href*='/login'], a[href*='/uas/login'], .nav__button-secondary")) {
      return false;
    }
    // La barra global solo existe con sesión iniciada.
    return Boolean(document.querySelector("#global-nav, .global-nav, [data-test-global-nav]"));
  }

  function leerOfertas() {
    const tarjetas = [...document.querySelectorAll(
      "[data-occludable-job-id], [data-job-id], li.jobs-search-results__list-item",
    )];

    return tarjetas.map((c) => {
      const id = c.getAttribute("data-occludable-job-id") || c.getAttribute("data-job-id") || "";
      const enlace = c.querySelector("a[href*='/jobs/view/']");
      const href = enlace?.getAttribute("href") || (id ? `/jobs/view/${id}/` : "");
      const titulo = texto(c, "a[href*='/jobs/view/'] strong, .job-card-list__title, [class*='job-card'] strong")
        || enlace?.innerText.split("\n")[0].trim() || "";

      return {
        id: `linkedin-${id || href}`,
        portal: "LinkedIn",
        portalId: "linkedin",
        postulable: false,
        titulo,
        empresa: texto(c, "[class*='primary-description'], [class*='subtitle'], .job-card-container__company-name"),
        ubicacion: texto(c, "[class*='metadata'] li, [class*='caption']"),
        publicado: texto(c, "time"),
        url: href.startsWith("http") ? href.split("?")[0] : `https://www.linkedin.com${href.split("?")[0]}`,
        yaPostulado: /solicitado|applied/i.test(c.innerText || ""),
      };
    }).filter((o) => o.titulo && o.url);
  }

  function leerDetalle() {
    return {
      titulo: texto(document, "h1"),
      descripcion: texto(document, "#job-details, .jobs-description__content").slice(0, 2500),
      requisitos: [],
      url: location.href,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _e, responder) => {
    try {
      if (msg.accion === "ping") responder({ ok: true, url: location.href, sesion: haySesion() });
      else if (msg.accion === "sesion") responder({ sesion: haySesion() });
      else if (msg.accion === "ofertas") responder({ ofertas: leerOfertas(), sesion: haySesion() });
      else if (msg.accion === "detalle") responder(leerDetalle());
      else responder({ error: "En LinkedIn solo se puede buscar; postula tú desde la oferta." });
    } catch (e) {
      responder({ error: e.message });
    }
    return true;
  });
})();

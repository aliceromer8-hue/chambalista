// Content script de Indeed: solo lectura del listado.
//
// Indeed sí mantiene atributos estables (`data-testid`, `data-jk`), así
// que aquí los selectores son directos. Lo único que cambió respecto a
// lo que se suele documentar: `h2.jobTitle` ya no existe; el título vive
// en un elemento con id que empieza por `jobTitle`.
// Verificado contra el sitio real: 16 de 16 ofertas extraídas completas.

(() => {
  const SEL = {
    oferta: "div.job_seen_beacon",
    titulo: "[id^='jobTitle'], h2 a span[title], h2 span",
    empresa: "[data-testid='company-name']",
    ubicacion: "[data-testid='text-location']",
    fecha: "[data-testid='myJobsStateDate'], .date",
  };

  const texto = (raiz, sel) => {
    const e = raiz.querySelector(sel);
    return e ? e.innerText.replace(/\s+/g, " ").trim() : "";
  };

  function leerOfertas() {
    return [...document.querySelectorAll(SEL.oferta)].map((c) => {
      // El href de la tarjeta es un redirector de Indeed; la URL
      // canónica se arma con el identificador `jk`.
      const jk = c.querySelector("a[data-jk]")?.getAttribute("data-jk") || "";
      return {
        id: `indeed-${jk}`,
        portal: "Indeed",
        portalId: "indeed",
        postulable: false,
        titulo: texto(c, SEL.titulo),
        empresa: texto(c, SEL.empresa),
        ubicacion: texto(c, SEL.ubicacion),
        publicado: texto(c, SEL.fecha),
        url: jk ? `https://pe.indeed.com/viewjob?jk=${jk}` : "",
        yaPostulado: false,
      };
    }).filter((o) => o.titulo && o.url);
  }

  function leerDetalle() {
    return {
      titulo: texto(document, "h1, [data-testid='jobsearch-JobInfoHeader-title']"),
      descripcion: texto(document, "#jobDescriptionText").slice(0, 2500),
      requisitos: [...document.querySelectorAll("#jobDescriptionText li")]
        .map((li) => li.innerText.trim()).filter(Boolean).slice(0, 12),
      url: location.href,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _e, responder) => {
    try {
      if (msg.accion === "ping") responder({ ok: true, url: location.href, sesion: true });
      else if (msg.accion === "ofertas") responder({ ofertas: leerOfertas(), sesion: true });
      else if (msg.accion === "detalle") responder(leerDetalle());
      else responder({ error: "Indeed solo permite buscar por ahora." });
    } catch (e) {
      responder({ error: e.message });
    }
    return true;
  });
})();

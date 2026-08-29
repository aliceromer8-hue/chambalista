// Content script de Bumeran: solo lectura del listado.
//
// Bumeran no permite postular desde aquí todavía: aporta vacantes a la
// lista y la persona abre la oferta para postular a mano.
//
// Ojo con los selectores: Bumeran usa styled-components, así que sus
// clases son hashes (`sc-VigVT`, `bnFyWs`) que cambian en cada despliegue
// suyo. Por eso NO se usa ninguna clase. Se usa la estructura semántica:
// dentro del enlace a la oferta, el <h2> es el título y los <h3> traen
// fecha, empresa, valoración, ubicación y modalidad, en ese orden.
// Verificado contra el sitio real: 20 de 20 ofertas extraídas completas.

(() => {
  const MODALIDAD = /^(presencial|remoto|h[ií]brido|home office)$/i;
  const SOLO_NUMERO = /^[\d.,]+$/;

  function leerOfertas() {
    const enlaces = [...document.querySelectorAll("a[href*='/empleos/']")]
      .filter((a) => a.querySelector("h2"));

    return enlaces.map((a) => {
      const encabezados = [...a.querySelectorAll("h2, h3")];
      const h2 = a.querySelector("h2");
      const i = encabezados.indexOf(h2);

      const posteriores = encabezados.slice(i + 1)
        .map((e) => e.innerText.trim()).filter(Boolean);

      // El primer h3 tras el título es la empresa, salvo que sea la
      // valoración numérica de la empresa.
      const empresa = posteriores.find((t) => !SOLO_NUMERO.test(t)) || "";
      // La ubicación es la que lleva coma («San Isidro, Lima») y no es
      // ni la empresa ni la modalidad.
      const ubicacion = posteriores.find(
        (t) => t !== empresa && t.includes(",") && !MODALIDAD.test(t) && !SOLO_NUMERO.test(t),
      ) || "";
      const modalidad = posteriores.find((t) => MODALIDAD.test(t)) || "";
      const fecha = encabezados.slice(0, i).reverse()
        .find((e) => e.tagName === "H3")?.innerText.trim() || "";

      const href = a.getAttribute("href") || "";
      const id = (href.match(/-(\d+)\.html/) || [])[1] || href;

      return {
        id: `bumeran-${id}`,
        portal: "Bumeran",
        portalId: "bumeran",
        postulable: false,
        titulo: h2.innerText.trim(),
        empresa,
        ubicacion: [ubicacion, modalidad].filter(Boolean).join(" · "),
        publicado: fecha,
        url: href.startsWith("http") ? href : `https://www.bumeran.com.pe${href}`,
        yaPostulado: false,
      };
    });
  }

  // Sesión: cuando NO hay, Bumeran muestra el enlace /login («Ingresar»).
  // Verificado contra el sitio real. La detección es por ausencia, así
  // que primero hay que confirmar que la página cargó de verdad; si no,
  // una página en blanco diría «sesión abierta» en falso.
  function haySesion() {
    if (!document.querySelector("footer, a[href*='/empleos'], header")) return false;
    return !document.querySelector("a[href='/login'], a[href*='/login?']");
  }

  function leerDetalle() {
    const texto = (s) => {
      const e = document.querySelector(s);
      return e ? e.innerText.replace(/\s+/g, " ").trim() : "";
    };
    return {
      titulo: texto("h1"),
      // El cuerpo de la oferta es el bloque de texto más largo de la página.
      descripcion: [...document.querySelectorAll("div, section")]
        .map((e) => e.innerText || "")
        .filter((t) => t.length > 200 && t.length < 6000)
        .sort((a, b) => b.length - a.length)[0]?.replace(/\s+/g, " ").trim().slice(0, 2500) || "",
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
      else responder({ error: "Bumeran solo permite buscar por ahora." });
    } catch (e) {
      responder({ error: e.message });
    }
    return true;
  });
})();

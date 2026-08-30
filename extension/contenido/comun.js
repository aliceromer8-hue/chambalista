// Utilidades compartidas por los content scripts.
//
// Los content scripts no son módulos ES, así que todo cuelga de
// window.ChambaComun para que computrabajo.js lo use.

window.ChambaComun = (() => {
  const texto = (raiz, sel) => {
    if (!sel) return "";
    try {
      const e = raiz.querySelector(sel);
      return e ? e.innerText.replace(/\s+/g, " ").trim() : "";
    } catch {
      return "";
    }
  };

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Espera a que aparezca un selector, hasta `limite` ms. */
  async function esperarSelector(sel, limite = 8000) {
    const fin = Date.now() + limite;
    while (Date.now() < fin) {
      const e = document.querySelector(sel);
      if (e) return e;
      await esperar(200);
    }
    return null;
  }

  /** Rellena un campo disparando los eventos que espera la página. */
  function rellenar(campo, valor) {
    const proto = campo instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    // React y compañía ignoran una asignación directa a .value; hay que
    // usar el setter nativo y luego disparar los eventos.
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(campo, valor);
    else campo.value = valor;
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** El enunciado que acompaña a un campo del formulario. */
  function enunciadoDe(campo) {
    const limpiar = (t) => (t || "").replace(/\s+/g, " ").trim();
    if (campo.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(campo.id)}"]`);
      if (lab) return limpiar(lab.innerText);
    }
    const dentro = campo.closest("label");
    if (dentro) return limpiar(dentro.innerText);
    let n = campo.parentElement;
    for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
      const t = limpiar(n.innerText);
      if (t && t.length > 12) return t.slice(0, 400);
    }
    return "";
  }

  const PISTAS_CAPTCHA = [
    "iframe[src*='recaptcha']",
    "iframe[src*='hcaptcha']",
    ".g-recaptcha",
    "#captcha",
  ];

  const hayCaptcha = () => PISTAS_CAPTCHA.some((s) => document.querySelector(s));

  /** Errores de validación que muestre el portal tras intentar enviar. */
  function erroresValidacion() {
    const vistos = new Set();
    document.querySelectorAll("input, textarea, select").forEach((e) => {
      if (e.willValidate && !e.checkValidity()) {
        vistos.add(`${e.name || e.id || "campo"}: ${e.validationMessage || "inválido"}`);
      }
    });
    document.querySelectorAll("[class*='error']:not(:empty), [role='alert']").forEach((e) => {
      const t = (e.innerText || "").replace(/\s+/g, " ").trim();
      if (t && t.length < 160) vistos.add(t);
    });
    return [...vistos].slice(0, 6);
  }

  // -------------------------------------------------------------------
  // Adjuntar el CV
  // -------------------------------------------------------------------
  // El navegador no deja escribir `input.value` de un campo de archivo
  // —sería un agujero de seguridad: cualquier página podría subir
  // /etc/passwd—. Pero sí deja asignar `input.files` con un DataTransfer
  // construido a mano, que es como funcionan los "arrastra tu archivo
  // aquí" de media web. Ese es el camino, y es el único.
  //
  // El archivo no se puede generar aquí: el .docx lo arma python-docx en
  // el servidor. Llega en base64 porque `chrome.tabs.sendMessage`
  // serializa a JSON y un Blob no sobrevive el salto.

  const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  /** Los campos de archivo que aceptan un CV, los mejores primero. */
  function camposDeArchivo() {
    const todos = [...document.querySelectorAll("input[type='file']")];
    const puntuar = (e) => {
      let p = 0;
      const acepta = (e.accept || "").toLowerCase();
      const cerca = [e.name, e.id, e.className,
                     e.closest("label,div,section")?.innerText?.slice(0, 120)]
        .filter(Boolean).join(" ").toLowerCase();
      if (/doc|pdf/.test(acepta)) p += 4;
      if (!acepta) p += 1;                       // sin filtro: probablemente vale
      if (/\bcv\b|curr[ií]culum|hoja de vida|resume|adjunt/.test(cerca)) p += 4;
      if (/foto|imagen|avatar|perfil.*imagen/.test(cerca)) p -= 6;
      if (e.offsetParent !== null) p += 1;       // visible, pero no es requisito:
      return p;                                  // casi todos están ocultos tras un botón
    };
    return todos.map((e) => ({ e, p: puntuar(e) }))
      .filter((x) => x.p > 0)
      .sort((a, b) => b.p - a.p)
      .map((x) => x.e);
  }

  /**
   * Mete el .docx en el formulario. Devuelve un parte honesto de lo que pasó.
   *
   * Nunca dice que adjuntó sin comprobarlo: después de asignar vuelve a
   * leer `input.files` y confirma que está el archivo con ese nombre. Si
   * el portal lo rechaza o lo pisa, se entera aquí y no en la bandeja de
   * la empresa.
   */
  function adjuntarCV(nombre, base64, mime = MIME_DOCX) {
    const campos = camposDeArchivo();
    if (!campos.length) {
      const hayBoton = /subir|adjuntar|cargar|otro cv|nuevo cv/i.test(document.body.innerText || "");
      return {
        adjuntado: false,
        motivo: hayBoton
          ? "El formulario no muestra el campo de archivo todavía; parece estar detrás de un botón de «subir CV»."
          : "Este formulario no pide archivo: usa el CV que ya tienes guardado en el portal.",
        campos: 0,
      };
    }

    let binario;
    try {
      const cruda = atob(base64);
      binario = new Uint8Array(cruda.length);
      for (let i = 0; i < cruda.length; i++) binario[i] = cruda.charCodeAt(i);
    } catch (e) {
      return { adjuntado: false, motivo: `El archivo llegó corrupto: ${e.message}`, campos: campos.length };
    }

    const fallos = [];
    for (const campo of campos) {
      try {
        const archivo = new File([binario], nombre, { type: mime });
        const dt = new DataTransfer();
        dt.items.add(archivo);
        campo.files = dt.files;
        campo.dispatchEvent(new Event("input", { bubbles: true }));
        campo.dispatchEvent(new Event("change", { bubbles: true }));

        // La comprobación: no basta con no haber lanzado excepción.
        const puesto = campo.files && campo.files.length === 1 && campo.files[0].name === nombre;
        if (puesto) {
          return {
            adjuntado: true,
            archivo: nombre,
            bytes: binario.length,
            campo: campo.name || campo.id || "input[type=file]",
            campos: campos.length,
          };
        }
        fallos.push(`${campo.name || campo.id || "campo"}: la asignación no quedó`);
      } catch (e) {
        fallos.push(`${campo.name || campo.id || "campo"}: ${e.message}`);
      }
    }

    return {
      adjuntado: false,
      motivo: `Se encontraron ${campos.length} campo(s) de archivo pero ninguno aceptó el CV. ${fallos.join("; ")}`,
      campos: campos.length,
    };
  }

  return { texto, esperar, esperarSelector, rellenar, enunciadoDe, hayCaptcha,
           erroresValidacion, adjuntarCV, camposDeArchivo, MIME_DOCX };
})();

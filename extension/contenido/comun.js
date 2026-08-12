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

  return { texto, esperar, esperarSelector, rellenar, enunciadoDe, hayCaptcha, erroresValidacion };
})();

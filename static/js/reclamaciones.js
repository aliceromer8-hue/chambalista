// Libro de Reclamaciones virtual. Registra la hoja en el servidor, que le da
// su número correlativo, y deja una copia lista para imprimir o guardar en
// PDF (la norma pide poder imprimirla o recibirla por correo).
(() => {
  const $ = (s) => document.querySelector(s);
  const hoy = new Date();
  $("#hoja-fecha").textContent = hoy.toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" });

  const ETIQUETAS = {
    nombre: "Nombre", documento_tipo: "Documento", documento: "Número", domicilio: "Domicilio",
    telefono: "Teléfono", correo: "Correo", apoderado: "Apoderado", bien_tipo: "Tipo",
    monto: "Monto reclamado (S/)", descripcion: "Descripción", tipo: "Reclamo o queja",
    detalle: "Detalle", pedido: "Pedido",
  };

  function error(t) {
    $("#reclamo-error").textContent = t || "";
    $("#reclamo-error").classList.toggle("oculto", !t);
  }

  $("#form-reclamo").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const datos = Object.fromEntries(new FormData(form).entries());
    const faltan = [...form.querySelectorAll("[required]")].filter((c) =>
      c.type === "checkbox" ? !c.checked : !String(c.value).trim());
    if (faltan.length) {
      error("Completa los campos obligatorios y marca la casilla de conformidad.");
      faltan[0].focus();
      return;
    }
    error("");
    const boton = $("#reclamo-enviar");
    boton.disabled = true;
    boton.textContent = "Registrando…";
    try {
      const r = await fetch("/api/reclamos", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { error(j.error || "No se pudo registrar. Inténtalo de nuevo."); return; }
      $("#hoja-numero").textContent = j.numero;
      const copia = $("#hoja-copia");
      copia.textContent = "";
      const dl = document.createElement("dl");
      for (const [clave, etiqueta] of Object.entries(ETIQUETAS)) {
        if (!datos[clave]) continue;
        const dt = document.createElement("dt");
        dt.textContent = etiqueta;
        const dd = document.createElement("dd");
        dd.textContent = datos[clave];
        dl.append(dt, dd);
      }
      copia.append(dl);
      form.classList.add("oculto");
      $("#hoja-lista").classList.remove("oculto");
      $("#hoja-lista").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      error("Sin conexión. Inténtalo de nuevo.");
    } finally {
      boton.disabled = false;
      boton.textContent = "Registrar";
    }
  });

  $("#hoja-imprimir").addEventListener("click", () => window.print());
})();

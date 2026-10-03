// Acreditar un pack tras comprobar el Yape/Plin. La clave no se guarda en
// ningún sitio: se escribe cada vez y viaja solo en la cabecera X-Admin.
document.querySelector("#form-acreditar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const estado = document.querySelector("#adm-estado");
  const boton = document.querySelector("#adm-enviar");
  const [postulaciones, soles, dias] = document.querySelector("#adm-pack").value.split("|").map(Number);
  boton.disabled = true;
  estado.textContent = "Acreditando…";
  try {
    const r = await fetch("/api/admin/acreditar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin": document.querySelector("#adm-clave").value },
      body: JSON.stringify({
        correo: document.querySelector("#adm-correo").value.trim(),
        postulaciones, soles, dias,
        nota: document.querySelector("#adm-nota").value.trim(),
      }),
    });
    const j = await r.json().catch(() => ({}));
    estado.textContent = j.mensaje || j.error || `El servidor respondió ${r.status}.`;
    if (r.ok) {
      document.querySelector("#adm-correo").value = "";
      document.querySelector("#adm-nota").value = "";
    }
  } catch (e) {
    estado.textContent = `No se pudo acreditar: ${e.message}`;
  } finally {
    boton.disabled = false;
  }
});

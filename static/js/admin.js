// Activar packs y pases tras comprobar el Yape/Plin. La clave no se guarda
// en ningún sitio: se escribe cada vez y viaja solo en la cabecera X-Admin.
const $ = (s) => document.querySelector(s);
const clave = () => $("#adm-clave").value;
const VALOR = { "100": "100|29|0", pase: "0|39|30", "30": "30|15|0" };

async function acreditar({ correo, valor, nota = "", aviso = "" }) {
  const [postulaciones, soles, dias] = valor.split("|").map(Number);
  const r = await fetch("/api/admin/acreditar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin": clave() },
    body: JSON.stringify({ correo, postulaciones, soles, dias, nota, aviso }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, texto: j.mensaje || j.error || `El servidor respondió ${r.status}.` };
}

async function verAvisos() {
  const lista = $("#adm-avisos");
  lista.textContent = "Cargando…";
  try {
    const r = await fetch("/api/admin/avisos", { headers: { "X-Admin": clave() } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { lista.textContent = j.error || `El servidor respondió ${r.status}.`; return; }
    lista.textContent = "";
    if (!j.avisos.length) { lista.textContent = "No hay pagos por activar."; return; }
    for (const a of j.avisos) {
      const plan = j.planes[a.plan] || { nombre: a.plan, soles: a.soles };
      const li = document.createElement("li");
      const texto = document.createElement("span");
      texto.textContent = `${a.correo} · ${plan.nombre} · S/ ${plan.soles}`
        + (a.operacion ? ` · op. ${a.operacion}` : "") + ` · ${new Date(a.creado).toLocaleString("es-PE")}`;
      const b = document.createElement("button");
      b.className = "boton chico primario";
      b.type = "button";
      b.textContent = "Ya lo vi en mi Yape: activar";
      b.addEventListener("click", async () => {
        b.disabled = true;
        const res = await acreditar({ correo: a.correo, valor: VALOR[a.plan], nota: a.operacion || "", aviso: String(a.id) });
        texto.textContent = res.texto;
        if (res.ok) b.remove(); else b.disabled = false;
      });
      li.append(texto, b);
      lista.append(li);
    }
  } catch (e) {
    lista.textContent = `No se pudo cargar: ${e.message}`;
  }
}
$("#adm-ver").addEventListener("click", verAvisos);

$("#form-acreditar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const boton = $("#adm-enviar");
  boton.disabled = true;
  $("#adm-estado").textContent = "Activando…";
  try {
    const res = await acreditar({ correo: $("#adm-correo").value.trim(), valor: $("#adm-pack").value,
                                  nota: $("#adm-nota").value.trim() });
    $("#adm-estado").textContent = res.texto;
    if (res.ok) { $("#adm-correo").value = ""; $("#adm-nota").value = ""; }
  } catch (e) {
    $("#adm-estado").textContent = `No se pudo activar: ${e.message}`;
  } finally {
    boton.disabled = false;
  }
});

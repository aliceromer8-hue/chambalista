// Activar packs y pases tras comprobar el Yape/Plin. La clave no se guarda
// en ningún sitio: se escribe cada vez y viaja solo en la cabecera X-Admin.
const $ = (s) => document.querySelector(s);
const clave = () => $("#adm-clave").value;
const VALOR = { "80": "80|39|0", "50": "50|29|0", "30": "30|15|0" };

async function acreditar({ correo, valor, nota = "", aviso = "", plan = "" }) {
  const [postulaciones, soles, dias] = valor.split("|").map(Number);
  // Qué pack es (para el precio de «sumar postulaciones»). Un regalo o una
  // suma no cambia el pack de la persona.
  plan = plan || (soles > 0 && VALOR[String(postulaciones)] ? String(postulaciones) : "");
  const r = await fetch("/api/admin/acreditar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin": clave() },
    body: JSON.stringify({ correo, postulaciones, soles, dias, nota, aviso, plan }),
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
      const plan = j.planes[a.plan] || { nombre: a.plan === "sumar" ? `Sumar ${a.postulaciones} postulaciones` : a.plan, soles: a.soles };
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
        const valor = VALOR[a.plan] || `${a.postulaciones}|${a.soles}|0`;
        const res = await acreditar({ correo: a.correo, valor, nota: a.operacion || "", aviso: String(a.id),
                                      plan: VALOR[a.plan] ? a.plan : "sumar" });
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


// ---------- Libro de Reclamaciones ----------
async function verReclamos() {
  const lista = $("#adm-lista-reclamos");
  lista.textContent = "Cargando…";
  try {
    const r = await fetch("/api/admin/reclamos", { headers: { "X-Admin": clave() } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { lista.textContent = j.error || `El servidor respondió ${r.status}.`; return; }
    lista.textContent = "";
    if (!j.reclamos.length) { lista.textContent = "No hay reclamos."; return; }
    for (const c of j.reclamos) {
      const li = document.createElement("li");
      li.className = c.respondido ? "respondido" : "";
      const dias = Math.floor((Date.now() - new Date(c.creado)) / 86400000);
      const cabeza = document.createElement("b");
      cabeza.textContent = `${c.numero || c.id} · ${c.tipo} · ${c.nombre} <${c.correo}> · hace ${dias} días`
        + (c.respondido ? " · RESPONDIDO" : "");
      const cuerpo = document.createElement("p");
      cuerpo.textContent = `${c.descripcion}${c.monto ? ` (S/ ${c.monto})` : ""} — ${c.detalle} — Pide: ${c.pedido}`;
      li.append(cabeza, cuerpo);
      if (!c.respondido) {
        const t = document.createElement("textarea");
        t.rows = 2;
        t.placeholder = "Qué le respondiste (queda registrado)";
        const b = document.createElement("button");
        b.className = "boton chico primario";
        b.type = "button";
        b.textContent = "Marcar respondido";
        b.addEventListener("click", async () => {
          b.disabled = true;
          const rr = await fetch(`/api/admin/reclamos/${c.id}`, {
            method: "POST", headers: { "Content-Type": "application/json", "X-Admin": clave() },
            body: JSON.stringify({ respuesta: t.value }),
          });
          const jj = await rr.json().catch(() => ({}));
          cabeza.textContent += rr.ok ? " · RESPONDIDO" : ` · ${jj.error || "error"}`;
          if (rr.ok) { t.remove(); b.remove(); } else b.disabled = false;
        });
        li.append(t, b);
      }
      lista.append(li);
    }
  } catch (e) {
    lista.textContent = `No se pudo cargar: ${e.message}`;
  }
}
$("#adm-reclamos").addEventListener("click", verReclamos);

// El token viene en el FRAGMENTO de la URL (#access_token=…), no en la
// ruta ni en la query. Es a propósito de Supabase y está bien: el
// navegador nunca manda el fragmento al servidor, así que la credencial
// no queda escrita en los registros de acceso de nadie. Lo lee esta
// página y lo usa una vez.
const $ = (s) => document.querySelector(s);
const parametros = new URLSearchParams(location.hash.slice(1));
const token = parametros.get("access_token");
const tipo = parametros.get("type");

function aviso(t, malo = true) {
  const p = $("#aviso");
  p.textContent = t || "";
  p.classList.toggle("oculto", !t);
  p.style.color = malo ? "" : "var(--tinta)";
}

if (token && tipo === "recovery") {
  // Se borra el token de la barra de direcciones en cuanto se lee: si no,
  // se queda en el historial del navegador y en cualquier captura.
  history.replaceState(null, "", location.pathname);
  $("#sin-enlace").classList.add("oculto");
  $("#form-clave").classList.remove("oculto");
} else {
  $("#sin-enlace").textContent =
    "Este enlace no es válido o ya caducó. Vuelve a pedir uno desde «Olvidé mi contraseña».";
}

$("#form-clave").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const a = $("#clave").value, b = $("#clave2").value;
  if (a !== b) { aviso("Las dos contraseñas no coinciden."); return; }
  if (a.length < 8) { aviso("Necesita al menos 8 caracteres."); return; }
  const boton = $("#enviar");
  boton.disabled = true;
  aviso("");
  try {
    const r = await fetch("/api/cuenta/clave-nueva", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contrasena: a }),
    });
    const j = await r.json();
    if (!r.ok) { aviso(j.error || "No se pudo cambiar."); return; }
    // La sesión vieja del navegador ya no vale nada: se limpia para que
    // no quede una sesión a medias con la contraseña anterior.
    try { localStorage.removeItem("chamba_sesion"); } catch {}
    $("#form-clave").classList.add("oculto");
    $("#sin-enlace").classList.remove("oculto");
    $("#sin-enlace").textContent = "Listo. Ya puedes entrar con tu contraseña nueva.";
  } catch {
    aviso("No se pudo conectar. Inténtalo de nuevo.");
  } finally {
    boton.disabled = false;
  }
});

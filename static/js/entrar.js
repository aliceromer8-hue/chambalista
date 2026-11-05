// Vuelta de «Continuar con Google».
//
// Supabase deja la sesión en el fragmento de la URL (#access_token=…). El
// fragmento no viaja al servidor, así que lo lee esta página, le pide al
// servidor que confirme de quién es el token y la guarda donde la web la
// busca (localStorage «chamba_sesion»). Si se entró desde la extensión, el
// puente (extension/contenido/puente.js) se la pasa sola al panel.
(async () => {
  const $ = (s) => document.querySelector(s);
  const fragmento = new URLSearchParams(location.hash.slice(1));
  const consulta = new URLSearchParams(location.search);
  const volver = (() => {
    const v = consulta.get("volver") || "/";
    return v.startsWith("/") && !v.startsWith("//") ? v : "/";
  })();
  const desdeExtension = volver.includes("desde=extension");

  function terminar(ok, titulo, texto) {
    $("#entrar-tarjeta").classList.add(ok ? "ok" : "mal");
    $("#entrar-titulo").textContent = titulo;
    $("#entrar-texto").textContent = texto;
    $("#entrar-acciones").classList.remove("oculto");
    $("#entrar-seguir").href = ok && !desdeExtension ? volver : "/";
    $("#entrar-seguir").textContent = ok ? (desdeExtension ? "Ir a la web" : "Seguir") : "Volver a intentarlo";
  }

  // El fragmento ya no hace falta en la barra: que no quede el token a la vista.
  history.replaceState(null, "", location.pathname + location.search);

  const error = fragmento.get("error_description") || consulta.get("error_description");
  const token = fragmento.get("access_token");
  if (error || !token) {
    terminar(false, "No se pudo entrar con Google",
      error ? `Google respondió: ${error}` : "No llegó la sesión. Inténtalo otra vez.");
    return;
  }

  try {
    const r = await fetch("/api/cuenta/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        refresco: fragmento.get("refresh_token"),
        expira_en: Number(fragmento.get("expires_in") || 3600),
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.token) { terminar(false, "No se pudo entrar", j.error || "Inténtalo otra vez."); return; }
    j.caduca = Date.now() + ((j.expira_en || 3600) - 60) * 1000;
    try { localStorage.setItem("chamba_sesion", JSON.stringify(j)); } catch { /* navegación privada */ }
    try { sessionStorage.setItem("chamba_bienvenida", "1"); } catch { /* da igual */ }
    const nombre = j.usuario?.nombre ? `, ${j.usuario.nombre}` : "";
    if (desdeExtension) {
      terminar(true, `¡Listo${nombre}!`,
        "Ya entraste. Vuelve a la extensión: te está esperando con tu cuenta abierta.");
      return;
    }
    $("#entrar-titulo").textContent = `¡Hola${nombre}!`;
    $("#entrar-texto").textContent = "Te llevamos de vuelta…";
    $("#entrar-tarjeta").classList.add("ok");
    setTimeout(() => location.replace(volver), 700);
  } catch {
    terminar(false, "Sin conexión", "No pudimos confirmar tu cuenta. Revisa tu internet e inténtalo otra vez.");
  }
})();

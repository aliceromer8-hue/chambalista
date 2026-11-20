// Entrar con Google con el botón oficial de Google (ver entrar-google.html).
//
// 1. Se inventa un «nonce» y a Google se le da su hash: así el token que
//    devuelve solo sirve para ESTA vuelta y no se puede reutilizar.
// 2. Google devuelve un token (`credential`) al elegir la cuenta.
// 3. Se manda al servidor junto con el nonce; el servidor se lo da a
//    Supabase, que comprueba firma, destinatario y nonce, y devuelve la sesión.
// 4. La sesión se guarda donde la web la busca (localStorage «chamba_sesion»).
//    Si se entró desde la extensión, el puente se la pasa sola al panel.
(async () => {
  const $ = (s) => document.querySelector(s);
  const consulta = new URLSearchParams(location.search);
  const volver = (() => {
    const v = consulta.get("volver") || "/";
    return v.startsWith("/") && !v.startsWith("//") ? v : "/";
  })();
  const desdeExtension = volver.includes("desde=extension");
  const contenedor = $("#gsi-boton");
  const clientId = contenedor?.dataset.clientId || "";

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const nonceHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce)));

  function decir(titulo, texto, estado) {
    $("#entrar-tarjeta").classList.remove("ok", "mal");
    if (estado) $("#entrar-tarjeta").classList.add(estado);
    $("#entrar-titulo").textContent = titulo;
    $("#entrar-texto").textContent = texto;
  }

  function terminarMal(titulo, texto) {
    decir(titulo, texto, "mal");
    contenedor.classList.add("oculto");
    $("#entrar-legal").classList.add("oculto");
    $("#entrar-acciones").classList.remove("oculto");
    $("#entrar-seguir").href = location.pathname + location.search;
    $("#entrar-seguir").textContent = "Volver a intentarlo";
  }

  async function alRecibir(respuesta) {
    if (!respuesta?.credential) return;
    decir("Entrando…", "Un segundo, estamos abriendo tu cuenta.");
    contenedor.classList.add("oculto");
    $("#entrar-legal").classList.add("oculto");
    try {
      const r = await fetch("/api/cuenta/google-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: respuesta.credential, nonce }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) {
        terminarMal("No se pudo entrar", j.error || "Inténtalo otra vez.");
        return;
      }
      j.caduca = Date.now() + ((j.expira_en || 3600) - 60) * 1000;
      j.emitida = Date.now();
      try {
        localStorage.setItem("chamba_sesion", JSON.stringify(j));
        localStorage.removeItem("chamba_salio");
      } catch { /* navegación privada */ }
      try { sessionStorage.setItem("chamba_bienvenida", "1"); } catch { /* da igual */ }
      // El puente de la extensión (si está) la recoge ahora mismo.
      window.postMessage({ chamba: "sincronizar" }, location.origin);

      const nombre = j.usuario?.nombre ? `, ${j.usuario.nombre}` : "";
      if (desdeExtension) {
        decir(`¡Listo${nombre}!`, "Ya entraste. Vuelve a la extensión: te está esperando con tu cuenta abierta.", "ok");
        $("#entrar-acciones").classList.remove("oculto");
        $("#entrar-seguir").href = "/";
        $("#entrar-seguir").textContent = "Ir a la web";
        return;
      }
      decir(`¡Hola${nombre}!`, "Te llevamos de vuelta…", "ok");
      setTimeout(() => location.replace(volver), 700);
    } catch {
      terminarMal("Sin conexión", "No pudimos confirmar tu cuenta. Revisa tu internet e inténtalo otra vez.");
    }
  }

  function pintarBoton() {
    if (!window.google?.accounts?.id || !clientId) return false;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: alRecibir,
      nonce: nonceHash,
      ux_mode: "popup",
      auto_select: false,
      use_fedcm_for_prompt: true,
    });
    window.google.accounts.id.renderButton(contenedor, {
      type: "standard", theme: "outline", size: "large", shape: "pill",
      text: "continue_with", logo_alignment: "left", width: 300, locale: "es",
    });
    return true;
  }

  // El script de Google carga aparte (async): se espera hasta unos segundos.
  // Si no llega —bloqueador de anuncios, red de empresa— se ofrece la otra vía.
  for (let i = 0; i < 30 && !pintarBoton(); i++) await new Promise((r) => setTimeout(r, 200));
  if (!contenedor.childElementCount) $("#entrar-alterno").classList.remove("oculto");
})();

// El párrafo sobre Google depende de la configuración real del
  // servidor. Escrito a mano diría lo que nos conviene en vez de lo que
  // ocurre, y una política que no coincide con el sistema es lo primero
  // que se revisa cuando alguien reclama.
  (async () => {
    const el = document.getElementById("aviso-gemini");
    try {
      const e = await (await fetch("/api/estado")).json();
      if (!e.ia_activa) {
        el.textContent = "Actualmente esta función está desactivada, por lo que tu CV "
          + "no se transmite a terceros.";
      } else if (e.ia_facturada) {
        el.textContent = "Operamos bajo su modalidad de pago, en la que Google no "
          + "utiliza el contenido enviado para entrenar sus modelos.";
      } else {
        el.textContent = "Operamos bajo su modalidad gratuita, en la que Google puede "
          + "utilizar el contenido enviado para mejorar sus servicios y personal "
          + "autorizado puede revisarlo.";
      }
    } catch { /* se conserva el texto del documento */ }
  })();

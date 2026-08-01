# -*- coding: utf-8 -*-
"""Conector real de Computrabajo (Playwright, navegador local).

Arquitectura: el navegador corre en la máquina de la persona con un
perfil persistente en `perfil_navegador/`. Ella inicia sesión ahí una
sola vez y la sesión queda guardada en su propio equipo. La plataforma
nunca ve ni pide su contraseña.

Reglas que este módulo NO rompe nunca:
- No envía ninguna postulación por su cuenta. `preparar_postulacion()`
  deja el formulario listo y se detiene; solo `confirmar_envio()` hace
  el clic final, y app.py solo lo llama tras la confirmación explícita.
- No completa datos sensibles que no estén en el CV (DNI, fecha de
  nacimiento, dirección, pretensión salarial): los reporta como
  pendientes para que la persona los escriba.
- No intenta resolver CAPTCHAs. Si aparece uno, devuelve el control.

Selectores verificados contra el sitio real el 2026-07-29. Si Computrabajo
cambia su maquetación habrá que revisarlos: están todos agrupados en
SELECTORES para que sea un solo lugar.
"""

import re
import unicodedata
from pathlib import Path
from urllib.parse import urlencode

BASE = "https://pe.computrabajo.com"
URL_ACCESO = "https://candidato.pe.computrabajo.com/acceso/"
PERFIL_DIR = Path(__file__).parent / "perfil_navegador"

SELECTORES = {
    "oferta": "article.box_offer[data-id]",
    "titulo": "h2 a.js-o-link",
    "empresa": "[offer-grid-article-company-url]",
    # La empresa vive en un <p class="dFlex ..."> junto a la valoración;
    # la ubicación es el <p> hermano SIN dFlex. Sin el :not() se captura
    # la valoración ("4,4") en las empresas que la tienen.
    "ubicacion": "p.fs16.fc_base.mt5:not(.dFlex)",
    "fecha": "p.fs13.fc_aux",
    "ya_postulado": "[applied-offer-tag]:not(.hide)",
    "apply_url": "[data-href-offer-apply]",
    "siguiente": "span[title='Siguiente'][data-path]",
    "detalle_titulo": "h1",
    "detalle_desc": "p.mbB",
    "detalle_requisitos": "ul.mbB li",
    "boton_postular": "a.b_primary:has-text('Postularme')",
    # Indicador de sesión CERRADA: el botón "Crear CV" que lleva al login.
    # Se detecta por ausencia — los enlaces a /candidato/ existen aunque no
    # haya sesión (apuntan al acceso), así que buscarlos da falso positivo.
    "sin_sesion": "a.js_login",
}

# Campos que la plataforma NO completa aunque el formulario los pida.
# Coinciden con DATOS_SENSIBLES_PORTAL de cv_parser.py.
CAMPOS_PROHIBIDOS = [
    (r"dni|documento|identidad|c\.?i\.?\b", "DNI / documento de identidad"),
    (r"nacimiento|birth|edad", "Fecha de nacimiento"),
    (r"direcci[oó]n|address|domicilio", "Dirección exacta"),
    (r"pretensi[oó]n|salario|salary|remuneraci[oó]n", "Pretensión salarial"),
]

# Preguntas de selección: el portal las añade por vacante y son texto
# libre. Se clasifican para decidir si la plataforma puede proponer un
# borrador (porque el CV tiene la respuesta) o si es decisión de la
# persona y debe quedar en blanco.
#
# "decision" gana siempre sobre el resto: aceptar condiciones o
# comprometer disponibilidad no se contesta por nadie más que ella.
CLASIFICACION_PREGUNTAS = [
    ("decision", r"confirmo|he le[ií]do|acepto|declaro|autorizo|ad honorem|sin remuneraci[oó]n|est[aá]s de acuerdo"),
    ("decision", r"disponibilidad|disponible|podr[ií]as asistir|horario|movilizarte|viajar"),
    ("decision", r"pretensi[oó]n|expectativa salarial|cu[aá]nto esperas"),
    ("estudios", r"estudias|carrera|universidad|instituto|ciclo|egresad|titulad|formaci[oó]n"),
    ("herramientas", r"herramientas|manejas|dominio|software|programas|conocimientos|nivel de"),
    ("contacto", r"distrito|residencia|celular|contacto|tel[eé]fono|d[oó]nde vives"),
    ("experiencia", r"experiencia|has trabajado|cu[eé]ntanos|por qu[eé]|motiva"),
]

PISTAS_CAPTCHA = [
    "iframe[src*='recaptcha']",
    "iframe[src*='hcaptcha']",
    ".g-recaptcha",
    "#captcha",
]


def _slug(texto):
    """Convierte 'Practicante de Marketing' -> 'practicante-de-marketing'."""
    texto = unicodedata.normalize("NFKD", texto or "")
    texto = texto.encode("ascii", "ignore").decode()
    texto = re.sub(r"[^\w\s-]", "", texto.lower()).strip()
    return re.sub(r"[\s_]+", "-", texto)


def url_busqueda(puesto, ciudad=None, pagina=1):
    """Arma la URL de resultados. Computrabajo usa slugs, no query params."""
    ruta = f"trabajo-de-{_slug(puesto)}"
    if ciudad:
        ruta += f"-en-{_slug(ciudad)}"
    url = f"{BASE}/{ruta}"
    if pagina > 1:
        url += "?" + urlencode({"p": pagina})
    return url


class NavegadorComputrabajo:
    """Maneja el navegador local persistente.

    Uso:
        nav = NavegadorComputrabajo()
        nav.abrir()                 # lanza el navegador visible
        nav.ir_a_login()            # la persona inicia sesión a mano
        nav.sesion_activa()         # confirma que ya entró
        nav.buscar("practicante de marketing", "lima")
        nav.preparar_postulacion(url)   # llena, NO envía
        nav.confirmar_envio()           # solo tras revisión humana
        nav.cerrar()
    """

    def __init__(self, headless=False):
        # headless=False a propósito: la persona tiene que ver lo que pasa
        # y poder intervenir (login, CAPTCHA, campos pendientes).
        self.headless = headless
        self._pw = None
        self.ctx = None
        self.page = None

    # ---------- ciclo de vida ----------
    def _vivo(self):
        """¿El navegador sigue abierto? La persona puede haber cerrado la
        ventana a mano, y entonces hay que volver a lanzarlo."""
        if not self.ctx or not self.page:
            return False
        try:
            return not self.page.is_closed()
        except Exception:
            return False

    def abrir(self):
        from playwright.sync_api import sync_playwright

        if self._vivo():
            return self.page
        # Contexto muerto: limpiar antes de relanzar.
        if self.ctx or self._pw:
            try:
                if self.ctx:
                    self.ctx.close()
            except Exception:
                pass
            try:
                if self._pw:
                    self._pw.stop()
            except Exception:
                pass
            self.ctx = self.page = self._pw = None

        PERFIL_DIR.mkdir(exist_ok=True)
        self._pw = sync_playwright().start()

        # Se usa el Chrome instalado (channel="chrome") en vez del Chromium
        # que trae Playwright, y se quita la bandera --enable-automation.
        # Sin esto, el login con Google se rechaza con "es posible que no
        # sean seguros este navegador o la app". Si no hay Chrome instalado,
        # se cae al Chromium de Playwright.
        opciones = dict(
            user_data_dir=str(PERFIL_DIR),
            headless=self.headless,
            viewport={"width": 1280, "height": 900},
            locale="es-PE",
            args=["--disable-blink-features=AutomationControlled"],
            ignore_default_args=["--enable-automation"],
        )
        try:
            self.ctx = self._pw.chromium.launch_persistent_context(channel="chrome", **opciones)
        except Exception:
            self.ctx = self._pw.chromium.launch_persistent_context(**opciones)
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        return self.page

    def cerrar(self):
        if self.ctx:
            self.ctx.close()
            self.ctx = self.page = None
        if self._pw:
            self._pw.stop()
            self._pw = None

    # ---------- sesión ----------
    # Dominios donde puede estar transcurriendo un inicio de sesión.
    DOMINIOS_LOGIN = ("accounts.google.", "facebook.com", "candidato.pe.computrabajo.com")

    def _en_flujo_login(self):
        url = (self.page.url or "").lower()
        return any(d in url for d in self.DOMINIOS_LOGIN)

    def ir_a_login(self):
        """Abre la pantalla de acceso. La persona escribe sus credenciales;
        la plataforma no las toca ni las lee."""
        self.abrir()
        # Si ya está a mitad del acceso (por ejemplo en el consentimiento de
        # Google), navegar otra vez le borraría el progreso. Se deja estar.
        if self._en_flujo_login():
            return {
                "url": self.page.url,
                "mensaje": "Ya tienes el acceso abierto en el navegador; termina de iniciar sesión ahí.",
            }
        self.page.goto(URL_ACCESO, wait_until="domcontentloaded")
        return {"url": self.page.url, "mensaje": "Inicia sesión en la ventana del navegador."}

    def sesion_activa(self):
        """Verifica si hay sesión abierta, sin pedir credenciales.

        La comprobación se hace en una pestaña aparte y desechable. Usar
        la pestaña principal rompía el login: si la persona estaba a mitad
        del flujo de acceso (por ejemplo en la pantalla de consentimiento
        de Google), el goto abortaba esa navegación y perdía el inicio de
        sesión. La pestaña nueva comparte cookies, así que ve lo mismo.
        """
        self.abrir()
        aux = self.ctx.new_page()
        try:
            aux.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            aux.wait_for_timeout(1000)
            # La detección es por AUSENCIA del botón de acceso, así que una
            # página en blanco o un error de red darían "sesión abierta" en
            # falso. Primero hay que confirmar que Computrabajo cargó de
            # verdad; si no, se responde que no hay sesión (fallar cerrado).
            if "computrabajo.com" not in (aux.url or ""):
                return False
            if not aux.query_selector("article.box_offer, form, footer, #prof-cat-search-input"):
                return False
            return aux.query_selector(SELECTORES["sin_sesion"]) is None
        except Exception:
            return False
        finally:
            try:
                aux.close()
            except Exception:
                pass

    # ---------- búsqueda ----------
    def buscar_multi(self, termino, ciudad=None, paginas=1, ids_portales=None):
        """Busca el mismo término en varios portales y junta los resultados.

        Cada portal tiene su propia maquetación, así que los selectores
        viven en `portales.py`. Si uno falla (cambió su web, bloqueó la
        petición), se registra y se sigue con los demás en vez de perder
        toda la búsqueda.
        """
        import portales

        self.abrir()
        resultados, errores, vistos = [], [], set()
        elegidos = ids_portales or [p["id"] for p in portales.PORTALES]

        for pid in elegidos:
            cfg = portales.portal(pid)
            if not cfg:
                continue
            try:
                encontradas = self._buscar_en(cfg, termino, ciudad, paginas)
            except Exception as e:
                errores.append({"portal": cfg["nombre"], "error": str(e)[:160]})
                continue
            for v in encontradas:
                clave = (v["titulo"].lower().strip(), v["empresa"].lower().strip())
                if clave in vistos:
                    continue  # la misma oferta publicada en dos portales
                vistos.add(clave)
                resultados.append(v)

        return {"vacantes": resultados, "errores": errores, "termino": termino}

    def _buscar_en(self, cfg, termino, ciudad, paginas):
        sel = cfg["selectores"]
        encontradas = []
        for n in range(1, paginas + 1):
            self.page.goto(cfg["url"](termino, ciudad, n), wait_until="domcontentloaded", timeout=45000)
            try:
                self.page.wait_for_selector(sel["oferta"], timeout=9000)
            except Exception:
                break
            for art in self.page.query_selector_all(sel["oferta"])[:25]:
                v = self._leer_generica(art, cfg)
                if v and v["titulo"]:
                    encontradas.append(v)
            if not encontradas:
                break
        return encontradas

    def _leer_generica(self, art, cfg):
        sel = cfg["selectores"]

        def texto(clave):
            try:
                e = art.query_selector(sel[clave])
                return e.inner_text().strip() if e else ""
            except Exception:
                return ""

        titulo = texto("titulo")
        if not titulo:
            return None

        # El enlace a la oferta: puede estar en el propio elemento o dentro.
        href = ""
        try:
            href = art.get_attribute("href") or ""
            if not href:
                enlace = art.query_selector("a[href]")
                href = enlace.get_attribute("href") if enlace else ""
        except Exception:
            pass
        if href and not href.startswith("http"):
            base = {"computrabajo": "https://pe.computrabajo.com",
                    "bumeran": "https://www.bumeran.com.pe",
                    "indeed": "https://pe.indeed.com"}[cfg["id"]]
            href = base + href
        href = href.split("#")[0]

        try:
            ident = art.get_attribute(sel["id_attr"]) or href
        except Exception:
            ident = href

        return {
            "id": f"{cfg['id']}-{(ident or titulo)[:40]}",
            "portal": cfg["nombre"],
            "portal_id": cfg["id"],
            "postulable": cfg["postulable"],
            "titulo": titulo,
            "empresa": texto("empresa"),
            "ubicacion": texto("ubicacion"),
            "publicado": texto("fecha"),
            "url": href,
            "ya_postulado": bool(art.query_selector(sel["ya_postulado"])) if sel.get("ya_postulado") else False,
        }

    def buscar(self, puesto, ciudad=None, paginas=1, excluir_postuladas=True):
        """Devuelve vacantes REALES de Computrabajo."""
        self.abrir()
        vacantes, vistos = [], set()

        for n in range(1, paginas + 1):
            self.page.goto(url_busqueda(puesto, ciudad, n), wait_until="domcontentloaded")
            try:
                self.page.wait_for_selector(SELECTORES["oferta"], timeout=8000)
            except Exception:
                break  # sin resultados en esta página

            for art in self.page.query_selector_all(SELECTORES["oferta"]):
                oferta = self._leer_oferta(art)
                if not oferta or oferta["id"] in vistos:
                    continue
                if excluir_postuladas and oferta["ya_postulado"]:
                    continue
                vistos.add(oferta["id"])
                vacantes.append(oferta)

            if not self.page.query_selector(SELECTORES["siguiente"]):
                break
        return vacantes

    def _leer_oferta(self, art):
        def texto(sel):
            e = art.query_selector(sel)
            return e.inner_text().strip() if e else ""

        enlace = art.query_selector(SELECTORES["titulo"])
        if not enlace:
            return None
        href = (enlace.get_attribute("href") or "").split("#")[0]
        apply_el = art.query_selector(SELECTORES["apply_url"])

        return {
            "id": art.get_attribute("data-id"),
            "portal": "Computrabajo",
            "titulo": enlace.inner_text().strip(),
            "empresa": texto(SELECTORES["empresa"]),
            "ubicacion": texto(SELECTORES["ubicacion"]),
            "publicado": texto(SELECTORES["fecha"]),
            "url": href if href.startswith("http") else BASE + href,
            "url_postular": apply_el.get_attribute("data-href-offer-apply") if apply_el else None,
            "ya_postulado": bool(art.query_selector(SELECTORES["ya_postulado"])),
        }

    def detalle(self, url):
        """Lee la descripción completa de una vacante (para adaptar el CV)."""
        self.abrir()
        self.page.goto(url, wait_until="domcontentloaded")
        def texto(sel):
            e = self.page.query_selector(sel)
            return e.inner_text().strip() if e else ""
        requisitos = [
            li.inner_text().strip()
            for li in self.page.query_selector_all(SELECTORES["detalle_requisitos"])
        ]
        return {
            "titulo": texto(SELECTORES["detalle_titulo"]),
            "descripcion": texto(SELECTORES["detalle_desc"]),
            "requisitos": requisitos,
            "url": url,
        }

    # ---------- postulación ----------
    def _hay_captcha(self):
        return any(self.page.query_selector(s) for s in PISTAS_CAPTCHA)

    def _en_formulario_postulacion(self):
        """¿Estamos de verdad en el formulario de postular, o en el login?

        Es la comprobación que evita rellenar y enviar la pantalla de
        acceso por error. Ante la duda, devuelve False.
        """
        url = (self.page.url or "").lower()
        if any(p in url for p in ("/acceso", "/login", "/registro", "/signin")):
            return False
        # Un campo de contraseña es señal inequívoca de login: el
        # formulario de postulación nunca pide contraseña.
        if self.page.query_selector("input[type='password']"):
            return False
        if self.page.query_selector(SELECTORES["sin_sesion"]):
            return False
        return True

    def _campo_prohibido(self, etiqueta):
        for patron, nombre in CAMPOS_PROHIBIDOS:
            if re.search(patron, etiqueta, re.I):
                return nombre
        return None

    def preparar_postulacion(self, url_oferta, perfil, ruta_cv=None):
        """Abre la oferta, pulsa 'Postularme' y llena lo que puede.

        NO envía nada. Devuelve un reporte de qué quedó completado y qué
        necesita la persona antes de confirmar.
        """
        self.abrir()
        self.page.goto(url_oferta, wait_until="domcontentloaded")

        import datos_personales

        guardados = datos_personales.leer()
        reporte = {
            "url": url_oferta,
            "completados": [],
            "pendientes": [],
            "usados_guardados": [],
            "captcha": False,
            "requiere_login": False,
            "listo_para_enviar": False,
            "nota": "",
        }

        boton = self.page.query_selector(SELECTORES["boton_postular"])
        if not boton:
            reporte["nota"] = "No se encontró el botón 'Postularme'. Puede que ya hayas postulado o que la oferta expiró."
            return reporte

        boton.click()
        self.page.wait_for_load_state("domcontentloaded")
        self.page.wait_for_timeout(1200)

        # Sin sesión, "Postularme" redirige al login. Hay que detectarlo:
        # si no, se rellenaría el formulario de acceso con los datos de la
        # persona y el envío haría clic sobre un login, no sobre la
        # postulación. Se aborta antes de tocar ningún campo.
        if not self._en_formulario_postulacion():
            reporte["nota"] = (
                "Computrabajo pidió iniciar sesión. Entra a tu cuenta en la ventana "
                "del navegador y vuelve a preparar la postulación."
            )
            reporte["requiere_login"] = True
            return reporte

        if self._hay_captcha():
            reporte["captcha"] = True
            reporte["nota"] = "El portal mostró un CAPTCHA. Resuélvelo tú en la ventana del navegador y vuelve a intentar."
            return reporte

        # Adjuntar el CV Harvard si el formulario lo permite.
        if ruta_cv and Path(ruta_cv).exists():
            file_input = self.page.query_selector("input[type='file']")
            if file_input:
                file_input.set_input_files(str(ruta_cv))
                reporte["completados"].append(f"CV adjuntado ({Path(ruta_cv).name})")

        # Recorrer los campos del formulario.
        for campo in self.page.query_selector_all("form input, form textarea, form select"):
            tipo = (campo.get_attribute("type") or "").lower()
            if tipo in ("hidden", "submit", "button", "file"):
                continue
            etiqueta = " ".join(filter(None, [
                campo.get_attribute("name") or "",
                campo.get_attribute("id") or "",
                campo.get_attribute("placeholder") or "",
                campo.get_attribute("aria-label") or "",
            ]))
            if not etiqueta.strip():
                continue

            # Datos personales (DNI, distrito, pretensión…): se completan
            # SOLO si la persona los guardó a propósito en la plataforma.
            # Lo que no guardó sigue reportándose como pendiente.
            clave_dato, valor_guardado = datos_personales.valor_para_campo(etiqueta, guardados)
            if clave_dato:
                if valor_guardado:
                    try:
                        campo.fill(valor_guardado)
                        reporte["completados"].append(f"{etiqueta.strip()[:38]} → {valor_guardado}")
                        reporte["usados_guardados"].append(clave_dato)
                    except Exception:
                        reporte["pendientes"].append(etiqueta.strip()[:40])
                else:
                    etiqueta_campo = next(
                        (c["etiqueta"] for c in datos_personales.CAMPOS if c["clave"] == clave_dato),
                        etiqueta.strip()[:40],
                    )
                    reporte["pendientes"].append(etiqueta_campo)
                continue

            valor = self._valor_para(etiqueta, perfil)
            if valor and not (campo.get_attribute("value") or "").strip():
                try:
                    campo.fill(valor)
                    reporte["completados"].append(f"{etiqueta.strip()[:40]} → {valor}")
                except Exception:
                    reporte["pendientes"].append(etiqueta.strip()[:40])

        # Preguntas de selección: se detectan y se devuelven con borradores,
        # pero NO se escriben aquí. La persona las revisa en la plataforma.
        reporte["preguntas"] = self._leer_preguntas(perfil)

        # Volcado de la estructura del formulario, para poder ajustar los
        # selectores cuando una vacante traiga campos distintos.
        reporte["diagnostico"] = self._diagnostico_formulario()

        reporte["pendientes"] = sorted(set(reporte["pendientes"]))
        reporte["listo_para_enviar"] = not reporte["captcha"]
        if reporte["preguntas"]:
            reporte["nota"] = (
                f"Esta vacante tiene {len(reporte['preguntas'])} pregunta(s) de selección. "
                "Revísalas abajo antes de enviar."
            )
        reporte["nota"] = reporte["nota"] or (
            "Formulario preparado. Revísalo en la ventana del navegador y confirma el envío desde la plataforma."
        )
        return reporte

    def _diagnostico_formulario(self):
        """Lista los controles del formulario (para depurar selectores)."""
        try:
            return self.page.evaluate(
                """() => [...document.querySelectorAll('form input, form textarea, form select')]
                    .filter(e => !['hidden','submit','button'].includes((e.type||'').toLowerCase()))
                    .slice(0, 40)
                    .map(e => ({
                        tag: e.tagName.toLowerCase(),
                        type: e.type || '',
                        name: e.name || '',
                        id: e.id || '',
                        required: !!e.required,
                    }))"""
            )
        except Exception:
            return []

    # ---------- preguntas de selección ----------
    def _clasificar(self, texto):
        for clase, patron in CLASIFICACION_PREGUNTAS:
            if re.search(patron, texto, re.I):
                return clase
        return "otra"

    def _texto_pregunta(self, campo):
        """Recupera el enunciado que acompaña a un campo de texto libre."""
        try:
            return campo.evaluate(
                """el => {
                    const limpiar = t => (t || '').replace(/\\s+/g, ' ').trim();
                    // Preferir el <label> asociado.
                    if (el.id) {
                        const lab = document.querySelector(`label[for="${el.id}"]`);
                        if (lab) return limpiar(lab.innerText);
                    }
                    const dentro = el.closest('label');
                    if (dentro) return limpiar(dentro.innerText);
                    // Si no, el bloque contenedor menos el propio campo.
                    let n = el.parentElement;
                    for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
                        const t = limpiar(n.innerText);
                        if (t && t.length > 12) return t.slice(0, 400);
                    }
                    return '';
                }"""
            )
        except Exception:
            return ""

    def _leer_preguntas(self, perfil, extras=None):
        """Detecta las preguntas de selección y redacta una propuesta.

        No las escribe: las devuelve para que la persona las revise en la
        plataforma. La redacción vive en `respuestas.py`; aquí solo se
        localizan los campos y sus enunciados.
        """
        import respuestas as redaccion

        # Primero localizar todas las preguntas del formulario.
        crudas = []
        campos = self.page.query_selector_all("form textarea, textarea")
        for i, campo in enumerate(campos):
            enunciado = self._texto_pregunta(campo)
            if not enunciado:
                continue
            crudas.append({
                "indice": i,
                "enunciado": enunciado[:400],
                "clase": self._clasificar(enunciado),
                "respuesta_actual": (campo.input_value() or "").strip(),
                "max": campo.get_attribute("maxlength") or "",
            })

        # Las de compromiso y consentimiento se resuelven sin modelo.
        propias, para_ia = [], []
        for p in crudas:
            if redaccion.es_decision_personal(p["enunciado"]):
                propias.append(p)
            else:
                para_ia.append(p)

        # Todas las demás en UNA sola llamada, para no agotar el límite
        # por minuto de la capa gratuita.
        en_lote = redaccion.redactar_varias([p["enunciado"] for p in para_ia], perfil, extras)

        preguntas = []
        for p in crudas:
            if p in propias:
                texto, faltan = redaccion.redactar(p["clase"], p["enunciado"], perfil, extras)
            else:
                texto, faltan = en_lote.get(para_ia.index(p), (None, None))
                if texto is None:
                    texto, faltan = redaccion.redactar(p["clase"], p["enunciado"], perfil, extras)
            preguntas.append({
                **p,
                "borrador": texto or "",
                "necesita": faltan or [],
                "decision_personal": p in propias,
            })
        return preguntas

    def releer_preguntas(self, perfil, extras):
        """Recompone los borradores con lo que la persona ya respondió."""
        self.abrir()
        if not self._en_formulario_postulacion():
            return {"error": "No estás en el formulario de postulación."}
        return {"preguntas": self._leer_preguntas(perfil, extras)}

    def escribir_respuestas(self, respuestas):
        """Escribe en el formulario las respuestas que la persona aprobó.

        `respuestas` es {indice: texto}. Solo se escribe lo que venga con
        texto: lo que ella dejó vacío se queda vacío.
        """
        if not self.page:
            return {"error": "No hay un formulario preparado."}
        if not self._en_formulario_postulacion():
            return {"error": "No estás en el formulario de postulación."}

        campos = self.page.query_selector_all("form textarea, textarea")
        escritas = []
        for clave, texto in (respuestas or {}).items():
            try:
                i = int(clave)
            except (TypeError, ValueError):
                continue
            if not (texto or "").strip() or i >= len(campos):
                continue
            try:
                campos[i].fill(texto.strip())
                escritas.append(i)
            except Exception:
                pass
        return {"escritas": escritas, "total": len(campos)}

    def _valor_para(self, etiqueta, perfil):
        """Solo datos que SÍ están en el CV."""
        contacto = perfil.get("contacto", {})
        mapa = [
            (r"nombre|name|nombres", perfil.get("nombre", "")),
            (r"mail|correo", contacto.get("email", "")),
            (r"tel[eé]fono|celular|phone|m[oó]vil", contacto.get("telefono", "")),
            (r"linkedin", contacto.get("linkedin", "")),
        ]
        for patron, valor in mapa:
            if re.search(patron, etiqueta, re.I) and valor:
                return valor
        return None

    def _botones_candidatos(self):
        """Botones que podrían ser el de enviar, ordenados por probabilidad.

        Se puntúan en vez de tomar el primero que aparezca: la página tiene
        otros botones de tipo submit (el buscador de ofertas, por ejemplo) y
        pulsar el equivocado no envía nada.
        """
        try:
            crudos = self.page.evaluate(
                """() => [...document.querySelectorAll(
                        "button, input[type='submit'], a[role='button'], a.b_primary, span.b_primary"
                    )]
                    .map((e, i) => ({
                        i,
                        texto: (e.innerText || e.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
                        tipo: (e.type || '').toLowerCase(),
                        clase: (e.className || '').toString().slice(0, 70),
                        visible: !!(e.offsetWidth || e.offsetHeight),
                        deshabilitado: !!e.disabled,
                        enForm: !!e.closest('form'),
                    }))
                    .filter(b => b.visible && !b.deshabilitado)"""
            )
        except Exception:
            return []

        # Palabras que delatan el botón correcto y las que lo descartan.
        buenas = re.compile(r"postular|enviar|aplicar|finalizar|confirmar|continuar", re.I)
        malas = re.compile(r"buscar|filtrar|iniciar sesi|registrar|cancelar|volver|cerrar|guardar b", re.I)

        for b in crudos:
            puntos = 0
            if buenas.search(b["texto"]):
                puntos += 10
            if malas.search(b["texto"]):
                puntos -= 20
            if b["tipo"] == "submit":
                puntos += 4
            if b["enForm"]:
                puntos += 3
            if "b_primary" in b["clase"]:
                puntos += 2
            b["puntos"] = puntos
        return sorted([b for b in crudos if b["puntos"] > 0], key=lambda b: -b["puntos"])

    def _errores_validacion(self):
        """Mensajes de campo obligatorio que el portal muestre tras enviar."""
        try:
            return self.page.evaluate(
                """() => {
                    const vistos = new Set();
                    // Validación nativa del navegador.
                    document.querySelectorAll('input, textarea, select').forEach(e => {
                        if (e.willValidate && !e.checkValidity()) {
                            const t = (e.validationMessage || 'campo inválido').trim();
                            const et = (e.name || e.id || e.placeholder || 'campo');
                            vistos.add(`${et}: ${t}`);
                        }
                    });
                    // Mensajes que pinta la propia página.
                    document.querySelectorAll(
                        "[class*='error']:not(:empty), [class*='invalid']:not(:empty), .fc_error, [role='alert']"
                    ).forEach(e => {
                        const t = (e.innerText || '').replace(/\\s+/g, ' ').trim();
                        if (t && t.length < 160) vistos.add(t);
                    });
                    return [...vistos].slice(0, 8);
                }"""
            )
        except Exception:
            return []

    def _postulacion_confirmada(self):
        """Señales fiables de que el portal aceptó la postulación.

        Buscar la palabra "postulación" en el texto no vale: aparece en
        cualquier página de Computrabajo. Se usan marcas concretas.
        """
        url = (self.page.url or "").lower()
        if any(p in url for p in ("/applied", "/postulacion-exitosa", "success", "gracias", "/apply/ok")):
            return True, f"URL de confirmación: {self.page.url}"
        # La etiqueta "Postulado" que el portal añade a la oferta.
        if self.page.query_selector("[applied-offer-tag]:not(.hide), .tag.postulated:not(.hide)"):
            return True, "El portal marcó la oferta como 'Postulado'."
        try:
            texto = self.page.inner_text("body")
        except Exception:
            return False, "No se pudo leer la página."
        for frase in ("tu postulación fue enviada", "postulación enviada", "hemos enviado tu postulación",
                      "postulaste a esta oferta", "ya postulaste", "gracias por postular",
                      "tu solicitud fue enviada"):
            if frase in texto.lower():
                return True, f"Mensaje del portal: «{frase}»"
        return False, ""

    def confirmar_envio(self):
        """Hace el clic final. Solo se llama tras la confirmación humana.

        Devuelve diagnóstico detallado cuando no puede confirmar el envío,
        para no dejar a la persona con un "algo falló" sin más.
        """
        if not self.page:
            return {"error": "No hay un formulario preparado."}
        # Nunca pulsar "enviar" sobre una pantalla de acceso.
        if not self._en_formulario_postulacion():
            return {"error": "No estás en el formulario de postulación. Inicia sesión y vuelve a preparar."}
        if self._hay_captcha():
            return {"error": "Hay un CAPTCHA pendiente; resuélvelo en el navegador."}

        # Puede que ya estuviera enviada de antes.
        ya, señal = self._postulacion_confirmada()
        if ya:
            return {"enviada": True, "url_final": self.page.url,
                    "mensaje": f"Ya estaba postulada. {señal}"}

        candidatos = self._botones_candidatos()
        if not candidatos:
            return {"error": "No se encontró el botón de envío.",
                    "diagnostico": {"botones": [], "url": self.page.url}}

        url_antes = self.page.url
        elegido = candidatos[0]
        try:
            self.page.evaluate(
                """(i) => {
                    const es = [...document.querySelectorAll(
                        "button, input[type='submit'], a[role='button'], a.b_primary, span.b_primary"
                    )];
                    es[i] && es[i].click();
                }""",
                elegido["i"],
            )
        except Exception as e:
            return {"error": f"No se pudo pulsar el botón: {e}"}

        # Esperar a que algo cambie: navegación, confirmación o error.
        for _ in range(12):
            self.page.wait_for_timeout(700)
            hecho, señal = self._postulacion_confirmada()
            if hecho:
                return {"enviada": True, "url_final": self.page.url,
                        "mensaje": f"Postulación enviada. {señal}"}
            if self.page.url != url_antes:
                break

        errores = self._errores_validacion()
        hecho, señal = self._postulacion_confirmada()
        if hecho:
            return {"enviada": True, "url_final": self.page.url,
                    "mensaje": f"Postulación enviada. {señal}"}

        mensaje = "No se pudo confirmar el envío."
        if errores:
            mensaje = "El portal pide completar campos obligatorios: " + " · ".join(errores[:3])
        return {
            "enviada": False,
            "url_final": self.page.url,
            "mensaje": mensaje + " Revisa la ventana del navegador.",
            "diagnostico": {
                "boton_pulsado": elegido["texto"] or elegido["clase"],
                "otros_botones": [b["texto"] or b["clase"] for b in candidatos[1:5]],
                "errores": errores,
                "url_antes": url_antes,
                "url_despues": self.page.url,
                "cambio_url": self.page.url != url_antes,
            },
        }


# ---------------------------------------------------------------------------
# Worker de navegador
#
# Playwright (API síncrona) exige que el navegador se cree y se use siempre
# desde el MISMO hilo. Flask atiende cada request en un hilo distinto, así
# que llamarlo directamente desde una vista revienta. La solución es un hilo
# dedicado que es dueño del navegador y recibe órdenes por una cola.
# ---------------------------------------------------------------------------

import queue
import threading


class WorkerNavegador:
    """Ejecuta las órdenes del navegador en un único hilo propio."""

    def __init__(self):
        self._ordenes = queue.Queue()
        self._hilo = None
        self._nav = None

    def _bucle(self):
        self._nav = NavegadorComputrabajo()
        while True:
            metodo, args, kwargs, respuesta = self._ordenes.get()
            if metodo == "__parar__":
                try:
                    self._nav.cerrar()
                finally:
                    respuesta.put(("ok", None))
                return
            try:
                resultado = getattr(self._nav, metodo)(*args, **kwargs)
                respuesta.put(("ok", resultado))
            except Exception as e:
                import traceback
                traceback.print_exc()
                respuesta.put(("error", f"{type(e).__name__}: {e}"))

    def llamar(self, metodo, *args, timeout=180, **kwargs):
        if self._hilo is None or not self._hilo.is_alive():
            self._hilo = threading.Thread(target=self._bucle, daemon=True)
            self._hilo.start()
        respuesta = queue.Queue()
        self._ordenes.put((metodo, args, kwargs, respuesta))
        estado, valor = respuesta.get(timeout=timeout)
        if estado == "error":
            raise RuntimeError(valor)
        return valor

    def parar(self):
        if self._hilo and self._hilo.is_alive():
            self.llamar("__parar__", timeout=30)


_worker = None


def worker():
    global _worker
    if _worker is None:
        _worker = WorkerNavegador()
    return _worker

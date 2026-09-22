// Qué portales han completado una postulación REAL, de punta a punta.
//
// Esto no es configuración: es la línea entre lo que el producto puede
// prometer y lo que solo está escrito.
//
// Tener el código no basta. bumeran.js tiene desde el 2026-09-11 sus seis
// funciones de postular, medidas contra la estructura real de una vacante
// —el botón, el formulario de sueldo pretendido, la barra— pero lo que
// pasa DESPUÉS de pulsar «Postularme» no lo ha visto nadie todavía,
// porque eso exige una sesión iniciada y una vacante de verdad. Hasta que
// alguien complete una, Bumeran es código sin comprobar.
//
// La regla que esto impone, y que las pruebas hacen cumplir: la página
// solo puede decir que postula en los portales de esta lista. Ampliarla
// se hace DESPUÉS de ver una postulación entrar, nunca antes.
export const POSTULACION_VERIFICADA = ["computrabajo"];

// Escrito y con selectores medidos, pendiente de una postulación real.
export const POSTULACION_SIN_PROBAR = ["bumeran", "indeed"];

// LinkedIn aparte: aquí no falta probarlo, es que NO va a enviar nunca.
//
// Su §8.2 prohíbe la automatización y desde finales de 2025 restringen
// cuentas por ello; lo que detectan son extensiones que tocan el DOM.
// Lo que se arriesga es el perfil de la persona, no el nuestro, y su
// LinkedIn es su vida laboral entera.
//
// Su política sí admite extensiones que ayudan al propio usuario
// mientras no envíen sin revisión, así que se rellena y se para. Esto
// no es una fase: es la decisión.
export const SOLO_RELLENA = ["linkedin"];


// Los packs que se venden. El titular de la portada sale de aquí.
//
// Antes decía «Quince postulaciones», que es TOPE_POR_TANDA: cuántas
// manda de una tanda. Pero eso no es lo que nadie compra, y Ali lo vio:
// ninguno de los planes dice quince. Lo que se compra son cien.
//
// El titular y el tope de una tanda tienen que salir del MISMO sitio.
// Estaban separados —el titular en panel.html, el tope en background.js—
// y llevaban meses diciendo cosas distintas: el texto prometía cien y el
// código mandaba quince. Un número en la portada que el propio código
// desmiente es justo lo que no se puede permitir.
//
// Ahora TOPE_POR_TANDA está aquí, al lado de los packs, background.js lo
// importa y el panel escribe el titular con él. Suban o bajen, coinciden;
// y una prueba falla si alguien los vuelve a separar.
//
// Por qué sigue en 15 y no en 100: el tope real no es este número, es la
// cuota de IA. Cada postulación gasta ~2 llamadas al modelo y la capa
// gratuita da 40 cada 24 h — una tanda de cien se quedaría tiesa cerca de
// la veinte, con ochenta «llegaste al límite» en pantalla. Subirlo a cien
// es una línea, pero solo después de activar facturación en Gemini.
export const PACKS = [
  { postulaciones: 5, soles: 0, nombre: "Para probar" },
  { postulaciones: 30, soles: 15, nombre: "Pack chico" },
  { postulaciones: 100, soles: 29, nombre: "Recomendado" },
];
export const PACK_MAYOR = 100;

// Cuántas prepara una tanda de un clic. Ver el bloque de arriba.
export const TOPE_POR_TANDA = 15;

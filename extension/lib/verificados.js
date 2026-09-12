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
export const POSTULACION_SIN_PROBAR = ["bumeran"];

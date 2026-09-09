// La dirección del servidor, y nada más.
//
// Vivía dentro de ia.js, y de ahí la importaban cv.js y sesion.js. Eso
// impedía que ia.js pudiera usar la sesión: sesion.js ya importaba de
// ia.js, y la vuelta habría cerrado un círculo. Con la constante en su
// propio módulo, cada uno importa de quien tiene que importar y no hay
// ciclo que romper.
export const SERVIDOR = "https://chamba-lista-ali-ab09.vercel.app";

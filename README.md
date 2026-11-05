# La Clínica del Gym

App del taller: clientes, órdenes, presupuestos, cobros, agenda y rutas, inventario, abonos, empleados y números.
Se instala en el celular como app (PWA) y guarda los datos en Supabase.

## Cómo está armada
- `index.html`: toda la app (pantallas y lógica).
- `vendor/`: librerías incluidas para que funcione sin señal (Supabase, PDF, QR).
- `sw.js` y `manifest.webmanifest`: instalación en el celular y modo sin señal.
- `supabase/`: el código SQL de la base (tablas, permisos e historial) y de los roles.

## Datos y permisos
- Cada persona entra con su email y contraseña (Supabase → Authentication).
- El rol (administrador, técnico, atención) se asigna con `supabase/2-roles.sql`.
- La contabilidad y los gastos ajenos los ve solo el administrador; lo bloquea la base, no solo la pantalla.
- Cada cambio queda en el historial: quién, qué y cuándo.

## Publicación
Vercel publica automáticamente cada cambio que se sube a la rama `main`.

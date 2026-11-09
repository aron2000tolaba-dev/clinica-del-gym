# Bot de WhatsApp · Clínica del Gym

Corre en Railway y se vincula al WhatsApp del negocio como **dispositivo vinculado** (igual que WhatsApp Web). El celular sigue funcionando normal.

## Qué hace

**Con clientes** (solo en el horario que pongas en la app → Más → Bot de WhatsApp):
- Si preguntan por su equipo y tienen una orden abierta, contesta el estado y la fecha estimada.
- Si preguntan por un repuesto que está en el inventario, contesta si hay y el precio aproximado. Si no está seguro, no contesta.
- Si no, manda un saludo (una vez por día por persona).
- Fuera de horario manda un aviso de cerrado (máximo uno cada 12 horas).
- Si alguien de ustedes escribe en ese chat, el bot se calla en ese chat (12 horas por defecto).

**Con la familia** (los números cargados en Empleados):
- Audio o texto con un gasto → contesta lo que entendió y lo guarda cuando le dicen "sí".
- La nafta pide litros y km, igual que la app.
- El dueño del número también puede mandárselo en el chat consigo mismo.

## Variables en Railway

| Variable | Qué poner |
|---|---|
| `BOT_EMAIL` | el email de la cuenta del bot en Supabase |
| `BOT_PASSWORD` | su contraseña |
| `PANEL_CLAVE` | una clave para ver el panel |
| `GROQ_API_KEY` | la clave de Groq (para entender audios) |
| `WA_NUMERO` | opcional: 5493875563583, para vincular con código en vez de QR |

Volumen montado en `/data` (ahí queda la sesión de WhatsApp; sin volumen hay que volver a vincular en cada actualización).

## Aviso

WhatsApp no permite oficialmente bots en números comunes. Por eso el bot manda pocos mensajes, con pausas y un tope diario, pero existe el riesgo de que WhatsApp bloquee el número.

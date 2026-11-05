-- ===== La Clínica del Gym · roles de cada persona (paso 2) =====
-- Correr DESPUÉS de crear los usuarios en Authentication → Users.
-- Si querés, cambiá los nombres entre comillas antes de tocar Run.
with personas (email, usuario, nombre, rol) as (values
  ('aron2000tolaba@gmail.com',   'u1', 'Aarón',   'admin'),
  ('retotolaba@gmail.com',       'u2', 'Papá',    'tecnico'),
  ('jezabelreynaga14@gmail.com', 'u3', 'Mamá',    'atencion'),
  ('samikeastolaba@gmail.com',   'u4', 'Hermano', 'tecnico'),
  ('saidrey2204@gmail.com',      'u5', 'Said',    'tecnico')
)
insert into public.perfiles (id, usuario, nombre, rol)
select u.id, p.usuario, p.nombre, p.rol
from personas p join auth.users u on lower(u.email) = p.email
on conflict (id) do update set usuario = excluded.usuario, nombre = excluded.nombre, rol = excluded.rol;

-- Control: muestra quién quedó listo y a quién falta crear
select p.email, p.nombre, p.rol,
       case when u.id is null then 'FALTA CREAR ESTE USUARIO' else 'OK' end as estado
from (values
  ('aron2000tolaba@gmail.com', 'Aarón', 'admin'), ('retotolaba@gmail.com', 'Papá', 'tecnico'),
  ('jezabelreynaga14@gmail.com', 'Mamá', 'atencion'), ('samikeastolaba@gmail.com', 'Hermano', 'tecnico'),
  ('saidrey2204@gmail.com', 'Said', 'tecnico')
) as p(email, nombre, rol)
left join auth.users u on lower(u.email) = p.email;

// app.js
// Servidor Express con autenticación por sesión, manejo de productos y carrito
// app.js (encabezado recomendado - ES modules)
import express from "express";
import bodyParser from "body-parser";
import mysql from "mysql2";
import dotenv from "dotenv";
import multer from "multer";
import fs from 'fs';
import path from 'path';
import session from "express-session";
import bcrypt from "bcrypt";
import MySQLStore from 'express-mysql-session';

dotenv.config(); // carga .env
console.log("DB host loaded:", !!process.env.DB_HOST);

// 1) Crear app antes de usarla
const app = express();

// 2) Middlewares básicos
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// 3) Session (usa SECRET desde .env en producción)
app.use(session({
  secret: process.env.SESSION_SECRET || "cambiar_esto_en_produccion",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 día
}));

// 4) Multer (configuración simple; si quieres memoryStorage ajusta aquí)
const storage = multer.memoryStorage(); // guarda en memoria (usa diskStorage si prefieres archivos)
const upload = multer({ storage });

// 5) Conexión MySQL usando .env
const con = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  // si la conexión remota requiere TLS o flags especiales, ahí los agregas
});

// 6) Conectar y verificar
con.connect((err) => {
  if (err) {
    console.error("❌ Error al conectar a la base de datos:", err);
    // opcional: process.exit(1);
  } else {
    console.log("✅ Conectado a MySQL:", process.env.DB_HOST, "DB:", process.env.DB_NAME);
  }
});

// exportar con si lo necesitas en otros módulos
// export { con };

// 7) Evitar múltiples app.listen al recargar: (haz un solo listen abajo)

// 5️⃣ Aquí ya puedes usar rutas
app.get("/", (req, res) => {
  res.send("Servidor funcionando correctamente");
});

// --- Sanitizador simple ---
function sanitizeInput(input) {
    if (!input) return '';
    return String(input).replace(/<[^>]*>?/gm, '').replace(/<\?php.*?\?>/gs, '');
}

// --- Función para validar contraseña ---
function validarPassword(password) {
    const minLength = 8;
    const regexMayus = /[A-Z]/;
    const regexMinus = /[a-z]/;
    const regexNumero = /[0-9]/;
    const regexEspecial = /[!@#$%^&*(),.?":{}|<>]/;

    if (password.length < minLength) return "La contraseña debe tener al menos 8 caracteres.";
    if (!regexMayus.test(password)) return "La contraseña debe contener al menos una letra mayúscula.";
    if (!regexMinus.test(password)) return "La contraseña debe contener al menos una letra minúscula.";
    if (!regexNumero.test(password)) return "La contraseña debe contener al menos un número.";
    if (!regexEspecial.test(password)) return "La contraseña debe contener al menos un carácter especial.";
    return null; // si pasa todas las validaciones
}

// Registro
app.post("/register", async (req, res) => {
    let { nombre, email, password, rol } = req.body;
    nombre = sanitizeInput(nombre);
    email = sanitizeInput(email);
    rol = sanitizeInput(rol) || 'cliente';

    if (!nombre || !email || !password) {
        return res.status(400).json({ error: "Todos los campos son obligatorios." });
    }

    // Validar contraseña
    const passError = validarPassword(password);
    if (passError) return res.status(400).json({ error: passError });

    try {
        // Revisar si el usuario ya existe
        const [rows] = await con.promise().query(
            "SELECT id_usuario FROM usuario WHERE email = ?",
            [email]
        );
        if (rows.length > 0) {
            return res.status(400).json({ error: "Email ya registrado." });
        }

        // Crear hash y guardar usuario
        const hashed = await bcrypt.hash(password, 10);
        await con.promise().query(
            "INSERT INTO usuario (nombre, email, password, rol) VALUES (?, ?, ?, ?)",
            [nombre, email, hashed, rol]
        );

        return res.json({ mensaje: "Usuario registrado correctamente." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al registrar usuario." });
    }
});

// /login actual por este bloque
app.post("/login", async (req, res) => {
  let { email, password } = req.body;
  email = sanitizeInput(email);
  if (!email || !password) return res.status(400).json({ error: "Email y contraseña son obligatorios." });

  try {
    const [rows] = await con.promise().query(
  "SELECT * FROM usuario WHERE email = ?",
  [email]
);
if (rows.length === 0) return res.status(400).json({ error: "Credenciales inválidas." });

    const user = rows[0];
    const stored = user.password || '';

    // Si stored parece un hash bcrypt (empieza con $2a$ $2b$ o $2y$), usar bcrypt.compare
    if (/^\$2[aby]\$/.test(stored)) {
      const ok = await bcrypt.compare(password, stored);
      if (!ok) return res.status(400).json({ error: "Credenciales inválidas." });
    } else {
      // stored parece texto plano: comparar directamente
      if (password !== stored) return res.status(400).json({ error: "Credenciales inválidas." });
      // re-hashear y actualizar DB para seguridad
      const newHash = await bcrypt.hash(password, 10);
      await con.promise().query("UPDATE usuario SET password = ? WHERE id_usuario = ?", [newHash, user.id_usuario]);
      console.log(`Usuario ${user.id_usuario} re-hasheado automáticamente.`);
    }

    req.session.user = {
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol
    };
    return res.json({ mensaje: "Login correcto.", user: req.session.user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error en el login." });
  }
});



// Logout
app.post("/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: "Error al cerrar sesión." });
        res.clearCookie('connect.sid');
        return res.json({ mensaje: "Cerraste sesión." });
    });
});

// Obtener usuario actual (si está autenticado)
app.get("/me", (req, res) => {
    if (!req.session.user) return res.json({ user: null });
    return res.json({ user: req.session.user });
});

// Servicio para actualizar perfil (nombre, password y foto opcional)
app.post('/perfil', upload.single('imagenPerfil'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autenticado.' });
    const id_usuario = req.session.user.id_usuario;
    try {
        const nombre = sanitizeInput(req.body.nombre || '');
        const newPassword = req.body.newPassword || '';

        // Actualizar nombre y/o contraseña
        const updates = [];
        const params = [];
        if (nombre) { updates.push('nombre = ?'); params.push(nombre); }
        if (newPassword) {
            const hashed = await bcrypt.hash(newPassword, 10);
            updates.push('password = ?'); params.push(hashed);
        }
        if (updates.length > 0) {
            const sql = `UPDATE usuario SET ${updates.join(', ')} WHERE id_usuario = ?`;
            params.push(id_usuario);
            await con.promise().query(sql, params);
        }

        // Si llega imagen, guardarla en disco bajo public/uploads/profiles/profile_{id}.{ext}
        if (req.file && req.file.buffer) {
            const dir = path.join(process.cwd(), 'public', 'uploads', 'profiles');
            await fs.promises.mkdir(dir, { recursive: true });
            const ext = path.extname(req.file.originalname) || '.jpg';
            const filename = `profile_${id_usuario}${ext}`;
            const filePath = path.join(dir, filename);
            await fs.promises.writeFile(filePath, req.file.buffer);
            // opcional: podríamos limpiar otras extensiones previas (profile_{id}.*)
            const files = await fs.promises.readdir(dir);
            for (const f of files) {
                if (f.startsWith(`profile_${id_usuario}`) && f !== filename) {
                    try { await fs.promises.unlink(path.join(dir, f)); } catch (e) { /* ignore */ }
                }
            }
        }

        // devolver usuario actualizado
        const [rows] = await con.promise().query('SELECT id_usuario, nombre, email, rol FROM usuario WHERE id_usuario = ?', [id_usuario]);
        const user = rows && rows[0] ? rows[0] : null;
        // actualizar sesión también
        if (user) req.session.user = { id_usuario: user.id_usuario, nombre: user.nombre, email: user.email, rol: user.rol };
        return res.json({ mensaje: 'Perfil actualizado.', user, imagenUrl: `/perfil/imagen/${id_usuario}` });
    } catch (err) {
        console.error('Error actualizando perfil:', err);
        return res.status(500).json({ error: 'Error al actualizar perfil.' });
    }
});

// Servir imagen de perfil si existe en public/uploads/profiles
app.get('/perfil/imagen/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const dir = path.join(process.cwd(), 'public', 'uploads', 'profiles');
        const exists = await fs.promises.access(dir).then(() => true).catch(() => false);
        if (!exists) return res.status(404).send('No image');
        const files = await fs.promises.readdir(dir);
        const file = files.find(f => f.startsWith(`profile_${id}`));
        if (!file) return res.status(404).send('No image');
        return res.sendFile(path.join(dir, file));
    } catch (err) {
        console.error('Error sirviendo imagen perfil:', err);
        return res.status(500).send('Error');
    }
});

// --- Endpoints productos (tus endpoints existentes adaptados) ---

// Agregar producto (solo admin)
app.post("/productos/agregar", upload.single("imagen"), (req, res) => {
  if (!req.session.user || req.session.user.rol !== 'admin') {
    return res.status(403).json({ error: "Acceso denegado." });
  }

  let { nombre, descripcion, precio, stock, temporada } = req.body;
  nombre = sanitizeInput(nombre);
  descripcion = sanitizeInput(descripcion);
  temporada = sanitizeInput(temporada);

  if (!nombre || !precio || !stock || !temporada) {
    return res.status(400).json({ error: "Todos los campos son obligatorios, incluida la temporada." });
  }

  let imagenBuffer = req.file ? req.file.buffer : null;

  const sql = "INSERT INTO producto (nombre, descripcion, precio, stock, imagen, temporada) VALUES (?, ?, ?, ?, ?, ?)";
  con.query(sql, [nombre, descripcion, precio, stock, imagenBuffer, temporada], (err, result) => {
    if (err) {
      console.error("Error al insertar producto:", err);
      return res.status(500).json({ error: "Error al guardar producto." });
    }
    return res.json({ mensaje: "Producto agregado correctamente.", id_producto: result.insertId });
  });
});

// Leer productos (para todos)
app.get("/obtenerProductos", (req, res) => {
    con.query("SELECT * FROM producto", (err, rows) => {
        if (err) {
            console.error("Error al obtener productos:", err);
            return res.status(500).json({ error: "Error al obtener productos." });
        }

        // Convertimos las imágenes a Base64
        const productos = rows.map(p => {
            let imagenBase64 = null;
            let tipoMime = null;

            if (p.imagen) {
                // detectar tipo por encabezado (primeros bytes)
                const header = p.imagen.slice(0, 4).toString('hex');
                if (header.startsWith('ffd8')) tipoMime = 'image/jpeg';
                else if (header === '89504e47') tipoMime = 'image/png';
                else if (header === '47494638') tipoMime = 'image/gif';
                else tipoMime = 'application/octet-stream';

                imagenBase64 = p.imagen.toString('base64');
            }

            return {
                ...p,
                tieneImagen: !!p.imagen,
                imagenBase64,
                tipoMime
            };
        });

        return res.json(productos);
    });
});

// Actualizar producto (solo admin)
app.post("/productos/editar/:id", upload.single("imagen"), (req, res) => {
  if (!req.session.user || req.session.user.rol !== 'admin') {
    return res.status(403).json({ error: "Acceso denegado." });
  }

  const id_producto = req.params.id;
  let { nombre, descripcion, precio, stock, temporada } = req.body;
  nombre = sanitizeInput(nombre);
  descripcion = sanitizeInput(descripcion);
  temporada = sanitizeInput(temporada);

  let imagenBuffer = req.file ? req.file.buffer : null;

  const sql = imagenBuffer
    ? "UPDATE producto SET nombre=?, descripcion=?, precio=?, stock=?, temporada=?, imagen=? WHERE id_producto=?"
    : "UPDATE producto SET nombre=?, descripcion=?, precio=?, stock=?, temporada=? WHERE id_producto=?";

  const params = imagenBuffer
    ? [nombre, descripcion, precio, stock, temporada, imagenBuffer, id_producto]
    : [nombre, descripcion, precio, stock, temporada, id_producto];

  con.query(sql, params, (err, result) => {
    if (err) {
      console.error("Error al actualizar producto:", err);
      return res.status(500).json({ error: "Error al actualizar producto." });
    }
    return res.json({ mensaje: "Producto actualizado correctamente." });
  });
});

// Servir imagen
app.get("/imagen/:id_producto", (req, res) => {
    const { id_producto } = req.params;
    con.query("SELECT imagen FROM producto WHERE id_producto = ?", [id_producto], (err, results) => {
        if (err || results.length === 0 || !results[0].imagen) {
            return res.status(404).send("Imagen no encontrada");
        }
        res.set("Content-Type", "image/jpeg");
        res.send(results[0].imagen);
    });
});

// eliminar producto (DELETE fetch desde frontend)
app.delete("/eliminarProducto/:id", (req, res) => {
  const id = req.params.id;
  con.query("DELETE FROM producto WHERE id_producto = ?", [id], (err, result) => {
    if (err) { console.error(err); return res.status(500).json({ ok:false }); }
    return res.json({ ok: true });
  });
});

// --- Endpoints carrito ---

// Agregar al carrito (cliente)
app.post('/carrito/agregar', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autenticado.' });
    const id_usuario = req.session.user.id_usuario;
    const { id_producto, cantidad } = req.body;
    if (!id_producto || !cantidad) return res.status(400).json({ error: 'Producto y cantidad obligatorios.' });

    try {
        const [p] = await con.promise().query('SELECT stock, precio FROM producto WHERE id_producto = ?', [id_producto]);
        if (p.length === 0) return res.status(404).json({ error: 'Producto no encontrado.' });
        if (p[0].stock < cantidad) return res.status(400).json({ error: 'No hay suficiente stock.' });

        // si ya existe el producto en el carrito, sumar cantidad
        const [exists] = await con.promise().query('SELECT id_carrito, cantidad FROM carrito WHERE id_usuario = ? AND id_producto = ?', [id_usuario, id_producto]);
        if (exists.length > 0) {
            const nueva = exists[0].cantidad + Number(cantidad);
            await con.promise().query('UPDATE carrito SET cantidad = ? WHERE id_carrito = ?', [nueva, exists[0].id_carrito]);
        } else {
            await con.promise().query('INSERT INTO carrito (id_usuario, id_producto, cantidad, precio) VALUES (?, ?, ?, ?)', [id_usuario, id_producto, cantidad, p[0].precio]);
        }
        return res.json({ mensaje: 'Agregado al carrito.' });
    } catch (err) {
        console.error('Error al agregar al carrito:', err);
        return res.status(500).json({ error: 'Error al agregar al carrito.' });
    }
});


// Obtener carrito del usuario
app.get("/carrito", async (req, res) => {
    if (!req.session.user) return res.json({ items: [] });
    const id_usuario = req.session.user.id_usuario;
    try {
        const [rows] = await con.promise().query(
            `SELECT c.id_carrito, c.cantidad, p.id_producto, p.nombre, p.precio 
            FROM carrito c JOIN producto p ON c.id_producto = p.id_producto WHERE c.id_usuario = ?`,
            [id_usuario]
        );
        return res.json({ items: rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener carrito." });
    }
});

// actualizar producto (form multipart)
app.post("/editarProducto/:id", upload.single("imagen"), (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, precio, stock, temporada } = req.body;
  const imagen = req.file ? req.file.buffer : null;

  const sql = imagen
    ? "UPDATE producto SET nombre=?, descripcion=?, precio=?, stock=?, temporada=?, imagen=? WHERE id_producto=?"
    : "UPDATE producto SET nombre=?, descripcion=?, precio=?, stock=?, temporada=? WHERE id_producto=?";

  const values = imagen
    ? [nombre, descripcion, precio, stock, temporada, imagen, id]
    : [nombre, descripcion, precio, stock, temporada, id];

  con.query(sql, values, (err) => {
    if (err) { console.error(err); return res.status(500).json({ ok:false }); }
    return res.json({ ok: true });
  });
});

// Eliminar item del carrito
app.post("/carrito/eliminar", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "No autenticado." });
    const { id_carrito } = req.body;
    if (!id_carrito) return res.status(400).json({ error: "ID de carrito obligatorio." });
    try {
        await con.promise().query("DELETE FROM carrito WHERE id_carrito = ?", [id_carrito]);
        return res.json({ mensaje: "Item eliminado." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar item." });
    }
});

// Checkout: descontar stock, guardar venta y vaciar carrito
app.post("/carrito/checkout", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "No autenticado." });
  }

  const id_usuario = req.session.user.id_usuario;
    // Aceptamos ambos nombres en el body para compatibilidad: { carrito: [...] } o { items: [...] }
    const items = req.body.carrito || req.body.items || [];
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Carrito vacío." });
    }

    const conn = con.promise();
    try {
        await conn.beginTransaction();

        // Crear la venta
        const [ventaRes] = await conn.query("INSERT INTO venta (id_usuario) VALUES (?)", [id_usuario]);
        const id_venta = ventaRes.insertId;

        // Insertar los productos del carrito, actualizar stock y eliminar del carrito
        for (const item of items) {
            // validar estructura mínima
            if (!item.id_producto || !item.cantidad) {
                throw new Error('Item inválido en carrito');
            }

            const precio = Number(item.precio) || 0;
            const cantidad = Number(item.cantidad);

            await conn.query(
  "INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio) VALUES (?, ?, ?, ?)",
  [id_venta, item.id_producto, cantidad, precio]
);


            await conn.query(
                "UPDATE producto SET stock = stock - ? WHERE id_producto = ?",
                [cantidad, item.id_producto]
            );

            // quitar del carrito del usuario
            await conn.query("DELETE FROM carrito WHERE id_usuario = ? AND id_producto = ?", [id_usuario, item.id_producto]);
        }

        await conn.commit();
        return res.json({ mensaje: "Venta completada con éxito" });
    } catch (err) {
        try { await conn.rollback(); } catch (e) { console.error('Rollback failed', e); }
        console.error("Error en checkout:", err);
        return res.status(500).json({ error: "Error al procesar la venta" });
    }
});

    // Obtener historial de compras del usuario (con detalles)
    app.get('/misCompras', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'No autenticado.' });
        const id_usuario = req.session.user.id_usuario;
        try {
            const [rows] = await con.promise().query(
                `SELECT v.*, d.id_detalle, d.id_producto, p.nombre, d.cantidad, d.subtotal, d.precio
                 FROM venta v
                 JOIN detalle_venta d ON v.id_venta = d.id_venta
                 JOIN producto p ON d.id_producto = p.id_producto
                 WHERE v.id_usuario = ?
                 ORDER BY v.id_venta DESC, d.id_detalle ASC`,
                [id_usuario]
            );

            // Agrupar por id_venta
            const mapa = new Map();
            for (const r of rows) {
                const id = r.id_venta;
                const fecha = r.fecha || r.created_at || r.createdAt || null;
                if (!mapa.has(id)) mapa.set(id, { id_venta: id, fecha: fecha, detalles: [], total: 0 });
                const grupo = mapa.get(id);
                grupo.detalles.push({ id_detalle: r.id_detalle, id_producto: r.id_producto, nombre: r.nombre, cantidad: r.cantidad, precio: r.precio, subtotal: r.subtotal });
                grupo.total += Number(r.subtotal || 0);
            }

            const result = Array.from(mapa.values());
            return res.json({ compras: result });
        } catch (err) {
            console.error('Error al obtener historial de compras:', err);
            return res.status(500).json({ error: 'Error al obtener historial de compras.' });
        }
    });


// --- Endpoints administración ---

// Obtener ventas totales por producto (solo admin)
app.get("/ventas", async (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: "Acceso denegado." });
    }
    try {
        const [rows] = await con.promise().query(
            `SELECT p.id_producto, p.nombre, SUM(d.cantidad) as total_vendido, SUM(d.cantidad * d.precio) as total_ingresos
            FROM detalle_venta d
            JOIN producto p ON d.id_producto = p.id_producto
            GROUP BY p.id_producto, p.nombre
            ORDER BY total_vendido DESC`
        );
        return res.json(rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener ventas." });
    }
});

app.get("/usuarios", async (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: "Acceso denegado." });
    }
    try {
        const [rows] = await con.promise().query("SELECT id_usuario, nombre, email, rol FROM usuario");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al obtener usuarios." });
    }
});

app.post("/usuarios/agregar", async (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: "Acceso denegado." });
    }
    let { nombre, email, rol } = req.body;
    nombre = sanitizeInput(nombre);
    email = sanitizeInput(email);
    rol = rol === "admin" ? "admin" : "cliente";

    try {
        // validar que no exista email
        const [rows] = await con.promise().query("SELECT id_usuario FROM usuario WHERE email=?", [email]);
        if (rows.length > 0) {
            return res.status(400).json({ error: "Email ya registrado." });
        }

        // contraseña por defecto
        const defaultPassword = "123456";
        const hashed = await bcrypt.hash(defaultPassword, 10);

        await con.promise().query(
            "INSERT INTO usuario (nombre, email, password, rol) VALUES (?, ?, ?, ?)",
            [nombre, email, hashed, rol]
        );

        res.json({ 
            mensaje: "Usuario agregado correctamente.", 
            passwordTemporal: defaultPassword 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al agregar usuario." });
    }
});


app.post("/usuarios/eliminar", async (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: "Acceso denegado." });
    }
    const { id } = req.body;
    try {
        await con.promise().query("DELETE FROM usuario WHERE id_usuario=?", [id]);
        res.json({ mensaje: "Usuario eliminado." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al eliminar usuario." });
    }
});

// Restablecer contraseña
app.post("/resetPassword", async (req, res) => {
    let { nombre, email, newPassword } = req.body;
    nombre = sanitizeInput(nombre);
    email = sanitizeInput(email);

    if (!nombre || !email || !newPassword) {
        return res.status(400).json({ error: "Todos los campos son obligatorios." });
    }

    try {
        const [rows] = await con.promise().query(
            "SELECT id_usuario FROM usuario WHERE nombre = ? AND email = ?",
            [nombre, email]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: "No se encontró usuario con esos datos." });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await con.promise().query(
            "UPDATE usuario SET password = ? WHERE id_usuario = ?",
            [hashed, rows[0].id_usuario]
        );

        return res.json({ mensaje: "Contraseña actualizada correctamente." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al restablecer contraseña." });
    }
});

// Obtener usuario por id (para edición)
app.get('/usuarios/:id', async (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: "Acceso denegado." });
    }

    const id_usuario = req.params.id;
    try {
        const [rows] = await con.promise().query(
            'SELECT id_usuario, nombre, email, rol FROM usuario WHERE id_usuario = ?',
            [id_usuario]
        );
        if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al obtener usuario" });
    }
});

// Editar usuario por id
app.post('/usuarios/editar/:id', async (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: "Acceso denegado." });
    }

    const id_usuario = req.params.id;
    let { nombre, email, rol } = req.body;

    nombre = sanitizeInput(nombre);
    email = sanitizeInput(email);
    rol = rol === "admin" ? "admin" : "cliente";

    try {
        // validar que no exista otro usuario con el mismo email
        const [existing] = await con.promise().query(
            'SELECT id_usuario FROM usuario WHERE email = ? AND id_usuario != ?',
            [email, id_usuario]
        );
        if (existing.length > 0) {
            return res.status(400).json({ error: "Email ya en uso por otro usuario" });
        }

        await con.promise().query(
            'UPDATE usuario SET nombre = ?, email = ?, rol = ? WHERE id_usuario = ?',
            [nombre, email, rol, id_usuario]
        );

        // devolver usuario actualizado
        const [rows] = await con.promise().query(
            'SELECT id_usuario, nombre, email, rol FROM usuario WHERE id_usuario = ?',
            [id_usuario]
        );

        res.json({ mensaje: "Usuario actualizado correctamente", user: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al actualizar usuario" });
    }
});





// --- Puerto ---
app.listen(10000, () => {
    console.log("Servidor escuchando en el puerto 10000");
});

// Obtener producto por id (para poblar modal de edición)
app.get('/editarProducto/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await con.promise().query('SELECT id_producto, nombre, descripcion, precio, stock, temporada, imagen IS NOT NULL AS tieneImagen FROM producto WHERE id_producto = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
        return res.json(rows[0]);
    } catch (err) {
        console.error('Error obteniendo producto:', err);
        return res.status(500).json({ error: 'Error al obtener producto' });
    }
});
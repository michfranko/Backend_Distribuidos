require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');


const app = express();

// 1. Configuración General del Servidor

// Lista de orígenes permitidos (desarrollo local y producción)
app.use(cors({
  origin: [
    'http://34.122.120.150',
    'http://34.128.148.231'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// --- Configuración de Google Cloud Storage ---
// Asegúrate de que tu entorno de Cloud Run tenga los permisos de IAM correctos
// y que las credenciales estén configuradas automáticamente.
const storageClient = new Storage();
const bucketName = 'portal-media-bucket-123'; // El nombre de tu bucket
const bucket = storageClient.bucket(bucketName);

// --- Configuración de Multer para subida de archivos ---
// Usamos memoryStorage para mantener el archivo en memoria como un buffer
// antes de subirlo a Google Cloud Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB por archivo
});


app.use(express.json());

app.get('/health', (req, res) => {
  res.send('OK');
});

// --- 3. Lógica de Logs Automática ---
const logAction = async (action) => {
  try {
    await pool.query('INSERT INTO logs (action) VALUES ($1)', [action]);
  } catch (error) {
    // Si falla el log, lo mostramos en consola pero no detenemos la operación principal.
    console.error('Error al registrar la acción en logs:', error);
  }
};

// --- 2. Rutas (Endpoints) del API ---

// --- CRUD para Categorías (/api/categories) ---
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name ASC;');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener categorías:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

app.post('/api/categories',
  body('name').notEmpty().withMessage('El nombre es obligatorio.').trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }
    try {
      const { name } = req.body;
      const result = await pool.query('INSERT INTO categories (name) VALUES ($1) RETURNING *', [name]);
      await logAction(`Categoría creada: ${result.rows[0].name}`);
      res.status(201).json({ message: 'Categoría creada con éxito', category: result.rows[0] });
    } catch (error) {
      console.error('Error al crear categoría:', error);
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  }
);

app.put('/api/categories/:id',
  body('name').notEmpty().withMessage('El nombre es obligatorio.').trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }
    try {
      const { id } = req.params;
      const { name } = req.body;
      const result = await pool.query('UPDATE categories SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ message: 'Categoría no encontrada.' });
      }
      await logAction(`Categoría actualizada con ID: ${id}`);
      res.status(200).json({ message: 'Categoría actualizada con éxito' });
    } catch (error) {
      console.error('Error al actualizar categoría:', error);
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  }
);

app.delete('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Categoría no encontrada.' });
    }
    await logAction(`Categoría eliminada con ID: ${id}`);
    res.status(200).json({ message: 'Categoría eliminada con éxito' });
  } catch (error) {
    console.error('Error al eliminar categoría:', error);
    if (error.code === '23503') { // Error de clave foránea
        return res.status(400).json({ message: 'No se puede eliminar la categoría porque tiene recursos asociados.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// --- CRUD para Usuarios (/api/users) ---
app.get('/api/users', async (req, res) => {
  try {
    // Excluimos el campo password de la respuesta por seguridad
    const result = await pool.query('SELECT id, username, email FROM users ORDER BY username ASC;');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

app.post('/api/users',
  body('username').notEmpty().withMessage('El nombre de usuario es obligatorio.'),
  body('email').isEmail().withMessage('El email no es válido.'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }
    try {
      const { username, email, password } = req.body;
      // Hashear la contraseña antes de guardarla
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const result = await pool.query(
        'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username',
        [username, email, hashedPassword]
      );
      await logAction(`Nuevo usuario creado: ${username}`);
      res.status(201).json({ message: 'Usuario creado con éxito', user: result.rows[0] });
    } catch (error) {
      console.error('Error al crear usuario:', error);
      if (error.code === '23505') { // Error de unicidad
        return res.status(400).json({ message: 'El nombre de usuario ya está en uso.' });
      }
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  }
);

app.put('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, password } = req.body;

        // Obtener usuario actual para comparar
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        if (userResult.rowCount === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        const user = userResult.rows[0];
        const newUsername = username || user.username;
        const newEmail = email || user.email;
        let newPassword = user.password;

        // Si se proporciona una nueva contraseña, hashearla
        if (password) {
            const salt = await bcrypt.genSalt(10);
            newPassword = await bcrypt.hash(password, salt);
        }

        await pool.query(
            'UPDATE users SET username = $1, email = $2, password = $3 WHERE id = $4',
            [newUsername, newEmail, newPassword, id]
        );
        await logAction(`Usuario actualizado con ID: ${id}`);
        res.status(200).json({ message: 'Usuario actualizado con éxito' });
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        if (error.code === '23505') {
            return res.status(400).json({ message: 'El nombre de usuario ya está en uso por otra cuenta.' });
        }
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    await logAction(`Usuario eliminado con ID: ${id}`);
    res.status(200).json({ message: 'Usuario eliminado con éxito' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    if (error.code === '23503') {
        return res.status(400).json({ message: 'No se puede eliminar el usuario porque tiene recursos asociados.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// --- CRUD para Recursos (/api/resources) ---
app.get('/api/resources', async (req, res) => {
  try {
    const query = `
      SELECT r.id, r.filename, r.path, r.upload_date, r.user_id, u.username, r.category_id, c.name as category_name
      FROM resources r
      JOIN users u ON r.user_id = u.id
      JOIN categories c ON r.category_id = c.id
      ORDER BY r.upload_date DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener recursos:', error);
    res.status(500).json({ message: 'Error interno del servidor al obtener recursos.' });
  }
});

app.post(
  '/api/resources',
  upload.single('file'), // Middleware de Multer para un solo archivo llamado 'file'
  body('user_id').isInt({ gt: 0 }).withMessage('El ID de usuario debe ser un entero positivo.'),
  body('category_id').isInt({ gt: 0 }).withMessage('El ID de categoría debe ser un entero positivo.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Si hay errores de validación, los retornamos
      return res.status(400).json({ message: errors.array()[0].msg });
    }
    if (!req.file) {
      // Si no se subió ningún archivo, retornamos un error
      return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    const { user_id, category_id } = req.body;
    const filename = req.file.originalname; // Nombre original del archivo

    try {
      // Subir el archivo a Google Cloud Storage
      const blob = bucket.file(`${Date.now()}-${filename.replace(/ /g, "_")}`);
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: req.file.mimetype,
      });

      await new Promise((resolve, reject) => {
        blobStream.on('error', (err) => {
          console.error('Error al subir a GCS:', err);
          reject(new Error('No se pudo subir el archivo.'));
        });

        blobStream.on('finish', () => {
          resolve();
        });

        blobStream.end(req.file.buffer);
      });

      // La URL pública del archivo en GCS
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

      // Guardar la información en la base de datos
      const result = await pool.query('INSERT INTO resources (filename, path, user_id, category_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [filename, publicUrl, user_id, category_id]
      );
      await logAction(`Recurso creado: ${filename} (ID: ${result.rows[0].id})`);
      res.status(201).json({ message: 'Recurso creado con éxito' });
    } catch (error) {
      console.error('Error al guardar en la base de datos:', error);
      if (error.code === '23503') {
        return res.status(400).json({ message: 'El usuario o la categoría especificada no existe.' });
      }
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  }
);

app.put('/api/resources/:id', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, category_id } = req.body;

    // Obtener la ruta del archivo antiguo para poder borrarlo si se sube uno nuevo
    const oldResourceResult = await pool.query('SELECT path FROM resources WHERE id = $1', [id]);
    if (oldResourceResult.rowCount === 0) {
      return res.status(404).json({ message: 'Recurso no encontrado.' });
    }
    const oldPath = oldResourceResult.rows[0].path;

    let newFilename, newPath;
    if (req.file) {
      // 1. Subir el nuevo archivo
      newFilename = req.file.originalname;
      const blob = bucket.file(`${Date.now()}-${newFilename.replace(/ /g, "_")}`);
      const blobStream = blob.createWriteStream({ resumable: false, contentType: req.file.mimetype });

      await new Promise((resolve, reject) => {
        blobStream.on('error', reject);
        blobStream.on('finish', resolve);
        blobStream.end(req.file.buffer);
      });

      newPath = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

      // 2. Borrar el archivo antiguo de GCS si existe
      if (oldPath) {
        try {
          const oldFilenameInBucket = oldPath.split('/').pop();
          await bucket.file(oldFilenameInBucket).delete();
        } catch (gcsError) {
          // Si el archivo no existe en GCS, no es un error crítico.
          console.warn(`No se pudo borrar el archivo antiguo de GCS: ${oldPath}`, gcsError.message);
        }
      }
    }

    // Construimos la consulta dinámicamente para actualizar solo los campos proporcionados
    const fields = [];
    const values = [];
    if (newFilename) {
      fields.push(`filename = $${fields.length + 1}`);
      values.push(newFilename);
    }
    if (newPath) {
      fields.push(`path = $${fields.length + 1}`);
      values.push(newPath);
    }
    if (user_id) { fields.push(`user_id = $${fields.length + 1}`); values.push(user_id); }
    if (category_id) { fields.push(`category_id = $${fields.length + 1}`); values.push(category_id); }

    if (fields.length === 0) return res.status(400).json({ message: 'No hay campos para actualizar.' });

    const query = `UPDATE resources SET ${fields.join(', ')} WHERE id = $${fields.length + 1} RETURNING *`;
    const result = await pool.query(query, [...values, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Recurso no encontrado.' });
    }
    await logAction(`Recurso actualizado con ID: ${id}`);
    res.status(200).json({ message: 'Recurso actualizado con éxito' });
  } catch (error) {
    console.error('Error al actualizar recurso:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

app.delete('/api/resources/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Primero, obtenemos la ruta del archivo para poder borrarlo de GCS
    const resourceResult = await pool.query('SELECT path FROM resources WHERE id = $1', [id]);
    if (resourceResult.rowCount > 0) {
      const path = resourceResult.rows[0].path;
      if (path) {
        try {
          const filenameInBucket = path.split('/').pop();
          await bucket.file(filenameInBucket).delete();
        } catch (gcsError) {
          // Si el archivo no se encuentra en GCS, puede que ya haya sido borrado.
          // Lo registramos pero continuamos para borrar el registro de la BD.
          console.warn(`Archivo no encontrado en GCS para borrar: ${path}`, gcsError.message);
        }
      }
    }

    const result = await pool.query('DELETE FROM resources WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Recurso no encontrado.' });
    }
    await logAction(`Recurso eliminado con ID: ${id}`);
    res.status(200).json({ message: 'Recurso eliminado con éxito' });
  } catch (error) {
    console.error('Error al eliminar recurso:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// --- Endpoint para Logs (/api/logs) ---
app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logs ORDER BY timestamp DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener logs:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0'; // Escucha en todas las interfaces de red

app.listen(port, host, () => {
  // Mostramos la IP 0.0.0.0 que significa que es accesible desde la IP de la máquina
  console.log(`API running on http://${host}:${port}`);
});

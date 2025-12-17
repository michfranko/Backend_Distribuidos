require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');


const app = express();

// 1. Configuración General del Servidor

// Lista de orígenes permitidos (desarrollo local y producción)
const allowedOrigins = ['http://localhost:5173', 'http://34.122.120.150'];

app.use(cors({
  origin: allowedOrigins
}));

app.use(express.json());

app.get('/healthz', (req, res) => {
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
      SELECT r.id, r.filename, r.upload_date, r.user_id, u.username, r.category_id, c.name as category_name
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
  body('filename').notEmpty().withMessage('El nombre del archivo es obligatorio.').trim(),
  body('user_id').isInt({ gt: 0 }).withMessage('El ID de usuario debe ser un entero positivo.'),
  body('category_id').isInt({ gt: 0 }).withMessage('El ID de categoría debe ser un entero positivo.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }

    const { filename, user_id, category_id } = req.body;
    // Generación automática de filepath y upload_date
    const filepath = `/uploads/${filename}`; // Ejemplo de generación de ruta

    try {
      const result = await pool.query(
        'INSERT INTO resources (filename, filepath, user_id, category_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [filename, filepath, user_id, category_id]
      );
      await logAction(`Recurso creado con ID: ${result.rows[0].id}`);
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

app.put('/api/resources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { filename, user_id, category_id } = req.body;

    // Validar que al menos un campo se esté actualizando
    if (!filename && !user_id && !category_id) {
      return res.status(400).json({ message: 'Debe proporcionar al menos un campo para actualizar.' });
    }

    const result = await pool.query('UPDATE resources SET filename = COALESCE($1, filename), user_id = COALESCE($2, user_id), category_id = COALESCE($3, category_id) WHERE id = $4 RETURNING *', [filename, user_id, category_id, id]);

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
    const result = await pool.query('DELETE FROM resources WHERE id = $1', [id]);
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
    const result = await pool.query('SELECT * FROM logs ORDER BY id DESC');
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

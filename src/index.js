require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { body, validationResult } = require('express-validator');


const app = express();

app.use(cors());
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.send('OK');
});

// --- Ruta para obtener todas las categorías ---
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name ASC;');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener categorías:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// --- Ruta para obtener todos los recursos ---
// Hacemos un JOIN para obtener información más útil.
app.get('/api/resources', async (req, res) => {
  try {
    const query = `
      SELECT r.id, r.title, r.filename, r.created_at, u.username, c.name as category_name
      FROM resources r
      JOIN users u ON r.user_id = u.id
      JOIN categories c ON r.category_id = c.id
      ORDER BY r.created_at DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener recursos:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// --- Ruta para crear un recurso con validación ---
app.post(
  '/api/resources',
  // Middlewares de validación
  body('title').notEmpty().withMessage('El título es obligatorio.').trim().escape(),
  body('user_id').isInt({ gt: 0 }).withMessage('El ID de usuario debe ser un entero positivo.'),
  body('category_id').isInt({ gt: 0 }).withMessage('El ID de categoría debe ser un entero positivo.'),
  async (req, res) => {
    // Comprobar si hay errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, user_id, category_id } = req.body;

    try {
      const query = `
        INSERT INTO resources (user_id, category_id, title, filename)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      const values = [
        user_id,
        category_id,
        title,
        'placeholder.txt' // Valor de relleno ya que no hay archivo
      ];
      const result = await pool.query(query, values);
      res.status(201).json({ message: 'Recurso creado con éxito', resource: result.rows[0] });
    } catch (error) {
      console.error('Error al guardar en la base de datos:', error);
      // Error de clave foránea
      if (error.code === '23503') {
        return res.status(400).json({ message: 'El usuario o la categoría especificada no existe.' });
      }
      res.status(500).json({ message: 'Error interno del servidor al crear el recurso.' });
    }
  }
);

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0'; // Escucha en todas las interfaces de red

app.listen(port, host, () => {
  // Mostramos la IP 0.0.0.0 que significa que es accesible desde la IP de la máquina
  console.log(`API running on http://${host}:${port}`);
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const resourcesRoutes = require('../routes/resources');

const app = express();

// --- Configuración de Logging con Morgan ---

// Crear un stream de escritura (en modo 'append') para el archivo de log
const accessLogStream = fs.createWriteStream(path.join(__dirname, '..', 'access.log'), { flags: 'a' });

// Loggear en la consola (formato 'dev') y en el archivo (formato 'combined')
app.use(morgan('dev'));
app.use(morgan('combined', { stream: accessLogStream }));

app.use(cors());
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.send('OK');
});

app.use('/api/resources', resourcesRoutes);

// --- Ruta para visualizar los logs ---
app.get('/logs', (req, res) => {
  const logFilePath = path.join(__dirname, '..', 'access.log');
  fs.readFile(logFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error al leer el archivo de logs.');
    }
    // Enviamos los logs dentro de una etiqueta <pre> para mantener el formato
    res.header('Content-Type', 'text/html').send(`<pre>${data}</pre>`);
  });
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0'; // Escucha en todas las interfaces de red

app.listen(port, host, () => {
  // Mostramos la IP 0.0.0.0 que significa que es accesible desde la IP de la máquina
  console.log(`API running on http://${host}:${port}`);
});

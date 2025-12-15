require('dotenv').config();
const express = require('express');
const cors = require('cors');

const resourcesRoutes = require('../routes/resources');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.send('OK');
});

app.use('/api/resources', resourcesRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API running on port ${port}`);
});

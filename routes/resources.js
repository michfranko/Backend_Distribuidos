const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const pool = require('../src/db')

const router = express.Router()

// 📌 Ruta dinámica (local vs Azure)
const uploadPath =
  process.env.UPLOAD_PATH || path.join(__dirname, '../uploads')

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true })
}

const upload = multer({ dest: uploadPath })

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const { title, user_id, category_id } = req.body

    await pool.query(
      `INSERT INTO resources (title, filename, path, user_id, category_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        title,
        req.file.originalname,
        req.file.path,
        user_id,
        category_id
      ]
    )

    res.json({ ok: true })
  } catch (err) {
    console.error('UPLOAD ERROR:', err)
    res.status(500).json({ error: 'DB error' })
  }
})

module.exports = router

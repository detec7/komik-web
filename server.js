require('dotenv').config(); // BARU: Membuka brankas rahasia
const express = require('express');
const multer = require('multer'); 
// ... (biarkan yang lain tetap sama)
const path = require('path'); 
const mongoose = require('mongoose');
// BARU: Memanggil alat pemroses Cloudinary
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));

// === 1. KONEKSI DATABASE MONGODB ===
const mongoURI = process.env.MONGO_URI; // Mengambil dari file .env

mongoose.connect(mongoURI)
// ...
    .then(() => console.log('Berhasil terhubung ke MongoDB Atlas!'))
    .catch(err => console.error('Gagal terhubung ke MongoDB:', err));

const chapterSchema = new mongoose.Schema({
    judulKomik: String,
    nomorChapter: Number,
    gambar: [String], // Sekarang ini akan berisi link dari Cloudinary
    tanggalDibuat: { type: Date, default: Date.now }
});
const Chapter = mongoose.model('Chapter', chapterSchema);

// === 2. KONFIGURASI CLOUDINARY ===
cloudinary.config({ 
    cloud_name: process.env.CLOUD_NAME, 
    api_key: process.env.API_KEY, 
    api_secret: process.env.API_SECRET 
});

// === 3. SISTEM UPLOAD BARU (Ke Cloudinary) ===
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'komik_uploads', // Nama folder yang akan dibuat otomatis di Cloudinary
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
    },
});
const upload = multer({ storage: storage });

app.get('/', async (req, res) => {
    try {
        const semuaChapter = await Chapter.find().sort({ tanggalDibuat: -1 });
        res.render('index', { listChapter: semuaChapter });
    } catch (err) {
        res.send("Terjadi kesalahan saat memuat halaman utama.");
    }
});

app.get('/dashboard', (req, res) => {
    res.render('admin');
});

// Proses Upload (Sekarang akan memakan waktu lebih lama karena diunggah ke internet)
app.post('/upload-chapter', upload.array('gambarKomik', 500), async (req, res) => {
    
    // Mengurutkan gambar A-Z (Sama seperti sebelumnya)
    let fileYangDiurutkan = req.files.sort((a, b) => {
        return a.originalname.localeCompare(b.originalname, undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    });

    let linkGambar = [];
    fileYangDiurutkan.forEach(file => {
        // BARU: Kita mengambil 'path' yang sekarang berisi URL asli dari Cloudinary
        linkGambar.push(file.path);
    });

    const chapterBaru = new Chapter({
        judulKomik: req.body.judulKomik,
        nomorChapter: req.body.nomorChapter,
        gambar: linkGambar
    });
    
    await chapterBaru.save(); 

    res.send(`
        <div style="background-color: #0b1320; color: white; font-family: sans-serif; padding: 50px; text-align: center; height: 100vh;">
            <h2 style="color: #4ade80;">Berhasil upload ${req.files.length} gambar ke Cloudinary & MongoDB!</h2>
            <br>
            <a href="/" style="padding: 15px 30px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 10px;">Lihat Halaman Utama</a>
            <a href="/dashboard" style="padding: 15px 30px; background: #475569; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Kembali ke Dashboard</a>
        </div>
    `);
});

app.get('/baca/:id', async (req, res) => {
    try {
        const chapterDipilih = await Chapter.findById(req.params.id);
        
        if (!chapterDipilih) {
            return res.send("Chapter tidak ditemukan.");
        }
        res.render('baca', { daftarGambar: chapterDipilih.gambar });
    } catch (error) {
        console.error(error);
        res.send("Terjadi kesalahan saat mengambil data chapter.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berhasil berjalan di port ${PORT}`);
});
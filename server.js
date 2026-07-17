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
    cover: String, // BARU: Untuk menyimpan link Cover
    gambar: [String],
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
        // Mengurutkan dari chapter terbesar ke terkecil
        const semuaChapter = await Chapter.find().sort({ nomorChapter: -1 });
        
        // Mengelompokkan chapter agar tidak berceceran (sesuai Judul)
        const komikGroup = {};
        semuaChapter.forEach(ch => {
            if (!komikGroup[ch.judulKomik]) {
                komikGroup[ch.judulKomik] = {
                    judul: ch.judulKomik,
                    // Jika tidak ada cover, gunakan gambar default
                    cover: ch.cover || 'https://via.placeholder.com/720x1028?text=No+Cover',
                    chapters: []
                };
            }
            komikGroup[ch.judulKomik].chapters.push(ch);
        });

        // Mengubah objek grup menjadi array agar bisa dibaca EJS
        const listKomik = Object.values(komikGroup);
        res.render('index', { listKomik: listKomik });
    } catch (err) {
        res.send("Terjadi kesalahan saat memuat halaman utama.");
    }
});

app.get('/dashboard', (req, res) => {
    res.render('admin');
});

// Menggunakan upload.fields untuk menerima input 'cover' dan 'gambarKomik'
app.post('/upload-chapter', upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'gambarKomik', maxCount: 500 }]), async (req, res) => {
    
    // 1. Mengurutkan dan mengambil link gambar chapter
    let fileYangDiurutkan = req.files['gambarKomik'].sort((a, b) => {
        return a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: 'base' });
    });

    let linkGambar = [];
    fileYangDiurutkan.forEach(file => { linkGambar.push(file.path); });

    // 2. Mengambil link cover (jika diupload)
    let linkCover = '';
    if (req.files['cover'] && req.files['cover'].length > 0) {
        linkCover = req.files['cover'][0].path;
    }

    // 3. Menyimpan semuanya ke Database
    const chapterBaru = new Chapter({
        judulKomik: req.body.judulKomik,
        nomorChapter: req.body.nomorChapter,
        cover: linkCover,
        gambar: linkGambar
    });
    
    await chapterBaru.save(); 

    res.send(`
        <div style="background-color: #0b1320; color: white; padding: 50px; text-align: center; height: 100vh;">
            <h2 style="color: #4ade80;">Berhasil upload Chapter & Cover!</h2><br>
            <a href="/" style="padding: 15px 30px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px;">Lihat Halaman Utama</a>
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
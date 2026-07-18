require('dotenv').config();
const express = require('express');
const multer = require('multer'); 
const path = require('path'); 
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const session = require('express-session'); // Alat untuk sistem Login

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true })); // Wajib agar form login bisa dibaca

// === PENGATURAN SESI LOGIN ===
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// === FUNGSI PENJAGA KEAMANAN (MIDDLEWARE) ===
// Fungsi ini menendang siapa saja yang mencoba mengakses link admin tanpa login
const cekAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        next(); // Boleh masuk
    } else {
        res.redirect('/login'); // Ditendang ke halaman login
    }
};

// === FUNGSI PEMBUAT URL CANTIK (SLUG) ===
const buatSlug = (judul, chapter) => {
    let teks = judul + " ch " + chapter + " bahasa indonesia";
    // 1. Hapus tanda kutip tunggal (') dan ganda (") terlebih dahulu agar tidak jadi strip
    teks = teks.replace(/['"]/g, '');
    // 2. Ubah spasi dan simbol aneh lainnya menjadi strip, lalu jadikan huruf kecil
    return teks.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
};

// === 1. KONEKSI DATABASE MONGODB ===
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
    .then(() => console.log('Berhasil terhubung ke MongoDB Atlas!'))
    .catch(err => console.error('Gagal terhubung ke MongoDB:', err));

// STRUKTUR DATABASE
const chapterSchema = new mongoose.Schema({
    judulKomik: String,
    nomorChapter: Number,
    slug: String, // Untuk URL khusus (contoh: solo-leveling-ch-1)
    cover: String, 
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

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'komik_uploads',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
    },
});
const upload = multer({ storage: storage });


// === 3. ROUTING PUBLIK (BISA DIAKSES SEMUA ORANG) ===

// Halaman Utama
app.get('/', async (req, res) => {
    try {
        const semuaChapter = await Chapter.find().sort({ nomorChapter: -1 });
        const komikGroup = {};
        semuaChapter.forEach(ch => {
            if (!komikGroup[ch.judulKomik]) {
                komikGroup[ch.judulKomik] = {
                    judul: ch.judulKomik,
                    cover: ch.cover || 'https://via.placeholder.com/720x1028?text=No+Cover',
                    chapters: []
                };
            }
            komikGroup[ch.judulKomik].chapters.push(ch);
        });
        const listKomik = Object.values(komikGroup);
        res.render('index', { listKomik: listKomik });
    } catch (err) {
        res.send("Terjadi kesalahan saat memuat halaman utama.");
    }
});

// Halaman Baca (Mencari berdasarkan URL Slug, bukan ID)
app.get('/baca/:slug', async (req, res) => {
    try {
        const chapterDipilih = await Chapter.findOne({ slug: req.params.slug });
        if (!chapterDipilih) {
            return res.send("Chapter tidak ditemukan.");
        }
        res.render('baca', { chapter: chapterDipilih }); 
    } catch (error) {
        res.send("Terjadi kesalahan.");
    }
});

// Sistem Login
app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
    // Mencocokkan dengan brankas rahasia .env
    if (req.body.username === process.env.ADMIN_USER && req.body.password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/dashboard');
    } else {
        res.send('<script>alert("Username atau Password salah!"); window.location.href="/login";</script>');
    }
});

// Sistem Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});


// === 4. ROUTING ADMIN (DIKUNCI OLEH MIDDLEWARE cekAdmin) ===

// Dashboard Upload
app.get('/dashboard', cekAdmin, (req, res) => {
    res.render('admin');
});

// Proses Upload (Terdapat Pembuat URL/Slug)
app.post('/upload-chapter', cekAdmin, upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'gambarKomik', maxCount: 500 }]), async (req, res) => {
    let fileYangDiurutkan = req.files['gambarKomik'].sort((a, b) => {
        return a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: 'base' });
    });

    let linkGambar = [];
    fileYangDiurutkan.forEach(file => { linkGambar.push(file.path); });

    let linkCover = '';
    if (req.files['cover'] && req.files['cover'].length > 0) {
        linkCover = req.files['cover'][0].path;
    }

    const chapterBaru = new Chapter({
        judulKomik: req.body.judulKomik,
        nomorChapter: req.body.nomorChapter,
        slug: buatSlug(req.body.judulKomik, req.body.nomorChapter), // Membuat link unik
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

// Halaman Management
app.get('/management', cekAdmin, async (req, res) => {
    try {
        const semuaChapter = await Chapter.find().sort({ tanggalDibuat: -1 });
        res.render('management', { listChapter: semuaChapter });
    } catch (err) {
        res.send("Terjadi kesalahan saat memuat halaman management.");
    }
});

// Proses Delete
app.post('/delete-chapter/:id', cekAdmin, async (req, res) => {
    try {
        await Chapter.findByIdAndDelete(req.params.id);
        res.redirect('/management');
    } catch (err) {
        res.send("Gagal menghapus chapter.");
    }
});

// Halaman Edit
app.get('/edit-chapter/:id', cekAdmin, async (req, res) => {
    try {
        const chapter = await Chapter.findById(req.params.id);
        res.render('edit', { chapter: chapter });
    } catch (err) {
        res.send("Chapter tidak ditemukan.");
    }
});

// Proses Update
app.post('/update-chapter/:id', cekAdmin, upload.array('gambarKomikBaru', 500), async (req, res) => {
    try {
        const chapterId = req.params.id;
        // Mengambil data lama untuk mengingat Judul Komik agar link Slug-nya tidak rusak
        const chapterLama = await Chapter.findById(chapterId); 
        
        let updateData = { 
            nomorChapter: req.body.nomorChapter,
            slug: buatSlug(chapterLama.judulKomik, req.body.nomorChapter) // Update link jika nomornya diganti
        };

        if (req.files && req.files.length > 0) {
            let fileYangDiurutkan = req.files.sort((a, b) => {
                return a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: 'base' });
            });
            
            let linkGambarBaru = [];
            fileYangDiurutkan.forEach(file => { linkGambarBaru.push(file.path); });
            
            updateData.gambar = linkGambarBaru; 
        }

        await Chapter.findByIdAndUpdate(chapterId, updateData);
        res.redirect('/management'); 
    } catch (err) {
        res.send("Gagal mengupdate chapter.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berhasil berjalan di port ${PORT}`);
});
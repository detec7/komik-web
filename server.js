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
const upload = multer({ 
    storage: storage,
    // Saringan pintar untuk membuang file non-gambar (seperti Thumbs.db) secara diam-diam
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true); // Loloskan jika file adalah gambar
        } else {
            cb(null, false); // Buang jika file bukan gambar tanpa memicu error
        }
    }
});


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

// Dashboard Upload (Untuk Project/Series Baru)
app.get('/dashboard', cekAdmin, (req, res) => {
    res.render('admin');
});

// === PENGAMAN MULTER & PROSES UPLOAD ===
const uploadFields = upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'gambarKomik', maxCount: 500 }]);

app.post('/upload-chapter', cekAdmin, (req, res) => {
    // 1. Membungkus proses Multer agar error tidak menghasilkan layar putih
    uploadFields(req, res, async function (err) {
        if (err) {
            console.error("Cloudinary Error:", err);
            return res.send(`
                <div style="background-color: #0b1320; color: white; padding: 50px; text-align: center; height: 100vh; font-family: sans-serif;">
                    <h2 style="color: #ef4444;">Gagal Upload Gambar!</h2>
                    <p style="color: #94a3b8;">Server atau Cloudinary kewalahan memproses gambar (Timeout/Error).<br>Pesan Error: ${err.message}</p>
                    <a href="/management" style="padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">Kembali</a>
                </div>
            `);
        }

        try {
            // Cek jika tidak ada gambar
            if (!req.files || !req.files['gambarKomik'] || req.files['gambarKomik'].length === 0) {
                return res.send(`
                    <div style="background-color: #0b1320; color: white; padding: 50px; text-align: center; height: 100vh; font-family: sans-serif;">
                        <h2 style="color: #ef4444;">Gagal: Tidak ada gambar valid.</h2>
                        <a href="/management" style="padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">Kembali</a>
                    </div>
                `);
            }

            // Urutkan gambar
            let fileYangDiurutkan = req.files['gambarKomik'].sort((a, b) => {
                return a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: 'base' });
            });
            let linkGambar = fileYangDiurutkan.map(file => file.path);

            // 2. Proteksi Ganda Cover (Menjawab Screenshot_50.png)
            let linkCover = req.body.coverLama;
            if (!linkCover || linkCover.trim() === '') {
                // Jika coverLama kosong/rusak, pasang gambar default
                linkCover = 'https://via.placeholder.com/720x1028?text=No+Cover'; 
            }
            // Jika user mengupload cover baru, timpa yang lama
            if (req.files && req.files['cover'] && req.files['cover'].length > 0) {
                linkCover = req.files['cover'][0].path;
            }

            const chapterBaru = new Chapter({
                judulKomik: req.body.judulKomik,
                nomorChapter: req.body.nomorChapter,
                slug: buatSlug(req.body.judulKomik, req.body.nomorChapter),
                cover: linkCover,
                gambar: linkGambar
            });
            
            await chapterBaru.save(); 

            res.send(`
                <div style="background-color: #0b1320; color: white; padding: 50px; text-align: center; height: 100vh; font-family: sans-serif;">
                    <h2 style="color: #4ade80;">Berhasil upload Chapter!</h2><br>
                    <a href="/management/series/${encodeURIComponent(req.body.judulKomik)}" style="padding: 15px 30px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px;">Kembali ke Daftar Chapter</a>
                </div>
            `);
        } catch (error) {
            console.error(error);
            res.send(`<h2 style="color:red; text-align:center;">Terjadi Kesalahan Database.</h2>`);
        }
    });
});

// Halaman Management (Sekarang Menampilkan Daftar Series)
app.get('/management', cekAdmin, async (req, res) => {
    try {
        const semuaChapter = await Chapter.find().sort({ tanggalDibuat: -1 });
        
        // Mengelompokkan berdasarkan Judul Komik agar rapi
        const komikGroup = {};
        semuaChapter.forEach(ch => {
            if (!komikGroup[ch.judulKomik]) {
                komikGroup[ch.judulKomik] = {
                    judul: ch.judulKomik,
                    cover: ch.cover || 'https://via.placeholder.com/150',
                    jumlahChapter: 0
                };
            }
            komikGroup[ch.judulKomik].jumlahChapter += 1;
        });
        
        const listKomik = Object.values(komikGroup);
        res.render('management', { listKomik: listKomik });
    } catch (err) {
        res.send("Terjadi kesalahan saat memuat halaman management.");
    }
});

// Halaman Daftar Chapter untuk Satu Series Spesifik
app.get('/management/series/:judul', cekAdmin, async (req, res) => {
    try {
        const judul = req.params.judul;
        // Cari semua chapter dengan judul yang sama
        const chapters = await Chapter.find({ judulKomik: judul }).sort({ nomorChapter: -1 });
        
        if (chapters.length === 0) return res.redirect('/management');
        
        res.render('management-chapters', { 
            judul: judul, 
            chapters: chapters,
            coverLama: chapters[0].cover // Membawa cover lama untuk disisipkan ke form tambah chapter
        });
    } catch (err) {
        res.send("Terjadi kesalahan.");
    }
});

// Halaman Form Tambah Chapter Khusus (Pre-filled)
app.get('/tambah-chapter-series/:judul', cekAdmin, async (req, res) => {
    try {
        const judul = req.params.judul;
        const chapterContoh = await Chapter.findOne({ judulKomik: judul });
        if (!chapterContoh) return res.redirect('/management');
        
        res.render('tambah-chapter', { judul: judul, coverLama: chapterContoh.cover });
    } catch (err) {
        res.send("Terjadi kesalahan.");
    }
});

// Proses Delete
app.post('/delete-chapter/:id', cekAdmin, async (req, res) => {
    try {
        await Chapter.findByIdAndDelete(req.params.id);
        // Kembali ke halaman series yang sedang dibuka
        if (req.body.judulKomik) {
            res.redirect('/management/series/' + encodeURIComponent(req.body.judulKomik));
        } else {
            res.redirect('/management');
        }
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
        const chapterLama = await Chapter.findById(chapterId); 
        
        let updateData = { 
            nomorChapter: req.body.nomorChapter,
            slug: buatSlug(chapterLama.judulKomik, req.body.nomorChapter) 
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
        // Kembali ke dalam series, bukan ke halaman depan management
        res.redirect('/management/series/' + encodeURIComponent(chapterLama.judulKomik)); 
    } catch (err) {
        res.send("Gagal mengupdate chapter.");
    }
});

// === 5. API RAHASIA UNTUK GAMBAR (ANTI-MALING) ===
app.get('/api/gambar/:id', async (req, res) => {
    // Mengecek 'KTP' pengunjung (Referer)
    const referer = req.get('Referer');
    
    // Jika tidak ada referer, atau referernya bukan dari website kita, TENDANG!
    if (!referer || !referer.includes(req.get('host'))) {
        return res.status(403).json({ error: "Akses Ditolak! API ini dilindungi." });
    }

    try {
        const chapter = await Chapter.findById(req.params.id);
        if (!chapter) return res.status(404).json({ error: "Chapter tidak ditemukan." });
        
        // Hanya mengirimkan array gambar, bukan data lainnya
        res.json({ gambar: chapter.gambar });
    } catch (error) {
        res.status(500).json({ error: "Terjadi kesalahan server." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berhasil berjalan di port ${PORT}`);
});
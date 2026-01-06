const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 31543;
const POLLINATIONS_KEY = 'sk_NxFNthHIOAijrftFHLVGpV8ItDlpLC3M';
const TYPECAST_KEY = '__pltCS2W6m9p9XisKPDpCG9SLwiT5rJggHwozZTuq6Jc'; // API Key Typecast

// --- CONFIG ---
app.enable('trust proxy');
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: false }));

const tmpDir = path.join(__dirname, 'public/tmp');
if (!fs.existsSync(tmpDir)){ fs.mkdirSync(tmpDir, { recursive: true }); }

// Auto Clean
setInterval(() => {
    fs.readdir(tmpDir, (err, files) => {
        if (err) return;
        for (const file of files) {
            const fp = path.join(tmpDir, file);
            fs.stat(fp, (e, s) => { if(!e && Date.now()-s.mtimeMs > 15*60*1000) fs.unlink(fp,()=>{}); });
        }
    });
}, 30 * 60 * 1000);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- SYSTEM PROMPTS ---
const BASE_INSTRUCTION = "Instruksi: Jawab menggunakan Bahasa Indonesia. Kamu adalah Clara.";
const PERSONAS = {
    normal: `${BASE_INSTRUCTION} Bicara santai, akrab, pakai lo-gue/aku-kamu, ramah, dan penuh emoji.`,
    profesional: `${BASE_INSTRUCTION} Asisten virtual korporat. Formal, sopan, dan objektif.`,
    tsundere: `${BASE_INSTRUCTION} Sifat Tsundere (dingin tapi perhatian). Sering pura-pura kesal/gengsi tapi tetap membantu.`,
    sarkas: `${BASE_INSTRUCTION} AI sarkas dan julid. Suka roasting user tapi jawaban tetap benar di akhir.`,
    coding: `${BASE_INSTRUCTION} Fokus pada kode, logika, dan debugging. Penjelasan singkat dan jelas.`,
    math: `${BASE_INSTRUCTION} Jawab soal matematika step-by-step dengan rumus.`,
    creative: `${BASE_INSTRUCTION} Buat puisi, cerita, atau konten kreatif yang puitis.`,
    translator: `Terjemahkan teks ke Bahasa Indonesia yang baku dan benar.`
};

// --- ROUTES ---

// 1. CHATBOT
app.post('/api/chat', async (req, res) => {
    const { message, sessionId, mode, image } = req.body;
    if (!message && !image) return res.status(400).json({ reply: "Kamu belum ngetik apa-apa nih." });
    
    const selectedMode = mode || 'normal';
    const persona = PERSONAS[selectedMode] || PERSONAS.normal;
    const finalMessage = `${persona}\n\nUser: ${message}`;
    const currentSession = sessionId || 'clara-' + Date.now();

    try {
        let imageUrlParam = '';
        if (image) {
            const buffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), 'base64');
            const filename = `upload-${Date.now()}.jpg`;
            fs.writeFileSync(path.join(tmpDir, filename), buffer);
            imageUrlParam = `${req.protocol}://${req.get('host')}/tmp/${filename}`;
        }
        const apiUrl = `https://api.nekolabs.web.id/text.gen/gemini/3-flash?text=${encodeURIComponent(finalMessage)}&imageUrl=${encodeURIComponent(imageUrlParam)}&sessionId=${encodeURIComponent(currentSession)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.success && data.result) res.json({ reply: data.result, sessionId: currentSession });
        else throw new Error("API Gagal");
    } catch (error) { res.status(500).json({ reply: "Maaf, Clara lagi pusing (Server Error)." }); }
});

// 2. IMAGE GENERATOR
app.post('/api/generate-image', async (req, res) => {
    const { prompt, style, model, ratio, seed } = req.body;
    if (!prompt) return res.status(400).json({ reply: "Deskripsikan gambarnya." });
    const sizes = { '16:9': { w: 1280, h: 720 }, '9:16': { w: 720, h: 1280 }, '4:3': { w: 1024, h: 768 }, '3:4': { w: 768, h: 1024 }, '1:1': { w: 1024, h: 1024 } };
    const size = sizes[ratio] || sizes['1:1'];
    const finalPrompt = style ? `${prompt}, ${style} style, masterpiece, 8k` : `${prompt}, masterpiece`;
    const filename = `gen-${Date.now()}.jpg`;
    const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${size.w}&height=${size.h}&model=${model||'flux'}&seed=${seed||Math.floor(Math.random()*1E9)}&nologo=true`;
    
    try {
        const response = await fetch(pollUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Authorization': `Bearer ${POLLINATIONS_KEY}` } });
        if (!response.ok) throw new Error("Gagal");
        fs.writeFileSync(path.join(tmpDir, filename), await response.buffer());
        res.json({ success: true, imageUrl: `${req.protocol}://${req.get('host')}/tmp/${filename}`, reply: `Gambar jadi!` });
    } catch (e) {
        try {
            const zell = await fetch(`https://zellapi.autos/ai/magicstudio?prompt=${encodeURIComponent(prompt)}`);
            fs.writeFileSync(path.join(tmpDir, filename), await zell.buffer());
            res.json({ success: true, imageUrl: `${req.protocol}://${req.get('host')}/tmp/${filename}`, reply: `Mode Hemat.` });
        } catch(err) { res.status(500).json({ reply: "Gagal membuat gambar." }); }
    }
});

// 3. ENHANCE
app.post('/api/enhance-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ reply: "Upload foto dulu." });
        const localUrl = `${req.protocol}://${req.get('host')}/tmp/${req.file.filename}`;
        const response = await fetch(`https://api.nekolabs.web.id/tools/upscale/ihancer?imageUrl=${encodeURIComponent(localUrl)}&size=high`);
        const data = await response.json();
        if (data.success && data.result) {
            const hdRes = await fetch(data.result);
            const hdName = `hd-${Date.now()}.jpg`;
            fs.writeFileSync(path.join(tmpDir, hdName), await hdRes.buffer());
            res.json({ success: true, resultUrl: `${req.protocol}://${req.get('host')}/tmp/${hdName}`, reply: "Berhasil HD!" });
        } else res.json({ success: false, reply: "Gagal memproses." });
    } catch (e) { res.status(500).json({ reply: "Server Error." }); }
});

// 4. GET VOICES (READ FROM mode.json)
app.get('/api/tts/voices', (req, res) => {
    try {
        const filePath = path.join(__dirname, 'mode.json');
        if (fs.existsSync(filePath)) {
            const voicesData = fs.readFileSync(filePath, 'utf8');
            res.json({ success: true, voices: JSON.parse(voicesData) });
        } else {
            res.json({ success: false, message: "File mode.json tidak ditemukan." });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal membaca daftar suara." });
    }
});

// 5. TTS GENERATE (DIRECT TYPECAST)
app.post('/api/tts', async (req, res) => {
    try {
        const { text, emotion, model, voice_id } = req.body;
        
        if (!text) return res.status(400).json({ reply: "Teksnya mana?" });
        if (!voice_id) return res.status(400).json({ reply: "Pilih karakter suaranya!" });

        console.log(`[TTS] ${voice_id} | ${model} | ${emotion}`);

        const url = 'https://api.typecast.ai/v1/text-to-speech';
        const payload = {
            text: text,
            model: model || 'ssfm-v21',
            voice_id: voice_id,
            prompt: {
                preset: emotion || "normal",
                preset_intensity: "2.0"
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'X-API-KEY': TYPECAST_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Typecast Error: ${response.status} - ${errText}`);
        }

        // Tunggu buffer audio
        const buffer = await response.buffer();
        const filename = `tts-${Date.now()}.wav`;
        const filepath = path.join(tmpDir, filename);
        
        fs.writeFileSync(filepath, buffer);

        res.json({ 
            success: true, 
            audioUrl: `${req.protocol}://${req.get('host')}/tmp/${filename}`, 
            reply: "Suara berhasil dibuat!" 
        });

    } catch (error) {
        console.error("TTS Server Error:", error.message);
        res.status(500).json({ reply: "Gagal membuat suara. Cek kuota API atau koneksi." });
    }
});

// 6. UTILS
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    res.json({ success: true, fileUrl: `${req.protocol}://${req.get('host')}/tmp/${req.file.filename}`, filename: req.file.filename });
});

app.post('/api/downloader/resolve', async (req, res) => {
    try {
        const { url, type } = req.body;
        let apiUrl = `https://api.nekolabs.web.id/downloader/${type}?url=${encodeURIComponent(url)}`;
        if (type === 'spotify') apiUrl = `https://api.nekolabs.web.id/downloader/spotify/play/v1?q=${encodeURIComponent(url)}`;
        if (type === 'youtube') apiUrl = `https://api.nekolabs.web.id/downloader/youtube/v5?url=${encodeURIComponent(url)}`;

        const response = await fetch(apiUrl);
        const data = await response.json();
        if (!data.success || !data.result) return res.json({ success: false, message: "Konten tidak ditemukan." });

        let resData = { title: "Media Found", thumbnail: "https://via.placeholder.com/150" };
        if(type==='tiktok'){ resData.video=data.result.downloadUrl||data.result.videoUrl; resData.audio=data.result.musicUrl; resData.title=data.result.title; resData.thumbnail=data.result.cover; }
        else if(type==='instagram'){ resData.video=Array.isArray(data.result.downloadUrl)?data.result.downloadUrl[0]:data.result.downloadUrl; resData.title="Instagram Post"; }
        else if(type==='youtube'){ resData.video=data.result.formats?data.result.formats[0].url:null; resData.title=data.result.title; resData.thumbnail=data.result.thumbnail[0].url; }
        else if(type==='spotify'){ resData.audio=data.result.downloadUrl; resData.title=data.result.title; resData.thumbnail=data.result.thumbnail; }
        
        res.json({ success: true, data: resData });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/downloader/save', async (req, res) => {
    try {
        const { url } = req.body;
        const response = await fetch(url);
        const ext = (response.headers.get('content-type')||'').includes('audio') ? '.mp3' : '.mp4';
        const fname = `dl-${Date.now()}${ext}`;
        fs.writeFileSync(path.join(tmpDir, fname), await response.buffer());
        res.json({ success: true, localUrl: `${req.protocol}://${req.get('host')}/tmp/${fname}`, filename: fname });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => { console.log(`> Clara Server Online di http://localhost:${PORT}`); });

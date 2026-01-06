const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = 31543;
const POLLINATIONS_KEY = 'sk_NxFNthHIOAijrftFHLVGpV8ItDlpLC3M';
const TYPECAST_KEY = '__pltCS2W6m9p9XisKPDpCG9SLwiT5rJggHwozZTuq6Jc'; 

// --- CONFIG ---
app.enable('trust proxy');
// Set limit 50MB
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
            fs.stat(fp, (e, s) => { if(!e && Date.now()-s.mtimeMs > 30*60*1000) fs.unlink(fp,()=>{}); });
        }
    });
}, 30 * 60 * 1000);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});

// Limit multer size to 50MB
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } 
});

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

// --- HELPER FUNCTION: VIDEO HD ---
async function videoHD_NoDisk(videoBuffer, fileName, authorization = '') {
    // 1. Get Upload Slot
    const formSlot = new FormData();
    formSlot.append('video_file_name', fileName);
    const slotRes = await axios.post(
        'https://api.unblurimage.ai/api/upscaler/v1/ai-video-enhancer/upload-video',
        formSlot,
        {
            headers: {
                ...formSlot.getHeaders(),
                'origin': 'https://imgupscaler.ai',
                'user-agent': 'Gienetic/1.2.0 Mobile',
                'accept': '*/*'
            }
        }
    );
    const slot = slotRes.data.result;
    
    // 2. Upload to Slot
    const stream = Readable.from(videoBuffer); 
    const size = videoBuffer.length; 

    await axios.put(slot.url, stream, {
        headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': size 
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
    
    const videoUrl = `https://cdn.unwatermark.ai/${slot.object_name}`;
    
    // 3. Create Job
    const serialRandom = crypto.randomUUID(); 
    const formJob = new FormData();
    formJob.append('original_video_file', videoUrl);
    formJob.append('is_preview', 'false');

    const jobRes = await axios.post(
        'https://api.unblurimage.ai/api/upscaler/v2/ai-video-enhancer/create-job',
        formJob,
        {
            headers: {
                ...formJob.getHeaders(),
                'origin': 'https://imgupscaler.ai',
                'user-agent': 'Gienetic/1.2.0 Mobile',
                'accept': '*/*',
                'product-serial': serialRandom,
                'authorization': authorization
            }
        }
    );

    const jobId = jobRes.data.result ? jobRes.data.result.job_id : null;
    if (!jobId) throw new Error('Gagal membuat job HD');
    
    // 4. Polling Status
    let attempts = 0;
    while (attempts < 60) { // Max 5 menit (60 * 5s)
        const statusRes = await axios.get(
            `https://api.unblurimage.ai/api/upscaler/v2/ai-video-enhancer/get-job/${jobId}`,
            {
                headers: {
                    'origin': 'https://imgupscaler.ai',
                    'user-agent': 'Gienetic/1.2.0 Mobile',
                    'accept': '*/*'
                }
            }
        );

        const result = statusRes.data.result;
        if (result && result.output_url) return result.output_url;
        if (result && result.job_status === 'failed') throw new Error('Proses gagal di server AI.');
        
        attempts++;
        await new Promise(r => setTimeout(r, 5000)); 
    }
    throw new Error('Timeout: Proses terlalu lama.');
}

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
        res.json({ success: true, imageUrl: `${req.protocol}://${req.get('host')}/tmp/${filename}`, reply: `Gambar jadi!`, filename: filename });
    } catch (e) { res.status(500).json({ reply: "Gagal membuat gambar." }); }
});

// 3. IMAGE ENHANCER
app.post('/api/enhance-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ reply: "Upload foto dulu." });
        const provider = req.body.provider || 'nekolabs'; 
        const localUrl = `${req.protocol}://${req.get('host')}/tmp/${req.file.filename}`;
        let targetUrl = '';
        
        if (provider === 'baguss') {
            const apiUrl = `https://api.baguss.xyz/api/edits/remini?image=${encodeURIComponent(localUrl)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            if (data.status && data.result && data.result.success) targetUrl = data.result.url;
            else throw new Error('API Baguss Gagal');
        } else {
            const response = await fetch(`https://api.nekolabs.web.id/tools/upscale/ihancer?imageUrl=${encodeURIComponent(localUrl)}&size=high`);
            const data = await response.json();
            if (data.success && data.result) targetUrl = data.result;
            else throw new Error('API Nekolabs Gagal');
        }

        const hdRes = await fetch(targetUrl);
        const hdName = `hd-${Date.now()}.png`;
        fs.writeFileSync(path.join(tmpDir, hdName), await hdRes.buffer());
        
        res.json({ success: true, resultUrl: `${req.protocol}://${req.get('host')}/tmp/${hdName}`, filename: hdName, reply: "Berhasil HD!" });
    } catch (e) { res.status(500).json({ reply: "Gagal memproses gambar." }); }
});

// 4. VIDEO UPSCALER (NEW)
app.post('/api/video-upscale', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ reply: "Upload video dulu!" });
        
        // Baca file dari disk ke buffer karena API butuh buffer/stream
        const videoPath = req.file.path;
        const videoBuffer = fs.readFileSync(videoPath);
        const fileName = req.file.filename;

        // Panggil Logic Video HD
        const hdUrl = await videoHD_NoDisk(videoBuffer, fileName);
        
        // Download Hasil Video ke Server Lokal
        const dlRes = await axios.get(hdUrl, { responseType: 'arraybuffer' });
        const resultName = `hd-vid-${Date.now()}.mp4`;
        fs.writeFileSync(path.join(tmpDir, resultName), dlRes.data);

        res.json({
            success: true,
            videoUrl: `${req.protocol}://${req.get('host')}/tmp/${resultName}`,
            filename: resultName,
            reply: "Video berhasil di-upscale ke HD!"
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ reply: e.message || "Gagal memproses video." });
    }
});

// 5. GET VOICES
app.get('/api/tts/voices', (req, res) => {
    try {
        if (fs.existsSync(path.join(__dirname, 'mode.json'))) {
            res.json({ success: true, voices: JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8')) });
        } else res.json({ success: false });
    } catch (error) { res.status(500).json({ success: false }); }
});

// 6. TTS GENERATE
app.post('/api/tts', async (req, res) => {
    try {
        const { text, emotion, model, voice_id } = req.body;
        if (!text) return res.status(400).json({ reply: "Teksnya mana?" });
        const response = await fetch('https://api.typecast.ai/v1/text-to-speech', {
            method: 'POST',
            headers: { 'X-API-KEY': TYPECAST_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model: model || 'ssfm-v21', voice_id, prompt: { preset: emotion || "normal", preset_intensity: "2.0" } })
        });
        if (!response.ok) throw new Error(`Typecast Error`);
        const filename = `tts-${Date.now()}.wav`;
        fs.writeFileSync(path.join(tmpDir, filename), await response.buffer());
        res.json({ success: true, audioUrl: `${req.protocol}://${req.get('host')}/tmp/${filename}`, reply: "Suara berhasil dibuat!" });
    } catch (error) { res.status(500).json({ reply: "Gagal membuat suara." }); }
});

// 7. UTILS
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
        res.json({ success: true, localUrl: `${req.protocol}://${req.get('host')}/tmp/${fname}`,qp_filename: fname });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => { console.log(`> Clara Server Online di http://localhost:${PORT}`); });

let currentMode = 'dashboard';
let currentPersona = 'normal';
let activeSessionId = null;
let currentChatImageBase64 = null;
let loaderInterval = null;

// --- DYNAMIC VOICES LOADING ---
async function loadVoices() {
    try {
        const response = await fetch('/api/tts/voices');
        const data = await response.json();
        if (data.success) {
            const voiceSelect = document.getElementById('tts-voice');
            voiceSelect.innerHTML = '';
            data.voices.forEach(v => {
                const option = document.createElement('option');
                option.value = v.voice_id;
                option.text = v.voice_name;
                option.dataset.emotions = JSON.stringify(v.emotions);
                voiceSelect.appendChild(option);
            });
            updateEmotionList();
        }
    } catch (e) { console.error("Server Error:", e); }
}

function updateEmotionList() {
    const voiceSelect = document.getElementById('tts-voice');
    const emotionSelect = document.getElementById('tts-emotion');
    const selectedOption = voiceSelect.options[voiceSelect.selectedIndex];

    if (selectedOption) {
        const emotions = JSON.parse(selectedOption.dataset.emotions || '["normal"]');
        emotionSelect.innerHTML = '';
        emotions.forEach(emo => {
            const opt = document.createElement('option');
            opt.value = emo;
            opt.text = emo.charAt(0).toUpperCase() + emo.slice(1);
            emotionSelect.appendChild(opt);
        });
    }
}

window.onload = function() { loadVoices(); };

// --- LOADER LOGIC ---
function toggleLoader(show, message = "Sedang Di Proses...") { 
    const l = document.getElementById('global-loader'); 
    const msg = document.getElementById('loader-msg');
    const pct = document.getElementById('spinner-percent');

    if (show) {
        l.classList.add('active'); 
        msg.innerText = message;
        
        // Reset Percentage
        let p = 0;
        pct.innerText = "0%";
        if(loaderInterval) clearInterval(loaderInterval);
        
        // Simulate progress up to 90% (Fake because we don't have websocket)
        loaderInterval = setInterval(() => {
            if(p < 90) {
                p++;
                pct.innerText = p + "%";
            }
        }, 300); 
    } else { 
        // Finish it
        pct.innerText = "100%";
        setTimeout(() => {
            l.classList.remove('active'); 
            if(loaderInterval) clearInterval(loaderInterval);
        }, 300);
    } 
}

// --- CHAT LOGIC ---
function handleChatImage(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            currentChatImageBase64 = e.target.result;
            document.getElementById('chat-img-preview').src = currentChatImageBase64;
            document.getElementById('chat-img-preview-container').style.display = 'block';
        }
        reader.readAsDataURL(file);
    }
}
function clearChatImage() {
    currentChatImageBase64 = null;
    document.getElementById('chat-file-input').value = '';
    document.getElementById('chat-img-preview-container').style.display = 'none';
}

async function sendMessage() {
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    if (!message && !currentChatImageBase64) return;
    addMessage('user', message, currentChatImageBase64);
    userInput.value = ''; userInput.style.height = '24px';
    const imageToSend = currentChatImageBase64;
    clearChatImage(); scrollToBottom();
    const loadingId = addLoadingMessage(); scrollToBottom();
    
    // Increment Usage
    incUsage();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message, sessionId: activeSessionId, mode: currentPersona, image: imageToSend }) 
        });
        const data = await response.json();
        removeMessage(loadingId); addMessage('bot', data.reply);
        if (data.sessionId) activeSessionId = data.sessionId;
        scrollToBottom();
    } catch (error) { removeMessage(loadingId); addMessage('bot', 'Error koneksi...'); }
}

function addMessage(sender, text, imageUrl = null) {
    const chatContainer = document.getElementById('chat-container');
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let content = "";
    if (imageUrl) content += `<img src="${imageUrl}" style="max-width: 200px; border-radius: 10px; margin-bottom: 5px; display:block;">`;
    if (text) content += `<span class="text">${formatText(text)}</span>`;
    div.innerHTML = `<div class="bubble">${content}<span class="time">${time}</span></div>`;
    chatContainer.appendChild(div);
}

const userInputElement = document.getElementById('user-input');
if(userInputElement) {
    userInputElement.addEventListener('input', function() {
        this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; 
        if(this.value === '') this.style.height = '24px';
    });
    userInputElement.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
}
function startLoadingTransition() {
    document.getElementById('landing-page').style.display = 'none';
    const transitionScreen = document.getElementById('loading-transition');
    transitionScreen.style.display = 'flex';
    const bar = document.getElementById('progress-bar');
    const percentText = document.getElementById('loading-percentage');
    let width = 0;
    const interval = setInterval(() => {
        if (width >= 100) {
            clearInterval(interval);
            setTimeout(() => {
                transitionScreen.style.display = 'none';
                document.getElementById('app-main').style.display = 'flex';
                if(window.visualViewport) adjustVisualViewport();
                
                // Trigger Promo
                setTimeout(openPromo, 1000); 

            }, 500);
        } else { width++; bar.style.width = width + '%'; percentText.innerText = width + '%'; }
    }, 30);
}

function showCustomAlert(msg) { document.getElementById('custom-alert-overlay').style.display = 'flex'; document.getElementById('custom-alert-msg').innerText = msg; }
function closeCustomAlert() { document.getElementById('custom-alert-overlay').style.display = 'none'; }
function toggleSidebar() { const s = document.getElementById('sidebar'); s.classList.toggle('open'); document.getElementById('overlay').classList.toggle('active', s.classList.contains('open')); }
function openSettings() { if (currentMode !== 'chat') return; document.getElementById('settings-modal').classList.add('active'); document.getElementById('overlay').classList.add('active'); }
function closeSettings() { document.getElementById('settings-modal').classList.remove('active'); checkOverlay(); }
function closeAllMenus() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('settings-modal').classList.remove('active'); checkOverlay(); }
function checkOverlay(){ if(!document.getElementById('sidebar').classList.contains('open') && !document.getElementById('settings-modal').classList.contains('active')) document.getElementById('overlay').classList.remove('active'); }
function scrollToBottom() { const c = document.getElementById('chat-container'); if(c) c.scrollTop = c.scrollHeight; }

// --- SUPPORT & PROMO ---
function openSupport() { document.getElementById('support-modal').style.display = 'flex'; }
function openPromo() { document.getElementById('promo-popup').style.display = 'flex'; }
function closePromo() { document.getElementById('promo-popup').style.display = 'none'; }

function changeMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.menu-list li').forEach(li => li.classList.remove('active'));
    
    // Order: 0:Dashboard, 1:Chat, 2:Enhance, 3:Video, 4:Download, 5:Upload, 6:ImgGen, 7:TTS
    const list = document.querySelectorAll('.menu-list li');
    const headerTitle = document.getElementById('header-title');
    const status = document.getElementById('header-status');
    
    ['dashboard-view', 'chat-view', 'image-view', 'enhance-view', 'video-view', 'uploader-view', 'downloader-view', 'tts-view'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = 'none';
    });

    if(mode === 'dashboard') {
        list[0].classList.add('active'); headerTitle.innerText = 'Dashboard'; status.innerText = 'System Monitor';
        document.getElementById('dashboard-view').style.display = 'flex'; updateDashStats();
    }
    else if(mode === 'chat') { 
        list[1].classList.add('active'); headerTitle.innerText = 'AI Chatbot'; status.innerText = 'Online'; 
        document.getElementById('chat-view').style.display = 'flex'; setTimeout(scrollToBottom, 100); 
    }
    else if(mode === 'enhance') { 
        list[2].classList.add('active'); headerTitle.innerText = 'Photo Enhancer'; status.innerText = 'HD Tool'; 
        document.getElementById('enhance-view').style.display = 'flex'; 
    }
    else if(mode === 'video') { 
        list[3].classList.add('active'); headerTitle.innerText = 'Video Upscaler'; status.innerText = 'AI Video'; 
        document.getElementById('video-view').style.display = 'flex'; 
    }
    else if(mode === 'downloader') { 
        list[4].classList.add('active'); headerTitle.innerText = 'Media Download'; status.innerText = 'Multi-Tools'; 
        document.getElementById('downloader-view').style.display = 'flex'; 
    }
    else if(mode === 'uploader') { 
        list[5].classList.add('active'); headerTitle.innerText = 'Temp File Cloud'; status.innerText = 'Storage'; 
        document.getElementById('uploader-view').style.display = 'flex'; 
    }
    else if(mode === 'image') { 
        list[6].classList.add('active'); headerTitle.innerText = 'AI Image Gen'; status.innerText = 'Creative'; 
        document.getElementById('image-view').style.display = 'flex'; 
    }
    else if(mode === 'tts') { 
        list[7].classList.add('active'); headerTitle.innerText = 'Text To Speech'; status.innerText = 'Typecast'; 
        document.getElementById('tts-view').style.display = 'flex'; 
    }
    closeAllMenus();
}

function addLoadingMessage() {
    const c = document.getElementById('chat-container');
    const d = document.createElement('div'); d.className = 'message bot'; d.id = 'loading-bubble';
    d.innerHTML = `<div class="bubble loading"><div class="typing"><span></span><span></span><span></span></div></div>`;
    c.appendChild(d); return d.id;
}
function removeMessage(id) { const el = document.getElementById(id); if (el) el.remove(); }
function selectPersona(persona, element) { currentPersona = persona; document.querySelectorAll('.persona-item').forEach(item => item.classList.remove('active')); element.classList.add('active'); }
function formatText(text) { if(!text) return ""; return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>'); }
function adjustVisualViewport() { const app = document.querySelector('.app-container'); if (!app) return; if (window.visualViewport) { app.style.height = `${window.visualViewport.height}px`; setTimeout(scrollToBottom, 100); } else { app.style.height = `${window.innerHeight}px`; } }
if (window.visualViewport) { window.visualViewport.addEventListener('resize', adjustVisualViewport); window.visualViewport.addEventListener('scroll', adjustVisualViewport); } else { window.addEventListener('resize', adjustVisualViewport); }
if(userInputElement) { userInputElement.addEventListener('focus', () => { setTimeout(() => { scrollToBottom(); document.getElementById('chat-view').scrollIntoView(false); }, 300); }); }

// --- IMAGE GENERATOR ---
async function generateImage() {
    const prompt = document.getElementById('img-prompt').value.trim();
    const style = document.getElementById('img-style').value;
    const model = document.getElementById('img-model').value;
    const ratio = document.getElementById('img-ratio').value;
    const seed = document.getElementById('img-seed').value; 
    if (!prompt) { showCustomAlert("Isi deskripsi dulu!"); return; }
    
    const previewBox = document.getElementById('image-preview');
    const downloadBtn = document.getElementById('download-btn');
    toggleLoader(true, "Sedang Menggambar...");
    incUsage(); // Stats
    
    const oldImg = previewBox.querySelector('img'); if(oldImg) oldImg.remove();
    downloadBtn.style.display = 'none'; previewBox.style.display = 'flex';
    
    try {
        const response = await fetch('/api/generate-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, style, model, ratio, seed }) 
        });
        const data = await response.json();
        toggleLoader(false);
        if (data.success) {
            const img = document.createElement('img'); img.src = data.imageUrl;
            img.onload = () => { downloadBtn.href = data.imageUrl; downloadBtn.download = data.filename || 'image.jpg'; downloadBtn.style.display = 'flex'; };
            previewBox.appendChild(img); showCustomAlert(data.reply);
        } else { showCustomAlert(data.reply); }
    } catch (e) { toggleLoader(false); showCustomAlert("Server Error"); }
}

async function resolveMedia() {
    const url = document.getElementById('dl-url').value.trim(); const type = document.getElementById('dl-type').value;
    if(!url) { showCustomAlert("Link kosong!"); return; }
    toggleLoader(true, "Mencari Media...");
    incUsage(); // Stats
    try {
        const response = await fetch('/api/downloader/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, type }) });
        const res = await response.json(); toggleLoader(false);
        if(res.success) {
            document.getElementById('dl-result-card').style.display='block'; document.getElementById('dl-title').innerText = res.data.title; document.getElementById('dl-thumb').src = res.data.thumbnail;
            const btnWrap = document.getElementById('dl-buttons-wrapper'); btnWrap.innerHTML = '';
            if(res.data.video) btnWrap.innerHTML += `<a class="dl-btn" onclick="dlSave('${res.data.video}')" href="#">Video</a>`;
            if(res.data.audio) btnWrap.innerHTML += `<a class="dl-btn" onclick="dlSave('${res.data.audio}')" href="#">Audio</a>`;
        } else showCustomAlert("Gagal");
    } catch(e) { toggleLoader(false); }
}

async function dlSave(url) {
    toggleLoader(true, "Mengunduh File...");
    try {
        const res = await fetch('/api/downloader/save', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url})});
        const data = await res.json(); toggleLoader(false);
        if(data.success) { const a=document.createElement('a'); a.href=data.localUrl; a.download=data.filename; a.click(); }
    } catch(e){ toggleLoader(false); }
}

async function handleGeneralUpload(input) {
    if(!input.files[0]) return;
    const fd = new FormData(); fd.append('file', input.files[0]);
    toggleLoader(true, "Mengupload File...");
    incUsage(); // Stats
    const res = await fetch('/api/upload', {method:'POST', body:fd});
    const data = await res.json(); toggleLoader(false);
    if(data.success) { document.getElementById('upload-result').style.display='block'; document.getElementById('file-url-output').value = data.fileUrl; }
}

function copyUrl() { const t = document.getElementById("file-url-output"); t.select(); navigator.clipboard.writeText(t.value); showCustomAlert("Copied"); }

// --- IMAGE ENHANCER LOGIC ---
function previewEnhanceFile(input) {
    if(input.files && input.files[0]) { 
        const file = input.files[0];
        document.getElementById('enhance-placeholder').style.display = 'none';
        document.getElementById('enhance-file-info').style.display = 'flex';
        document.getElementById('enhance-filename').innerText = file.name;
        document.getElementById('enhance-actions').style.display = 'none';
    }
}
async function processEnhance() {
    const f = document.getElementById('enhance-file'); const apiSelect = document.getElementById('enhance-api');
    if(!f.files[0]) { showCustomAlert("Pilih file dulu!"); return; }
    toggleLoader(true, "Meningkatkan Kualitas..."); 
    incUsage(); // Stats
    const fd = new FormData(); fd.append('image', f.files[0]); fd.append('provider', apiSelect.value);
    try {
        const res = await fetch('/api/enhance-image', {method:'POST', body:fd});
        const data = await res.json(); 
        toggleLoader(false);
        if(data.success) { 
            document.getElementById('enhance-filename').innerText = data.filename || 'enhanced-image.png';
            document.getElementById('enhance-actions').style.display = 'flex';
            document.getElementById('btn-view-result').href = data.resultUrl;
            const btnDL = document.getElementById('btn-download-result'); btnDL.href = data.resultUrl; btnDL.download = data.filename || 'clara-hd.png';
            showCustomAlert(data.reply);
        } else { showCustomAlert(data.reply); }
    } catch(e) { toggleLoader(false); showCustomAlert("Error memproses gambar."); }
}

// --- VIDEO UPSCALER LOGIC ---
function previewVideoFile(input) {
    if(input.files && input.files[0]) {
        const file = input.files[0];
        document.getElementById('video-file-info').style.display = 'block';
        document.getElementById('video-filename').innerText = file.name;
        document.getElementById('video-result-box').style.display = 'none';
    }
}

async function processVideoUpscale() {
    const f = document.getElementById('video-file');
    if(!f.files[0]) { showCustomAlert("Pilih video dulu!"); return; }
    if(f.files[0].size > 50 * 1024 * 1024) { showCustomAlert("File max 50MB!"); return; }

    toggleLoader(true, "Video sedang diproses AI... (Bisa 1-5 Menit)");
    incUsage(); // Stats
    const fd = new FormData();
    fd.append('video', f.files[0]);

    try {
        const res = await fetch('/api/video-upscale', { method: 'POST', body: fd });
        const data = await res.json();
        toggleLoader(false);

        if(data.success) {
            document.getElementById('video-result-box').style.display = 'block';
            
            // Set Link Download
            const dlBtn = document.getElementById('btn-download-video');
            dlBtn.href = data.videoUrl;
            dlBtn.download = data.filename;

            // Set Link View (New)
            const viewBtn = document.getElementById('btn-view-video');
            viewBtn.href = data.videoUrl;

            showCustomAlert(data.reply);
        } else {
            showCustomAlert(data.reply);
        }
    } catch(e) {
        toggleLoader(false);
        showCustomAlert("Gagal memproses video (Timeout/Error).");
    }
}

// --- TTS LOGIC ---
async function generateTTS() {
    const text = document.getElementById('tts-text').value.trim();
    const voice_id = document.getElementById('tts-voice').value;
    const emotion = document.getElementById('tts-emotion').value;
    const model = document.getElementById('tts-model').value;
    const playerContainer = document.getElementById('tts-player-container');
    const audio = document.getElementById('tts-audio');
    const dlBtn = document.getElementById('tts-download');
    
    if (!text) { showCustomAlert("Isi teksnya dulu!"); return; }
    toggleLoader(true, "Membuat Suara...");
    incUsage(); // Stats
    playerContainer.style.display = 'none';

    try {
        const response = await fetch('/api/tts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice_id, emotion, model }) 
        });
        const data = await response.json();
        toggleLoader(false);
        if (data.success) {
            audio.src = data.audioUrl; dlBtn.href = data.audioUrl; dlBtn.download = `clara-voice-${Date.now()}.wav`;
            playerContainer.style.display = 'block'; audio.play(); showCustomAlert(data.reply);
        } else { showCustomAlert(data.reply); }
    } catch (e) { toggleLoader(false); showCustomAlert("Gagal koneksi server."); }
}

// --- DASHBOARD & TYPING LOGIC (NEW) ---
const typeTexts = ["Clara adalah AI asisten serbaguna.", "Bisa HD-kan foto buram jadi jernih.", "Download video TikTok/IG tanpa watermark.", "Teman ngobrol yang asik dan pintar."];
let txtIdx = 0, charIdx = 0, isDel = false;

function typeEffect() {
    const el = document.getElementById('typing-text');
    if(!el) return;
    const current = typeTexts[txtIdx];
    el.innerHTML = current.substring(0, charIdx) + '<span class="cursor-blink"></span>';
    
    let speed = isDel ? 30 : 50;
    if(!isDel && charIdx === current.length) { speed = 2000; isDel = true; }
    else if(isDel && charIdx === 0) { isDel = false; txtIdx = (txtIdx+1)%typeTexts.length; speed = 500; }
    
    charIdx += isDel ? -1 : 1;
    setTimeout(typeEffect, speed);
}

let usageCount = localStorage.getItem('claraUsage') || 0;

function updateDashStats() {
    // Fake Stats Simulation
    const elMem = document.getElementById('dash-memory');
    const elStor = document.getElementById('dash-storage');
    if(elMem) elMem.innerText = (Math.random()*(4.5-3.5)+3.5).toFixed(1) + " GB";
    if(elStor) elStor.innerText = Math.floor(Math.random()*(65-55)+55) + "%";
    
    const elUsage = document.getElementById('dash-usage');
    if(elUsage) elUsage.innerText = usageCount;

    // Get IP Real
    fetch('https://api.ipify.org?format=json').then(r=>r.json())
    .then(d => { const el = document.getElementById('dash-ip'); if(el) el.innerText = d.ip; })
    .catch(() => { const el = document.getElementById('dash-ip'); if(el) el.innerText = "Offline"; });
}

// Uptime Counter
const startT = Date.now();
setInterval(() => {
    if(currentMode !== 'dashboard') return;
    const d = new Date(Date.now() - startT);
    const el = document.getElementById('dash-uptime');
    if(el) el.innerText = d.toISOString().substr(11, 8);
}, 1000);

function incUsage() {
    usageCount++; localStorage.setItem('claraUsage', usageCount);
    const el = document.getElementById('dash-usage'); if(el) el.innerText = usageCount;
}

document.addEventListener("DOMContentLoaded", () => {
    typeEffect();
    if(currentMode === 'dashboard') updateDashStats();
});

const video = document.getElementById('videoPlayer');
const errorMsg = document.getElementById('errorMsg');
const qualitySelect = document.getElementById('qualitySelect');

const PROXY_BASE = 'http://localhost:3000/proxy?';

let hlsInstance = null;
let shakaInstance = null;

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
}

function clearError() {
    errorMsg.style.display = 'none';
}

async function loadStream() {
    clearError();
    const rawUrl = document.getElementById('streamUrl').value.trim();
    const refererUrl = document.getElementById('refererUrl').value.trim();

    if (!rawUrl) return showError('Please enter a stream URL');

    // Proxy URL তৈরি করা (Referer থাকলে অ্যাড করা)
    let proxiedUrl = PROXY_BASE;
    if (refererUrl) {
        proxiedUrl += `referer=${encodeURIComponent(refererUrl)}&`;
    }
    proxiedUrl += `url=${encodeURIComponent(rawUrl)}`;

    // আগের প্লেয়ার ইনস্ট্যান্স রিমুভ করা
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (shakaInstance) { await shakaInstance.destroy(); shakaInstance = null; }
    qualitySelect.innerHTML = '<option value="-1">Auto Quality</option>';

    if (rawUrl.includes('.m3u8')) {
        initHLS(proxiedUrl);
    } else if (rawUrl.includes('.mpd')) {
        initShaka(proxiedUrl);
    } else {
        showError('Unsupported format. URL must contain .m3u8 or .mpd');
    }
}

function initHLS(url) {
    if (Hls.isSupported()) {
        hlsInstance = new Hls({ maxMaxBufferLength: 30 });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            video.play().catch(() => console.log('Autoplay blocked'));
            
            data.levels.forEach((level, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                opt.text = `${level.height}p`;
                qualitySelect.appendChild(opt);
            });
            
            qualitySelect.onchange = (e) => {
                hlsInstance.currentLevel = parseInt(e.target.value);
            };
        });

        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) showError(`HLS Error: ${data.type}`);
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('loadedmetadata', () => video.play());
    }
}

async function initShaka(url) {
    shaka.polyfill.installAll();
    if (shaka.Player.isBrowserSupported()) {
        shakaInstance = new shaka.Player(video);
        shakaInstance.addEventListener('error', (e) => showError(`Shaka Error code: ${e.detail.code}`));

        try {
            await shakaInstance.load(url);
            video.play().catch(() => console.log('Autoplay blocked'));
            
            const updateQualities = () => {
                const tracks = shakaInstance.getVariantTracks();
                qualitySelect.innerHTML = '<option value="-1">Auto Quality</option>';
                tracks.forEach(track => {
                    const opt = document.createElement('option');
                    opt.value = track.id;
                    opt.text = `${track.height}p (${(track.bandwidth/1000000).toFixed(1)} Mbps)`;
                    qualitySelect.appendChild(opt);
                });
            };
            
            updateQualities();
            shakaInstance.addEventListener('trackschanged', updateQualities);
            
            qualitySelect.onchange = (e) => {
                const val = e.target.value;
                if (val === '-1') {
                    shakaInstance.configure({ abr: { enabled: true } });
                } else {
                    shakaInstance.configure({ abr: { enabled: false } });
                    const tracks = shakaInstance.getVariantTracks();
                    shakaInstance.selectVariantTrack(tracks.find(t => t.id == val), true);
                }
            };
        } catch (e) {
            showError(`DASH Load Error: ${e.message}`);
        }
    } else {
        showError('Browser does not support Shaka Player');
    }
}

function changeSpeed(speed) { video.playbackRate = parseFloat(speed); }

async function togglePiP() {
    if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
    }
}

function toggleFullscreen() {
    if (video.requestFullscreen) {
        video.requestFullscreen();
    } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
    }
}

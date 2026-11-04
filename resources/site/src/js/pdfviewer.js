// Minimal pdf.js viewer: renders lazily, and reports the visible page back to
// the local server so storage/<key>/.zotero-reader-state stays in sync.
import * as pdfjs from './pdfjs/pdf.min.mjs';

const PJ = new URL('./pdfjs/', import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PJ).href;

const params = new URLSearchParams(location.search);
const file = params.get('file') || '';
const key = (file.split('/')[1] || '').toUpperCase();

const pagesEl = document.getElementById('pages');
const numEl = document.getElementById('page');
const countEl = document.getElementById('count');
const zoomEl = document.getElementById('zoom');
const nameEl = document.getElementById('name');

let doc = null;
let total = 0;
let sizes = [];
let wrappers = [];
let current = 0;
let fitScale = 1;
let zoom = 1;
let saveTimer = null;

if (!/^[A-Z0-9]{8}$/.test(key)) {
    nameEl.textContent = 'missing or bad ?file= parameter';
    throw new Error('bad file parameter');
}

const post = (beacon) => {
    const body = JSON.stringify({key: key, pageIndex: current - 1});
    if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/state',
                             new Blob([body], {type: 'application/json'}));
        return;
    }
    fetch('/api/state', {method: 'POST',
                         headers: {'Content-Type': 'application/json'},
                         body: body}).catch(() => {});
};

const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => post(false), 800);
};

const setCurrent = (n) => {
    n = Math.min(Math.max(n, 1), total);
    if (n === current) return;
    current = n;
    numEl.value = n;
    document.title = n + '/' + total + ' - ' + fileName();
    queueSave();
};

const fileName = () => decodeURIComponent(file.split('/').pop() || file);

const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
        if (e.isIntersecting) renderPage(e.target);
    }
}, {rootMargin: '1500px 0px'});

async function renderPage(w) {
    if (w.dataset.done === '1') return;
    w.dataset.done = '1';
    try {
        const page = await doc.getPage(Number(w.dataset.page));
        const viewport = page.getViewport({scale: fitScale * zoom});
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        await page.render({
            canvas: canvas,
            canvasContext: canvas.getContext('2d'),
            viewport: viewport,
            transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
        }).promise;
        w.textContent = '';
        w.appendChild(canvas);
    } catch (e) {
        w.dataset.done = '0';
        console.error('render failed on page ' + w.dataset.page, e);
    }
}

async function layout() {
    io.disconnect();
    pagesEl.textContent = '';
    wrappers = [];
    const scale = fitScale * zoom;
    for (let i = 1; i <= total; i++) {
        const w = document.createElement('div');
        w.className = 'page';
        w.dataset.page = String(i);
        w.style.width = Math.floor(sizes[i - 1].w * scale) + 'px';
        w.style.height = Math.floor(sizes[i - 1].h * scale) + 'px';
        pagesEl.appendChild(w);
        wrappers.push(w);
        io.observe(w);
    }
    zoomEl.textContent = Math.round(zoom * 100) + '%';
}

function goTo(n) {
    n = Math.min(Math.max(n, 1), total);
    const w = wrappers[n - 1];
    if (w) window.scrollTo(0, w.offsetTop - 40);
    setCurrent(n);
}

function syncCurrent() {
    const y = window.scrollY + 100;
    let n = 1;
    for (let i = 0; i < wrappers.length; i++) {
        if (wrappers[i].offsetTop <= y) n = i + 1;
        else break;
    }
    setCurrent(n);
}

async function relayout() {
    const keep = current;
    await layout();
    goTo(keep);
}

let ticking = false;
window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; syncCurrent(); });
}, {passive: true});

window.addEventListener('pagehide', () => { if (current) post(true); });
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && current) post(true);
});

numEl.addEventListener('change', () => goTo(parseInt(numEl.value, 10) || 1));
document.getElementById('prev').addEventListener('click', () => goTo(current - 1));
document.getElementById('next').addEventListener('click', () => goTo(current + 1));
document.getElementById('zoomin').addEventListener('click', () => {
    zoom = Math.min(4, zoom + 0.25);
    relayout();
});
document.getElementById('zoomout').addEventListener('click', () => {
    zoom = Math.max(0.25, zoom - 0.25);
    relayout();
});

(async () => {
    nameEl.textContent = 'loading…';
    try {
        doc = await pdfjs.getDocument({
            url: file,
            cMapUrl: new URL('cmaps/', PJ).href,
            cMapPacked: true,
            standardFontDataUrl: new URL('standard_fonts/', PJ).href,
            wasmUrl: new URL('wasm/', PJ).href,
            iccUrl: new URL('iccs/', PJ).href,
        }).promise;
    } catch (e) {
        nameEl.textContent = 'failed to load PDF: ' + e.message;
        return;
    }
    total = doc.numPages;
    countEl.textContent = '/ ' + total;
    nameEl.textContent = fileName();

    sizes = [];
    let widest = 0;
    for (let i = 1; i <= total; i++) {
        const v = (await doc.getPage(i)).getViewport({scale: 1});
        sizes.push({w: v.width, h: v.height});
        if (v.width > widest) widest = v.width;
    }
    fitScale = Math.min(1.5, Math.max(0.4,
                                    (window.innerWidth - 40) / widest));

    let start = 1;
    try {
        const r = await fetch('/api/state?key=' + key, {cache: 'no-store'});
        if (r.ok) {
            const st = await r.json();
            if (typeof st.pageIndex === 'number') start = st.pageIndex + 1;
        }
    } catch (e) { /* no state yet */ }

    await layout();
    goTo(start);
    syncCurrent();
})();

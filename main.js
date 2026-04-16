// ── State ────────────────────────────────────────────────────────────────
const state = {
  imageData: null,
  originalPixels: null,
  w: 0,
  h: 0,
  filters: {
    gamma:      { on: false, value: 1 },
    brightness: { on: false, value: 0 },
    contrast:   { on: false, value: 1 },
    histeq:     { on: false, value: 1 },
    tonemap:    { on: false, value: 1 },
    shadow:     { on: false, value: 0 },
    highlight:  { on: false, value: 0 },
  },
  channels: { R: true, G: true, B: true },
};

// ── Upload ───────────────────────────────────────────────────────────────
const fileInput  = document.getElementById('fileInput');
const uploadZone = document.getElementById('uploadZone');

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) loadImage(e.target.files[0]);
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
});

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img  = new Image();

  img.onload = () => {
    const MAX = 1200;
    let w = img.width, h = img.height;
    if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
    if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }

    state.w = w;
    state.h = h;

    const origCanvas = document.getElementById('originalCanvas');
    origCanvas.width  = w;
    origCanvas.height = h;

    const ctx = origCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    state.originalPixels = ctx.getImageData(0, 0, w, h).data.slice();

    document.getElementById('emptyOriginal').style.display = 'none';
    origCanvas.style.display = 'block';
    document.getElementById('imgSize').textContent = `${img.width} × ${img.height}`;

    document.getElementById('statsRow').style.display      = 'grid';
    document.getElementById('histogramPanel').style.display = 'block';
    document.getElementById('downloadBtn').style.display    = 'flex';

    URL.revokeObjectURL(url);
    applyFilters();
  };

  img.src = url;
}

// ── Controls ─────────────────────────────────────────────────────────────
function toggleFilter(name) {
  state.filters[name].on = !state.filters[name].on;
  const t = document.getElementById('toggle-' + name);
  if (t) t.classList.toggle('on', state.filters[name].on);
  applyFilters();
}

function updateParam(name, val) {
  const v = parseFloat(val);

  if (name === 'shadow') {
    state.filters.shadow.value = v;
    document.getElementById('val-shadow').textContent = v;
  } else if (name === 'highlight') {
    state.filters.highlight.value = v;
    document.getElementById('val-highlight').textContent = v;
  } else {
    state.filters[name].value = v;
    document.getElementById('val-' + name).textContent =
      Number.isInteger(v) ? v : v.toFixed(2);
  }

  applyFilters();
}

function setChannel(ch) {
  const all    = ['R', 'G', 'B'];
  const active = all.filter(c => state.channels[c]);

  if (active.length === 1 && active[0] === ch) {
    all.forEach(c => { state.channels[c] = true; updateChannelUI(c); });
  } else {
    all.forEach(c => { state.channels[c] = (c === ch); updateChannelUI(c); });
  }

  applyFilters();
}

function updateChannelUI(ch) {
  const el  = document.getElementById('ch-' + ch);
  const cls = 'active-' + ch.toLowerCase();
  el.classList.toggle(cls, state.channels[ch]);
}

function resetAll() {
  const defaults = {
    gamma: 1, brightness: 0, contrast: 1,
    histeq: 1, tonemap: 1, shadow: 0, highlight: 0,
  };

  for (const [key, val] of Object.entries(defaults)) {
    state.filters[key].on    = false;
    state.filters[key].value = val;

    const toggle = document.getElementById('toggle-' + key);
    if (toggle) toggle.classList.remove('on');

    const slider = document.getElementById('sl-' + key);
    if (slider) slider.value = val;

    const label = document.getElementById('val-' + key);
    if (label) label.textContent = Number.isInteger(val) ? val : val.toFixed(2);
  }

  document.getElementById('val-highlight').textContent = '0';
  document.getElementById('sl-highlight').value = 0;

  state.channels = { R: true, G: true, B: true };
  ['R', 'G', 'B'].forEach(updateChannelUI);

  applyFilters();
}

// ── Processing Pipeline ───────────────────────────────────────────────────
function applyFilters() {
  if (!state.originalPixels) return;

  const src = state.originalPixels;
  const len = src.length;
  const out = new Uint8ClampedArray(len);

  const f  = state.filters;
  const ch = state.channels;

  // Pre-build histogram equalization LUT if needed
  const histeqOn       = f.histeq.on;
  const histeqStrength = f.histeq.value;
  let lut = null;

  if (histeqOn) {
    const combined = new Uint8Array(len / 4);
    for (let i = 0; i < len; i += 4) {
      combined[i >> 2] = Math.round(
        0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]
      );
    }
    lut = buildHistEqLUT(combined);
  }

  // Per-pixel loop
  for (let i = 0; i < len; i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];

    for (let ci = 0; ci < 3; ci++) {
      const active = (ci === 0 && ch.R) || (ci === 1 && ch.G) || (ci === 2 && ch.B);
      if (!active) continue;

      let v = ci === 0 ? r : ci === 1 ? g : b;

      // 1. Brightness
      if (f.brightness.on) v = v + f.brightness.value;

      // 2. Contrast
      if (f.contrast.on) v = (v - 128) * f.contrast.value + 128;

      // 3. Gamma correction: I_out = (I/255)^γ × 255
      if (f.gamma.on) v = Math.pow(clamp(v, 0, 255) / 255, f.gamma.value) * 255;

      // 4. Reinhard tone mapping: I_out = (L*e / (1 + L*e)) × 255
      if (f.tonemap.on) {
        const e  = f.tonemap.value;
        const vn = (v / 255) * e;
        v = (vn / (1 + vn)) * 255;
      }

      // 5. Histogram equalization with alpha blend
      if (histeqOn && lut) {
        const mapped = lut[Math.round(clamp(v, 0, 255))];
        v = v * (1 - histeqStrength) + mapped * histeqStrength;
      }

      // 6. Shadows: weight = (1 - I/255)
      if (f.shadow.value !== 0) {
        const vc     = clamp(v, 0, 255);
        const weight = 1 - vc / 255;
        v = v + f.shadow.value * weight;
      }

      // 7. Highlights: weight = (I/255)
      if (f.highlight.value !== 0) {
        const vc     = clamp(v, 0, 255);
        const weight = vc / 255;
        v = v + f.highlight.value * weight;
      }

      const clamped = clamp(Math.round(v), 0, 255);
      if (ci === 0) r = clamped;
      else if (ci === 1) g = clamped;
      else b = clamped;
    }

    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
  }

  // Write result to canvas
  const resCanvas = document.getElementById('resultCanvas');
  resCanvas.width  = state.w;
  resCanvas.height = state.h;

  const ctx     = resCanvas.getContext('2d');
  const imgData = new ImageData(out, state.w, state.h);
  ctx.putImageData(imgData, 0, 0);

  resCanvas.style.display = 'block';
  document.getElementById('emptyResult').style.display = 'none';

  // Update active filter label
  const activeList = Object.entries(f)
    .filter(([, v]) => v.on)
    .map(([k]) => k);
  document.getElementById('processingLabel').textContent =
    activeList.length ? activeList.join(' + ') : '—';

  updateStats(out);
  drawHistogram(out);
  updateDownload(resCanvas);
}

// ── Histogram Equalization LUT ────────────────────────────────────────────
function buildHistEqLUT(luminance) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < luminance.length; i++) hist[luminance[i]]++;

  const N   = luminance.length;
  const cdf = new Float32Array(256);
  cdf[0] = hist[0] / N;
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i] / N;

  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(cdf[i] * 255);

  return lut;
}

// ── Utility ───────────────────────────────────────────────────────────────
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Statistics ────────────────────────────────────────────────────────────
function updateStats(pixels) {
  let sum = 0, min = 255, max = 0, n = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    sum += luma;
    n++;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }

  const mean = sum / n;
  let variance = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    variance += (luma - mean) ** 2;
  }

  const std = Math.sqrt(variance / n);

  document.getElementById('stat-mean').textContent = mean.toFixed(1);
  document.getElementById('stat-std').textContent  = std.toFixed(1);
  document.getElementById('stat-min').textContent  = Math.round(min);
  document.getElementById('stat-max').textContent  = Math.round(max);
}

// ── Histogram Draw ────────────────────────────────────────────────────────
function drawHistogram(pixels) {
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  const histL = new Uint32Array(256);

  for (let i = 0; i < pixels.length; i += 4) {
    histR[pixels[i]]++;
    histG[pixels[i + 1]]++;
    histB[pixels[i + 2]]++;
    histL[Math.round(
      0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
    )]++;
  }

  const maxVal = Math.max(...histR, ...histG, ...histB);
  const canvas = document.getElementById('histCanvas');
  canvas.width  = canvas.offsetWidth || 600;
  canvas.height = 100;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const W  = canvas.width;
  const H  = canvas.height;
  const bw = W / 256;

  function drawChannel(hist, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    for (let x = 0; x < 256; x++) {
      const barH = (hist[x] / maxVal) * H;
      ctx.moveTo(x * bw + bw / 2, H);
      ctx.lineTo(x * bw + bw / 2, H - barH);
    }
    ctx.stroke();
  }

  drawChannel(histL, 'rgba(160,150,140,0.25)');
  drawChannel(histR, 'rgba(201,122,106,0.6)');
  drawChannel(histG, 'rgba(122,158,138,0.6)');
  drawChannel(histB, 'rgba(122,138,158,0.6)');
}

// ── Download ──────────────────────────────────────────────────────────────
function updateDownload(canvas) {
  const btn  = document.getElementById('downloadBtn');
  btn.href   = canvas.toDataURL('image/png');
}

// ── Resize Handler ────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (!state.originalPixels) return;
  const resCanvas = document.getElementById('resultCanvas');
  const ctx       = resCanvas.getContext('2d');
  const d         = ctx.getImageData(0, 0, state.w, state.h);
  drawHistogram(d.data);
});

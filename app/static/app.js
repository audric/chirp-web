// Chirp-Web client-side logic

let radios = {};         // {vendor: [model, ...]}
let stockConfigs = [];   // [{id, name, region}, ...]
let uploadId = null;     // Opaque ID returned by /api/detect
let sourceVendor = null;
let sourceModel = null;
let sourceMode = "upload"; // "upload" or "preset"

const fileInput = document.getElementById("file-input");
const detectBtn = document.getElementById("detect-btn");
const detectResult = document.getElementById("detect-result");
const destVendor = document.getElementById("dest-vendor");
const destModel = document.getElementById("dest-model");
const convertBtn = document.getElementById("convert-btn");
const resultSection = document.getElementById("result-section");
const resultBox = document.getElementById("result-box");

const tabUpload = document.getElementById("tab-upload");
const tabPreset = document.getElementById("tab-preset");
const panelUpload = document.getElementById("panel-upload");
const panelPreset = document.getElementById("panel-preset");
const stockSelect = document.getElementById("stock-config");
const presetInfo = document.getElementById("preset-info");

// Load radio list on page load
fetch("/api/radios")
    .then(r => r.json())
    .then(data => {
        radios = data;
        for (const vendor of Object.keys(data).sort()) {
            const opt = document.createElement("option");
            opt.value = vendor;
            opt.textContent = vendor;
            destVendor.appendChild(opt);
        }
    });

// Load stock configs
fetch("/api/stock-configs")
    .then(r => r.json())
    .then(data => {
        stockConfigs = data;
        // Group by region
        const groups = {};
        for (const cfg of data) {
            const region = cfg.region || "Other";
            if (!groups[region]) groups[region] = [];
            groups[region].push(cfg);
        }
        for (const [region, configs] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
            const optgroup = document.createElement("optgroup");
            optgroup.label = region;
            for (const cfg of configs) {
                const opt = document.createElement("option");
                opt.value = cfg.id;
                opt.textContent = cfg.name;
                optgroup.appendChild(opt);
            }
            stockSelect.appendChild(optgroup);
        }
    });

// Source mode tabs
tabUpload.addEventListener("click", () => switchSource("upload"));
tabPreset.addEventListener("click", () => switchSource("preset"));

function switchSource(mode) {
    sourceMode = mode;
    tabUpload.classList.toggle("active", mode === "upload");
    tabPreset.classList.toggle("active", mode === "preset");
    panelUpload.classList.toggle("hidden", mode !== "upload");
    panelPreset.classList.toggle("hidden", mode !== "preset");
    // Reset state
    uploadId = null;
    sourceVendor = null;
    sourceModel = null;
    detectResult.classList.add("hidden");
    presetInfo.classList.add("hidden");
    resultSection.classList.add("hidden");
    updateConvertBtn();
}

// Enable detect button when file selected
fileInput.addEventListener("change", () => {
    detectBtn.disabled = !fileInput.files.length;
    // Reset state
    uploadId = null;
    sourceVendor = null;
    sourceModel = null;
    detectResult.classList.add("hidden");
    resultSection.classList.add("hidden");
    updateConvertBtn();
});

// Detect source radio
detectBtn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    detectBtn.disabled = true;
    detectBtn.textContent = t("step1.detecting");
    detectResult.classList.add("hidden");

    const form = new FormData();
    form.append("file", file);

    try {
        const res = await fetch("/api/detect", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Detection failed");

        uploadId = data.upload_id;
        sourceVendor = data.vendor;
        sourceModel = data.model;
        detectResult.textContent = t("step1.detected", { vendor: data.vendor, model: data.model });
        detectResult.classList.remove("hidden", "error");
    } catch (err) {
        detectResult.textContent = translateError(err.message);
        detectResult.classList.remove("hidden");
        detectResult.classList.add("error");
    } finally {
        detectBtn.disabled = false;
        detectBtn.textContent = t("step1.detect");
        updateConvertBtn();
    }
});

// Stock config selection
stockSelect.addEventListener("change", () => {
    const selected = stockConfigs.find(c => c.id === stockSelect.value);
    if (selected) {
        presetInfo.textContent = t("step1.preset_ready", { name: selected.name });
        presetInfo.classList.remove("hidden", "error");
    } else {
        presetInfo.classList.add("hidden");
    }
    resultSection.classList.add("hidden");
    updateConvertBtn();
});

// Populate model dropdown when vendor changes
destVendor.addEventListener("change", () => {
    destModel.innerHTML = `<option value="">${t("step2.model")}</option>`;
    const models = radios[destVendor.value] || [];
    for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        destModel.appendChild(opt);
    }
    destModel.disabled = !models.length;
    updateConvertBtn();
});

destModel.addEventListener("change", updateConvertBtn);

function updateConvertBtn() {
    const hasSource = sourceMode === "upload" ? !!uploadId : !!stockSelect.value;
    convertBtn.disabled = !(hasSource && destVendor.value && destModel.value);
}

// Convert
convertBtn.addEventListener("click", async () => {
    convertBtn.disabled = true;
    convertBtn.textContent = t("step3.converting");
    resultSection.classList.add("hidden");

    const form = new FormData();
    if (sourceMode === "preset") {
        form.append("stock_config", stockSelect.value);
    } else {
        form.append("upload_id", uploadId);
        if (sourceVendor) form.append("source_vendor", sourceVendor);
        if (sourceModel) form.append("source_model", sourceModel);
    }
    form.append("dest_vendor", destVendor.value);
    form.append("dest_model", destModel.value);

    try {
        const res = await fetch("/api/convert", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Conversion failed");

        let html = `<p><strong>${escapeHtml(data.source_vendor)} ${escapeHtml(data.source_model)}</strong> &rarr; <strong>${escapeHtml(data.dest_vendor)} ${escapeHtml(data.dest_model)}</strong></p>`;
        html += `<p>${t("result.memories", { converted: data.converted, skipped: data.skipped })}</p>`;
        html += `<p><a href="${data.download_url}">${t("result.download")}</a></p>`;

        if (data.warnings && data.warnings.length) {
            html += '<ul class="warning-list">';
            for (const w of data.warnings.slice(0, 20)) {
                html += `<li>${escapeHtml(w)}</li>`;
            }
            if (data.warnings.length > 20) {
                html += `<li>${t("result.more_warnings", { count: data.warnings.length - 20 })}</li>`;
            }
            html += "</ul>";
        }

        resultBox.innerHTML = html;
        resultBox.classList.remove("error");
        resultSection.classList.remove("hidden");
    } catch (err) {
        resultBox.textContent = translateError(err.message);
        resultBox.classList.add("error");
        resultSection.classList.remove("hidden");
    } finally {
        convertBtn.disabled = false;
        convertBtn.textContent = t("step3.convert");
        updateConvertBtn();
    }
});

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// Map known backend error messages to i18n keys
const ERROR_PATTERNS = [
    [/Could not detect radio from file/, "error.detect_failed"],
    [/Unknown file format/, "error.unknown_format"],
    [/File too large/, "error.file_too_large"],
    [/Empty file/, "error.empty_file"],
    [/Conversion failed/, "error.conversion_failed"],
    [/Unknown radio/, "error.unknown_radio"],
    [/No file provided/, "error.no_file"],
    [/Invalid upload path/, "error.invalid_upload"],
    [/Upload file not found/, "error.upload_not_found"],
];

function translateError(msg) {
    for (const [pattern, key] of ERROR_PATTERNS) {
        if (pattern.test(msg)) return t(key);
    }
    return msg;
}

// Source help modal
const sourceHelpModal = document.getElementById("source-help-modal");
document.getElementById("source-help-btn").addEventListener("click", () => {
    sourceHelpModal.classList.remove("hidden");
});
document.getElementById("source-help-close").addEventListener("click", () => {
    sourceHelpModal.classList.add("hidden");
});
sourceHelpModal.addEventListener("click", (e) => {
    if (e.target === sourceHelpModal) sourceHelpModal.classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sourceHelpModal.classList.contains("hidden")) {
        sourceHelpModal.classList.add("hidden");
    }
});

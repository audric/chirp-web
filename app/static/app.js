// Chirp-Web client-side logic

let radios = {};         // {vendor: [model, ...]}
let radioItems = [];     // [{vendor, model, label}, ...] flattened for search
let stockConfigs = [];   // [{id, name, region}, ...]
let uploadId = null;     // Opaque ID returned by /api/detect
let sourceVendor = null;
let sourceModel = null;
let sourceMode = "upload"; // "upload" or "preset"

const fileInput = document.getElementById("file-input");
const detectBtn = document.getElementById("detect-btn");
const detectResult = document.getElementById("detect-result");
const destVendorInput = document.getElementById("dest-vendor");
const destModelInput = document.getElementById("dest-model");
const destSearch = document.getElementById("dest-search");
const destDropdown = document.getElementById("dest-dropdown");
const convertBtn = document.getElementById("convert-btn");
const resultSection = document.getElementById("result-section");
const resultBox = document.getElementById("result-box");

const tabUpload = document.getElementById("tab-upload");
const tabPreset = document.getElementById("tab-preset");
const panelUpload = document.getElementById("panel-upload");
const panelPreset = document.getElementById("panel-preset");
const stockSelect = document.getElementById("stock-config");
const presetSearch = document.getElementById("preset-search");
const presetDropdown = document.getElementById("preset-dropdown");
const presetInfo = document.getElementById("preset-info");

// ── Search-select helper ──────────────────────────────────────────────
function setupSearchSelect({ input, dropdown, hidden, getItems, onSelect, formatItem, storageKey }) {
    let items = [];
    let activeIdx = -1;
    let isOpen = false;

    function setItems(newItems) { items = newItems; }

    function open() {
        render(input.value);
        dropdown.classList.remove("hidden");
        isOpen = true;
    }

    function close() {
        dropdown.classList.add("hidden");
        isOpen = false;
        activeIdx = -1;
    }

    function select(item) {
        if (!item) return;
        input.value = item.label;
        input.classList.add("has-value");
        if (hidden) hidden.value = item.value || "";
        close();
        if (onSelect) onSelect(item);
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify(item));
    }

    function clear() {
        input.value = "";
        input.classList.remove("has-value");
        if (hidden) hidden.value = "";
        if (onSelect) onSelect(null);
    }

    function render(query) {
        const q = (query || "").toLowerCase().trim();
        const words = q.split(/\s+/).filter(Boolean);
        const filtered = items.filter(item => {
            if (!words.length) return true;
            const hay = item.searchText || item.label.toLowerCase();
            return words.every(w => hay.includes(w));
        }).slice(0, 80);

        dropdown.innerHTML = "";
        activeIdx = -1;

        if (!filtered.length) {
            const div = document.createElement("div");
            div.className = "ss-item";
            div.style.color = "#999";
            div.textContent = t("step2.no_results");
            dropdown.appendChild(div);
            return;
        }

        let lastGroup = null;
        filtered.forEach((item, i) => {
            if (item.group && item.group !== lastGroup) {
                lastGroup = item.group;
                const g = document.createElement("div");
                g.className = "ss-group";
                g.textContent = item.group;
                dropdown.appendChild(g);
            }
            const div = document.createElement("div");
            div.className = "ss-item";
            div.innerHTML = formatItem ? formatItem(item, words) : escapeHtml(item.label);
            div.addEventListener("mousedown", (e) => {
                e.preventDefault(); // prevent input blur
                select(item);
            });
            div.dataset.idx = i;
            dropdown.appendChild(div);
        });
    }

    input.addEventListener("focus", () => {
        open();
    });

    input.addEventListener("input", () => {
        if (hidden) hidden.value = "";
        input.classList.remove("has-value");
        if (onSelect) onSelect(null);
        open();
    });

    input.addEventListener("blur", () => {
        // Small delay to allow mousedown on items
        setTimeout(() => {
            close();
            // If text doesn't match a selection, clear
            if (hidden && !hidden.value) {
                input.value = "";
                input.classList.remove("has-value");
            }
        }, 150);
    });

    input.addEventListener("keydown", (e) => {
        const visibleItems = dropdown.querySelectorAll(".ss-item:not([style*='color'])");
        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, visibleItems.length - 1);
            updateActive(visibleItems);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            updateActive(visibleItems);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (activeIdx >= 0 && visibleItems[activeIdx]) {
                const idx = parseInt(visibleItems[activeIdx].dataset.idx);
                const q = (input.value || "").toLowerCase().trim();
                const words = q.split(/\s+/).filter(Boolean);
                const filtered = items.filter(item => {
                    if (!words.length) return true;
                    const hay = item.searchText || item.label.toLowerCase();
                    return words.every(w => hay.includes(w));
                }).slice(0, 80);
                if (filtered[idx]) select(filtered[idx]);
            }
        } else if (e.key === "Escape") {
            close();
            input.blur();
        }
    });

    function updateActive(visibleItems) {
        visibleItems.forEach((el, i) => {
            el.classList.toggle("active", i === activeIdx);
            if (i === activeIdx) el.scrollIntoView({ block: "nearest" });
        });
    }

    // Restore from localStorage
    function restore() {
        if (!storageKey) return;
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            if (saved && saved.label) {
                // Verify the item still exists
                const match = items.find(it =>
                    it.value === saved.value || it.label === saved.label
                );
                if (match) select(match);
            }
        } catch {}
    }

    return { setItems, select, clear, restore };
}

// ── Highlight matching text ───────────────────────────────────────────
function highlightMatch(text, words) {
    if (!words.length) return escapeHtml(text);
    let html = escapeHtml(text);
    for (const w of words) {
        const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi");
        html = html.replace(re, '<span class="ss-match">$1</span>');
    }
    return html;
}

// ── Destination radio search ──────────────────────────────────────────
const destSS = setupSearchSelect({
    input: destSearch,
    dropdown: destDropdown,
    hidden: destModelInput,
    storageKey: "chirpweb-dest",
    onSelect(item) {
        if (item) {
            destVendorInput.value = item.vendor;
            destModelInput.value = item.model;
        } else {
            destVendorInput.value = "";
            destModelInput.value = "";
        }
        updateConvertBtn();
    },
    formatItem(item, words) {
        return highlightMatch(item.label, words);
    },
});

// ── Preset search ─────────────────────────────────────────────────────
const presetSS = setupSearchSelect({
    input: presetSearch,
    dropdown: presetDropdown,
    hidden: stockSelect,
    storageKey: "chirpweb-preset",
    onSelect(item) {
        if (item) {
            stockSelect.value = item.value;
            presetInfo.textContent = t("step1.preset_ready", { name: item.label });
            presetInfo.classList.remove("hidden", "error");
        } else {
            stockSelect.value = "";
            presetInfo.classList.add("hidden");
        }
        resultSection.classList.add("hidden");
        updateConvertBtn();
    },
    formatItem(item, words) {
        return `<span class="ss-vendor">${escapeHtml(item.group)}</span> ${highlightMatch(item.name, words)}`;
    },
});

// ── Load radio list ───────────────────────────────────────────────────
fetch("/api/radios")
    .then(r => r.json())
    .then(data => {
        radios = data;
        radioItems = [];
        for (const vendor of Object.keys(data).sort()) {
            for (const model of data[vendor]) {
                radioItems.push({
                    vendor,
                    model,
                    label: `${vendor} ${model}`,
                    value: `${vendor}||${model}`,
                    group: vendor,
                    searchText: `${vendor} ${model}`.toLowerCase(),
                });
            }
        }
        destSS.setItems(radioItems);
        destSS.restore();
    });

// ── Load stock configs ────────────────────────────────────────────────
fetch("/api/stock-configs")
    .then(r => r.json())
    .then(data => {
        stockConfigs = data;
        const presetItems = data.map(cfg => ({
            value: cfg.id,
            label: cfg.name,
            name: cfg.name.replace(/^[A-Z]{2}\s+/, ""), // name without region prefix for search display
            group: cfg.region || "Other",
            searchText: cfg.name.toLowerCase(),
        }));
        presetSS.setItems(presetItems);
        presetSS.restore();
    });

// ── Source mode tabs ──────────────────────────────────────────────────
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

function updateConvertBtn() {
    const hasSource = sourceMode === "upload" ? !!uploadId : !!stockSelect.value;
    const hasDest = !!(destVendorInput.value && destModelInput.value);
    convertBtn.disabled = !(hasSource && hasDest);
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
    form.append("dest_vendor", destVendorInput.value);
    form.append("dest_model", destModelInput.value);

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

// Chirp-Web client-side logic

let radios = {};         // {vendor: [model, ...]}
let uploadId = null;     // Opaque ID returned by /api/detect
let sourceVendor = null;
let sourceModel = null;

const fileInput = document.getElementById("file-input");
const detectBtn = document.getElementById("detect-btn");
const detectResult = document.getElementById("detect-result");
const destVendor = document.getElementById("dest-vendor");
const destModel = document.getElementById("dest-model");
const convertBtn = document.getElementById("convert-btn");
const resultSection = document.getElementById("result-section");
const resultBox = document.getElementById("result-box");

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
        detectResult.textContent = err.message;
        detectResult.classList.remove("hidden");
        detectResult.classList.add("error");
    } finally {
        detectBtn.disabled = false;
        detectBtn.textContent = t("step1.detect");
        updateConvertBtn();
    }
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
    convertBtn.disabled = !(uploadId && destVendor.value && destModel.value);
}

// Convert
convertBtn.addEventListener("click", async () => {
    convertBtn.disabled = true;
    convertBtn.textContent = t("step3.converting");
    resultSection.classList.add("hidden");

    const form = new FormData();
    form.append("upload_id", uploadId);
    form.append("dest_vendor", destVendor.value);
    form.append("dest_model", destModel.value);
    if (sourceVendor) form.append("source_vendor", sourceVendor);
    if (sourceModel) form.append("source_model", sourceModel);

    try {
        const res = await fetch("/api/convert", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Conversion failed");

        let html = `<p><strong>${data.source_vendor} ${data.source_model}</strong> &rarr; <strong>${data.dest_vendor} ${data.dest_model}</strong></p>`;
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
        resultBox.textContent = err.message;
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

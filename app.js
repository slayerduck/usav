/*
 * app.js — camera capture, PDF417 decoding, and UI for the age-verification
 * demo. Parsing/age logic lives in aamva.js so it can be unit-tested.
 *
 * SCOPE: this reads what the barcode claims. It does NOT verify the document
 * is authentic or that it belongs to the holder. See README for what a real
 * production identity/age system additionally requires.
 */
(function () {
  "use strict";

  const MIN_AGE = 18;

  const el = (id) => document.getElementById(id);
  const video = el("video");
  const startBtn = el("startBtn");
  const stopBtn = el("stopBtn");
  const fileInput = el("fileInput");
  const statusEl = el("status");
  const resultCard = el("resultCard");
  const verdictEl = el("verdict");
  const verdictIcon = el("verdictIcon");
  const verdictText = el("verdictText");
  const detailsEl = el("details");
  const resetBtn = el("resetBtn");

  if (typeof ZXing === "undefined") {
    setStatus("Barcode library failed to load. Reload the page.");
    startBtn.disabled = true;
    return;
  }

  const { BarcodeFormat, DecodeHintType, BrowserMultiFormatReader } = ZXing;
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const reader = new BrowserMultiFormatReader(hints);
  let scanning = false;

  function setStatus(message) {
    statusEl.textContent = message;
  }

  // --- Result rendering --------------------------------------------------
  const VERDICTS = {
    approved: (r) => ({
      cls: "pass",
      icon: "✅",
      text: `Approved — ${r.age} years old (${MIN_AGE}+)`,
    }),
    underage: (r) => ({
      cls: "fail",
      icon: "🚫",
      text: `Denied — ${r.age} years old (under ${MIN_AGE})`,
    }),
    expired: (r) => ({
      cls: "fail",
      icon: "⚠️",
      text: `Denied — ID expired (holder is ${r.age})`,
    }),
    future_dob: () => ({
      cls: "fail",
      icon: "⚠️",
      text: "Invalid — date of birth is in the future",
    }),
    no_dob: () => ({
      cls: "fail",
      icon: "⚠️",
      text: "Could not read date of birth",
    }),
  };

  function showResult(fields) {
    const r = AAMVA.evaluate(fields, { minAge: MIN_AGE });
    const v = (VERDICTS[r.reason] || VERDICTS.no_dob)(r);

    verdictEl.className = "verdict verdict--" + v.cls;
    verdictIcon.textContent = v.icon;
    verdictText.textContent = v.text;

    detailsEl.innerHTML = "";
    if (r.dob) addDetail("Date of birth", formatDate(r.dob));
    if (r.age != null) addDetail("Age", String(r.age));
    const name = AAMVA.fullName(fields);
    if (name) addDetail("Name", name);
    if (r.expiration) {
      addDetail(
        "Expiration",
        formatDate(r.expiration) + (r.expired ? " (EXPIRED)" : "")
      );
    }
    if (fields.DBC) {
      addDetail(
        "Sex",
        fields.DBC === "1" ? "M" : fields.DBC === "2" ? "F" : fields.DBC
      );
    }
    if (r.reason === "no_dob") {
      addDetail("Raw DOB field", fields.DBB || "(not found)");
    }

    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function addDetail(label, value) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    detailsEl.append(dt, dd);
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function handleDecodedText(text) {
    const fields = AAMVA.parse(text);
    if (!fields.DBB) {
      setStatus(
        "A barcode was read, but it isn't an AAMVA ID barcode. Make sure " +
          "you're scanning the back of a US driver's license / state ID."
      );
      return false;
    }
    showResult(fields);
    return true;
  }

  // --- Camera scanning ---------------------------------------------------
  async function startCamera() {
    if (!window.isSecureContext) {
      setStatus(
        "Camera requires HTTPS (or localhost). Use the upload option, or " +
          "serve this page over a secure connection."
      );
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("This browser doesn't support camera access. Use upload.");
      return;
    }

    setStatus("Requesting camera access…");
    scanning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;

    // Prefer the rear (environment) camera at a resolution high enough to
    // resolve a dense PDF417 barcode.
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };

    try {
      await reader.decodeFromConstraints(constraints, video, (result) => {
        if (result && scanning) {
          if (handleDecodedText(result.getText())) {
            stopCamera("Barcode read successfully.");
          }
        }
        // Per-frame "not found" errors are expected and ignored.
      });
      setStatus("Camera on. Center the barcode inside the frame.");
    } catch (e) {
      scanning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      const msg = e && e.name === "NotAllowedError"
        ? "Camera permission denied. You can upload a photo instead."
        : "Could not access the camera: " +
          (e && e.message ? e.message : e) +
          ". You can upload a photo instead.";
      setStatus(msg);
    }
  }

  function stopCamera(message) {
    scanning = false;
    try {
      reader.reset();
    } catch (_) {
      /* no-op */
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus(message || "Camera stopped.");
  }

  // --- File upload path --------------------------------------------------
  async function handleFile(file) {
    if (!file) return;
    stopCamera("");
    setStatus("Decoding image…");
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      if (handleDecodedText(result.getText())) {
        setStatus("Barcode read successfully.");
      }
    } catch (_) {
      setStatus(
        "No PDF417 barcode found in that image. Try a sharper, well-lit, " +
          "straight-on photo of the back of the ID."
      );
    } finally {
      URL.revokeObjectURL(url);
      fileInput.value = ""; // allow re-selecting the same file
    }
  }

  function reset() {
    resultCard.hidden = true;
    detailsEl.innerHTML = "";
    setStatus("Ready. Start the camera or upload a photo.");
  }

  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", () => stopCamera("Camera stopped."));
  fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
  resetBtn.addEventListener("click", reset);
  window.addEventListener("pagehide", () => stopCamera(""));
})();

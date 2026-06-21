/*
 * Age verification proof-of-concept.
 *
 * Reads the PDF417 barcode on the back of a US driver's license / state ID,
 * parses the AAMVA-encoded payload, extracts the date of birth, and checks
 * whether the holder is 18 or older.
 *
 * IMPORTANT: This only reads what the barcode claims. It does NOT verify that
 * the document is authentic or that it belongs to the person presenting it.
 * Real-world age/identity verification needs server-side document authenticity
 * checks plus a liveness / face match, typically via a dedicated IDV vendor.
 */

(function () {
  "use strict";

  const MIN_AGE = 18;

  // --- DOM references ----------------------------------------------------
  const video = document.getElementById("video");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const fileInput = document.getElementById("fileInput");
  const statusEl = document.getElementById("status");
  const resultCard = document.getElementById("resultCard");
  const verdictEl = document.getElementById("verdict");
  const verdictIcon = document.getElementById("verdictIcon");
  const verdictText = document.getElementById("verdictText");
  const detailsEl = document.getElementById("details");
  const resetBtn = document.getElementById("resetBtn");

  // --- ZXing setup -------------------------------------------------------
  // Restrict to PDF417 so the decoder is faster and less prone to false hits.
  const hints = new Map();
  const { BarcodeFormat, DecodeHintType, BrowserMultiFormatReader } = ZXing;
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const reader = new BrowserMultiFormatReader(hints);
  let scanning = false;

  // --- Status helper -----------------------------------------------------
  function setStatus(message) {
    statusEl.textContent = message;
  }

  // --- AAMVA parsing -----------------------------------------------------
  // The AAMVA payload is a set of 3-letter element IDs followed by their value,
  // one per line. We only need a handful of fields here.
  const FIELD_LABELS = {
    DCS: "Last name",
    DAC: "First name",
    DAD: "Middle name",
    DBB: "Date of birth",
    DBA: "Expiration date",
    DBD: "Issue date",
    DBC: "Sex",
    DAQ: "License number",
  };

  function parseAamva(raw) {
    const fields = {};
    // Records are separated by LF (0x0A); the header uses CR/LF and the
    // "@" / "ANSI " preamble which we can ignore for field extraction.
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^([A-Z]{3})(.*)$/);
      if (match) {
        const [, code, value] = match;
        if (!(code in fields)) {
          fields[code] = value.trim();
        }
      }
    }
    return fields;
  }

  // AAMVA dates are MMDDCCYY (US) or CCYYMMDD (some jurisdictions / Canada).
  // We detect which by checking for a plausible month in the leading digits.
  function parseAamvaDate(value) {
    if (!value || !/^\d{8}$/.test(value)) return null;

    const a = value.slice(0, 4); // either MMDD or CCYY
    const tryMMDDCCYY = () => {
      const mm = +value.slice(0, 2);
      const dd = +value.slice(2, 4);
      const yyyy = +value.slice(4, 8);
      return buildDate(yyyy, mm, dd);
    };
    const tryCCYYMMDD = () => {
      const yyyy = +value.slice(0, 4);
      const mm = +value.slice(4, 6);
      const dd = +value.slice(6, 8);
      return buildDate(yyyy, mm, dd);
    };

    // If the first four digits look like a year (>= 1900), prefer CCYYMMDD.
    const looksLikeYear = +a >= 1900 && +a <= 2200;
    const primary = looksLikeYear ? tryCCYYMMDD() : tryMMDDCCYY();
    const fallback = looksLikeYear ? tryMMDDCCYY() : tryCCYYMMDD();
    return primary || fallback;
  }

  function buildDate(yyyy, mm, dd) {
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    if (yyyy < 1900 || yyyy > 2200) return null;
    const d = new Date(yyyy, mm - 1, dd);
    // Reject overflow (e.g. Feb 30 rolling into March).
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
      return null;
    }
    return d;
  }

  function calculateAge(birthDate, on = new Date()) {
    let age = on.getFullYear() - birthDate.getFullYear();
    const m = on.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && on.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // --- Result rendering --------------------------------------------------
  function showResult(fields) {
    const dobRaw = fields.DBB;
    const dob = parseAamvaDate(dobRaw);

    detailsEl.innerHTML = "";

    if (!dob) {
      verdictEl.className = "verdict verdict--fail";
      verdictIcon.textContent = "⚠️";
      verdictText.textContent = "Could not read date of birth";
      addDetail("Raw DOB field", dobRaw || "(not found)");
      revealResult();
      return;
    }

    const age = calculateAge(dob);
    const isAdult = age >= MIN_AGE;

    verdictEl.className = "verdict " + (isAdult ? "verdict--pass" : "verdict--fail");
    verdictIcon.textContent = isAdult ? "✅" : "🚫";
    verdictText.textContent = isAdult
      ? `Approved — ${age} years old (18+)`
      : `Denied — ${age} years old (under 18)`;

    addDetail("Date of birth", formatDate(dob));
    addDetail("Age", String(age));

    // Show a few extra fields when present, for transparency.
    const name = [fields.DAC, fields.DAD, fields.DCS]
      .filter(Boolean)
      .join(" ");
    if (name) addDetail("Name", name);

    const exp = parseAamvaDate(fields.DBA);
    if (exp) {
      const expired = exp < new Date();
      addDetail("Expiration", formatDate(exp) + (expired ? " (EXPIRED)" : ""));
    }
    if (fields.DBC) {
      addDetail("Sex", fields.DBC === "1" ? "M" : fields.DBC === "2" ? "F" : fields.DBC);
    }

    revealResult();
  }

  function addDetail(label, value) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    detailsEl.append(dt, dd);
  }

  function revealResult() {
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function handleDecodedText(text) {
    const fields = parseAamva(text);
    if (!fields.DBB) {
      setStatus(
        "A barcode was read, but it doesn't look like an AAMVA ID barcode. " +
          "Make sure you're scanning the back of a US ID."
      );
      return false;
    }
    showResult(fields);
    return true;
  }

  // --- Camera scanning ---------------------------------------------------
  async function startCamera() {
    setStatus("Requesting camera access…");
    try {
      scanning = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;

      await reader.decodeFromVideoDevice(
        undefined, // default device; prefers environment camera where possible
        video,
        (result, err) => {
          if (result && scanning) {
            const ok = handleDecodedText(result.getText());
            if (ok) stopCamera("Barcode read successfully.");
          }
          // Per-frame "not found" errors are expected; ignore them.
        }
      );
      setStatus("Camera on. Center the barcode in the frame.");
    } catch (e) {
      scanning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      setStatus(
        "Could not access the camera: " +
          (e && e.message ? e.message : e) +
          ". You can upload a photo instead."
      );
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
    if (message) setStatus(message);
    else setStatus("Camera stopped.");
  }

  // --- File upload path --------------------------------------------------
  async function handleFile(file) {
    if (!file) return;
    stopCamera();
    setStatus("Decoding image…");
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      const ok = handleDecodedText(result.getText());
      if (ok) setStatus("Barcode read successfully.");
    } catch (e) {
      setStatus(
        "No PDF417 barcode found in that image. Try a sharper, well-lit photo " +
          "of the back of the ID."
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // --- Reset -------------------------------------------------------------
  function reset() {
    resultCard.hidden = true;
    detailsEl.innerHTML = "";
    setStatus("Ready. Start the camera or upload a photo.");
  }

  // --- Wire up events ----------------------------------------------------
  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", () => stopCamera("Camera stopped."));
  fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
  resetBtn.addEventListener("click", reset);

  // Expose date helpers for ad-hoc testing in the console / unit checks.
  window.__ageVerify = { parseAamva, parseAamvaDate, calculateAge };
})();

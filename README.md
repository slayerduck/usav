# US ID Age Verification — Proof of Concept

A single-page, **front-end only** (HTML/CSS/JS) demo that scans the **PDF417
barcode** on the back of a US driver's license / state ID, parses the
[AAMVA](https://www.aamva.org/)-encoded data, reads the date of birth, and
checks whether the holder is **18 or older**.

Everything runs locally in the browser — **no data is uploaded anywhere**.

## How it works

1. **Capture** — uses the camera via `getUserMedia()`, or a photo upload.
2. **Decode** — [ZXing](https://github.com/zxing-js/library) decodes the PDF417
   barcode (loaded from a CDN).
3. **Parse** — splits the AAMVA payload into its 3-letter element fields
   (`DBB` = date of birth, `DBA` = expiration, names, etc.).
4. **Verify age** — computes age from `DBB` and compares against 18.

## Running it

Camera access (`getUserMedia`) requires a **secure context**, so serve it over
HTTPS or `localhost` (opening the file directly via `file://` will block the
camera, though photo upload still works).

```bash
# any static server works, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

## ⚠️ Important limitations

This is a **demonstration**, not a production identity/age-verification system.
It reads what the barcode *claims*; it does **not**:

- verify the document is **authentic** (a forged barcode with a fake-but-over-18
  DOB will pass — the PDF417 has no offline-verifiable cryptographic signature);
- confirm the ID **belongs to the person** presenting it (no liveness / face
  match);
- address the **legal & privacy obligations** of handling government ID data
  (e.g. Illinois BIPA, GDPR/CCPA, state biometric/ID laws).

Production-grade age verification typically requires server-side document
authenticity analysis plus a selfie/liveness check, usually through a dedicated
IDV vendor (Persona, Onfido, Veriff, Jumio, etc.).

## Files

- `index.html` — markup
- `styles.css` — styling
- `app.js` — camera, decoding, AAMVA parsing, and age logic

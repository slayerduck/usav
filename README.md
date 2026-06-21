# US ID Age Verification

A single-page, **front-end** (HTML/CSS/JS) app that scans the **PDF417
barcode** on the back of a US driver's license / state ID, parses the
[AAMVA](https://www.aamva.org/)-encoded data, reads the date of birth, and
checks whether the holder is **18 or older**.

Everything runs locally in the browser — **no data is uploaded anywhere**.

## How it works

1. **Capture** — camera via `getUserMedia()` (prefers the rear camera), or a
   photo upload.
2. **Decode** — [ZXing](https://github.com/zxing-js/library) decodes the PDF417
   barcode. The library is **vendored locally** (`vendor/`) with Subresource
   Integrity — no runtime CDN dependency.
3. **Parse** — `aamva.js` splits the AAMVA payload into its 3-letter element
   fields, tolerant of CR/LF/RS separators and the leading subfile designator.
4. **Verify** — computes age from `DBB`, rejects future/unparseable dates, and
   denies expired documents.

## Running it

Camera access (`getUserMedia`) requires a **secure context** — serve over HTTPS
or `localhost`. (Opening via `file://` blocks the camera; photo upload still
works.)

```bash
npm run serve   # http://localhost:8000
# or any static server, e.g. python3 -m http.server 8000
```

## Tests

The parsing and age logic is isolated in `aamva.js` and covered by a Node test
suite:

```bash
npm test
```

## Project layout

```
index.html              markup + CSP + SRI-pinned script tags
styles.css              styling
aamva.js                pure, testable AAMVA parser + age logic
app.js                  camera, decoding, and UI wiring
vendor/                 vendored ZXing PDF417 decoder
test/aamva.test.mjs     unit tests
```

## ⚠️ What this is — and is not

This hardens the **client side** as far as it can honestly go (robust parsing,
expiration/sanity checks, local-only processing, CSP, SRI, tests). But a
front-end-only app **cannot** be a complete production identity/age-verification
system. It reads what the barcode *claims*; it does **not**:

- verify the document is **authentic** — a forged barcode encoding a
  fake-but-over-18 DOB will pass. The AAMVA PDF417 has no offline-verifiable
  cryptographic signature, so authenticity cannot be established in the browser.
- confirm the ID **belongs to the person** presenting it (no liveness / face
  match).
- satisfy the **legal & privacy obligations** of handling government ID data
  (e.g. Illinois BIPA, GDPR/CCPA, state biometric/ID laws).

**A production deployment needs a server-side component**: document-authenticity
analysis, a selfie/liveness check, audit logging, and a defined data-retention
policy — typically delivered through a dedicated IDV vendor (Persona, Onfido,
Veriff, Jumio, etc.). Treat this repo as the capture/parse front-end of such a
system, not the whole thing.

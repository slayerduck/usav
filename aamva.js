/*
 * aamva.js — pure parsing & age logic for AAMVA-encoded US ID barcodes.
 *
 * No DOM dependencies, so it can be unit-tested under Node (see test/).
 * Exposed as `window.AAMVA` in the browser and via module.exports in Node.
 *
 * Reference: AAMVA DL/ID Card Design Standard. The PDF417 payload is:
 *   compliance indicator "@"  (0x40)
 *   LF                        (0x0A)  data element separator
 *   RS                        (0x1E)  record separator
 *   CR                        (0x0D)  segment terminator
 *   "ANSI " + IIN(6) + version(2) + jurisdictionVersion(2) + entries(2)
 *   then one subfile designator per entry: type(2) offset(4) length(4)
 *   then the subfiles, each: type(2) + elements separated by LF, ending CR.
 *
 * Each data element is a 3-letter code immediately followed by its value.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AAMVA = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Separators that can delimit data elements across jurisdictions/encoders.
  const SEPARATORS = /[\r\n\x1e]+/;
  // Known subfile designators that may prefix the first element of a subfile.
  const SUBFILE_TYPES = ["DL", "ID"];

  const FIELD_LABELS = {
    DCS: "Last name",
    DAC: "First name",
    DCT: "First name",
    DAD: "Middle name",
    DBB: "Date of birth",
    DBA: "Expiration date",
    DBD: "Issue date",
    DBC: "Sex",
    DAQ: "License number",
    DCG: "Country",
    DCK: "Inventory control",
  };

  /**
   * Parse a raw AAMVA payload string into a { CODE: value } map.
   * Tolerant of CR/LF/RS separators and of a leading subfile designator
   * (e.g. "DL") fused to the first element ("DLDAQ12345").
   */
  function parse(raw) {
    const fields = {};
    if (typeof raw !== "string" || raw.length === 0) return fields;

    const tokens = raw.split(SEPARATORS);
    for (let token of tokens) {
      token = token.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]+$/g, ""); // trailing ctrl
      if (token.length < 3) continue;

      // Strip a leading subfile designator if it's immediately followed by a
      // 3-letter element code, e.g. "DLDAQ..." -> "DAQ...".
      const prefix = token.slice(0, 2);
      if (SUBFILE_TYPES.includes(prefix) && /^[A-Z]{3}/.test(token.slice(2))) {
        token = token.slice(2);
      }

      const m = token.match(/^([A-Z]{3})(.*)$/);
      if (!m) continue;
      const code = m[1];
      const value = m[2].trim();
      // First occurrence wins (header/designators won't match the code regex
      // in a way that overwrites real subfile data).
      if (!(code in fields)) fields[code] = value;
    }
    return fields;
  }

  /**
   * Parse an 8-digit AAMVA date. US (version >= 2) uses MMDDCCYY; AAMVA v1 and
   * some jurisdictions (e.g. Canada) use CCYYMMDD. We disambiguate by whether
   * the leading 4 digits form a plausible year.
   * @returns {Date|null}
   */
  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{8}$/.test(value)) return null;

    const lead = Number(value.slice(0, 4));
    const looksLikeYear = lead >= 1900 && lead <= 2200;

    const mmddccyy = () =>
      build(+value.slice(4, 8), +value.slice(0, 2), +value.slice(2, 4));
    const ccyymmdd = () =>
      build(+value.slice(0, 4), +value.slice(4, 6), +value.slice(6, 8));

    return looksLikeYear ? ccyymmdd() || mmddccyy() : mmddccyy() || ccyymmdd();
  }

  function build(yyyy, mm, dd) {
    if (yyyy < 1900 || yyyy > 2200) return null;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(yyyy, mm - 1, dd);
    if (
      d.getFullYear() !== yyyy ||
      d.getMonth() !== mm - 1 ||
      d.getDate() !== dd
    ) {
      return null; // rejects overflow such as Feb 30
    }
    return d;
  }

  /** Whole years between birthDate and `on` (default: now). */
  function ageOn(birthDate, on) {
    on = on || new Date();
    let age = on.getFullYear() - birthDate.getFullYear();
    const m = on.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && on.getDate() < birthDate.getDate())) age--;
    return age;
  }

  /**
   * Evaluate the parsed fields against a minimum age.
   * @returns {{
   *   ok: boolean, reason: string, age: (number|null),
   *   dob: (Date|null), expiration: (Date|null), expired: boolean,
   *   fields: object
   * }}
   */
  function evaluate(fields, options) {
    options = options || {};
    const minAge = options.minAge != null ? options.minAge : 18;
    const now = options.now || new Date();

    const dob = parseDate(fields.DBB);
    const expiration = parseDate(fields.DBA);
    const expired = expiration ? expiration < now : false;

    if (!fields.DBB || !dob) {
      return {
        ok: false,
        reason: "no_dob",
        age: null,
        dob: null,
        expiration,
        expired,
        fields,
      };
    }

    if (dob > now) {
      return {
        ok: false,
        reason: "future_dob",
        age: null,
        dob,
        expiration,
        expired,
        fields,
      };
    }

    const age = ageOn(dob, now);

    if (age < minAge) {
      return { ok: false, reason: "underage", age, dob, expiration, expired, fields };
    }
    if (expired) {
      // Old enough, but the document itself is no longer valid.
      return { ok: false, reason: "expired", age, dob, expiration, expired, fields };
    }
    return { ok: true, reason: "approved", age, dob, expiration, expired, fields };
  }

  function fullName(fields) {
    return [fields.DAC || fields.DCT, fields.DAD, fields.DCS]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  return { parse, parseDate, ageOn, evaluate, fullName, FIELD_LABELS };
});

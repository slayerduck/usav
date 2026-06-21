import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AAMVA = require("../aamva.js");

// A representative AAMVA payload (back-of-ID PDF417 contents). Uses the real
// separators: "@", LF (0x0A), RS (0x1E), CR (0x0D).
const LF = "\n";
const CR = "\r";
const RS = "\x1e";
function sample(fields) {
  const header = "@\nANSI 636026080102DL00410288ZV03290015";
  const body =
    "DL" +
    fields.map((f) => f).join(LF) +
    CR;
  return header + RS + body;
}

test("parse extracts core fields and strips the DL subfile prefix", () => {
  const raw = sample([
    "DAQT64235789",
    "DCSDOE",
    "DACJOHN",
    "DADQUINCY",
    "DBB01151990",
    "DBA01152030",
    "DBC1",
  ]);
  const f = AAMVA.parse(raw);
  assert.equal(f.DAQ, "T64235789"); // prefix "DL" must not corrupt first field
  assert.equal(f.DCS, "DOE");
  assert.equal(f.DAC, "JOHN");
  assert.equal(f.DBB, "01151990");
});

test("parseDate handles US MMDDCCYY", () => {
  const d = AAMVA.parseDate("01151990");
  assert.equal(d.getFullYear(), 1990);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 15);
});

test("parseDate handles CCYYMMDD (v1 / Canada)", () => {
  const d = AAMVA.parseDate("19900115");
  assert.equal(d.getFullYear(), 1990);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 15);
});

test("parseDate rejects impossible dates", () => {
  assert.equal(AAMVA.parseDate("02301990"), null); // Feb 30
  assert.equal(AAMVA.parseDate("13011990"), null); // month 13
  assert.equal(AAMVA.parseDate("abcdefgh"), null);
  assert.equal(AAMVA.parseDate("1234567"), null); // wrong length
});

test("ageOn computes whole years, respecting birthday not yet reached", () => {
  const dob = new Date(2008, 5, 21); // 21 Jun 2008
  assert.equal(AAMVA.ageOn(dob, new Date(2026, 5, 21)), 18); // exact birthday
  assert.equal(AAMVA.ageOn(dob, new Date(2026, 5, 20)), 17); // day before
});

test("evaluate approves an adult with a valid, unexpired ID", () => {
  const f = { DBB: "06211990", DBA: "06212030" };
  const r = AAMVA.evaluate(f, { minAge: 18, now: new Date(2026, 5, 21) });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "approved");
  assert.equal(r.age, 36);
});

test("evaluate denies an underage holder", () => {
  const f = { DBB: "06212010", DBA: "06212030" };
  const r = AAMVA.evaluate(f, { minAge: 18, now: new Date(2026, 5, 21) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "underage");
  assert.equal(r.age, 16);
});

test("evaluate denies an expired ID even if the holder is old enough", () => {
  const f = { DBB: "06211990", DBA: "06212020" };
  const r = AAMVA.evaluate(f, { minAge: 18, now: new Date(2026, 5, 21) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
  assert.equal(r.expired, true);
});

test("evaluate flags a missing or unparseable DOB", () => {
  assert.equal(AAMVA.evaluate({}, {}).reason, "no_dob");
  assert.equal(AAMVA.evaluate({ DBB: "garbage" }, {}).reason, "no_dob");
});

test("evaluate rejects a future date of birth", () => {
  const f = { DBB: "06212030" };
  const r = AAMVA.evaluate(f, { now: new Date(2026, 5, 21) });
  assert.equal(r.reason, "future_dob");
});

test("end-to-end: parse + evaluate on a full payload", () => {
  const raw = sample(["DBB06211990", "DBA06212030", "DCSDOE", "DACJOHN"]);
  const f = AAMVA.parse(raw);
  const r = AAMVA.evaluate(f, { minAge: 18, now: new Date(2026, 5, 21) });
  assert.equal(r.ok, true);
  assert.equal(AAMVA.fullName(f), "JOHN DOE");
});

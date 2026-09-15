// Ported from job_bot's autofill/base.py -- same semantics, DOM instead of
// Playwright. Nothing here ever clicks a submit button; that invariant is
// load-bearing, keep it that way.

const NATIVE_INPUT_VALUE_SETTER = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, "value"
).set;
const NATIVE_TEXTAREA_VALUE_SETTER = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, "value"
).set;

function setNativeValue(el, value) {
  const setter = el.tagName === "TEXTAREA" ? NATIVE_TEXTAREA_VALUE_SETTER : NATIVE_INPUT_VALUE_SETTER;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillElement(el, value) {
  if (!value) return { filled: false, reason: "no_value" };
  try {
    setNativeValue(el, value);
    return { filled: true };
  } catch (e) {
    return { filled: false, reason: String(e) };
  }
}

// Mirrors try_fill: no-op on falsy value, silently skip if selector not found.
function fillField(selector, value) {
  if (!value) return { selector, filled: false, reason: "no_value" };
  const el = document.querySelector(selector);
  if (!el) return { selector, filled: false, reason: "not_found" };
  return { selector, el, ...fillElement(el, value) };
}

// Tries each selector in order, first one that actually fills wins. Used by
// the generic fallback matcher, which has to guess at several possible
// selectors per logical field instead of knowing one exact selector.
function fillFirstMatch(selectors, value) {
  for (const selector of selectors) {
    const result = fillField(selector, value);
    if (result.filled) return result;
  }
  return { selector: selectors[0], filled: false, reason: "no_match" };
}

// Mirrors try_answer: resolve a control by its <label> text (regex, case
// insensitive already baked into the RegExp passed in), first match wins.
// <select> is matched by visible option text; everything else gets the
// value set directly.
function findByLabel(regex) {
  const labels = Array.from(document.querySelectorAll("label"));
  for (const label of labels) {
    if (!regex.test(label.textContent || "")) continue;
    let control = null;
    if (label.htmlFor) control = document.getElementById(label.htmlFor);
    if (!control) control = label.querySelector("input, select, textarea");
    if (control) return control;
  }
  // Fallback for label-less custom fields that expose an aria-label instead.
  const ariaEls = Array.from(document.querySelectorAll("[aria-label]"));
  for (const el of ariaEls) {
    if (regex.test(el.getAttribute("aria-label") || "")) return el;
  }
  return null;
}

function answerByLabel(regex, value) {
  if (!value) return { label: regex.source, answered: false, reason: "no_value" };
  const el = findByLabel(regex);
  if (!el) return { label: regex.source, answered: false, reason: "not_found" };
  try {
    if (el.tagName === "SELECT") {
      const target = String(value).trim().toLowerCase();
      const option = Array.from(el.options).find(
        (o) => (o.textContent || "").trim().toLowerCase() === target
      );
      if (!option) return { label: regex.source, el, answered: false, reason: "option_not_found" };
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      setNativeValue(el, String(value));
    }
    return { label: regex.source, el, answered: true };
  } catch (e) {
    return { label: regex.source, el, answered: false, reason: String(e) };
  }
}

function highlightField(el, message) {
  el.style.outline = "3px solid #f5a623";
  el.style.outlineOffset = "2px";
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const note = document.createElement("div");
  note.textContent = message || "job_bot: please attach this file manually";
  note.style.cssText =
    "position:absolute;z-index:2147483647;background:#f5a623;color:#111;" +
    "font:12px/1.4 sans-serif;padding:4px 8px;border-radius:4px;margin-top:4px;";
  const rect = el.getBoundingClientRect();
  note.style.top = `${window.scrollY + rect.bottom}px`;
  note.style.left = `${window.scrollX + rect.left}px`;
  document.body.appendChild(note);
  setTimeout(() => note.remove(), 8000);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Mirrors try_upload, plus the fallback the user asked for: if programmatic
// assignment fails (selector missing, or the site rejects it), highlight the
// field instead of failing silently. Accepts either a selector string (the
// two dedicated field maps know their exact selector) or an element directly
// (the generic fallback resolves the file input by heuristics, not a fixed
// selector).
function uploadResume(selectorOrEl, resume) {
  const selector = typeof selectorOrEl === "string" ? selectorOrEl : "(resolved element)";
  if (!resume || !resume.base64) return { selector, attached: false, reason: "no_resume" };
  const el = typeof selectorOrEl === "string" ? document.querySelector(selectorOrEl) : selectorOrEl;
  if (!el) return { selector, attached: false, reason: "not_found" };
  try {
    const bytes = base64ToBytes(resume.base64);
    const file = new File([bytes], resume.filename || "resume.pdf", {
      type: resume.mimeType || "application/octet-stream",
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { selector, attached: true };
  } catch (e) {
    highlightField(el, "job_bot: couldn't auto-attach resume -- please attach it manually");
    return { selector, attached: false, reason: String(e) };
  }
}

// The reverse of findByLabel: given a form control, find its label's text.
// Used to describe an unanswered open-ended question (e.g. a textarea) back
// to the AI-assist flow, which only has the DOM element, not label text.
function getLabelText(el) {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return (label.textContent || "").trim();
  }
  const wrapping = el.closest("label");
  if (wrapping) return (wrapping.textContent || "").trim();
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return (labelEl.textContent || "").trim();
  }
  return "";
}

// AI-assist support: after the deterministic fill pass, the site scripts
// register which element (if any) they used for the cover letter, then scan
// for other still-empty textareas that look like real open-ended questions
// (a real label, not just a placeholder). Filled in later via FILL_ANSWERS
// once the popup has asked job_bot to generate an answer for each -- kept as
// a two-step handshake because answering needs a network round trip the
// content script itself shouldn't own.
let COVER_LETTER_EL = null;
let PENDING_QUESTIONS = [];

function registerCoverLetterElement(el) {
  COVER_LETTER_EL = el || null;
}

function scanOpenQuestions() {
  PENDING_QUESTIONS = [];
  const found = [];
  for (const el of document.querySelectorAll("textarea")) {
    if (el === COVER_LETTER_EL) continue;
    if (el.value && el.value.trim()) continue; // already filled, deterministically or otherwise
    const label = getLabelText(el);
    if (label.trim().length < 8) continue; // too short to trust as a real question
    const index = PENDING_QUESTIONS.length;
    PENDING_QUESTIONS.push(el);
    found.push({ index, question: label.trim() });
  }
  return found;
}

function fillAnswers(answers) {
  let filled = 0;
  for (const { index, value } of answers || []) {
    const el = PENDING_QUESTIONS[index];
    if (el && value && fillElement(el, value).filled) filled++;
  }
  return { filled };
}

function fillCoverLetterElement(value) {
  if (!COVER_LETTER_EL) return { filled: false, reason: "not_found" };
  return fillElement(COVER_LETTER_EL, value);
}

// Best-effort job title/company/description scrape for the AI-assist calls
// -- there's no structured selector that works across every ATS, so this
// leans on the page <title> (usually "Job Title at Company" or "Job Title -
// Company") and falls back to the whole visible body text for context. Much
// fuzzier than job_bot's own API-sourced job descriptions; good enough to
// ground a generated answer, not meant to be exact.
function scrapePageContext() {
  const title = document.title || "";
  const parts = title.split(/\s+[-|]\s+|\s+at\s+/i).map((s) => s.trim()).filter(Boolean);
  const jobTitle = parts[0] || title;
  const companyName = parts.length >= 2 ? parts[1] : "";
  const description = (document.body.innerText || "").slice(0, 6000);
  return { jobTitle, companyName, description };
}

function detectATS() {
  const host = window.location.hostname;
  if (host.includes("greenhouse.io")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  return null;
}

// Set by content/greenhouse.js or content/lever.js.
let SITE_FILL_FN = null;
function registerFillFn(fn) {
  SITE_FILL_FN = fn;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "AUTOFILL": {
      if (!SITE_FILL_FN) {
        sendResponse({ ok: false, reason: "unsupported_site" });
        break;
      }
      try {
        const result = SITE_FILL_FN(message.payload || {});
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ ok: false, reason: String(e) });
      }
      break;
    }
    case "GET_PAGE_CONTEXT":
      sendResponse({ ok: true, context: scrapePageContext() });
      break;
    case "FILL_ANSWERS":
      sendResponse({ ok: true, result: fillAnswers(message.answers) });
      break;
    case "FILL_COVER_LETTER":
      sendResponse({ ok: true, result: fillCoverLetterElement(message.value) });
      break;
    default:
      return undefined; // not ours -- let any other listener handle it
  }
  return undefined;
});

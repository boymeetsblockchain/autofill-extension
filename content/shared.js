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

// Mirrors try_fill: no-op on falsy value, silently skip if selector not found.
function fillField(selector, value) {
  if (!value) return { selector, filled: false, reason: "no_value" };
  const el = document.querySelector(selector);
  if (!el) return { selector, filled: false, reason: "not_found" };
  try {
    setNativeValue(el, value);
    return { selector, filled: true };
  } catch (e) {
    return { selector, filled: false, reason: String(e) };
  }
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
      if (!option) return { label: regex.source, answered: false, reason: "option_not_found" };
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      setNativeValue(el, String(value));
    }
    return { label: regex.source, answered: true };
  } catch (e) {
    return { label: regex.source, answered: false, reason: String(e) };
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
  if (message.type !== "AUTOFILL") return undefined;
  if (!SITE_FILL_FN) {
    sendResponse({ ok: false, reason: "unsupported_site" });
    return undefined;
  }
  try {
    const result = SITE_FILL_FN(message.payload || {});
    sendResponse({ ok: true, result });
  } catch (e) {
    sendResponse({ ok: false, reason: String(e) });
  }
  return undefined;
});

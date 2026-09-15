function detectATSFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (host.includes("greenhouse.io")) return "greenhouse";
    if (host.includes("lever.co")) return "lever";
  } catch (e) {
    // ignore
  }
  return null;
}

function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined ? vars[key] : match));
}

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

let state = { tab: null, ats: null, jobId: null };

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.ats = detectATSFromUrl(tab.url || "");

  const badge = document.getElementById("ats-badge");
  const fillBtn = document.getElementById("fill-btn");
  const sourceEl = document.getElementById("source");

  if (!state.ats) {
    badge.textContent = "Unrecognized site — best effort";
    badge.className = "badge ats-none";
    fillBtn.textContent = "Fill form (best-effort)";
  } else {
    badge.textContent = state.ats === "greenhouse" ? "Greenhouse" : "Lever";
    badge.className = `badge ats-${state.ats}`;
  }
  fillBtn.disabled = false;

  const settings = await chrome.storage.local.get(["jobBotSyncEnabled", "coverLetterTemplate", "profile"]);
  let coverLetter = fillTemplate(settings.coverLetterTemplate || "", {
    full_name: (settings.profile && settings.profile.full_name) || "",
  });

  if (settings.jobBotSyncEnabled !== false) {
    const res = await sendToBackground({ type: "GET_JOB_BY_URL", url: tab.url });
    if (res && res.ok && res.data) {
      state.jobId = res.data.id;
      if (res.data.cover_letter) {
        coverLetter = res.data.cover_letter;
        state.coverLetterFromJobBot = true;
      }
      sourceEl.innerHTML = `Resolved from job_bot: <strong>${escapeHtml(res.data.title)}</strong> @ ${escapeHtml(res.data.company)}`;
      document.getElementById("applied-btn").disabled = false;
    } else if (res && res.unreachable) {
      sourceEl.textContent = "job_bot not running — using standalone profile/template.";
    } else {
      sourceEl.textContent = "Job not tracked in job_bot — using standalone profile/template.";
    }
  } else {
    sourceEl.textContent = "job_bot sync disabled — using standalone profile/template.";
  }

  state.coverLetter = coverLetter;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

function summarize(result) {
  if (!result) return "No response from page.";
  const filledCount = (result.filled || []).filter((f) => f.filled).length;
  const answeredCount = (result.answered || []).filter((a) => a.answered).length;
  const lines = [`Filled ${filledCount} field(s), answered ${answeredCount} screening question(s).`];
  lines.push(result.resumeAttached ? "Resume attached." : "Resume NOT attached — check the highlighted field.");
  return lines.join("\n");
}

// content/greenhouse.js and content/lever.js are declared in manifest.json
// and auto-inject on their matching hostnames. For everything else, inject
// the generic fallback here, on demand, guarded against double-injection
// (re-running shared.js's top-level `let`s a second time throws).
async function ensureGenericInjected(tabId) {
  const [{ result: ready }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!window.__jobBotGenericReady,
  });
  if (!ready) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/shared.js", "content/generic.js"],
    });
  }
}

// Opt-in (see Options) -- each call spends real OpenAI credits via job_bot,
// so this only runs after an explicit Fill click, never automatically, and
// only when the user has turned it on. Regenerates the cover letter only
// if it wasn't already a real tailored one pulled from job_bot (no point
// re-templating over that), then answers whatever open-ended questions the
// deterministic fill pass left behind.
async function runAiAssist(fillResult, resultEl) {
  const context = await chrome.tabs
    .sendMessage(state.tab.id, { type: "GET_PAGE_CONTEXT" })
    .then((r) => (r && r.ok ? r.context : {}))
    .catch(() => ({}));
  const jobTitle = context.jobTitle || "";
  const companyName = context.companyName || "";
  const description = context.description || "";

  if (!state.coverLetterFromJobBot) {
    resultEl.textContent += "\nGenerating cover letter…";
    const res = await sendToBackground({ type: "GENERATE_COVER_LETTER", jobTitle, companyName, description });
    if (res && res.ok && res.data && res.data.cover_letter) {
      await chrome.tabs.sendMessage(state.tab.id, { type: "FILL_COVER_LETTER", value: res.data.cover_letter });
      resultEl.textContent += " done.";
    } else {
      const detail = (res && res.error && res.error.detail) || (res && res.unreachable && "job_bot not running") || "failed";
      resultEl.textContent += ` skipped (${detail}).`;
    }
  }

  const openQuestions = (fillResult && fillResult.openQuestions) || [];
  if (openQuestions.length) {
    resultEl.textContent += `\nAnswering ${openQuestions.length} open question(s)…`;
    const answers = [];
    for (const q of openQuestions) {
      const res = await sendToBackground({
        type: "ANSWER_QUESTION", question: q.question, jobTitle, companyName, description,
      });
      if (res && res.ok && res.data && res.data.answer) {
        answers.push({ index: q.index, value: res.data.answer });
      }
    }
    if (answers.length) {
      await chrome.tabs.sendMessage(state.tab.id, { type: "FILL_ANSWERS", answers });
    }
    resultEl.textContent += ` answered ${answers.length}/${openQuestions.length} — review before submitting.`;
  }
}

document.getElementById("fill-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("result");
  resultEl.textContent = "Filling…";
  const { profile, resume, aiAssistEnabled, jobBotSyncEnabled } = await chrome.storage.local.get([
    "profile", "resume", "aiAssistEnabled", "jobBotSyncEnabled",
  ]);

  try {
    if (!state.ats) {
      await ensureGenericInjected(state.tab.id);
    }
    const response = await chrome.tabs.sendMessage(state.tab.id, {
      type: "AUTOFILL",
      payload: { profile, resume, coverLetter: state.coverLetter },
    });
    if (!response || !response.ok) {
      resultEl.textContent = `Could not fill: ${(response && response.reason) || "unknown error"}`;
      return;
    }
    resultEl.textContent = summarize(response.result);
    if (!state.ats) resultEl.textContent += "\n(Best-effort match — double-check every field.)";

    if (aiAssistEnabled && jobBotSyncEnabled !== false) {
      await runAiAssist(response.result, resultEl);
    }
  } catch (e) {
    resultEl.textContent = `Could not reach the page's content script: ${e}`;
  }
});

document.getElementById("applied-btn").addEventListener("click", async () => {
  if (!state.jobId) return;
  const resultEl = document.getElementById("result");
  const res = await sendToBackground({ type: "SET_STATUS", id: state.jobId, status: "applied" });
  resultEl.textContent = res && res.ok ? "Marked as applied in job_bot." : "Could not update job_bot.";
});

document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();

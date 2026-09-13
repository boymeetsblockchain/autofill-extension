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
    badge.textContent = "Not a supported ATS";
    badge.className = "badge ats-none";
    sourceEl.textContent = "Open a Greenhouse or Lever job page to use autofill.";
    return;
  }

  badge.textContent = state.ats === "greenhouse" ? "Greenhouse" : "Lever";
  badge.className = `badge ats-${state.ats}`;
  fillBtn.disabled = false;

  const settings = await chrome.storage.local.get(["jobBotSyncEnabled", "coverLetterTemplate", "profile"]);
  let coverLetter = fillTemplate(settings.coverLetterTemplate || "", {
    full_name: (settings.profile && settings.profile.full_name) || "",
  });

  if (settings.jobBotSyncEnabled !== false) {
    const res = await sendToBackground({ type: "GET_JOB_BY_URL", url: tab.url });
    if (res && res.ok && res.data) {
      state.jobId = res.data.id;
      if (res.data.cover_letter) coverLetter = res.data.cover_letter;
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

document.getElementById("fill-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("result");
  resultEl.textContent = "Filling…";
  const { profile, resume } = await chrome.storage.local.get(["profile", "resume"]);

  try {
    const response = await chrome.tabs.sendMessage(state.tab.id, {
      type: "AUTOFILL",
      payload: { profile, resume, coverLetter: state.coverLetter },
    });
    if (!response || !response.ok) {
      resultEl.textContent = `Could not fill: ${(response && response.reason) || "unknown error"}`;
      return;
    }
    resultEl.textContent = summarize(response.result);
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

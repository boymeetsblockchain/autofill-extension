const PROFILE_FIELDS = [
  "full_name", "email", "phone", "location", "linkedin_url", "portfolio_url", "years_of_experience",
];
const TRI_STATE_FIELDS = ["work_authorized", "requires_sponsorship"];

function triStateToSelect(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}
function selectToTriState(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

async function load() {
  const data = await chrome.storage.local.get([
    "profile", "resume", "coverLetterTemplate", "jobBotServerUrl", "jobBotSyncEnabled", "jobBotToken",
    "aiAssistEnabled",
  ]);
  const profile = data.profile || {};

  for (const field of PROFILE_FIELDS) {
    const el = document.getElementById(field);
    if (el) el.value = profile[field] || "";
  }
  for (const field of TRI_STATE_FIELDS) {
    document.getElementById(field).value = triStateToSelect(profile[field]);
  }

  document.getElementById("jobBotServerUrl").value = data.jobBotServerUrl || "http://127.0.0.1:8787";
  document.getElementById("jobBotToken").value = data.jobBotToken || "";
  document.getElementById("jobBotSyncEnabled").checked = data.jobBotSyncEnabled !== false;
  document.getElementById("aiAssistEnabled").checked = !!data.aiAssistEnabled;
  document.getElementById("coverLetterTemplate").value = data.coverLetterTemplate || "";

  const resumeStatus = document.getElementById("resume-status");
  resumeStatus.textContent = data.resume
    ? `Saved: ${data.resume.filename} (${Math.round((data.resume.base64.length * 3) / 4 / 1024)} KB)`
    : "No resume saved.";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById("save-btn").addEventListener("click", async () => {
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    profile[field] = document.getElementById(field).value.trim();
  }
  for (const field of TRI_STATE_FIELDS) {
    profile[field] = selectToTriState(document.getElementById(field).value);
  }

  const toSet = {
    profile,
    coverLetterTemplate: document.getElementById("coverLetterTemplate").value,
    jobBotServerUrl: document.getElementById("jobBotServerUrl").value.trim() || "http://127.0.0.1:8787",
    jobBotToken: document.getElementById("jobBotToken").value.trim(),
    jobBotSyncEnabled: document.getElementById("jobBotSyncEnabled").checked,
    aiAssistEnabled: document.getElementById("aiAssistEnabled").checked,
  };

  const fileInput = document.getElementById("resume");
  if (fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    toSet.resume = {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      base64: await fileToBase64(file),
    };
  }

  await chrome.storage.local.set(toSet);
  const status = document.getElementById("save-status");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 2000);
  load();
});

document.getElementById("test-connection-btn").addEventListener("click", async () => {
  const serverUrl = document.getElementById("jobBotServerUrl").value.trim();
  const token = document.getElementById("jobBotToken").value.trim();
  const status = document.getElementById("sync-status");
  status.textContent = "Testing…";
  const res = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION", serverUrl, token });
  status.textContent = res && res.ok ? "Connected." : "Could not reach job_bot server.";
});

document.getElementById("import-btn").addEventListener("click", async () => {
  const serverUrl = document.getElementById("jobBotServerUrl").value.trim();
  const token = document.getElementById("jobBotToken").value.trim();
  const status = document.getElementById("sync-status");
  status.textContent = "Importing…";
  const res = await chrome.runtime.sendMessage({ type: "IMPORT_FROM_JOBBOT", serverUrl, token });
  if (res && res.ok) {
    status.textContent = res.data.resumeImported ? "Imported profile + resume." : "Imported profile (no resume found).";
    load();
  } else if (res && res.status === 401) {
    status.textContent = "Import failed — token rejected. Check the token pasted above matches .server_token.";
  } else {
    status.textContent = "Import failed — is `python cli.py serve` running?";
  }
});

load();

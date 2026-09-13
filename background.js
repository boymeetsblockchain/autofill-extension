const DEFAULT_SETTINGS = {
  profile: {
    full_name: "",
    email: "",
    phone: "",
    location: "",
    linkedin_url: "",
    portfolio_url: "",
    work_authorized: null,
    requires_sponsorship: null,
    years_of_experience: "",
  },
  resume: null, // { filename, mimeType, base64 }
  coverLetterTemplate:
    "Dear Hiring Team,\n\nI'm excited to apply for the {job_title} role at {company_name}.\n\n" +
    "I'd welcome the chance to discuss how my experience could contribute to your team.\n\n" +
    "Best regards,\n{full_name}",
  jobBotServerUrl: "http://127.0.0.1:8787",
  jobBotSyncEnabled: true,
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) toSet[key] = value;
  }
  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
});

async function fetchJson(url, options) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return { ok: false, status: res.status, error: await res.json().catch(() => null) };
    return { ok: true, data: await res.json() };
  } catch (e) {
    // job_bot not running is the expected common case, not an error to surface.
    return { ok: false, unreachable: true, error: String(e) };
  }
}

async function fetchJobByUrl(serverUrl, jobUrl) {
  return fetchJson(`${serverUrl}/job?url=${encodeURIComponent(jobUrl)}`);
}

async function setJobStatus(serverUrl, id, status) {
  return fetchJson(`${serverUrl}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
}

async function importFromJobBot(serverUrl) {
  const applicantRes = await fetchJson(`${serverUrl}/applicant`);
  if (!applicantRes.ok) return applicantRes;

  let resume = null;
  try {
    const resumeRes = await fetch(`${serverUrl}/resume`);
    if (resumeRes.ok) {
      const blob = await resumeRes.blob();
      const buf = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const disposition = resumeRes.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      resume = {
        filename: match ? match[1] : "resume.pdf",
        mimeType: blob.type || "application/octet-stream",
        base64,
      };
    }
  } catch (e) {
    // Resume fetch failing shouldn't block importing the applicant profile.
  }

  const a = applicantRes.data;
  const profile = {
    full_name: a.full_name || "",
    email: a.email || "",
    phone: a.phone || "",
    location: a.location || "",
    linkedin_url: a.linkedin_url || "",
    portfolio_url: a.portfolio_url || "",
    work_authorized: a.work_authorized === undefined ? null : a.work_authorized,
    requires_sponsorship: a.requires_sponsorship === undefined ? null : a.requires_sponsorship,
    years_of_experience: a.years_of_experience || "",
  };

  const toSet = { profile };
  if (resume) toSet.resume = resume;
  await chrome.storage.local.set(toSet);
  return { ok: true, data: { profile, resumeImported: !!resume } };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const { jobBotServerUrl } = await chrome.storage.local.get(["jobBotServerUrl"]);
    const serverUrl = message.serverUrl || jobBotServerUrl || DEFAULT_SETTINGS.jobBotServerUrl;

    switch (message.type) {
      case "GET_JOB_BY_URL":
        sendResponse(await fetchJobByUrl(serverUrl, message.url));
        break;
      case "SET_STATUS":
        sendResponse(await setJobStatus(serverUrl, message.id, message.status));
        break;
      case "IMPORT_FROM_JOBBOT":
        sendResponse(await importFromJobBot(serverUrl));
        break;
      case "TEST_CONNECTION":
        sendResponse(await fetchJson(`${serverUrl}/health`));
        break;
      default:
        sendResponse({ ok: false, error: "unknown_message_type" });
    }
  })();
  return true; // keep the message channel open for the async response
});

# job_bot Autofill (Chrome extension)

Fills Greenhouse and Lever application forms in your own browser tab, using
either a locally-saved profile or a running [job_bot](../job_bot) instance.
Like job_bot's Playwright-based `apply` command, it **never clicks submit**
— it only fills fields for you to review.

## Load it

1. Go to `chrome://extensions`, enable Developer mode.
2. "Load unpacked" → select this folder.

## Standalone use (no job_bot needed)

Open the extension's Options page, fill in your profile, upload a resume,
and edit the default cover letter template. Then on any Greenhouse or Lever
job page, open the popup and click **Fill form**.

## With job_bot

In your job_bot folder, run:

```bash
python cli.py serve
```

This starts a local API at `http://127.0.0.1:8787` (loopback only) and prints
an auth token the first time it runs (also saved to `.server_token` in the
job_bot folder). Paste that token into the extension's Options page under
"Server token" — every job_bot endpoint except `/health` requires it, since
loopback binding alone doesn't stop other tabs in your browser from reading
a wide-open local API. Then make sure "Use job_bot..." is checked and click
**Import profile + resume now** to pull your `config.yaml` applicant info
and resume in. From then on, opening the popup on a job page job_bot already
tracks will use its tailored cover letter automatically, and **Mark as
applied** writes the status straight back into `job_bot.db`.

If job_bot isn't running, or the job isn't tracked, the extension silently
falls back to the standalone profile/template — no errors, just the
fallback path.

## Sites without a dedicated field map

Greenhouse and Lever get exact selectors (see below). On anything else —
Ashby, Workday, a company's own custom form — the popup still offers **Fill
form (best-effort)**: it guesses fields from common `name`/`id`/`autocomplete`/
`type` attribute patterns (e.g. `input[name*='first' i]`,
`input[autocomplete='email']`) instead of a known selector. This is
meaningfully less reliable than the dedicated scripts — it only fills a
field it's reasonably confident about and never guesses on anything
ambiguous, but double-check every field before submitting.

## AI-generated cover letters &amp; open-question answers (opt-in)

Off by default. Enable "Auto-generate cover letters & answer open questions
with AI" in Options to have Fill also:
- Generate a fresh tailored cover letter via job_bot's `/tailor` endpoint
  whenever it didn't already pull a real one from a tracked job (never
  re-templates over an actual job_bot-tailored letter).
- Scan the form for any still-empty long-answer question (a `<textarea>`
  with a real associated label — e.g. "Why do you want to work here?") that
  the fixed work-authorization/sponsorship/years-of-experience matching
  doesn't cover, and answer each one via job_bot's `/answer` endpoint.

Both call OpenAI through job_bot (your key, never the browser) using
`applicant.resume_summary` from `config.yaml` for grounding, plus a
best-effort scrape of the page's title and visible text for job context —
fuzzier than job_bot's own API-sourced descriptions, so **always review
generated text before submitting**. Requires job_bot sync to be on; each
Fill click with this enabled makes real OpenAI API calls.

## What it fills

- **Greenhouse**: first/last name, email, phone, resume, cover letter,
  LinkedIn/portfolio links, and (only if you've set a real value in Options)
  work authorization / sponsorship / years-of-experience screening questions
  matched by their label text.
- **Lever**: name, email, phone, resume, cover letter, LinkedIn/portfolio
  links, same screening-question matching.

Custom questions the label-matching doesn't recognize are always left blank
for you. Resume attachment is attempted automatically (via the
`DataTransfer` API); if a site rejects that, the file field is highlighted
so you can attach it by hand instead.

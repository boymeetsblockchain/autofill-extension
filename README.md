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

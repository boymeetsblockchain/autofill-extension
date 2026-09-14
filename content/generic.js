// Best-effort fallback for sites that aren't Greenhouse or Lever (Ashby,
// Workday, SmartRecruiters, iCIMS, or a company's own custom form). Unlike
// content/greenhouse.js and content/lever.js, which know the exact selector
// for every field, this guesses from common name/id/autocomplete/type
// attribute patterns -- much less reliable, so it's deliberately
// conservative: it only fills a field it's reasonably confident about and
// never guesses on anything ambiguous. Injected on demand (see popup.js)
// rather than declared in manifest.json, since it only makes sense on pages
// the two dedicated scripts didn't already handle.

function findResumeInput() {
  const named = document.querySelector(
    "input[type='file'][name*='resume' i], input[type='file'][id*='resume' i], " +
      "input[type='file'][name*='cv' i], input[type='file'][id*='cv' i]"
  );
  if (named) return named;
  // No name/id gives it away -- fall back to the page's one-and-only file
  // input (common on simple forms); if there are several, don't guess which.
  const fileInputs = document.querySelectorAll("input[type='file']");
  return fileInputs.length === 1 ? fileInputs[0] : null;
}

registerFillFn(function fillGeneric({ profile = {}, resume, coverLetter }) {
  const results = { filled: [], answered: [], resumeAttached: false };

  const fullName = profile.full_name || "";
  const [firstName, ...rest] = fullName.split(" ");
  const lastName = rest.join(" ");

  const firstFilled = fillFirstMatch(
    ["input[autocomplete='given-name']", "input[name*='first' i]", "input[id*='first' i]"],
    firstName
  );
  results.filled.push(firstFilled);
  results.filled.push(
    fillFirstMatch(["input[autocomplete='family-name']", "input[name*='last' i]", "input[id*='last' i]"], lastName)
  );
  // No split first/last fields found -- try a single full-name field instead.
  if (!firstFilled.filled) {
    results.filled.push(
      fillFirstMatch(
        ["input[autocomplete='name']", "input[name='name' i]", "input[name*='fullname' i]", "input[id*='fullname' i]"],
        fullName
      )
    );
  }

  results.filled.push(
    fillFirstMatch(
      ["input[type='email']", "input[autocomplete='email']", "input[name*='email' i]", "input[id*='email' i]"],
      profile.email
    )
  );
  results.filled.push(
    fillFirstMatch(
      ["input[type='tel']", "input[autocomplete='tel']", "input[name*='phone' i]", "input[id*='phone' i]"],
      profile.phone
    )
  );
  results.filled.push(
    fillFirstMatch(["input[name*='linkedin' i]", "input[id*='linkedin' i]"], profile.linkedin_url)
  );
  results.filled.push(
    fillFirstMatch(
      ["input[name*='portfolio' i]", "input[id*='portfolio' i]", "input[name*='website' i]", "input[id*='website' i]"],
      profile.portfolio_url
    )
  );
  results.filled.push(
    fillFirstMatch(["textarea[name*='cover' i]", "textarea[id*='cover' i]", "textarea[name*='letter' i]"], coverLetter)
  );

  const resumeInput = findResumeInput();
  if (resumeInput && resume) {
    const resumeResult = uploadResume(resumeInput, resume);
    results.resumeAttached = resumeResult.attached;
    results.resumeDetail = resumeResult;
  } else {
    results.resumeDetail = { attached: false, reason: resumeInput ? "no_resume" : "not_found" };
  }

  // Same three screening-question regexes as the dedicated ATS scripts --
  // label-text matching is already site-agnostic.
  if (profile.work_authorized !== null && profile.work_authorized !== undefined) {
    results.answered.push(
      answerByLabel(/authoriz(ed|ation) to work/i, profile.work_authorized ? "Yes" : "No")
    );
  }
  if (profile.requires_sponsorship !== null && profile.requires_sponsorship !== undefined) {
    results.answered.push(
      answerByLabel(/require .*sponsorship|visa sponsorship/i, profile.requires_sponsorship ? "Yes" : "No")
    );
  }
  if (profile.years_of_experience) {
    results.answered.push(
      answerByLabel(/years of (relevant )?experience/i, String(profile.years_of_experience))
    );
  }

  return results;
});

// Injection-guard flag, checked by popup.js before re-injecting shared.js +
// this file into the same frame (re-running shared.js's top-level `let`
// declarations a second time would throw).
window.__jobBotGenericReady = true;

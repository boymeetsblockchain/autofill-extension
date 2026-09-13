// Ported 1:1 from job_bot's autofill/greenhouse_form.py.

registerFillFn(function fillGreenhouse({ profile = {}, resume, coverLetter }) {
  const results = { filled: [], answered: [], resumeAttached: false };

  const fullName = profile.full_name || "";
  const [firstName, ...rest] = fullName.split(" ");
  results.filled.push(fillField("#first_name", firstName));
  results.filled.push(fillField("#last_name", rest.join(" ")));
  results.filled.push(fillField("#email", profile.email));
  results.filled.push(fillField("#phone", profile.phone));

  const resumeResult = uploadResume("#resume", resume);
  results.resumeAttached = resumeResult.attached;
  results.resumeDetail = resumeResult;

  // Greenhouse often has a "cover letter" textarea, or an upload field.
  results.filled.push(fillField("#cover_letter_text", coverLetter));

  // Common optional links
  results.filled.push(fillField("input[name*='linkedin' i]", profile.linkedin_url));
  results.filled.push(fillField("input[name*='portfolio' i]", profile.portfolio_url));

  // Common screening questions -- only answered if a real value is set in
  // options (applicant.work_authorized / .requires_sponsorship /
  // .years_of_experience). A question we don't recognize by label text is
  // always left blank for you to answer yourself.
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

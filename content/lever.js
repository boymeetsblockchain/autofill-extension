// Ported 1:1 from job_bot's autofill/lever_form.py.

registerFillFn(function fillLever({ profile = {}, resume, coverLetter }) {
  const results = { filled: [], answered: [], resumeAttached: false };

  results.filled.push(fillField("input[name='name']", profile.full_name));
  results.filled.push(fillField("input[name='email']", profile.email));
  results.filled.push(fillField("input[name='phone']", profile.phone));
  // input[name='org'] (current company) is deliberately left blank, matching
  // the Python source.
  results.filled.push(fillField("input[name='urls[LinkedIn]']", profile.linkedin_url));
  results.filled.push(fillField("input[name='urls[Portfolio]']", profile.portfolio_url));

  const resumeResult = uploadResume("input[name='resume']", resume);
  results.resumeAttached = resumeResult.attached;
  results.resumeDetail = resumeResult;

  results.filled.push(fillField("textarea[name='comments']", coverLetter));

  // Same three screening questions as Greenhouse, same regexes.
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

// services/agents.service.js
// Concrete implementations for every agent in the registry.
// Attachments happen at module load; agents.service must be imported by the
// routes so resolveAction can find propose/execute on AGENTS entries.

import { ObjectId } from "mongodb";
import { AGENTS } from "./agentFramework.js";
import { generateWithFallback } from "./gemini.service.js";
import { stripPII, stripPIIFromText } from "./sanitizer.service.js";

const byId = (id) => AGENTS.find((a) => a.id === id);
const jsonLoose = (text) => {
  let s = text;
  const cb = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) s = cb[1].trim();
  const fb = s.indexOf("{"), fk = s.indexOf("[");
  if (fk !== -1 && (fb === -1 || fk < fb)) {
    const lk = s.lastIndexOf("]");
    if (lk > fk) return JSON.parse(s.substring(fk, lk + 1));
  }
  const lb = s.lastIndexOf("}");
  return JSON.parse(s.substring(fb, lb + 1));
};
const sanitizeText = (v, max = 1000) =>
  String(v || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/[<>]/g, "").trim().slice(0, max);

/* ------------------------------- candidate ------------------------------- */

byId("auto-apply").propose = async (db, uid, opts = {}) => {
  const limit = Math.min(Math.max(Number(opts.jobIds ? opts.jobIds.length : opts.limit) || 3, 1), 5);

  const appliedJobs = (await db.collection("applications")
    .find({ firebaseUid: uid })
    .project({ jobId: 1 })
    .toArray()).map((a) => a.jobId?.toString()).filter(Boolean);

  const query = { matchedCandidates: uid, status: { $ne: "delete_requested" } };
  if (opts.jobIds?.length) query._id = { $in: opts.jobIds.filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i)) };

  const jobs = (await db.collection("find_jobs").find(query).limit(20).project({ title: 1, company: 1, location: 1 }).toArray())
    .filter((j) => !appliedJobs.includes(j._id.toString()))
    .slice(0, limit);

  if (jobs.length === 0) {
    throw Object.assign(new Error("No new matched jobs to apply to — you have already applied to your matches."), { status: 400 });
  }

  return {
    summary: `Draft ${jobs.length} job application(s): ${jobs.map((j) => j.title).join(", ")}.`,
    proposal: { jobs: jobs.map((j) => ({ jobId: j._id.toString(), title: j.title, company: j.company, location: j.location })) },
  };
};

byId("auto-apply").execute = async (db, uid, action) => {
  const user = await db.collection("users").findOne({ firebaseUid: uid }, { projection: { email: 1, _id: 0 } });
  if (!user?.email) throw Object.assign(new Error("User profile email not found — cannot submit applications"), { status: 400 });

  const inserted = [];
  for (const job of action.proposal.jobs) {
    if (!ObjectId.isValid(job.jobId)) continue;
    const already = await db.collection("applications").countDocuments({ jobId: new ObjectId(job.jobId), firebaseUid: uid });
    if (already > 0) continue; // never double-apply
    const application = {
      jobId: new ObjectId(job.jobId),
      firebaseUid: uid,
      email: user.email,
      jobTitle: sanitizeText(job.title, 200),
      company: sanitizeText(job.company, 200),
      location: sanitizeText(job.location, 120),
      status: "submitted",
      aiScore: null,
      timeline: [{ status: "submitted", timestamp: new Date() }],
      feedback: null,
      createdAt: new Date(),
    };
    const { insertedId } = await db.collection("applications").insertOne(application);
    inserted.push({ applicationId: insertedId.toString(), title: job.title, company: job.company });
  }
  if (inserted.length === 0) throw Object.assign(new Error("All selected jobs were already applied to"), { status: 409 });
  return {
    result: { applications: inserted },
    summary: `Submitted ${inserted.length} approved job application(s).`,
  };
};

byId("skill-assessment").propose = async (db, uid) => {
  const user = await db.collection("users").findOne({ firebaseUid: uid }, { projection: { skills: 1, title: 1, _id: 0 } });
  const latestApp = await db.collection("applications").findOne(
    { firebaseUid: uid }, { sort: { createdAt: -1 }, projection: { jobTitle: 1, _id: 0 } }
  );
  const { text } = await generateWithFallback(`You are a career coach. The candidate is targeting "${latestApp?.jobTitle || user?.title || "a tech role"}" and currently has skills: ${(user?.skills || []).join(", ")}.

Pick the ONE most valuable skill they should get verified on their job platform next. Reply ONLY with JSON: {"skill": "...", "reason": "one sentence"}.`);
  let rec;
  try { rec = jsonLoose(text); } catch { rec = { skill: stripPIIFromText(text).slice(0, 80), reason: "" }; }

  return {
    summary: `Get verified on "${sanitizeText(rec.skill, 80)}" — a matching skill test will be recommended.`,
    proposal: { skill: sanitizeText(rec.skill, 80), reason: sanitizeText(rec.reason, 300), targetRole: sanitizeText(latestApp?.jobTitle || user?.title, 200) },
  };
};

byId("skill-assessment").execute = async (db, uid, action) => {
  const { skill, reason } = action.proposal;
  await db.collection("notifications").insertOne({
    userId: uid,
    type: "SKILL_TEST_RECOMMENDED",
    message: `Recommended: take a skill test for "${skill}". ${reason}`,
    read: false,
    createdAt: new Date(),
  });
  return { result: { skill }, summary: `Skill test recommendation for "${skill}" delivered to notifications.` };
};

byId("networking").propose = async (db, uid, opts = {}) => {
  const user = await db.collection("users").findOne(
    { firebaseUid: uid },
    { projection: { displayName: 1, skills: 1, title: 1, _id: 0 } }
  );
  const targetRole = sanitizeText(opts.targetRole || user?.title, 200);
  const { text } = await generateWithFallback(`Write a short professional networking outreach message (max 120 words) from a job seeker to a recruiter.

User's name: ${user?.displayName || "the candidate"}
User's title/skills: ${user?.title || ""}, ${(user?.skills || []).slice(0, 8).join(", ")}
Target role: ${targetRole}
Tone: polite, confident, one paragraph. No placeholders like [Your Name].

Return ONLY JSON: {"message": "..."}.`);
  let draft;
  try { draft = jsonLoose(text).message; } catch { draft = stripPIIFromText(text); }

  return {
    summary: `Draft outreach message for "${targetRole}" — review and send it yourself.`,
    proposal: { message: stripPIIFromText(String(draft)).slice(0, 2000), targetRole },
  };
};

// Networking stays draft-only: the user sends it themselves (privacy boundary).
byId("networking").execute = async (db, uid, action) => ({
  result: { message: action.proposal.message },
  summary: "Outreach draft saved — copy it and send it from your own account.",
});

byId("learning-path").propose = async (db, uid) => {
  const user = await db.collection("users").findOne({ firebaseUid: uid }, { projection: { skills: 1, title: 1, _id: 0 } });
  const latestApp = await db.collection("applications").findOne(
    { firebaseUid: uid }, { sort: { createdAt: -1 }, projection: { jobTitle: 1, _id: 0 } }
  );
  const { text } = await generateWithFallback(`Create a 4-week study plan.

Current title: ${user?.title || "unknown"}
Current skills: ${(user?.skills || []).join(", ")}
Target role: ${latestApp?.jobTitle || user?.title || "senior role"}

Return ONLY JSON: {"weeks": [{"week": 1, "focus": "...", "tasks": ["..."]}]} (exactly 4 weeks, 2-3 tasks each).`);
  let plan;
  try { plan = jsonLoose(text); } catch { throw Object.assign(new Error("AI plan was unreadable — please retry"), { status: 502 }); }
  if (!Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    throw Object.assign(new Error("AI plan was empty — please retry"), { status: 502 });
  }

  const weeks = plan.weeks.slice(0, 4).map((w, i) => ({
    week: Number(w.week) || i + 1,
    focus: sanitizeText(w.focus, 200),
    tasks: (Array.isArray(w.tasks) ? w.tasks : []).slice(0, 5).map((t) => sanitizeText(t, 300)),
  }));

  return {
    summary: `4-week learning plan toward "${latestApp?.jobTitle || user?.title || "your target role"}".`,
    proposal: { weeks, targetRole: sanitizeText(latestApp?.jobTitle || user?.title, 200) },
  };
};

byId("learning-path").execute = async (db, uid, action) => {
  const reminder = action.proposal.weeks.map((w) => `Week ${w.week}: ${w.focus}`).join(" | ");
  await db.collection("notifications").insertOne({
    userId: uid,
    type: "LEARNING_PLAN_AGENT",
    message: `Your approved ${action.proposal.weeks.length}-week plan (${reminder}) is saved on the Learning Plan page.`,
    read: false,
    createdAt: new Date(),
  });
  return { result: { weeks: action.proposal.weeks }, summary: `Learning plan approved and saved.` };
};

byId("profile-optimizer").propose = async (db, uid) => {
  const user = await db.collection("users").findOne(
    { firebaseUid: uid },
    { projection: { displayName: 1, skills: 1, title: 1, isSkillVerified: 1, resumeUploaded: 1, _id: 0 } }
  );
  const problems = [];
  if (!user) throw Object.assign(new Error("Profile not found"), { status: 404 });
  if (!user.title) problems.push("add a job title");
  if (!user.skills?.length) problems.push("add skills (or upload a resume to auto-extract them)");
  if (!user.resumeUploaded) problems.push("upload your resume");
  if (!user.isSkillVerified) problems.push("take a skill test to get verified");

  let suggestedTitle = "";
  if (user.title && user.skills?.length) {
    const { text } = await generateWithFallback(`A candidate's current job title is "${user.title}" and skills are: ${user.skills.join(", ")}.
Suggest ONE sharper, industry-standard job title. Return ONLY JSON: {"title": "..."}.`);
    try { suggestedTitle = sanitizeText(jsonLoose(text).title, 100); } catch { suggestedTitle = ""; }
  }
  if (titleShouldChange(user.title, suggestedTitle)) problems.push(`sharpen your title to "${suggestedTitle}"`);

  if (problems.filter((p) => !p.startsWith("sharpen")).length === 0 && !suggestedTitle) {
    throw Object.assign(new Error("Your profile already looks complete — nothing to optimize."), { status: 400 });
  }

  return {
    summary: `Profile fixes ready for approval: ${problems.join("; ")}.`,
    proposal: { problems, updates: suggestedTitle ? { title: suggestedTitle } : {} },
  };
};

const titleShouldChange = (current, suggested) =>
  suggested && suggested.toLowerCase() !== String(current || "").toLowerCase();

byId("profile-optimizer").execute = async (db, uid, action) => {
  const updates = action.proposal.updates || {};
  if (Object.keys(updates).length === 0) {
    return { result: { applied: false, problems: action.proposal.problems }, summary: "No profile fields to change — see the review tips." };
  }
  const set = { updatedAt: new Date() };
  if (updates.title) set.title = sanitizeText(updates.title, 100);
  await db.collection("users").updateOne({ firebaseUid: uid }, { $set: set });
  return { result: { applied: true, updates: set }, summary: `Profile updated: ${Object.keys(set).filter((k) => k !== "updatedAt").join(", ")}.` };
};

/* ------------------------------- recruiter ------------------------------- */

async function recruiterJobs(db, uid) {
  const recruiter = await db.collection("users").findOne(
    { firebaseUid: uid },
    { projection: { companyName: 1, displayName: 1, _id: 0 } }
  );
  if (!recruiter) throw Object.assign(new Error("Recruiter profile not found"), { status: 404 });
  return db.collection("find_jobs")
    .find({ $or: [{ postedBy: uid }, { company: recruiter.companyName || recruiter.displayName }] })
    .project({ title: 1, company: 1, _id: 1, description: 1, updatedAt: 1 })
    .limit(10)
    .toArray();
}

byId("candidate-outreach").propose = async (db, uid, opts = {}) => {
  const jobs = await recruiterJobs(db, uid);
  if (jobs.length === 0) throw Object.assign(new Error("Post a job first — nothing to recruit for."), { status: 400 });

  const job = opts.jobId && ObjectId.isValid(opts.jobId)
    ? jobs.find((j) => j._id.toString() === opts.jobId) || jobs[0]
    : jobs[0];

  const applicants = await db.collection("applications")
    .aggregate([
      { $match: { jobId: job._id, status: { $in: ["submitted", "shortlisted", "task_sent"] } } },
      { $sort: { createdAt: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "users",
          localField: "firebaseUid",
          foreignField: "firebaseUid",
          as: "candidate",
        },
      },
      { $unwind: "$candidate" },
      { $project: { "candidate.displayName": 1, "candidate.title": 1, "candidate.skills": 1, _id: 1 } },
    ])
    .toArray();

  if (applicants.length === 0) throw Object.assign(new Error("No applicants for this job yet."), { status: 400 });

  const { text } = await generateWithFallback(`Write a short outreach message (max 100 words) from a recruiter to the top candidate below for the role "${job.title}".

Candidates (pick the top one):
${JSON.stringify(applicants.slice(0, 3).map((a) => ({ name: a.candidate.displayName, title: a.candidate.title, skills: (a.candidate.skills || []).slice(0, 6) })), null, 1)}

Return ONLY JSON: {"candidateName": "...", "message": "..."}. Use the candidate's real name, no placeholders.`);
  let draft;
  try { draft = jsonLoose(text); } catch { throw Object.assign(new Error("AI draft unreadable — Please retry"), { status: 502 }); }

  return {
    summary: `Draft outreach to ${sanitizeText(draft.candidateName, 100)} for "${sanitizeText(job.title, 100)}" — you send it.`,
    proposal: { jobId: job._id.toString(), jobTitle: sanitizeText(job.title, 200), message: stripPIIFromText(String(draft.message)).slice(0, 2000), candidateName: sanitizeText(draft.candidateName, 100) },
  };
};

byId("candidate-outreach").execute = async (db, uid, action) => ({
  result: { message: action.proposal.message, candidateName: action.proposal.candidateName },
  summary: "Outreach draft saved — send it from your messaging section.",
});

byId("applicant-vetting").propose = async (db, uid, opts = {}) => {
  const jobs = await recruiterJobs(db, uid);
  if (jobs.length === 0) throw Object.assign(new Error("Post a job first."), { status: 400 });
  const job = opts.jobId && ObjectId.isValid(opts.jobId) ? jobs.find((j) => j._id.toString() === opts.jobId) || jobs[0] : jobs[0];

  const apps = await db.collection("applications")
    .aggregate([
      { $match: { jobId: job._id, status: { $ne: "rejected" } } },
      { $limit: 15 },
      { $lookup: { from: "users", localField: "firebaseUid", foreignField: "firebaseUid", as: "candidate" } },
      { $unwind: "$candidate" },
      { $project: { status: 1, "candidate.displayName": 1, "candidate.skills": 1, "candidate.isSkillVerified": 1, _id: 0 } },
    ])
    .toArray();

  if (apps.length === 0) throw Object.assign(new Error("No applicants to vet for this job yet."), { status: 400 });

  const { text } = await generateWithFallback(`You are vetting applicants for "${job.title}". Rank them and give a one-line rationale each.

Applicants:
${JSON.stringify(apps.map((a) => ({ name: a.candidate.displayName, skills: (a.candidate.skills || []).slice(0, 8), verified: !!a.candidate.isSkillVerified })), null, 1)}

Return ONLY JSON: {"ranked": [{"name": "...", "rationale": "..."}]} — same names, best first.`);
  let ranked;
  try { ranked = jsonLoose(text).ranked; } catch { throw Object.assign(new Error("AI ranking unreadable — please retry"), { status: 502 }); }

  const ranking = (Array.isArray(ranked) ? ranked : []).slice(0, 10).map((r) => ({
    name: sanitizeText(r.name, 100),
    rationale: sanitizeText(r.rationale, 300),
  }));

  return {
    summary: `${ranking.length} applicant(s) ranked for "${sanitizeText(job.title, 100)}" with fit rationale.`,
    proposal: { jobId: job._id.toString(), jobTitle: sanitizeText(job.title, 200), ranking },
  };
};

// Vetting is advisory: there is nothing to write, the proposal IS the deliverable.
byId("applicant-vetting").execute = async (db, uid, action) => ({
  result: { ranking: action.proposal.ranking },
  summary: "Ranking saved to your activity log for reference.",
});

byId("job-post-refresher").propose = async (db, uid, opts = {}) => {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recruiter = await db.collection("users").findOne(
    { firebaseUid: uid },
    { projection: { companyName: 1, displayName: 1, _id: 0 } }
  );
  if (!recruiter) throw Object.assign(new Error("Recruiter profile not found"), { status: 404 });

  const stale = await db.collection("find_jobs")
    .find({ $or: [{ postedBy: uid }, { company: recruiter.companyName || recruiter.displayName }], updatedAt: { $lt: cutoff } })
    .project({ title: 1, description: 1, company: 1 })
    .limit(5)
    .toArray();

  if (stale.length === 0) throw Object.assign(new Error("No stale job posts (older than 14 days) to refresh."), { status: 400 });

  const job = stale[0];
  const { text } = await generateWithFallback(`Refresh this job description to be current and appealing (max 200 words).

Title: ${job.title}
Company: ${job.company}
Current description: ${stripPIIFromText(String(job.description || "")).slice(0, 2000)}

Return ONLY JSON: {"description": "..."}.`);
  let fresh;
  try { fresh = jsonLoose(text).description; } catch { throw Object.assign(new Error("AI copy unreadable — please retry"), { status: 502 }); }

  return {
    summary: `Refresh copy for stale post "${sanitizeText(job.title, 100)}".`,
    proposal: {
      jobId: job._id.toString(),
      jobTitle: sanitizeText(job.title, 200),
      description: sanitizeText(fresh, 8000),
    },
  };
};

byId("job-post-refresher").execute = async (db, uid, action) => {
  const job = await db.collection("find_jobs").findOne({ _id: new ObjectId(action.proposal.jobId) });
  const recruiter = await db.collection("users").findOne({ firebaseUid: uid }, { projection: { companyName: 1, displayName: 1, _id: 0 } });
  const ownsJob = job && (job.postedBy === uid || job.company === (recruiter?.companyName || recruiter?.displayName));
  if (!ownsJob) throw Object.assign(new Error("You do not own this job post"), { status: 403 });

  await db.collection("find_jobs").updateOne(
    { _id: job._id },
    { $set: { description: action.proposal.description, updatedAt: new Date() } }
  );
  return { result: { jobId: action.proposal.jobId }, summary: `Job post "${action.proposal.jobTitle}" description refreshed.` };
};

export { AGENTS };

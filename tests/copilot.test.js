// tests/copilot.test.js
// Phase 3 recruiter copilot (PLAN §4.7): pipeline-summary aggregation,
// outreach-draft ownership + grounding, JD-grounded interview questions,
// Zod validation, and LLM-off template fallbacks. No network, no real DB —
// services/llm.js, config/db.js, config/mongoose.js and middleware/auth.js are
// mocked for the whole file.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { ObjectId } from "mongodb";

vi.mock("../config/db.js", () => ({
  connectDB: vi.fn(async () => {}),
  getDB: vi.fn(() => globalThis.__testDb),
}));

vi.mock("../config/mongoose.js", () => ({
  connectMongoose: vi.fn(async () => null),
  syncAllIndexes: vi.fn(async () => ({ total: 0, synced: 0, failed: [] })),
}));

vi.mock("../middleware/auth.js", () => ({
  verifyToken: (req, res, next) => {
    if (!globalThis.__testUser) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing Token" });
    }
    req.user = globalThis.__testUser;
    return next();
  },
}));

vi.mock("../services/llm.js", () => {
  class LLMConfigError extends Error {
    constructor(message) {
      super(message);
      this.name = "LLMConfigError";
      this.permanent = true;
    }
  }
  class LLMOutputError extends Error {
    constructor(message, opts = {}) {
      super(message);
      this.name = "LLMOutputError";
      this.raw = opts.raw ?? null;
      this.issues = opts.issues ?? null;
    }
  }
  return {
    generateText: vi.fn(async () => "mocked text"),
    generateJSON: vi.fn(async () => ({})),
    extractJSON: vi.fn((text) => JSON.parse(text)),
    isLLMAvailable: vi.fn(() => false),
    disableLLM: vi.fn(),
    getModelList: vi.fn(() => ["mock-model"]),
    LLMConfigError,
    LLMOutputError,
  };
});

import app from "../api/index.js";
import { generateJSON, isLLMAvailable } from "../services/llm.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RECRUITER = {
  firebaseUid: "r1",
  displayName: "Rita Boss",
  companyName: "Acme",
  role: "recruiter",
};
const CANDIDATE = { firebaseUid: "c1", displayName: "Alex Kim", title: "Frontend Developer" };

const OWNED_JOBS = [
  {
    _id: new ObjectId("64b0bb000000000000000001"),
    title: "Frontend Developer",
    company: "Acme",
    postedBy: "r1",
    status: "approved",
    skills: ["JavaScript", "React", "CSS"],
    niceToHaveSkills: [],
    requiredSkills: [],
    preferredSkills: [],
    description: "Front-end work.",
  },
  {
    _id: new ObjectId("64b0bb000000000000000002"),
    title: "Backend Developer",
    company: "Acme",
    postedBy: "r1",
    status: "approved",
    skills: ["Node.js", "SQL"],
    niceToHaveSkills: [],
    requiredSkills: [],
    preferredSkills: [],
    description: "Back-end work.",
  },
  {
    _id: new ObjectId("64b0bb000000000000000003"),
    title: "Data Analyst",
    company: "Acme",
    postedBy: "someone-else", // owned via company match — same rule as my-jobs
    status: "approved",
    skills: ["SQL", "Python"],
    niceToHaveSkills: [],
    requiredSkills: [],
    preferredSkills: [],
    description: "Analytics.",
  },
];

const UNOWNED_JOB = {
  _id: new ObjectId("64b0bb000000000000000009"),
  title: "Security Engineer",
  company: "OtherCo",
  postedBy: "stranger",
  status: "approved",
  skills: ["Security"],
  description: "Not this recruiter's job.",
};

const NOW = Date.now();
const DAY = 86_400_000;

// 7 applications → deterministic aggregates (see assertions below).
const PIPELINE_APPS = [
  {
    _id: new ObjectId("64b0bb000000000000000011"),
    jobId: OWNED_JOBS[0]._id,
    firebaseUid: "c1",
    status: "applied",
    createdAt: new Date(NOW - 10 * DAY),
    aiScore: { total: 88, breakdown: { assessment: 70 }, missingSkills: ["React", "SQL"] },
  },
  {
    _id: new ObjectId("64b0bb000000000000000012"),
    jobId: OWNED_JOBS[0]._id,
    firebaseUid: "c1",
    status: "submitted",
    createdAt: new Date(NOW - DAY),
    aiScore: { total: 74, breakdown: { assessment: 65 }, missingSkills: ["React"] },
  },
  {
    _id: new ObjectId("64b0bb000000000000000013"),
    jobId: OWNED_JOBS[1]._id,
    firebaseUid: "c2",
    status: "submitted",
    createdAt: new Date(NOW - 3_600_000),
    aiScore: { total: 52, breakdown: { assessment: null }, missingSkills: ["TypeScript"] },
  },
  {
    _id: new ObjectId("64b0bb000000000000000014"),
    jobId: OWNED_JOBS[1]._id,
    firebaseUid: "c2",
    status: "shortlisted",
    createdAt: new Date(NOW - 2 * DAY),
    aiScore: { total: 66, breakdown: { assessment: 80 }, missingSkills: ["React"] },
  },
  {
    _id: new ObjectId("64b0bb000000000000000015"),
    jobId: OWNED_JOBS[2]._id,
    firebaseUid: "c3",
    status: "shortlisted",
    createdAt: new Date(NOW - DAY),
    aiScore: { total: 45, breakdown: { assessment: 55 }, missingSkills: ["TypeScript", "SQL"] },
  },
  {
    _id: new ObjectId("64b0bb000000000000000016"),
    jobId: OWNED_JOBS[2]._id,
    firebaseUid: "c3",
    status: "rejected",
    createdAt: new Date(NOW - 3 * DAY),
    aiScore: null,
  },
  {
    _id: new ObjectId("64b0bb000000000000000017"),
    jobId: OWNED_JOBS[0]._id,
    firebaseUid: "c4",
    status: "interviewing",
    createdAt: new Date(NOW - 4 * DAY),
    aiScore: { total: 91, breakdown: { assessment: 90 }, missingSkills: [] },
    communicationScore: 80,
  },
];

const OUTREACH_APP = {
  _id: new ObjectId("64b0bb000000000000000021"),
  jobId: OWNED_JOBS[0]._id,
  firebaseUid: "c1",
  jobTitle: "Frontend Developer",
  company: "Acme",
  status: "shortlisted",
  aiScore: {
    total: 87,
    matchedSkills: ["React", "JavaScript", "CSS"],
    evidence: [{ label: "Skill match", detail: "React and JavaScript appear in the resume" }],
  },
  communicationScore: 76,
};

const INTERVIEW_JOB = {
  _id: new ObjectId("64b0bb000000000000000031"),
  title: "Frontend Developer",
  company: "Acme",
  postedBy: "r1",
  status: "approved",
  skills: ["JavaScript", "SQL"],
  niceToHaveSkills: [],
  requiredSkills: [],
  preferredSkills: [],
  description: "Front-end work.",
};

const INTERVIEW_APP = {
  _id: new ObjectId("64b0bb000000000000000032"),
  jobId: INTERVIEW_JOB._id,
  firebaseUid: "c1",
  status: "shortlisted",
  aiScore: {
    total: 70,
    missingSkills: ["React", "TypeScript"],
    adjacentSkills: [{ candidateSkill: "JS", jobSkill: "JavaScript", credit: 0.8 }],
  },
};

// ── Mock DB ──────────────────────────────────────────────────────────────────

function cursor(list) {
  const c = {};
  c.limit = vi.fn(() => c);
  c.project = vi.fn(() => c);
  c.sort = vi.fn(() => c);
  c.toArray = vi.fn(async () => list);
  return c;
}

function makeDb({ jobs = [], apps = [], users = [RECRUITER, CANDIDATE] } = {}) {
  const findJobs = {
    find: vi.fn(() => cursor(jobs)),
    findOne: vi.fn(
      async (filter = {}) => jobs.find((job) => String(job._id) === String(filter._id)) || null,
    ),
  };
  const applications = {
    find: vi.fn((filter = {}) => {
      const ids = filter?.jobId?.$in;
      const list = Array.isArray(ids)
        ? apps.filter((app) => ids.some((id) => String(id) === String(app.jobId)))
        : apps;
      return cursor(list);
    }),
    findOne: vi.fn(
      async (filter = {}) => apps.find((app) => String(app._id) === String(filter._id)) || null,
    ),
  };
  const userCollection = {
    findOne: vi.fn(
      async (filter = {}) =>
        (filter.firebaseUid && users.find((user) => user.firebaseUid === filter.firebaseUid)) || null,
    ),
  };

  return {
    collection: vi.fn((name) => {
      if (name === "find_jobs") return findJobs;
      if (name === "applications") return applications;
      if (name === "users") return userCollection;
      if (name === "skills") return { find: vi.fn(() => cursor([])) };
      return {
        find: vi.fn(() => cursor([])),
        findOne: vi.fn(async () => null),
        updateOne: vi.fn(async () => ({ matchedCount: 0 })),
      };
    }),
    __findJobs: findJobs,
    __applications: applications,
    __users: userCollection,
  };
}

// Unique client IP per request so the shared aiLimiter (10 / 5 min) never
// throttles the suite — the app sets trust proxy, so X-Forwarded-For keys it.
let ipCounter = 0;
function postJson(path) {
  ipCounter += 1;
  const octet = (ipCounter % 250) + 1;
  return request(app)
    .post(path)
    .set("X-Forwarded-For", `10.77.${Math.floor(ipCounter / 250)}.${octet}`)
    .set("Content-Type", "application/json");
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__testUser = { uid: RECRUITER.firebaseUid, role: RECRUITER.role };
  globalThis.__testDb = makeDb({ jobs: OWNED_JOBS, apps: PIPELINE_APPS });
  isLLMAvailable.mockReturnValue(false);
  generateJSON.mockResolvedValue({});
});

// ── 1. Pipeline summary ──────────────────────────────────────────────────────

describe("POST /api/copilot/pipeline-summary", () => {
  it("401s without an authenticated user", async () => {
    globalThis.__testUser = null;
    const res = await postJson("/api/copilot/pipeline-summary").send({ uid: "r1" });
    expect(res.status).toBe(401);
  });

  it("403s for non-recruiters", async () => {
    globalThis.__testUser = { uid: "c1", role: "candidate" };
    const res = await postJson("/api/copilot/pipeline-summary").send({ uid: "c1" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false });
  });

  it("aggregates the recruiter's real pipeline into a templated summary (LLM off)", async () => {
    const res = await postJson("/api/copilot/pipeline-summary").send({ uid: "r1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { summary, insights } = res.body.data;
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
    expect(Array.isArray(insights)).toBe(true);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((insight) => typeof insight === "string")).toBe(true);

    // 3 jobs / 7 applications fixture → exact aggregate numbers.
    expect(summary).toContain("7 application(s)");
    expect(summary).toContain("3 job post(s)");
    expect(summary).toContain("2 shortlisted");
    expect(summary).toContain("80-100: 2");
    expect(summary).toContain("5 of 7"); // assessment coverage
    expect(summary).toMatch(/Oldest pending: "applied" \(oldest waiting 10 day\(s\)\)/);

    // Top missing skill across applicants: react (3).
    expect(insights.some((insight) => insight.includes("react (3)"))).toBe(true);
    expect(insights.some((insight) => insight.includes("shortlisted"))).toBe(true);
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("scopes to a single job when jobId is given", async () => {
    const res = await postJson("/api/copilot/pipeline-summary").send({
      uid: "r1",
      jobId: String(OWNED_JOBS[0]._id),
    });

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toContain("3 application(s)");
    expect(res.body.data.summary).toContain("1 job post(s)");
  });

  it("403s when the recruiter does not own the requested job", async () => {
    globalThis.__testDb = makeDb({ jobs: [UNOWNED_JOB], apps: [] });
    const res = await postJson("/api/copilot/pipeline-summary").send({
      uid: "r1",
      jobId: String(UNOWNED_JOB._id),
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Access denied/);
  });

  it("rejects bad bodies via Zod (missing uid + malformed jobId)", async () => {
    const res = await postJson("/api/copilot/pipeline-summary").send({
      jobId: "not-an-object-id",
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: "Invalid request body" });
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["uid", "jobId"]),
    );
  });
});

// ── 2. Outreach draft ────────────────────────────────────────────────────────

describe("POST /api/copilot/outreach-draft", () => {
  it("403s when the recruiter does not own the application's job", async () => {
    globalThis.__testDb = makeDb({
      jobs: [UNOWNED_JOB],
      apps: [{ ...OUTREACH_APP, jobId: UNOWNED_JOB._id }],
    });
    const res = await postJson("/api/copilot/outreach-draft").send({
      uid: "r1",
      applicationId: String(OUTREACH_APP._id),
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Access denied/);
  });

  it("403s when the body uid does not match the authenticated user", async () => {
    const res = await postJson("/api/copilot/outreach-draft").send({
      uid: "r2",
      applicationId: String(OUTREACH_APP._id),
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/does not match/);
  });

  it("returns a well-formed deterministic draft when the LLM is unavailable", async () => {
    globalThis.__testDb = makeDb({ jobs: OWNED_JOBS, apps: [OUTREACH_APP] });

    const res = await postJson("/api/copilot/outreach-draft").send({
      uid: "r1",
      applicationId: String(OUTREACH_APP._id),
    });

    expect(res.status).toBe(200);
    const { subject, body } = res.body.data;
    expect(typeof subject).toBe("string");
    expect(subject.length).toBeGreaterThan(0);
    expect(typeof body).toBe("string");
    expect(body).toContain("Alex Kim"); // candidate display name (real data)
    expect(body).toContain("Frontend Developer"); // job title (real data)
    expect(body).toContain("Acme"); // company (real data)
    expect(body).toContain("87"); // aiScore.total (real data)
    expect(body).toContain("React"); // matched skills (real data)
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("passes the grounded payload to the LLM and returns its validated draft", async () => {
    globalThis.__testDb = makeDb({ jobs: OWNED_JOBS, apps: [OUTREACH_APP] });
    isLLMAvailable.mockReturnValue(true);
    const llmDraft = {
      subject: "Frontend Developer — we would love to talk",
      body: "Hi Alex, your application caught our eye. Would you have time for a quick call this week?",
    };
    generateJSON.mockResolvedValue(llmDraft);

    const res = await postJson("/api/copilot/outreach-draft").send({
      uid: "r1",
      applicationId: String(OUTREACH_APP._id),
      tone: "enthusiastic",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(llmDraft);

    const call = generateJSON.mock.calls[0][0];
    expect(call.promptTag).toBe("copilot.outreach");
    expect(call.prompt).toContain("<outreach_data>");
    expect(call.prompt).toContain("Alex Kim");
    expect(call.prompt).toContain("enthusiastic");
    expect(call.system).toMatch(/UNTRUSTED/i);
    expect(call.schema.safeParse({ subject: "s", body: "b" }).success).toBe(true);
  });

  it("rejects an invalid tone via Zod", async () => {
    const res = await postJson("/api/copilot/outreach-draft").send({
      uid: "r1",
      applicationId: String(OUTREACH_APP._id),
      tone: "angry",
    });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((issue) => issue.path)).toContain("tone");
  });
});

// ── 3. Interview questions ───────────────────────────────────────────────────

describe("POST /api/copilot/interview-questions", () => {
  it("covers the candidate's missing skills as flagged focus areas (LLM off)", async () => {
    globalThis.__testDb = makeDb({ jobs: [INTERVIEW_JOB], apps: [INTERVIEW_APP] });

    const res = await postJson("/api/copilot/interview-questions").send({
      uid: "r1",
      jobId: String(INTERVIEW_JOB._id),
      applicationId: String(INTERVIEW_APP._id),
    });

    expect(res.status).toBe(200);
    const { questions } = res.body.data;
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(questions.length).toBeLessThanOrEqual(8);

    const skills = questions.map((entry) => entry.skill);
    expect(skills).toContain("React"); // missing skill from aiScore
    expect(skills).toContain("TypeScript"); // missing skill from aiScore

    const reactQuestion = questions.find((entry) => entry.skill === "React");
    expect(reactQuestion.whatToLookFor).toMatch(/^Gap focus:/);
    expect(reactQuestion.question).toContain("React");

    for (const entry of questions) {
      expect(entry.question.length).toBeGreaterThan(0);
      expect(entry.whatToLookFor.length).toBeGreaterThan(0);
    }
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("returns the LLM's validated, focus-covering question set when available", async () => {
    globalThis.__testDb = makeDb({ jobs: [INTERVIEW_JOB], apps: [INTERVIEW_APP] });
    isLLMAvailable.mockReturnValue(true);
    const generated = {
      questions: ["React", "TypeScript", "JavaScript", "SQL", "communication", "collaboration"].map(
        (skill) => ({
          skill,
          question: `Tell me about your ${skill} experience.`,
          whatToLookFor:
            skill === "React" ? "Gap focus: probe React depth." : `Solid ${skill} fundamentals.`,
        }),
      ),
    };
    generateJSON.mockResolvedValue(generated);

    const res = await postJson("/api/copilot/interview-questions").send({
      uid: "r1",
      jobId: String(INTERVIEW_JOB._id),
      applicationId: String(INTERVIEW_APP._id),
    });

    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(6);

    const call = generateJSON.mock.calls[0][0];
    expect(call.promptTag).toBe("copilot.questions");
    expect(call.prompt).toContain("<job_data>");
    expect(call.prompt).toContain("React"); // focus skills injected
    expect(call.system).toMatch(/UNTRUSTED/i);
    const schemaCheck = call.schema.safeParse({ questions: res.body.data.questions });
    expect(schemaCheck.success).toBe(true);
  });

  it("403s when the recruiter does not own the job", async () => {
    globalThis.__testDb = makeDb({ jobs: [UNOWNED_JOB], apps: [] });
    const res = await postJson("/api/copilot/interview-questions").send({
      uid: "r1",
      jobId: String(UNOWNED_JOB._id),
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Access denied/);
  });

  it("rejects a malformed jobId via Zod", async () => {
    const res = await postJson("/api/copilot/interview-questions").send({
      uid: "r1",
      jobId: "nope",
    });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((issue) => issue.path)).toContain("jobId");
  });
});

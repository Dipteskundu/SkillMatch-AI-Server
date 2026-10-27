// controllers/resumeController.js
//
// Resume upload supports BOTH modes:
//   • async (default): validate the file bytes, persist the resume doc
//     (extractionStatus: "queued", raw bytes moved into the doc immediately),
//     enqueue a `resume.extract` job and respond right away with
//     { resumeId, extractionStatus: "queued" }. The frontend polls
//     GET /api/resume/status/:uid.
//   • sync (backward compatible): ?sync=true or the X-Sync-Resume: 1 header
//     runs the whole pipeline inline and returns the original response shape
//     (data.skills / technologies / experience_years / role_titles).
//
// The client-supplied mimetype is never trusted: magic bytes are checked
// before anything is stored (mismatch -> 400).

import { getDB } from "../config/db.js";
import { validateResumeFileMagic } from "../services/resumeParserService.js";
import { runResumePipeline } from "../services/resumePipeline.js";
import { enqueue, getJob } from "../services/queue.js";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

function wantsSyncMode(req) {
  if (req.query?.sync === "true" || req.query?.sync === "1") return true;
  const header = req.get("x-sync-resume");
  return header === "1" || header?.toLowerCase() === "true";
}

/** Handle resume upload: validation, then async (queued) or sync processing. */
async function uploadResume(req, res) {
  try {
    const { candidateId } = req.body;
    const file = req.file;

    if (!candidateId) {
      return res.status(400).json({ success: false, message: "candidateId is required" });
    }
    if (!file) {
      return res.status(400).json({ success: false, message: "Resume file is required" });
    }

    // Reject files whose bytes don't match the declared mimetype (400).
    const magic = validateResumeFileMagic(file);
    if (!magic.ok) {
      return res.status(400).json({ success: false, message: magic.message });
    }

    const db = getDB();
    const resumesCollection = db.collection("resumes");

    // ── Sync mode: original behavior (inline pipeline, old response shape) ──
    if (wantsSyncMode(req)) {
      const outcome = await runResumePipeline({ candidateId, file });
      if (outcome.status === "failed") {
        return res.status(500).json({
          success: false,
          message: outcome.error || "Server error during resume processing",
        });
      }
      return res.status(200).json({
        success: true,
        message: "Resume processed successfully",
        warning: outcome.warning || undefined,
        data: {
          skills: outcome.skills,
          technologies: outcome.technologies,
          experience_years: outcome.experience_years,
          role_titles: outcome.role_titles,
        },
      });
    }

    // ── Async mode: persist doc + bytes, enqueue, respond immediately ───────
    // File bytes go straight into the doc (they leave the request's memory
    // here, and are $unset by the pipeline once parsed).
    const resumeDoc = {
      candidateId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      fileBuffer: file.buffer,
      extractedText: "",
      extractedSkills: [],
      extractedExperience: 0,
      extractedTechnologies: [],
      extractedRoles: [],
      normalizedSkills: [],
      injectionFlags: [],
      extractionStatus: "queued",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await resumesCollection.insertOne(resumeDoc);

    let jobId = null;
    try {
      ({ jobId } = await enqueue("resume.extract", {
        resumeId: String(insertedId),
        candidateId,
      }));
      await resumesCollection.updateOne({ _id: insertedId }, { $set: { jobId } });
    } catch (queueError) {
      console.error("Resume enqueue failed:", queueError);
      await resumesCollection
        .updateOne(
          { _id: insertedId },
          {
            $set: {
              extractionStatus: "failed",
              error: queueError?.message || "Failed to enqueue resume processing",
              processedAt: new Date(),
              updatedAt: new Date(),
            },
            $unset: { fileBuffer: "" },
          },
        )
        .catch(() => {});
      return res.status(500).json({
        success: false,
        message: "Failed to queue resume processing. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Resume uploaded and queued for processing",
      data: {
        resumeId: String(insertedId),
        extractionStatus: "queued",
      },
    });
  } catch (error) {
    console.error("Upload Resume Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error during resume processing",
    });
  }
}

/**
 * GET /api/resume/status/:uid
 * Latest resume doc for the candidate + whether a processing job is active.
 * Response shape is stable so the frontend can poll blindly.
 */
async function getResumeStatus(req, res) {
  try {
    const uid = req.params.uid;
    if (!uid) {
      return res.status(400).json({ success: false, message: "uid is required" });
    }

    const db = getDB();
    const resumesCollection = db.collection("resumes");

    const resume = await resumesCollection
      .find({ candidateId: uid })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    const doc = resume[0] || null;

    // Is the extraction job for this resume still queued/running?
    let hasActiveJob = false;
    if (doc?.jobId) {
      const job = await getJob(doc.jobId).catch(() => null);
      hasActiveJob = Boolean(job && ACTIVE_JOB_STATUSES.has(job.status));
    }
    // Fallback when the job record is gone but the doc never progressed.
    if (!hasActiveJob && doc && ACTIVE_JOB_STATUSES.has(doc.extractionStatus) && !doc.jobId) {
      hasActiveJob = true;
    }

    return res.status(200).json({
      success: true,
      data: {
        resume: doc
          ? {
              _id: doc._id,
              extractionStatus: doc.extractionStatus || "queued",
              normalizedSkills: doc.normalizedSkills || [],
              extractedExperience: doc.extractedExperience ?? 0,
              injectionFlags: doc.injectionFlags || [],
              error: doc.error || undefined,
              processedAt: doc.processedAt || undefined,
              originalName: doc.originalName || "",
              createdAt: doc.createdAt,
            }
          : null,
        hasActiveJob,
      },
    });
  } catch (error) {
    console.error("Resume Status Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching resume status",
    });
  }
}

export { uploadResume, getResumeStatus };

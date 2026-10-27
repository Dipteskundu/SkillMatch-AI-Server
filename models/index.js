// models/index.js
// Barrel that registers every Mongoose model on the default connection.
// Importing this module is enough to have all schemas + indexes defined.

export { User, USER_ROLES, USER_STATUSES } from "./User.js";
export { Job, JOB_STATUSES } from "./Job.js";
export { Application, APPLICATION_STATUSES } from "./Application.js";
export { Skill } from "./Skill.js";
export { Assessment, AssessmentResult, ASSESSMENT_RESULTS } from "./Assessment.js";
export { Notification } from "./Notification.js";
export { Resume, RESUME_COLLECTION } from "./Resume.js";
export { Interview, INTERVIEW_STATUSES, INTERVIEW_COLLECTION } from "./Interview.js";
export { Task, TASK_COLLECTION } from "./Task.js";
export { TaskSubmission } from "./TaskSubmission.js";
export { ChatHistory, CHAT_HISTORY_COLLECTION, getChatHistoryCollection } from "./ChatHistory.js";
export { SkillGap, SKILL_GAP_COLLECTION } from "./SkillGap.js";
export { Company } from "./Company.js";
export { CompanyFollow } from "./CompanyFollow.js";
export { SavedJob } from "./SavedJob.js";
export { CommunicationTest, STATUS, COLLECTION } from "./communicationTest.model.js";
export { CommunicationVerification, COMM_VER_COLLECTION } from "./CommunicationVerification.js";
export { seedStarterSkills, STARTER_SKILLS, slugify } from "./skillSeed.js";
// Phase 4 — SkillForge Learning Hub
export { Technology } from "./Technology.js";
export { LearningPath, PATH_LEVELS, PATH_STATUSES, LESSON_TYPES } from "./LearningPath.js";
export { UserProgress } from "./UserProgress.js";
export { Certificate, generateVerifiableCode } from "./Certificate.js";
// Phase 5 — Trust & Launch
export { Subscription, SUBSCRIPTION_STATUSES } from "./Subscription.js";
export { CreditLedger } from "./CreditLedger.js";
export { ApiKey } from "./ApiKey.js";
export { AuditLog } from "./AuditLog.js";

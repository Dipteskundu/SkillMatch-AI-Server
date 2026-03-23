// models/SystemKnowledge.js
// Schema reference for systemKnowledge collection

/**
 * Document structure for systemKnowledge collection
 *
 * {
 *   _id: ObjectId,
 *   slug: string,
 *   title: string,
 *   role: "all" | "candidate" | "recruiter" | "admin",
 *   keywords: Array<string>,
 *   content: string,
 *   status: "active" | "draft",
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */

const COLLECTION = "systemKnowledge";

export { COLLECTION };

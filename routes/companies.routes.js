// routes/companies.routes.js
// Handles company-related API routes

import express from "express";
import { getDB } from "../config/db.js";
import { mockCompanies } from "../data/mockData.js";
import { followRuntimeCompany } from "../services/runtimeStore.js";

const router = express.Router();


async function getAllCompaniesHandler(req, res) {
  if (req.dbUnavailable) {
    return res.status(200).json({
      success: true,
      count: mockCompanies.length,
      data: mockCompanies,
      fallback: true,
      message: "Showing fallback companies while the database is unavailable.",
    });
  }

  try {
    // 1️⃣ Get database connection
    const db = getDB();

    // 2️⃣ Fetch all companies from the correct collection
    //    You said your collection is named "companies_info"
    const companies = await db
      .collection("companies_info")
      .find({})
      .toArray();

    // 3️⃣ Send response
    res.status(200).json({
      success: true,
      count: companies.length,
      data: companies,
    });

  } catch (error) {
    console.error("GET Companies Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error while fetching companies",
    });
  }
}

// GET: Get All Companies
// ===============================
router.get("/api/v1/companies", getAllCompaniesHandler);
router.get("/api/companies", getAllCompaniesHandler);


async function createCompanyHandler(req, res) {
  try {
    const db = getDB();

    // 1️⃣ Extract data from request body
    const { name, industry, location, description, logo, companySize, website } = req.body;

    // 2️⃣ Simple validation (beginner level)
    if (!name || !industry || !location) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, industry, and location",
      });
    }

    // 3️⃣ Create company object
    const newCompany = {
      name,
      industry,
      location,
      description: description || "",
      logo: logo || "",
      companySize: companySize || "",
      website: website || "",
      createdAt: new Date(),
    };

    // 4️⃣ Insert into database
    const result = await db
      .collection("companies_info")
      .insertOne(newCompany);

    // 5️⃣ Send response
    res.status(201).json({
      success: true,
      message: "Company created successfully",
      data: {
        _id: result.insertedId,
        ...newCompany,
      },
    });

  } catch (error) {
    console.error("POST Company Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error while creating company",
    });
  }
}

// POST: Create New Company
// ===============================
router.post("/api/v1/companies", createCompanyHandler);
router.post("/api/companies", createCompanyHandler);


// POST: Follow a Company
// ===============================
router.post("/api/v1/companies/:id/follow", async (req, res) => {
  if (req.dbUnavailable) {
    const { uid, email } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: "uid and email are required",
      });
    }

    followRuntimeCompany(uid, req.params.id);

    return res.status(200).json({
      success: true,
      message: "Company followed successfully",
      fallback: true,
    });
  }

  try {
    const db = getDB();
    const { id } = req.params;
    const { uid, email } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: "uid and email are required",
      });
    }

    const follows = db.collection("company_follows");

    await follows.updateOne(
      { companyId: id, firebaseUid: uid },
      {
        $setOnInsert: {
          createdAt: new Date(),
        },
        $set: {
          email,
        },
      },
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Company followed successfully",
    });
  } catch (error) {
    console.error("FOLLOW Company Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while following company",
    });
  }
});


export default router;

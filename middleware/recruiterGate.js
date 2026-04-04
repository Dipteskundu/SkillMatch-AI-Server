export function requireRecruiter(req, res, next) {
  const role = req.user?.role;
  if (!role) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  if (role !== "recruiter" && role !== "employer" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Recruiter access required" });
  }

  return next();
}

export function requireCandidate(req, res, next) {
  const role = req.user?.role;
  if (!role) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  if (role !== "candidate" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Candidate access required" });
  }

  return next();
}

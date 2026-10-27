// models/skillSeed.js
// Idempotent starter seed for the canonical Skill vocabulary (Phase 2 matching).
// Inserts ONLY when the "skills" collection is empty; safe to call on every boot.

import { Skill } from "./Skill.js";

/** Convert a display name to a URL-safe slug ("C++" -> "c-plus-plus"). */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/\+\+/g, "-plus")
    .replace(/#/g, "-sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Starter canonical skill list: ~85 common skills with aliases used in the wild
 * (js -> javascript, k8s -> kubernetes, pg -> postgresql, ...) plus adjacency.
 * Shape: { name, aliases, category, demand (0-100), adjacency (slugs) }
 */
export const STARTER_SKILLS = [
  // Programming languages
  { name: "JavaScript", aliases: ["js", "ecmascript"], category: "language", demand: 98, adjacency: ["typescript", "react", "node-js"] },
  { name: "TypeScript", aliases: ["ts"], category: "language", demand: 92, adjacency: ["javascript", "react", "node-js"] },
  { name: "Python", aliases: ["py"], category: "language", demand: 96, adjacency: ["pandas", "machine-learning", "django"] },
  { name: "Java", aliases: [], category: "language", demand: 88, adjacency: ["spring-boot", "kotlin"] },
  { name: "C++", aliases: ["cpp", "c plus plus"], category: "language", demand: 72, adjacency: ["c-sharp", "rust"] },
  { name: "C#", aliases: ["csharp", "dotnet-lang"], category: "language", demand: 74, adjacency: ["net", "unity"] },
  { name: "Go", aliases: ["golang"], category: "language", demand: 78, adjacency: ["docker", "kubernetes"] },
  { name: "Rust", aliases: ["rs"], category: "language", demand: 65, adjacency: ["go", "c-plus-plus"] },
  { name: "PHP", aliases: [], category: "language", demand: 60, adjacency: ["laravel"] },
  { name: "Swift", aliases: ["ios"], category: "language", demand: 58, adjacency: ["kotlin", "objective-c"] },
  { name: "Kotlin", aliases: ["android"], category: "language", demand: 62, adjacency: ["java", "swift"] },
  { name: "Ruby", aliases: ["rb"], category: "language", demand: 45, adjacency: ["rails", "python"] },
  { name: "Scala", aliases: [], category: "language", demand: 38, adjacency: ["java", "spark"] },
  { name: "R", aliases: ["rlang"], category: "language", demand: 50, adjacency: ["data-analysis", "statistics"] },
  { name: "SQL", aliases: ["structured query language"], category: "language", demand: 94, adjacency: ["postgresql", "mysql", "data-analysis"] },

  // Frontend / web
  { name: "HTML", aliases: ["html5", "hypertext markup language"], category: "web", demand: 95, adjacency: ["css", "javascript"] },
  { name: "CSS", aliases: ["css3"], category: "web", demand: 93, adjacency: ["html", "tailwind-css", "sass"] },
  { name: "React", aliases: ["reactjs", "react.js"], category: "framework", demand: 97, adjacency: ["javascript", "next-js", "typescript"] },
  { name: "Vue.js", aliases: ["vue", "vuejs"], category: "framework", demand: 80, adjacency: ["javascript", "nuxt-js"] },
  { name: "Angular", aliases: ["angularjs"], category: "framework", demand: 76, adjacency: ["typescript", "javascript"] },
  { name: "Next.js", aliases: ["nextjs", "next"], category: "framework", demand: 90, adjacency: ["react", "node-js", "typescript"] },
  { name: "Svelte", aliases: ["sveltekit"], category: "framework", demand: 62, adjacency: ["javascript", "react"] },
  { name: "Tailwind CSS", aliases: ["tailwind", "tailwindcss"], category: "framework", demand: 89, adjacency: ["css", "react"] },
  { name: "Bootstrap", aliases: [], category: "framework", demand: 55, adjacency: ["css", "html"] },
  { name: "jQuery", aliases: ["jquery"], category: "framework", demand: 30, adjacency: ["javascript", "html"] },
  { name: "Sass", aliases: ["scss"], category: "tool", demand: 58, adjacency: ["css"] },

  // Backend / APIs
  { name: "Node.js", aliases: ["node", "nodejs", "node js"], category: "runtime", demand: 94, adjacency: ["express", "javascript", "mongodb"] },
  { name: "Express", aliases: ["express.js", "expressjs"], category: "framework", demand: 88, adjacency: ["node-js", "mongodb"] },
  { name: "Django", aliases: [], category: "framework", demand: 70, adjacency: ["python", "postgresql"] },
  { name: "Flask", aliases: [], category: "framework", demand: 66, adjacency: ["python"] },
  { name: "Spring Boot", aliases: ["spring", "springboot"], category: "framework", demand: 78, adjacency: ["java"] },
  { name: ".NET", aliases: ["dotnet", "asp.net", "dot net"], category: "framework", demand: 72, adjacency: ["c-sharp"] },
  { name: "Laravel", aliases: [], category: "framework", demand: 52, adjacency: ["php", "mysql"] },
  { name: "GraphQL", aliases: ["graph ql"], category: "api", demand: 74, adjacency: ["rest-api", "react"] },
  { name: "REST API", aliases: ["rest", "restful"], category: "api", demand: 92, adjacency: ["http", "graphql"] },
  { name: "Rails", aliases: ["ruby on rails", "ror"], category: "framework", demand: 40, adjacency: ["ruby"] },

  // Databases & storage
  { name: "MongoDB", aliases: ["mongo"], category: "database", demand: 90, adjacency: ["node-js", "express"] },
  { name: "PostgreSQL", aliases: ["postgres", "pg", "psql"], category: "database", demand: 91, adjacency: ["sql", "mysql"] },
  { name: "MySQL", aliases: [], category: "database", demand: 87, adjacency: ["sql", "postgresql"] },
  { name: "Redis", aliases: [], category: "database", demand: 76, adjacency: ["mongodb", "caching"] },
  { name: "Firebase", aliases: ["fire store", "firestore"], category: "database", demand: 84, adjacency: ["react", "node-js"] },
  { name: "Oracle", aliases: ["oracle db", "oracle database"], category: "database", demand: 64, adjacency: ["sql", "pl-sql"] },
  { name: "Microsoft SQL Server", aliases: ["mssql", "sql server"], category: "database", demand: 68, adjacency: ["sql", "t-sql"] },
  { name: "Elasticsearch", aliases: ["elastic", "elk"], category: "database", demand: 60, adjacency: ["kibana", "redis"] },

  // DevOps / cloud / platform
  { name: "Docker", aliases: ["docker-compose", "containers"], category: "devops", demand: 95, adjacency: ["kubernetes", "linux", "ci-cd"] },
  { name: "Kubernetes", aliases: ["k8s", "kube"], category: "devops", demand: 93, adjacency: ["docker", "terraform", "aws"] },
  { name: "AWS", aliases: ["amazon web services"], category: "cloud", demand: 97, adjacency: ["azure", "docker", "kubernetes"] },
  { name: "Azure", aliases: ["microsoft azure"], category: "cloud", demand: 88, adjacency: ["aws", "gcp"] },
  { name: "Google Cloud Platform", aliases: ["gcp", "google cloud"], category: "cloud", demand: 85, adjacency: ["aws", "kubernetes"] },
  { name: "Git", aliases: ["version control", "git vcs"], category: "tool", demand: 96, adjacency: ["github", "ci-cd"] },
  { name: "GitHub", aliases: ["gh"], category: "tool", demand: 94, adjacency: ["git"] },
  { name: "CI/CD", aliases: ["cicd", "continuous integration", "continuous delivery"], category: "devops", demand: 90, adjacency: ["jenkins", "github-actions", "docker"] },
  { name: "GitHub Actions", aliases: ["gh actions"], category: "devops", demand: 82, adjacency: ["ci-cd", "github"] },
  { name: "Jenkins", aliases: [], category: "devops", demand: 62, adjacency: ["ci-cd"] },
  { name: "Terraform", aliases: ["tf", "iac"], category: "devops", demand: 80, adjacency: ["aws", "kubernetes"] },
  { name: "Linux", aliases: ["unix", "ubuntu"], category: "devops", demand: 92, adjacency: ["bash", "docker"] },
  { name: "Nginx", aliases: ["engine x"], category: "devops", demand: 70, adjacency: ["linux", "docker"] },
  { name: "Prometheus", aliases: ["prom"], category: "devops", demand: 55, adjacency: ["grafana", "kubernetes"] },
  { name: "Grafana", aliases: [], category: "devops", demand: 58, adjacency: ["prometheus"] },

  // Data & AI
  { name: "Pandas", aliases: ["pandas-python"], category: "data", demand: 84, adjacency: ["python", "numpy", "data-analysis"] },
  { name: "NumPy", aliases: ["numpy"], category: "data", demand: 78, adjacency: ["python", "pandas"] },
  { name: "TensorFlow", aliases: ["tf"], category: "ai", demand: 74, adjacency: ["python", "deep-learning"] },
  { name: "PyTorch", aliases: ["torch"], category: "ai", demand: 80, adjacency: ["python", "deep-learning"] },
  { name: "scikit-learn", aliases: ["sklearn", "scikit learn"], category: "ai", demand: 76, adjacency: ["python", "machine-learning"] },
  { name: "Machine Learning", aliases: ["ml", "machine learning"], category: "ai", demand: 95, adjacency: ["python", "deep-learning", "data-analysis"] },
  { name: "Deep Learning", aliases: ["dl"], category: "ai", demand: 86, adjacency: ["machine-learning", "tensorflow", "pytorch"] },
  { name: "Data Analysis", aliases: ["data analytics", "analytics"], category: "data", demand: 91, adjacency: ["sql", "excel", "power-bi"] },
  { name: "Power BI", aliases: ["powerbi"], category: "data", demand: 83, adjacency: ["excel", "data-analysis"] },
  { name: "Tableau", aliases: [], category: "data", demand: 81, adjacency: ["data-analysis", "power-bi"] },
  { name: "Excel", aliases: ["microsoft excel", "spreadsheets"], category: "data", demand: 89, adjacency: ["data-analysis", "power-bi"] },

  // Testing
  { name: "Jest", aliases: [], category: "testing", demand: 72, adjacency: ["javascript", "react"] },
  { name: "Cypress", aliases: [], category: "testing", demand: 70, adjacency: ["javascript", "selenium"] },
  { name: "Selenium", aliases: ["selenium webdriver"], category: "testing", demand: 68, adjacency: ["python", "java"] },
  { name: "Postman", aliases: [], category: "testing", demand: 75, adjacency: ["rest-api", "swagger"] },

  // Design
  { name: "Figma", aliases: [], category: "design", demand: 92, adjacency: ["ui-ux-design", "sketch"] },
  { name: "UI/UX Design", aliases: ["ui design", "ux design", "user experience"], category: "design", demand: 88, adjacency: ["figma", "wireframing"] },
  { name: "Adobe Photoshop", aliases: ["photoshop", "psd"], category: "design", demand: 70, adjacency: ["adobe-illustrator"] },
  { name: "Adobe Illustrator", aliases: ["illustrator"], category: "design", demand: 60, adjacency: ["adobe-photoshop"] },

  // Soft skills
  { name: "Communication", aliases: ["communication skills", "verbal communication"], category: "soft_skill", demand: 97, adjacency: ["teamwork", "presentation"] },
  // Phase 4 (SkillForge): system design interviews / architecture skill.
  { name: "System Design", aliases: ["system design interview", "system architecture", "software architecture", "distributed systems"], category: "design", demand: 85, adjacency: ["sql", "communication", "aws"] },
  { name: "Leadership", aliases: ["leadership skills"], category: "soft_skill", demand: 88, adjacency: ["teamwork", "project-management"] },
  { name: "Teamwork", aliases: ["collaboration", "team player"], category: "soft_skill", demand: 94, adjacency: ["communication"] },
  { name: "Problem Solving", aliases: ["problem-solving", "critical problem solving"], category: "soft_skill", demand: 93, adjacency: ["critical-thinking"] },
  { name: "Time Management", aliases: ["time management"], category: "soft_skill", demand: 85, adjacency: ["project-management"] },
  { name: "Critical Thinking", aliases: ["critical thinking"], category: "soft_skill", demand: 87, adjacency: ["problem-solving"] },
  { name: "Adaptability", aliases: ["flexibility"], category: "soft_skill", demand: 84, adjacency: ["teamwork"] },
  { name: "Presentation", aliases: ["presenting", "public speaking"], category: "soft_skill", demand: 82, adjacency: ["communication"] },

  // Product / marketing / operations
  { name: "Project Management", aliases: ["pm", "project manager"], category: "business", demand: 90, adjacency: ["agile", "scrum", "jira"] },
  { name: "Agile", aliases: ["agile methodology"], category: "business", demand: 91, adjacency: ["scrum", "jira"] },
  { name: "Scrum", aliases: ["scrum master"], category: "business", demand: 86, adjacency: ["agile", "jira"] },
  { name: "Jira", aliases: [], category: "tool", demand: 83, adjacency: ["agile", "confluence"] },
  { name: "SEO", aliases: ["search engine optimization"], category: "marketing", demand: 79, adjacency: ["digital-marketing", "content-marketing"] },
  { name: "Digital Marketing", aliases: ["online marketing"], category: "marketing", demand: 85, adjacency: ["seo", "content-marketing"] },
  { name: "Content Marketing", aliases: ["content strategy"], category: "marketing", demand: 76, adjacency: ["digital-marketing", "seo"] },
];

/**
 * Insert the starter skill list — only if the collection is empty.
 * Idempotent: a second call (or a partially seeded collection) is a no-op.
 * @returns {Promise<{skipped: boolean, seeded: number, reason?: string}>}
 */
export async function seedStarterSkills() {
  const existing = await Skill.countDocuments({});
  if (existing > 0) {
    return { skipped: true, seeded: 0, reason: `${existing} skills already present` };
  }

  const ops = STARTER_SKILLS.map(({ name, aliases, category, demand, adjacency }) => {
    const slug = slugify(name);
    return {
      updateOne: {
        filter: { slug },
        update: {
          $setOnInsert: {
            name,
            slug,
            aliases: aliases || [],
            taxonomy: { escoId: null, onetId: null },
            category: category || "general",
            adjacency: adjacency || [],
            demand: typeof demand === "number" ? demand : 0,
          },
        },
        upsert: true,
      },
    };
  });

  const result = await Skill.bulkWrite(ops, { ordered: false });
  return { skipped: false, seeded: result.upsertedCount ?? ops.length };
}

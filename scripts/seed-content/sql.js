// scripts/seed-content/sql.js — hand-authored, real SQL curriculum (Phase 4 seed).
// 3 modules · 9 lessons · 5-question quiz with explanations.
// Dialect notes: examples use standard SQL that runs on PostgreSQL/MySQL.

export const sqlPath = {
  technologySlug: "programming",
  skillSlug: "sql",
  title: "SQL",
  slug: "sql",
  level: "beginner",
  estimatedHours: 3.5,
  modules: [
    {
      title: "Querying Data",
      lessons: [
        {
          title: "SELECT, WHERE and ORDER BY",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Every SQL journey starts with SELECT: pull columns from a table, filter rows with WHERE, and sort with ORDER BY. These three clauses answer the majority of day-to-day data questions.",
            sections: [
              {
                heading: "The shape of a query",
                paragraphs: [
                  "A basic query reads: which columns (SELECT), from which table (FROM), which rows (WHERE), in what order (ORDER BY). SQL is declarative — you describe the result you want, and the engine's optimizer decides how to fetch it. The logical execution order differs from the written order: FROM → WHERE → SELECT → ORDER BY → LIMIT, which is why you can't reuse a SELECT alias inside WHERE.",
                ],
                code: {
                  lang: "sql",
                  text: `SELECT title, company, salary\nFROM jobs\nWHERE salary >= 80000\n  AND location = 'Remote'\nORDER BY salary DESC\nLIMIT 20;`,
                },
              },
              {
                heading: "Filtering precisely",
                paragraphs: [
                  "WHERE supports comparisons (=, <>, <, >), AND/OR/NOT, ranges with BETWEEN (inclusive), membership with IN, and pattern matching with LIKE (% matches any sequence, _ matches one character). Use ESCAPE when your data contains literal % or _ characters.",
                  "String comparison is case-sensitivity depends on the database and collation — in PostgreSQL = is case-sensitive, so use ILIKE (or lower(x) = lower(y)) for case-insensitive search.",
                ],
                code: {
                  lang: "sql",
                  text: `SELECT *\nFROM jobs\nWHERE title LIKE '%Engineer%'\n  AND experience_level IN ('junior', 'mid')\n  AND posted_at BETWEEN '2026-01-01' AND '2026-06-30'\n  AND salary IS NOT NULL;`,
                },
                list: [
                  "Select the columns you need — avoid SELECT * in production code.",
                  "IN beats chains of OR for membership; BETWEEN is inclusive on both ends.",
                  "WHERE filters rows BEFORE grouping; ORDER BY sorts the final result.",
                ],
              },
            ],
            takeaways: [
              "Write a filtered, sorted, limited query.",
              "Explain the logical order of SQL clauses and why aliases can't be used in WHERE.",
              "Use LIKE, IN, BETWEEN and IS NULL correctly.",
            ],
          },
        },
        {
          title: "Aggregates and GROUP BY",
          durationMin: 8,
          type: "article",
          content: {
            intro:
              "Aggregation collapses many rows into summary numbers: counts, sums, averages. GROUP BY decides which rows are collapsed together — it is how you answer 'per X' questions.",
            sections: [
              {
                heading: "Aggregate functions",
                paragraphs: [
                  "COUNT, SUM, AVG, MIN, MAX summarize column values across rows. COUNT(*) counts rows; COUNT(column) counts non-NULL values of that column — a distinction that shows up constantly in data interviews. AVG ignores NULLs rather than treating them as zero.",
                ],
                code: {
                  lang: "sql",
                  text: `SELECT company,\n       COUNT(*) AS job_count,\n       ROUND(AVG(salary), 0) AS avg_salary\nFROM jobs\nWHERE status = 'approved'\nGROUP BY company\nORDER BY job_count DESC;`,
                },
              },
              {
                heading: "Rules of grouping",
                paragraphs: [
                  "Every column in SELECT that is not inside an aggregate must appear in GROUP BY. Conceptually: the engine partitions rows into groups, then evaluates the SELECT expressions once per group. HAVING filters groups after aggregation — you cannot use it in WHERE because WHERE runs before grouping exists.",
                  "Classic order of operations: WHERE (row filter) → GROUP BY (partition) → HAVING (group filter) → SELECT (compute columns) → ORDER BY (sort).",
                ],
                code: {
                  lang: "sql",
                  text: `-- companies with more than 5 approved jobs, avg salary shown\nSELECT company,\n       COUNT(*) AS jobs,\n       ROUND(AVG(salary)) AS avg_salary\nFROM jobs\nWHERE status = 'approved'\nGROUP BY company\nHAVING COUNT(*) > 5\nORDER BY avg_salary DESC;`,
                },
                list: [
                  "COUNT(*) = rows in group; COUNT(col) = non-NULL values; COUNT(DISTINCT col) = unique non-NULL values.",
                  "WHERE filters rows, HAVING filters groups.",
                  "AVG/SUM silently ignore NULLs — check for them when numbers look too good.",
                ],
              },
            ],
            takeaways: [
              "Summarize rows per company with GROUP BY and aggregates.",
              "Use HAVING to filter groups and explain why it can't live in WHERE.",
              "Distinguish COUNT(*) from COUNT(column).",
            ],
          },
        },
        {
          title: "NULL Semantics",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "NULL means 'unknown' or 'missing' — not zero, not an empty string. Three-valued logic makes NULL behave surprisingly in comparisons, aggregates, and joins; knowing the rules prevents silent wrong answers.",
            sections: [
              {
                heading: "Comparisons with NULL",
                paragraphs: [
                  "Any comparison with NULL ( = NULL, <> NULL, even NULL = NULL) evaluates to UNKNOWN, not TRUE or FALSE — so WHERE drops those rows. That's why the idiomatic existence checks are IS NULL / IS NOT NULL. Similarly, NOT IN with a NULL in the list returns no rows at all (everything is UNKNOWN), a notorious bug source.",
                ],
                code: {
                  lang: "sql",
                  text: `-- WRONG: never matches NULL rows\nSELECT * FROM jobs WHERE salary = NULL;\n\n-- RIGHT\nSELECT * FROM jobs WHERE salary IS NULL;\n\n-- NOT IN trap: if ids contains ANY NULL, this returns ZERO rows\nSELECT * FROM applications WHERE candidate_id NOT IN (\n  SELECT id FROM blocklist WHERE id IS NOT NULL\n);`,
                },
              },
              {
                heading: "NULL in expressions and functions",
                paragraphs: [
                  "Arithmetic with NULL yields NULL (5 + NULL = NULL). Coalesce(col, fallback) returns the first non-NULL argument and is the standard way to supply defaults. NULLIF(a, b) returns NULL when a = b — handy for turning a divisor of zero into NULL instead of an error.",
                  "In sorted results, most databases order NULLs last for ASC by default (PostgreSQL: NULLS LAST for ASC, NULLS FIRST for DESC; MySQL sorts NULLs first in ASC). Be explicit if the order matters to users.",
                ],
                code: {
                  lang: "sql",
                  text: `SELECT title,\n       COALESCE(salary, 0) AS salary_or_zero,\n       ROUND(salary / NULLIF(applicant_count, 0), 2) AS salary_per_applicant\nFROM jobs;`,
                },
                list: [
                  "NULL is unknown — comparisons are UNKNOWN, not TRUE.",
                  "Never write = NULL; write IS NULL.",
                  "COALESCE for defaults, NULLIF to neutralize division by zero.",
                  "Guard NOT IN subqueries against NULLs — prefer NOT EXISTS.",
                ],
              },
            ],
            takeaways: [
              "Explain three-valued logic and why = NULL matches nothing.",
              "Supply defaults with COALESCE and safe division with NULLIF.",
              "Rewrite a fragile NOT IN check as NOT EXISTS.",
            ],
          },
        },
      ],
    },
    {
      title: "Joining Tables",
      lessons: [
        {
          title: "INNER and LEFT JOIN",
          durationMin: 8,
          type: "article",
          content: {
            intro:
              "Joins combine rows from two tables based on a related column. INNER JOIN keeps only matched pairs; LEFT JOIN keeps every row from the left table, filling unmatched columns with NULL. Choosing between them is choosing what your question is.",
            sections: [
              {
                heading: "The join types that matter most",
                paragraphs: [
                  "INNER JOIN returns rows where the condition matches in both tables — 'jobs that have an application'. LEFT JOIN returns all rows of the left table plus matches from the right, with NULL where no match exists — 'all jobs, with application counts (zero for none)'. RIGHT JOIN is LEFT JOIN with the sides swapped; FULL OUTER JOIN keeps unmatched rows from both.",
                ],
                code: {
                  lang: "sql",
                  text: `-- INNER: only jobs that received applications\nSELECT j.title, a.status\nFROM jobs j\nINNER JOIN applications a ON a.job_id = j.id;\n\n-- LEFT: every job, with its application (NULL if none)\nSELECT j.title, a.status\nFROM jobs j\nLEFT JOIN applications a ON a.job_id = j.id;`,
                },
              },
              {
                heading: "Common mistakes",
                paragraphs: [
                  "Putting the filter on the right table in WHERE after a LEFT JOIN silently converts it into an inner join: WHERE a.status = 'applied' removes the NULL-padded rows. Filter the right table in the ON clause (or use a subquery) to keep the left side intact.",
                  "The ON clause defines what 'matching' means; WHERE defines which result rows survive. With INNER JOIN the difference is often invisible — with LEFT JOIN it decides correctness. Also remember: join columns must be comparable types, and an accidental many-to-many join multiplies your rows — join keys should be unique on the 'one' side.",
                ],
                list: [
                  "INNER JOIN = matched rows only; LEFT JOIN = all left rows + matches.",
                  "Filter right-table conditions in ON, not WHERE, for LEFT JOINs.",
                  "Unexpected row counts usually mean a many-to-many join — check key uniqueness.",
                ],
              },
            ],
            takeaways: [
              "Write an INNER JOIN and a LEFT JOIN with correct ON conditions.",
              "Explain how a WHERE filter on the right table breaks a LEFT JOIN.",
              "Diagnose inflated row counts caused by non-unique join keys.",
            ],
          },
        },
        {
          title: "Joining Multiple Tables",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Real queries chain three or more tables: job → application → candidate → skills. The skill is keeping alias names and join conditions straight, and knowing when to use join syntax vs subqueries.",
            sections: [
              {
                heading: "Aliasing and chaining",
                paragraphs: [
                  "Table aliases (FROM jobs j) keep long joins readable. Each join adds one condition linking the new table to an already-joined one. Build the query incrementally: join, SELECT the columns you expect, verify row counts, then add the next join. A quick sanity check: count rows before and after each join to catch fan-out early.",
                ],
                code: {
                  lang: "sql",
                  text: `SELECT j.title,\n       c.name AS candidate,\n       a.score\nFROM jobs j\nJOIN applications a  ON a.job_id = j.id\nJOIN candidates   c  ON c.id = a.candidate_id\nLEFT JOIN resumes  r  ON r.candidate_id = c.id\nWHERE j.status = 'approved'\nORDER BY a.score DESC;`,
                },
              },
              {
                heading: "Joins vs subqueries",
                paragraphs: [
                  "Anything expressible as a join can often be written as a subquery and vice versa. A JOIN brings columns of the related row into the same result; a scalar subquery embeds one value; EXISTS tests for related rows without multiplying rows. Derived tables (a subquery in FROM, aliased) let you aggregate first and join the summary afterwards — something you can't do by joining raw tables directly.",
                ],
                code: {
                  lang: "sql",
                  text: `-- Aggregate in a derived table, then join\nSELECT j.title, s.app_count\nFROM jobs j\nLEFT JOIN (\n  SELECT job_id, COUNT(*) AS app_count\n  FROM applications\n  GROUP BY job_id\n) s ON s.job_id = j.id;`,
                },
                list: [
                  "Alias every table; link each join to an already-present table.",
                  "Check row counts after each join to catch fan-out.",
                  "Use EXISTS for 'has related rows' tests — it doesn't duplicate rows.",
                ],
              },
            ],
            takeaways: [
              "Chain three joins with clear aliases and correct conditions.",
              "Decide between JOIN, EXISTS, and a derived-table subquery.",
              "Verify row counts to detect accidental many-to-many joins.",
            ],
          },
        },
        {
          title: "Anti-joins and EXISTS",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "'Find rows with NO match' is one of the most common data questions: jobs without applications, candidates who never tested. Anti-joins — LEFT JOIN + IS NULL, NOT EXISTS, or EXCEPT — are the tools, and they differ in readability and performance.",
            sections: [
              {
                heading: "Three ways to anti-join",
                paragraphs: [
                  "LEFT JOIN ... WHERE right.col IS NULL keeps left rows that had no match. NOT EXISTS (subquery) asks the engine to stop searching as soon as one match is found — often the fastest and always NULL-safe. EXCEPT (MINUS in Oracle) returns rows of the first query minus rows of the second, as a set operation.",
                ],
                code: {
                  lang: "sql",
                  text: `-- LEFT JOIN + IS NULL\nSELECT j.title\nFROM jobs j\nLEFT JOIN applications a ON a.job_id = j.id\nWHERE a.id IS NULL;\n\n-- NOT EXISTS (NULL-safe, often faster)\nSELECT j.title\nFROM jobs j\nWHERE NOT EXISTS (\n  SELECT 1 FROM applications a WHERE a.job_id = j.id\n);`,
                },
              },
              {
                heading: "Reading EXISTS",
                paragraphs: [
                  "EXISTS(subquery) is true when the subquery returns at least one row; the SELECT list inside it is irrelevant conventionally written as SELECT 1. Because it short-circuits, it doesn't scan the entire right table once a match is found. Unlike NOT IN, NOT EXISTS is unaffected by NULLs in the right table — which is why it's the recommended anti-join.",
                ],
                list: [
                  "Anti-join = 'left rows with no right match'.",
                  "Prefer NOT EXISTS for NULL safety and short-circuiting.",
                  "EXISTS checks for at least one match; SELECT 1 inside is conventional.",
                  "Correlated subqueries reference the outer query's row (a.job_id) — that's what makes them per-row checks.",
                ],
              },
            ],
            takeaways: [
              "Find jobs with no applications using two different anti-join techniques.",
              "Explain why NOT EXISTS is NULL-safe while NOT IN is not.",
              "Read a correlated EXISTS subquery and describe how it executes.",
            ],
          },
        },
      ],
    },
    {
      title: "Writing Better Queries",
      lessons: [
        {
          title: "Subqueries",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "A subquery is a query nested inside another. Used in WHERE, FROM, or SELECT, they let you express 'relative to a computed answer' — top-N per group, values matching a dynamic condition, and per-row benchmarks.",
            sections: [
              {
                heading: "Scalar and IN subqueries",
                paragraphs: [
                  "A scalar subquery returns one value and can be compared directly: WHERE salary > (SELECT AVG(salary) FROM jobs). An IN subquery returns a column of values for membership testing. Both read naturally; both can be rewritten as joins when performance demands it.",
                ],
                code: {
                  lang: "sql",
                  text: `-- above-average salaries\nSELECT title, salary\nFROM jobs\nWHERE salary > (SELECT AVG(salary) FROM jobs);\n\n-- jobs with at least one shortlisted candidate\nSELECT title\nFROM jobs\nWHERE id IN (\n  SELECT job_id FROM applications WHERE status = 'shortlisted'\n);`,
                },
              },
              {
                heading: "Correlated subqueries and window teaser",
                paragraphs: [
                  "A correlated subquery references the outer query's row, so it re-evaluates per row — powerful ('rows where salary exceeds their own company's average') but potentially slow, since it runs once per candidate row. If you find yourself writing the same correlated subquery in many places, consider a JOIN to a derived table or, in modern engines, a window function.",
                ],
                code: {
                  lang: "sql",
                  text: `SELECT j.title, j.company, j.salary\nFROM jobs j\nWHERE j.salary > (\n  SELECT AVG(j2.salary)\n  FROM jobs j2\n  WHERE j2.company = j.company   -- correlated: outer row's company\n);`,
                },
                list: [
                  "Scalar subquery = one value; IN subquery = list of values.",
                  "Correlated subqueries reference the outer row — flexible but per-row cost.",
                  "Prefer joins/derived tables when the same subquery repeats.",
                ],
              },
            ],
            takeaways: [
              "Use a scalar subquery to filter against a computed benchmark.",
              "Write a correlated subquery and explain its per-row execution cost.",
              "Recognize when a subquery should become a join for performance.",
            ],
          },
        },
        {
          title: "Window Functions",
          durationMin: 8,
          type: "article",
          content: {
            intro:
              "Window functions compute across a set of rows related to the current row WITHOUT collapsing them — ranking per group, running totals, moving averages. They are the modern replacement for most correlated-subquery gymnastics.",
            sections: [
              {
                heading: "OVER: the window clause",
                paragraphs: [
                  "Aggregate functions get an OVER(...) clause to become windows: SUM(salary) OVER (PARTITION BY company ORDER BY posted_at) computes a running total per company while every row stays visible. PARTITION BY defines the groups; ORDER BY defines the sequence inside each partition; ROWS BETWEEN bounds narrows the frame (e.g. preceding 2 rows).",
                ],
                code: {
                  lang: "sql",
                  text: `SELECT title, company, salary,\n       RANK()       OVER (PARTITION BY company ORDER BY salary DESC) AS salary_rank,\n       AVG(salary)  OVER (PARTITION BY company) AS company_avg\nFROM jobs\nWHERE status = 'approved';`,
                },
              },
              {
                heading: "Ranking functions and frames",
                paragraphs: [
                  "ROW_NUMBER gives unique consecutive numbers; RANK leaves gaps after ties (1,1,3); DENSE_RANK has no gaps (1,1,2). The difference matters for 'top N per group' — take ROW_NUMBER and filter rn <= 3 to get exactly three rows even with ties. Running totals and moving averages use frame clauses: SUM(amount) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) is a 7-day rolling sum.",
                ],
                code: {
                  lang: "sql",
                  text: `-- top 3 jobs per company by salary (exactly 3, ties broken arbitrarily)\nWITH ranked AS (\n  SELECT *,\n         ROW_NUMBER() OVER (PARTITION BY company ORDER BY salary DESC) AS rn\n  FROM jobs\n)\nSELECT * FROM ranked WHERE rn <= 3;`,
                },
                list: [
                  "Window functions do not collapse rows — GROUP BY does.",
                  "ROW_NUMBER vs RANK vs DENSE_RANK: ties → unique / gapped / dense.",
                  "'Top N per group' = ROW_NUMBER + filter.",
                  "Window functions run after WHERE — filter rows first, then window.",
                ],
              },
            ],
            takeaways: [
              "Rank rows within each partition using RANK and ROW_NUMBER.",
              "Solve 'top N per group' with ROW_NUMBER plus a WHERE filter.",
              "Explain how ORDER BY inside OVER differs from a query's final ORDER BY.",
            ],
          },
        },
        {
          title: "Indexes and Query Performance",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "An index is an auxiliary sorted structure (usually a B-tree) that lets the engine find rows without scanning the whole table. The right index turns a slow dashboard query into a millisecond one — the wrong ones just waste space and slow writes.",
            sections: [
              {
                heading: "How indexes help — and when they're used",
                paragraphs: [
                  "A B-tree index stores keys in sorted order with pointers to rows, giving O(log n) lookups, range scans, and sorted access. The optimizer uses an index when it estimates it's cheaper than a full scan: equality columns, range columns (after equality ones), and ORDER BY that matches the index order (avoiding a sort).",
                  "Composite indexes follow the leftmost-prefix rule: an index on (company, salary) serves WHERE company = ..., and WHERE company = ... AND salary > ..., but NOT WHERE salary = ... alone. Order columns by selectivity of equality predicates first, then range/sort columns.",
                ],
                code: {
                  lang: "sql",
                  text: `CREATE INDEX idx_jobs_company_salary\n  ON jobs (company, salary DESC);\n\n-- Served by the index:\nSELECT * FROM jobs WHERE company = 'Acme' ORDER BY salary DESC;\n-- NOT served (company missing / leftmost prefix broken):\nSELECT * FROM jobs WHERE salary > 100000;`,
                },
              },
              {
                heading: "Costs and verification",
                paragraphs: [
                  "Indexes are not free: every INSERT/UPDATE pays maintenance, and storage grows. Composite indexes that duplicate a leading column of an existing index are usually redundant. Most engines let you verify with EXPLAIN (PostgreSQL: EXPLAIN ANALYZE) — look for sequential scans on large tables where you expected an index scan, and for actual row estimates wildly off the planner's guess.",
                ],
                list: [
                  "Index columns used in equality predicates first, then range/sort.",
                  "Leftmost prefix rule decides which queries a composite index serves.",
                  "EXPLAIN / EXPLAIN ANALYZE before and after adding an index.",
                  "High-cardinality columns (many distinct values) are the most selective — usually the best index candidates.",
                ],
              },
            ],
            takeaways: [
              "Create a composite index in the correct column order.",
              "Explain the leftmost-prefix rule with an example.",
              "Use EXPLAIN to verify the optimizer actually uses your index.",
            ],
          },
        },
      ],
    },
  ],
  quiz: {
    passingScore: 70,
    questions: [
      {
        prompt:
          "applications has rows for some jobs. What does this query return?\n\nSELECT j.title\nFROM jobs j\nLEFT JOIN applications a ON a.job_id = j.id\nWHERE a.status = 'applied';",
        options: [
          "Every job, with 'applied' filled in where it exists",
          "Only jobs that have at least one 'applied' application (effectively an INNER JOIN)",
          "Jobs with no applications plus all applications",
          "A syntax error — WHERE cannot follow a JOIN",
        ],
        answerIndex: 1,
        explanation:
          "The WHERE filter runs after the join and removes the NULL-padded rows that a LEFT JOIN produced for jobs without applications — silently converting it into an inner join. To keep all jobs, filter in the ON clause (LEFT JOIN applications a ON a.job_id = j.id AND a.status = 'applied') or pre-filter in a subquery.",
        skillSlug: "sql",
      },
      {
        prompt:
          "Why does WHERE salary = NULL never match rows, even those with NULL salary?",
        options: [
          "It matches only empty strings, not NULLs",
          "NULL = NULL is TRUE in SQL",
          "Comparisons with NULL evaluate to UNKNOWN, which fails the WHERE (TRUE-only) filter",
          "The database raises an error for = NULL",
        ],
        answerIndex: 2,
        explanation:
          "SQL's three-valued logic makes any comparison involving NULL UNKNOWN, and WHERE keeps only TRUE rows. The correct existence check is IS NULL. Databases don't error on = NULL — they just return nothing, which makes it a silent bug.",
        skillSlug: "sql",
      },
      {
        prompt:
          "You want companies with more than 5 approved jobs, each showing its average salary. Which clause filters the groups?",
        options: [
          "WHERE count > 5",
          "HAVING COUNT(*) > 5",
          "GROUP BY count > 5",
          "ORDER BY COUNT(*) > 5",
        ],
        answerIndex: 1,
        explanation:
          "HAVING filters groups after aggregation — the only place an aggregate condition is allowed. WHERE filters individual rows before grouping (aggregates aren't available there yet). GROUP BY defines the partitions; ORDER BY only sorts the output.",
        skillSlug: "sql",
      },
      {
        prompt:
          "An index exists on jobs (company, salary). Which query can use it (leftmost prefix)?",
        options: [
          "WHERE salary = 90000",
          "WHERE salary > 90000 ORDER BY salary",
          "WHERE company = 'Acme' AND salary > 90000",
          "WHERE title LIKE '%Engineer%'",
        ],
        answerIndex: 2,
        explanation:
          "A composite B-tree index is traversed left to right: queries can use a prefix of the indexed columns. Equality on company then a range on salary follows that order. A query filtering only on salary skips the leading company column and can't use this index; title isn't in the index at all.",
        skillSlug: "sql",
      },
      {
        prompt:
          "What's the key difference between RANK() and ROW_NUMBER() OVER (ORDER BY salary DESC)?",
        options: [
          "RANK numbers every row uniquely; ROW_NUMBER allows ties",
          "ROW_NUMBER gives consecutive numbers with no gaps; RANK leaves gaps after ties (e.g. 1, 1, 3)",
          "They are identical; RANK is just an alias",
          "RANK works only without an ORDER BY",
        ],
        answerIndex: 1,
        explanation:
          "Both assign numbers by order, but on ties: ROW_NUMBER breaks the tie arbitrarily and yields unique consecutive numbers (1,2,3), while RANK gives tied rows the same number and then skips the following ranks (1,1,3). That's why 'top N per group' usually uses ROW_NUMBER — you get exactly N rows.",
        skillSlug: "sql",
      },
    ],
  },
};

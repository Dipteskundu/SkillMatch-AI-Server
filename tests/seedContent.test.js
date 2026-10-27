// tests/seedContent.test.js
// Seed smoke test for the Phase 4 SkillForge content: structure + non-trivial
// content only (no DB writes, no network) — the seed module's data is imported
// directly from scripts/seed-content/index.js.

import { describe, it, expect } from "vitest";
import { SEED_TECHNOLOGIES, SEED_PATHS, SEED_SKILLS } from "../scripts/seed-content/index.js";

function countWords(...parts) {
  return parts
    .flat(Infinity)
    .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

describe("SkillForge seed content", () => {
  it("seeds 4 technologies grouping 5 flagship paths, with unique slugs", () => {
    expect(SEED_TECHNOLOGIES).toHaveLength(4);
    expect(new Set(SEED_TECHNOLOGIES.map((t) => t.slug)).size).toBe(4);

    expect(SEED_PATHS).toHaveLength(5);
    expect(SEED_PATHS.map((p) => p.title).sort()).toEqual(["Communication", "Python", "React", "SQL", "System Design"]);
    expect(new Set(SEED_PATHS.map((p) => p.slug)).size).toBe(5);

    const techSlugs = new Set(SEED_TECHNOLOGIES.map((t) => t.slug));
    for (const path of SEED_PATHS) {
      expect(techSlugs.has(path.technologySlug)).toBe(true);
    }
  });

  it("every path has 3-4 modules and 8-10 lessons with sane metadata", () => {
    for (const path of SEED_PATHS) {
      expect(path.modules.length).toBeGreaterThanOrEqual(3);
      expect(path.modules.length).toBeLessThanOrEqual(4);
      const lessons = path.modules.flatMap((m) => m.lessons);
      expect(lessons.length).toBeGreaterThanOrEqual(8);
      expect(lessons.length).toBeLessThanOrEqual(10);
      expect(["beginner", "intermediate", "advanced"]).toContain(path.level);
      expect(path.estimatedHours).toBeGreaterThan(0);
      for (const lesson of lessons) {
        expect(lesson.title.length).toBeGreaterThan(0);
        expect(lesson.durationMin).toBeGreaterThanOrEqual(1);
        expect(lesson.durationMin).toBeLessThanOrEqual(10); // <=10-min lessons
        expect(["article", "interactive"]).toContain(lesson.type);
      }
    }
  });

  it("every lesson carries real content: intro, >=2 sections, paragraphs, takeaways, meaningful length", () => {
    for (const path of SEED_PATHS) {
      for (const mod of path.modules) {
        for (const lesson of mod.lessons) {
          const c = lesson.content;
          const where = `${path.title} / ${mod.title} / ${lesson.title}`;
          expect(c.intro.length, where).toBeGreaterThan(20);
          expect(c.sections.length, where).toBeGreaterThanOrEqual(2);
          expect(c.takeaways.length, where).toBeGreaterThanOrEqual(2);
          for (const section of c.sections) {
            expect(section.heading.length, where).toBeGreaterThan(0);
            expect(section.paragraphs.length, where).toBeGreaterThanOrEqual(1);
            for (const p of section.paragraphs) {
              expect(typeof p, where).toBe("string");
              expect(p.length, where).toBeGreaterThan(0);
            }
            if (section.code) {
              expect(section.code.text.length, where).toBeGreaterThan(0);
            }
          }
          // Non-trivial: no placeholder/filler text — a real lesson body.
          const words = countWords(
            c.intro,
            c.sections.map((s) => [s.heading, ...(s.paragraphs || []), ...(s.list || []), s.code?.text]),
            c.takeaways,
          );
          expect(words, where).toBeGreaterThanOrEqual(180);
        }
      }
    }
  });

  it("every path quiz has exactly 5 valid questions with explanations and unique options", () => {
    for (const path of SEED_PATHS) {
      expect(path.quiz.questions.length, path.title).toBe(5);
      expect(path.quiz.passingScore).toBe(70);
      for (const q of path.quiz.questions) {
        expect(q.prompt.length).toBeGreaterThan(10);
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(Number.isInteger(q.answerIndex)).toBe(true);
        expect(q.answerIndex).toBeGreaterThanOrEqual(0);
        expect(q.answerIndex).toBeLessThanOrEqual(3);
        expect(q.explanation.length).toBeGreaterThanOrEqual(20);
        expect(q.skillSlug).toBe(path.skillSlug);
      }
    }
  });

  it("ensures the 5 canonical skills (incl. System Design) for the vocabulary", () => {
    expect(SEED_SKILLS).toHaveLength(5);
    const slugs = SEED_SKILLS.map((s) => s.slug).sort();
    expect(slugs).toEqual(["communication", "python", "react", "sql", "system-design"]);
    const pathSlugs = new Set(SEED_PATHS.map((p) => p.skillSlug));
    for (const skill of SEED_SKILLS) {
      expect(pathSlugs.has(skill.slug)).toBe(true);
      expect(skill.name.length).toBeGreaterThan(0);
    }
  });
});

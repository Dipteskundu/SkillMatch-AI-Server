// scripts/seed-content/communication.js — hand-authored communication curriculum (Phase 4 seed).
// 3 modules · 9 lessons · 5-question quiz with explanations.

export const communicationPath = {
  technologySlug: "career-skills",
  skillSlug: "communication",
  title: "Communication",
  slug: "communication",
  level: "beginner",
  estimatedHours: 3,
  modules: [
    {
      title: "Communication Foundations",
      lessons: [
        {
          title: "Active Listening",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Most 'communication problems' are listening problems. Active listening means listening to understand rather than to reply — and it's a learnable set of behaviors, not a personality trait.",
            sections: [
              {
                heading: "What listening actually looks like",
                paragraphs: [
                  "Active listening has observable behaviors: you let the speaker finish without rehearsing your reply; you reflect back what you heard ('So the blocker is the API contract, not the test failures?'); you ask one clarifying question before jumping to solutions; and you check understanding by summarizing next steps at the end.",
                  "In practice most of us listen just enough to form a response. The pause after someone finishes — two full seconds — is where summarizing and clarifying happen. Meetings improve measurably when someone plays the 'summarizer' role explicitly.",
                ],
                list: [
                  "Wait for the pause; don't plan your reply while they talk.",
                  "Reflect and confirm: 'What I heard is… Did I get that right?'",
                  "Ask open questions (what/how) before closed ones (yes/no).",
                  "Paraphrase decisions and owners at the end — miscommunication hides in unconfirmed assumptions.",
                ],
              },
              {
                heading: "Listening in writing and async",
                paragraphs: [
                  "Async text removes tone and timing, so listening means reading the whole message before replying, quoting the specific part you're answering, and acknowledging the emotional content before the factual one (' Sounds frustrating — here's what I found…'). A reply that answers a question nobody asked is a listening failure in text form.",
                ],
              },
            ],
            takeaways: [
              "Demonstrate the reflect-confirm-clarify sequence in a conversation.",
              "Use a two-second pause before responding.",
              "Apply active listening to async text by quoting and acknowledging.",
            ],
          },
        },
        {
          title: "Clear and Concise Writing",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Professional writing is read once, fast, often on a phone. Structure beats eloquence: lead with what the reader needs, cut everything that doesn't change a decision, and make the ask unmistakable.",
            sections: [
              {
                heading: "The one-message rule",
                paragraphs: [
                  "Before writing, decide the ONE thing the reader should know, decide, or do. Everything else is supporting evidence. Put it in the first two lines — people scan the top of an email or PR description and skim the rest. If there are multiple asks, number them so nothing gets lost.",
                ],
                code: {
                  lang: "text",
                  text: `Before (buried ask):\n  "The deploy had some issues and we looked at the logs... (8 lines)...\n   anyway, could you approve the rollback when you get a chance?"\n\nAfter (ask first):\n  "Requesting approval to roll back payments-api to v41 — latency p99 hit 4s.\n   Evidence in the incident doc. Approve here: [link]"`,
                },
              },
              {
                heading: "Editing techniques that work",
                paragraphs: [
                  "Cut hedges ('I think maybe we could possibly') — replace with direct statements plus honest uncertainty where it exists ('I'm 70% confident; the risk is X'). Prefer concrete nouns to abstractions ('the nightly job fails at 02:00' not 'there are some data issues'). One idea per sentence; one topic per paragraph.",
                  "Format for scanning: short paragraphs, bullets for anything three or more, bold for the ask. And delete the first draft's throat-clearing ('This is to inform you that…') — start at the point.",
                ],
                list: [
                  "Lead with the ask or finding; evidence follows.",
                  "Numbers and specifics beat adjectives.",
                  "Bold or bullet the action items; name owners and dates.",
                  "Read it once on 'phone width' before sending.",
                ],
              },
            ],
            takeaways: [
              "Rewrite a buried-ask message so the ask comes first.",
              "Cut hedges and abstractions from a paragraph.",
              "Format a status note for scanning on mobile.",
            ],
          },
        },
        {
          title: "Structuring Your Message: BLUF",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "BLUF — Bottom Line Up Front — is the military writing convention that professional writing borrowed: state the conclusion first, then context, then details. It respects the reader's time and gets faster decisions.",
            sections: [
              {
                heading: "The three-layer structure",
                paragraphs: [
                  "Layer 1 (one sentence): the conclusion, decision, or request. Layer 2 (2-4 sentences): the key reasons or evidence, strongest first. Layer 3 (optional): supporting detail, data, links for the reader who wants to dig. The reader who stops after layer 1 is fully informed; the reader who reads all three layers has everything.",
                  "BLUF works for emails, PR descriptions, incident updates, and design docs — anywhere a busy reader needs the point before the reasoning. It feels abrupt at first; that discomfort is your old habit of warming up.",
                ],
                code: {
                  lang: "text",
                  text: `BLUF: Recommend deferring the migration to Q3 — current error budget\n      won't absorb the risk.\nWhy:  1) two unresolved data-loss edge cases, 2) team at capacity\n      through August.\nDetail: full risk table in the RFC, section 4.`,
                },
              },
              {
                heading: "When NOT to BLUF",
                paragraphs: [
                  "For sensitive feedback or bad news, a pure conclusion-first blast can land badly — lead with a brief human framing, then the BLUF structure. For exploratory questions ('thinking out loud'), a question-first, reasoning-shared format invites collaboration better than a pre-decided conclusion. BLUF is for decisions and status, not for every sentence you write.",
                ],
                list: [
                  "Decision/status → BLUF; sensitive topics → context first, then BLUF.",
                  "Numbers in the headline ('cut latency 40%') earn attention for the detail.",
                  "Match the medium: 3-line email for decisions, doc for the full reasoning.",
                ],
              },
            ],
            takeaways: [
              "Restructure an update into conclusion → reasons → detail.",
              "Recognize when a conclusion-first message is the wrong tone.",
              "Write a one-sentence headline a manager can forward.",
            ],
          },
        },
      ],
    },
    {
      title: "Communicating at Work",
      lessons: [
        {
          title: "Status Updates That Build Trust",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Status updates are a trust instrument: predictable, honest updates make you the person others don't need to chase. The format that works is boring and consistent.",
            sections: [
              {
                heading: "The update skeleton",
                paragraphs: [
                  "Three parts, always: (1) Done — what shipped or settled since last update, (2) Next — what you'll do before the next one, (3) Risks/Blockers — anything threatening the plan, with what you need and from whom. Consistency is the point: readers should be able to skim your update in ten seconds and never wonder whether things are on track.",
                  "Quantify where you can ('8 of 12 endpoints done'), but never spin. A missed date announced early with a revised plan costs far less trust than a surprise miss. If you have no blockers, say 'No blockers' explicitly — silence is ambiguous.",
                ],
              },
              {
                heading: "Bad news early, specifically",
                paragraphs: [
                  "'We might slip' is anxiety without information. A trustworthy risk line names the cause, the impact, and the options: 'The auth API changed under us; without a decision by Thursday we slip a week — options: adapt (my rec) or freeze scope.' That structure turns the reader from a worrier into a decision-maker, which is exactly the job of upward communication.",
                ],
                list: [
                  "Done / Next / Blockers — same shape every time.",
                  "Announce misses early with a recovery plan, not excuses.",
                  "Name what you need, from whom, by when.",
                  "No blockers? Say so — explicitly.",
                ],
              },
            ],
            takeaways: [
              "Write a Done/Next/Blockers update in under 150 words.",
              "Turn a vague risk into cause + impact + options.",
              "Explain why early bad news preserves trust.",
            ],
          },
        },
        {
          title: "Giving and Receiving Feedback",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Feedback is information about work, delivered to improve it. Done well it's specific, timely, and behavior-focused; done poorly it's vague, delayed, and personal. Frameworks give the awkward conversation a spine.",
            sections: [
              {
                heading: "SBI: Situation-Behavior-Impact",
                paragraphs: [
                  "The SBI model strips feedback to facts: Situation (when/where), Behavior (what the person did — observable, not interpreted), Impact (the effect on you, the team, or the work). 'In standup this morning (S), you cut Priya off twice while she described the outage (B); she went quiet and we lost her timeline details (I).' There's no character verdict — just behavior and consequence, which is what the person can actually change.",
                  "Deliver feedback promptly (weeks later is gossip), privately by default, and once — resist piling three pieces of feedback into one conversation. Kind and clear aren't opposites: hedged feedback ('this is just a thought, ignore me…') is usually heard as noise.",
                ],
              },
              {
                heading: "Receiving feedback like a professional",
                paragraphs: [
                  "Receiving well is a skill of its own. First reaction is often defensive — notice it, don't act on it. Ask one question to sharpen the example ('Can you show me which part caused that?'), thank them even when it stings, and decide later, alone, what to do with it. You're not obligated to implement every piece of feedback — but you are obligated to understand it.",
                  "For upward feedback (to managers), lead with what you've tried and where you're stuck, not with the verdict. 'I've asked twice for clearer acceptance criteria; the last two PRs got rework because of it — can we agree on a definition-of-done checklist?' is feedback that's easy to hear because it's easy to act on.",
                ],
                list: [
                  "SBI: describe, don't interpret ('cut off', not 'rude').",
                  "Timely, private, specific, singular.",
                  "Receiver: pause, clarify, thank, decide later.",
                  "Frame upward feedback with attempts + ask, not blame.",
                ],
              },
            ],
            takeaways: [
              "Deliver one piece of feedback using Situation-Behavior-Impact.",
              "Rewrite a personality verdict ('you're careless') as observable behavior.",
              "Describe the receive loop: pause → clarify → thank → decide.",
            ],
          },
        },
        {
          title: "Speaking Up in Meetings",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Meetings reward the prepared and punish the rehearsed-late. Whether you're presenting a decision or asking a question, a little structure turns meeting airtime into visible contribution.",
            sections: [
              {
                heading: "Contribution patterns that land",
                paragraphs: [
                  "The highest-leverage meeting move is the summary-and-check: 'So we've decided X, owner Y, by Friday — did I capture that?' It looks like housekeeping; it's actually leadership. The second is the well-formed question: state what you understand, then the gap ('I'm with you on the rollout plan — what's the fallback if the migration script fails halfway?'). Questions framed as understanding beat questions framed as doubt.",
                  "If you tend to stay quiet, prepare one contribution per meeting — a question, a summary offer, or a data point — and commit to using it in the first ten minutes. If you tend to dominate, practice the pause: count to five after asking a question; someone else will fill it, and their angle will likely be one you hadn't considered.",
                ],
              },
              {
                heading: "Presenting a decision in the room",
                paragraphs: [
                  "When you need a decision from a meeting, open with the recommendation and the two or three reasons (BLUF, spoken), then invite the specific objection you most fear ('The concern I expect is timeline — here's why I still think we ship'). Naming the counterargument yourself takes its sting out and marks you as the person who has thought it through. Close by stating the decision, owner, and next step before anyone leaves the call.",
                ],
                list: [
                  "Prepare one contribution; use it early.",
                  "Summarize decisions and owners — meetings' most underused move.",
                  "Ask questions as understanding, not doubt.",
                  "Close with decision + owner + next step, spoken aloud.",
                ],
              },
            ],
            takeaways: [
              "Facilitate a summary-and-check moment in a meeting.",
              "Formulate a question that states understanding before the gap.",
              "Open a decision request with recommendation + reasons + named objection.",
            ],
          },
        },
      ],
    },
    {
      title: "Hard Conversations and Influence",
      lessons: [
        {
          title: "Disagreeing Constructively",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Disagreement is the job: designs improve when alternatives are argued well. The skill is separating the idea from the person and moving from positions ('this is wrong') to reasoning ('here's the failure mode I see').",
            sections: [
              {
                heading: "From position to reasoning",
                paragraphs: [
                  "A position is a conclusion without its logic; reasoning is transferable and debatable. 'I don't like this approach' ends the conversation. 'If we index by timestamp, the July incident shows the shard fills in weeks and writes fail — that's why I'd shard by user_id' invites the real discussion, because now others can attack your reasoning instead of your taste.",
                  "The steelman habit helps: restate the other view stronger than they did, then respond. It forces understanding, lowers defensiveness, and often reveals a hybrid neither side started with. The IBM 'disagree and commit' norm is the escape hatch when debate must end: say your piece, then execute the decision fully — passive resistance costs the team more than the wrong choice usually does.",
                ],
                list: [
                  "Disagree with evidence and a proposed alternative, not verdicts.",
                  "Steelman first: 'Your concern is X, right?' then respond.",
                  "Distinguish reversible from one-way-door decisions — match debate to stakes.",
                  "After the decision: commit publicly, resist re-litigating.",
                ],
              },
              {
                heading: "Written disagreement",
                paragraphs: [
                  "In design docs, disagreeing well means quoting the exact section you object to, explaining the scenario where it fails, and proposing concrete alternative text. Comments like 'this won't scale' are unactionable; 'Section 3 assumes read traffic is uniform, but /feed is 80% of reads — the cache should key on feed id' gets fixed the same day.",
                ],
              },
            ],
            takeaways: [
              "Convert a positional objection into reasoning + alternative.",
              "Steelman an opposing view before rebutting it.",
              "Write a design-doc objection quote → failure scenario → alternative.",
            ],
          },
        },
        {
          title: "Influencing Without Authority",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Most cross-team progress happens without anyone having authority over anyone else. Influence is built before you need it: reliability, understanding of others' goals, and small early agreements.",
            sections: [
              {
                heading: "The mechanics of influence",
                paragraphs: [
                  "Start with the other party's incentives, not your ask. A platform team saying no to your migration isn't obstruction — they own an uptime SLA and your migration is risk on their board. Frame your ask inside their goals ('this reduces their ticket load by X') and make the cost small and explicit (a staged rollout with a kill switch).",
                  "Small yeses compound: ask for a 30-minute review before a big ask; deliver on the small thing flawlessly; then the big ask arrives with a track record. And do the unglamorous part — doing someone else's urgent small favor once is a deposit you can later withdraw as a request.",
                ],
                list: [
                  "Map their goals before framing your ask.",
                  "Make the ask small, staged, and reversible (kill switch).",
                  "Trade favors early; keep a record of promises made and kept.",
                  "Cite shared goals and data, never seniority you don't have.",
                ],
              },
              {
                heading: "Being taken seriously early in your career",
                paragraphs: [
                  "Juniors often under-speak because they lack tenure — counter it with preparation, not volume: bring data, a crisp proposal, and awareness of constraints. One accurate forecast or well-scoped plan that lands correctly is worth more than a year of agreeable silence. Credibility is built by being right in small things repeatedly, and by admitting uncertainty before someone else catches it.",
                ],
              },
            ],
            takeaways: [
              "Frame a cross-team ask in the other team's incentives.",
              "Break a big request into a small staged first step.",
              "Describe credibility-building behaviors for early-career engineers.",
            ],
          },
        },
        {
          title: "Handling Conflict",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Conflict at work is inevitable; destructive conflict is optional. The difference is usually whether the disagreement stays about the work or drifts into identity — and whether there's a path to resolution both sides can see.",
            sections: [
              {
                heading: "De-escalate, then solve",
                paragraphs: [
                  "When tempers rise, stop problem-solving and name the dynamic neutrally: 'We keep circling — I think we're actually disagreeing about who owns this decision.' Defining the disagreement is often 80% of resolving it: ownership disputes, different risk tolerances, and unstated success metrics all masquerade as technical debates.",
                  "During the exchange, lower the temperature physically: move to a whiteboard (shared focus on the problem, not each other), switch to writing, or take a 20-minute break. And separate the person from the pattern: attack 'the deploy process failed us', never 'you broke the deploy'. After resolution, close the loop publicly — state what was decided and thank the counterpart — so the conflict doesn't leave residue for the next reader of the thread.",
                ],
              },
              {
                heading: "Know when to escalate",
                paragraphs: [
                  "Escalation isn't defeat; it's routing an unresolvable decision to whoever actually owns it. Do it transparently ('We've reached impasse on X; I'd like to bring it to the staff meeting with both our positions summarized'), never sideways or behind the counterpart's back. Escalate on stalemates with real stakes and clear options — not on bruised feelings.",
                ],
                list: [
                  "Name the meta-disagreement: ownership, risk, or metrics?",
                  "Shift channels when heated: whiteboard, writing, or a break.",
                  "Attack processes, never people.",
                  "Escalate transparently, with both positions fairly stated.",
                ],
              },
            ],
            takeaways: [
              "Identify the real axis of a conflict (ownership, risk, metrics).",
              "Apply one de-escalation move (channel shift, break, naming the pattern).",
              "Describe a transparent escalation that preserves the relationship.",
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
          "A teammate finishes explaining a blocker and you've been silent for a beat. What is the strongest active-listening move?",
        options: [
          "Immediately propose three solutions to show engagement",
          "Reflect what you heard and confirm before moving on: 'So the blocker is the API contract change — did I get that right?'",
          "Move the conversation to written channels",
          "Ask them to summarize their own point more briefly",
        ],
        answerIndex: 1,
        explanation:
          "Active listening means listening to understand: reflect-and-confirm verifies your understanding and shows the speaker they were actually heard. Jumping straight to solutions skips comprehension; the speaker often isn't asking for fixes yet. The other options are evasive or dismissive.",
        skillSlug: "communication",
      },
      {
        prompt: "Which rewrite best applies BLUF (Bottom Line Up Front)?",
        options: [
          "A 10-paragraph email ending with the decision request",
          "'Requesting approval to roll back payments-api to v41 — p99 latency hit 4s. Evidence in the incident doc. [link]'",
          "'Hey! Hope you're doing well. Weather's been crazy. Anyway…'",
          "'I have some thoughts about the deploy, maybe we can chat?'",
        ],
        answerIndex: 1,
        explanation:
          "BLUF leads with the conclusion/ask, then the key evidence, then links for detail. The reader knows the decision and reason within two lines. Burying the ask at the end, or opening with pleasantries that delay the point, inverts the structure.",
        skillSlug: "communication",
      },
      {
        prompt:
          "Using SBI (Situation-Behavior-Impact), which feedback is written correctly?",
        options: [
          "'You're always dismissive of QA in meetings.'",
          "'In standup this morning you cut Priya off twice while she described the outage; she went quiet and we lost the timeline details.'",
          "'Everyone noticed you were rude again today.'",
          "'You should be more respectful — it's just basic professionalism.'",
        ],
        answerIndex: 1,
        explanation:
          "SBI requires a specific situation, an observable behavior (not a character trait), and the concrete impact. 'Always dismissive', 'rude', and 'everyone noticed' are interpretations and verdicts — unactionable and defensive-triggering. The standup example names when, what happened, and its effect.",
        skillSlug: "communication",
      },
      {
        prompt:
          "Two engineers disagree heatedly about a migration plan in a design review. What's the best de-escalation move?",
        options: [
          "End the discussion immediately and decide alone later",
          "Defend the more senior person's position to keep momentum",
          "Name the axis of disagreement ('we're actually debating rollback scope vs. timeline') and move to a whiteboard or written summary",
          "Add more engineers to the meeting so more perspectives are heard",
        ],
        answerIndex: 2,
        explanation:
          "Naming the real axis (ownership, risk tolerance, metrics) usually reveals the debate isn't actually about the surface issue, and shifting to a shared artifact (whiteboard, writing) refocuses on the problem rather than each other. Unilaterally deciding poisons the process; stacking the room raises the stakes; siding on seniority entrenches the conflict.",
        skillSlug: "communication",
      },
      {
        prompt:
          "You need a data-platform team to prioritize work that benefits your team but costs them a week. What's the most effective framing?",
        options: [
          "Escalate to your VP that they're blocking you",
          "Insist it's critical because your deadline is tight",
          "Frame it in their goals and de-risk the ask: explain how it cuts their ticket load, propose a staged rollout with a kill switch, and start with a small agreement",
          "Wait until they have spare capacity with no follow-up",
        ],
        answerIndex: 2,
        explanation:
          "Influence without authority works through the other party's incentives and small, reversible asks. A staged rollout with a kill switch directly addresses their SLA risk; tying it to their ticket load makes it their win too. Escalation-as-first-move burns credibility, urgency-dumping is your problem not theirs, and passive waiting ignores that prioritization requires a business case.",
        skillSlug: "communication",
      },
    ],
  },
};

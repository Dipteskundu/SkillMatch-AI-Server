// scripts/seed-content/react.js — hand-authored, real React curriculum (Phase 4 seed).
// 4 modules · 9 lessons · 5-question quiz with explanations.

export const reactPath = {
  technologySlug: "web-development",
  skillSlug: "react",
  title: "React",
  slug: "react",
  level: "beginner",
  estimatedHours: 4,
  modules: [
    {
      title: "Core Building Blocks",
      lessons: [
        {
          title: "Components and JSX",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "React applications are built from components — small, reusable functions that return UI. This lesson introduces components and JSX, the syntax extension that makes describing UI feel like writing markup.",
            sections: [
              {
                heading: "What a component is",
                paragraphs: [
                  "A React component is a plain JavaScript function that returns a description of what should appear on screen. Each component renders independently: React calls your function, takes the returned description (a tree of elements), and keeps the actual DOM in sync with it. Because components are functions, they can take inputs, hold state, and compose into larger UIs.",
                  "Components let you split a UI into pieces like Page, Header, and JobCard. Each piece owns one responsibility, which keeps code readable and lets you reuse the same piece in multiple places.",
                ],
                list: [
                  "Component names must start with a capital letter — JSX uses capitalization to tell components apart from HTML tags.",
                  "A component returns one root element (or a fragment <>...</> for several).",
                  "Props flow data in; state (next lesson) handles data that changes over time.",
                ],
              },
              {
                heading: "JSX: JavaScript that looks like HTML",
                paragraphs: [
                  "JSX is a syntax extension compiled by tools like Vite or Next.js into nested React.createElement (or the modern jsx runtime) calls. It lets you describe UI declaratively, but it is still JavaScript: curly braces embed any expression, and you write className instead of class, htmlFor instead of for, because those are reserved words in JavaScript.",
                ],
                code: {
                  lang: "jsx",
                  text: `function JobCard({ title, company }) {\n  return (\n    <article className="card">\n      <h3>{title}</h3>\n      <p>{company}</p>\n    </article>\n  );\n}`,
                },
                list: [
                  "Attributes are camelCase in JSX: className, tabIndex, onClick.",
                  "Self-closing tags need the slash: <img />, <input />.",
                  "A component that renders conditionally can return null to render nothing.",
                ],
              },
            ],
            takeaways: [
              "Explain that a component is a function returning a UI description.",
              "Write a JSX component that interpolates props with curly braces.",
              "Convert HTML attributes to their JSX names (className, htmlFor).",
            ],
          },
        },
        {
          title: "Props and One-Way Data Flow",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Props are how parents pass data to children in React. Understanding props — and React's one-way data flow — is the foundation for every pattern you will learn later, from forms to state management.",
            sections: [
              {
                heading: "Passing and reading props",
                paragraphs: [
                  "Props are the arguments a component receives. When you write <JobCard title=\"Engineer\" />, the JobCard function receives them as a single object: function JobCard(props) { ... }. Destructuring in the parameter list (function JobCard({ title, company })) is the standard style.",
                  "Props can be any JavaScript value — strings, numbers, arrays, objects, functions, or other components. Functions as props let children notify parents of events, which is how child components trigger changes in their parents without owning the data themselves.",
                ],
                code: {
                  lang: "jsx",
                  text: `function JobList({ jobs, onSelect }) {\n  return (\n    <ul>\n      {jobs.map((job) => (\n        <li key={job.id} onClick={() => onSelect(job.id)}>\n          {job.title}\n        </li>\n      ))}\n    </ul>\n  );\n}`,
                },
              },
              {
                heading: "Props are read-only",
                paragraphs: [
                  "Props flow one way: parent to child. A component must never modify the props it receives — mutating props makes UI unpredictable because React assumes props are immutable inputs. If a child needs different data, the parent passes different props, or the child manages its own state.",
                  "This one-way flow is a feature. Data has a single source of truth, so when something changes you always know where to look: up the tree, at the component that owns the data.",
                ],
                list: [
                  "Default values: function Badge({ level = 'beginner' }) { ... } or Badge.defaultProps in older code.",
                  "Prop spreading: <Card {...rest} /> passes the remaining props through.",
                  "children is a special prop for content nested between a component's tags.",
                  "Props are named descriptively (title, jobs) — avoid generic names like data or info.",
                ],
              },
            ],
            takeaways: [
              "Pass data into a component via props and read it with destructuring.",
              "State the rule that props are read-only and explain why it exists.",
              "Use a callback prop so a child can notify its parent of an event.",
            ],
          },
        },
      ],
    },
    {
      title: "State and Interaction",
      lessons: [
        {
          title: "State with useState",
          durationMin: 8,
          type: "article",
          content: {
            intro:
              "State is a component's private, changeable data. While props come from outside, state lives inside a component and drives re-renders when it changes. The useState hook is the simplest way to add state to a function component.",
            sections: [
              {
                heading: "Declaring state",
                paragraphs: [
                  "useState takes an initial value and returns a pair: the current value and a function that schedules an update. Calling the updater tells React to re-render the component with the new value. The state variable from one call is scoped to that component instance — two JobCard components each keep their own copy.",
                ],
                code: {
                  lang: "jsx",
                  text: `import { useState } from "react";\n\nfunction BookmarkButton({ initial }) {\n  const [saved, setSaved] = useState(initial);\n\n  return (\n    <button onClick={() => setSaved(!saved)}>\n      {saved ? "Saved" : "Save"}\n    </button>\n  );\n}`,
                },
              },
              {
                heading: "How updates actually work",
                paragraphs: [
                  "Calling setSaved does not mutate the old value — it queues a re-render with a new value. React batches multiple updates in the same event handler into a single re-render, so the last call wins. This is why state updates must be treated as immutable: use spread syntax or arrays methods that return new arrays (map, filter, concat) instead of push.",
                  "When the next value depends on the previous one, pass a function instead: setCount((c) => c + 1). React then calls your function with the latest queued value, which is correct even when several updates are batched.",
                ],
                list: [
                  "Read state to render; never read it expecting live DOM values.",
                  "One useState per independent piece of data — don't bundle unrelated values into one object.",
                  "The state from the render where you created an event closure may be stale — use the functional updater form when the update depends on prior state.",
                ],
              },
            ],
            takeaways: [
              "Add state to a component with useState and trigger a re-render with its setter.",
              "Explain why state updates must be immutable and how batching works.",
              "Use the functional updater (c => c + 1) when a new value depends on the old one.",
            ],
          },
        },
        {
          title: "Events and Conditional Rendering",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Interactivity comes from event handlers plus conditional rendering. This lesson covers React's synthetic events and the common techniques for showing different UI based on state.",
            sections: [
              {
                heading: "Handling events",
                paragraphs: [
                  "React attaches event handlers with camelCase names (onClick, onChange, onSubmit) and passes a synthetic event that normalizes browser differences. Handlers receive the current props and state from the render they were created in — which is why calling a state setter inside one schedules a fresh re-render.",
                  "With inline arrow functions, a new handler closure is created on every render. That is fine for most UI; only memoize (useCallback) when a child depends on handler identity for performance.",
                ],
                code: {
                  lang: "jsx",
                  text: `function SearchBox({ onSearch }) {\n  const [query, setQuery] = useState("");\n\n  function handleSubmit(e) {\n    e.preventDefault(); // stop the page reload\n    onSearch(query.trim());\n  }\n\n  return (\n    <form onSubmit={handleSubmit}>\n      <input value={query} onChange={(e) => setQuery(e.target.value)} />\n      <button type="submit">Search</button>\n    </form>\n  );\n}`,
                },
              },
              {
                heading: "Rendering UI conditionally",
                paragraphs: [
                  "Because JSX is JavaScript, any expression can decide what renders. The && operator short-circuits (show a badge only when verified), the ternary picks between two branches, and an early return renders a fallback (a spinner or error message) before the main UI. Keep conditions in the JSX or in small helper variables — hiding logic deep inside child components makes the UI hard to follow.",
                ],
                list: [
                  "Falsy && trap: {count && <Thing />} renders 0 when count is 0 — guard with count > 0 && ... .",
                  "Use the ternary for two states: {loading ? <Spinner /> : <Results />}.",
                  "Early return for whole-screen states: if (error) return <ErrorState error={error} />.",
                ],
              },
            ],
            takeaways: [
              "Attach a form submit handler and prevent the default page reload.",
              "Render UI conditionally with &&, ternaries, and early returns.",
              "Avoid the {count && ...} pitfall when the left side can be 0.",
            ],
          },
        },
      ],
    },
    {
      title: "Lists, Effects and Forms",
      lessons: [
        {
          title: "Rendering Lists and Keys",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Most real UI renders collections: job lists, notifications, skill chips. React gives you array methods plus a special `key` prop — understanding why keys matter prevents subtle bugs and performance problems.",
            sections: [
              {
                heading: "From array to elements",
                paragraphs: [
                  "Use map (or filter first) to transform an array of data into an array of elements. React renders each returned element in order. Because JSX is JavaScript, this happens right inside the JSX with curly braces.",
                ],
                code: {
                  lang: "jsx",
                  text: `function JobList({ jobs }) {\n  if (jobs.length === 0) return <p>No jobs found.</p>;\n\n  return (\n    <ul>\n      {jobs\n        .filter((job) => job.active)\n        .map((job) => (\n          <li key={job.id}>{job.title}</li>\n        ))}\n    </ul>\n  );\n}`,
                },
              },
              {
                heading: "Why keys matter",
                paragraphs: [
                  "When a list changes, React compares the old and new element trees to decide what to update, move, or delete. The key tells React which element is which across renders. A stable, unique key (like a database id) lets React reuse the DOM for unchanged items and update only what changed.",
                  "Using the array index as a key breaks exactly when the list reorders, prepends, or removes items: React reuses DOM nodes by position, so state and focus can end up attached to the wrong row. If you have no id, generate one when the data is created — not with Math.random() inside render, which changes every render and defeats reconciliation entirely.",
                ],
                list: [
                  "Good keys: database ids, UUIDs generated once per item.",
                  "Bad keys: array indexes, random values generated during render.",
                  "Duplicate keys are a bug — React will warn and behavior is undefined.",
                ],
              },
            ],
            takeaways: [
              "Render a filtered, mapped list inside JSX.",
              "Explain what keys do during reconciliation.",
              "Choose stable ids as keys and avoid index keys for reorderable lists.",
            ],
          },
        },
        {
          title: "Side Effects with useEffect",
          durationMin: 8,
          type: "article",
          content: {
            intro:
              "Some things happen outside React's render cycle: fetching data, subscribing to events, syncing with localStorage. useEffect declares a side effect that runs after the component renders, and its dependency array controls when it runs again.",
            sections: [
              {
                heading: "The dependency array",
                paragraphs: [
                  "useEffect(() => { ... }) runs after every render. Adding a dependency array (useEffect(fn, [deps])) runs it only when one of the deps changed. The array compares each value with Object.is — the same rules as state: new object or array identities count as changes, so don't build deps inline unless you mean them to change every render.",
                ],
                code: {
                  lang: "jsx",
                  text: `useEffect(() => {\n  let cancelled = false;\n\n  async function loadJobs() {\n    setLoading(true);\n    const res = await fetch(\`/api/jobs?query=\${query}\`);\n    const data = await res.json();\n    if (!cancelled) {\n      setJobs(data.jobs);\n      setLoading(false);\n    }\n  }\n\n  loadJobs();\n  return () => {\n    cancelled = true; // cleanup for fast typing / unmount\n  };\n}, [query]);`,
                },
              },
              {
                heading: "Cleanup functions",
                paragraphs: [
                  "The function returned from useEffect is the cleanup: it runs before the effect re-runs and when the component unmounts. Cleanup cancels in-flight requests, clears timers, and removes subscriptions — without it, a slow response can overwrite fresh state (a race) and cause memory leaks.",
                  "An empty dependency array ([]) runs the effect once after the first render — the classic 'mount' effect. Use it sparingly: two-way sync with external systems is usually a smell. And never call setState of the same component in an unconditional, dependency-less effect — that is an infinite render loop.",
                ],
                list: [
                  "Fetch inside the effect, not during render.",
                  "Guard stale responses (cancelled flag or AbortController).",
                  "Clean up every resource the effect creates.",
                  "Effects are for synchronizing with systems outside React — derived values belong in plain calculations during render.",
                ],
              },
            ],
            takeaways: [
              "Fetch data in useEffect keyed on the query that drives it.",
              "Explain what the dependency array compares and why it avoids an infinite loop.",
              "Write a cleanup function that cancels a stale request on re-run or unmount.",
            ],
          },
        },
        {
          title: "Controlled Inputs and Forms",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "In React, form inputs are usually 'controlled' — their value comes from state, and changes flow through an onChange handler. This gives you a single source of truth for validation, disabled states, and submit logic.",
            sections: [
              {
                heading: "The controlled pattern",
                paragraphs: [
                  "A controlled input pairs value={state} with onChange that updates state. React keeps the DOM input in sync with your state on every keystroke, so at any moment the current input value is simply the state value — no reading the DOM, no refs needed for basic forms.",
                ],
                code: {
                  lang: "jsx",
                  text: `function EmailForm({ onSubmit }) {\n  const [email, setEmail] = useState("");\n  const valid = /\\S+@\\S+\\.\\S+/.test(email);\n\n  return (\n    <form\n      onSubmit={(e) => {\n        e.preventDefault();\n        if (valid) onSubmit(email);\n      }}\n    >\n      <input\n        type="email"\n        value={email}\n        onChange={(e) => setEmail(e.target.value)}\n        placeholder="you@example.com"\n      />\n      <button type="submit" disabled={!valid}>Sign up</button>\n    </form>\n  );\n}`,
                },
              },
              {
                heading: "Why control beats uncontrolled",
                paragraphs: [
                  "Because state holds the truth, validation is a derived boolean (valid above), and the submit button can be disabled until the form is valid. You can also transform on the way in (trim, capitalize) or reject characters entirely by ignoring them in onChange.",
                  "Uncontrolled inputs (defaultValue + reading the DOM on submit) exist and work — form libraries often build on them — but the controlled pattern is the React-native default. For complex forms, reach for a library (React Hook Form, Formik) rather than hand-rolling dozens of useState calls.",
                ],
                list: [
                  "value + onChange = controlled; defaultValue = uncontrolled.",
                  "Always preventDefault on form submit, or the page reloads and state is lost.",
                  "Multiple fields: one state object with a single onChange using the field name (e.target.name) keeps handlers DRY.",
                ],
              },
            ],
            takeaways: [
              "Build a controlled input with value and onChange.",
              "Derive validation from state instead of duplicating it.",
              "Explain when an uncontrolled input or form library is the better tool.",
            ],
          },
        },
      ],
    },
    {
      title: "Composition Patterns",
      lessons: [
        {
          title: "Composition, not Inheritance",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "React ships with one built-in way to reuse component logic between components: composition. Unlike class-based OOP languages, React deliberately skips component inheritance — this lesson shows the patterns that replace it.",
            sections: [
              {
                heading: "Wrapping components with children",
                paragraphs: [
                  "The children prop is the closest thing to 'subclassing' a layout: a Shell component renders whatever is nested between its tags, while owning the chrome around it. Slots take this further — passing renderable elements as named props lets a parent decide what goes in each region.",
                ],
                code: {
                  lang: "jsx",
                  text: `function PageShell({ title, children, sidebar }) {\n  return (\n    <div className="shell">\n      <header><h1>{title}</h1></header>\n      <main>{children}</main>\n      <aside>{sidebar}</aside>\n    </div>\n  );\n}\n\n// Usage:\n// <PageShell title="Jobs" sidebar={<Filters />}>\n//   <JobList jobs={jobs} />\n// </PageShell>`,
                },
              },
              {
                heading: "Extracting shared behavior",
                paragraphs: [
                  "When two components share logic, the React answer is to extract a custom hook (useJobs(query)) or a component (JobRow), not to inherit from a base class. Inheritance hierarchies couple components to their ancestors; composition keeps each piece independently understandable and testable.",
                  "The official docs put it directly: 'React does not have the notion of inheritance... use composition instead.' Variants of this idea appear everywhere: render props, slots, higher-order components (older style), and custom hooks (modern style).",
                ],
                list: [
                  "Reuse markup with children and slot props.",
                  "Reuse stateful logic with custom hooks.",
                  "Reuse plain logic with plain functions.",
                  "Reserve inheritance for non-UI classes, if you use it at all.",
                ],
              },
            ],
            takeaways: [
              "Build a layout component that accepts children plus named slots.",
              "Explain why React omits inheritance and what to use instead.",
              "Choose between a custom hook, a component, and a helper function when extracting shared logic.",
            ],
          },
        },
        {
          title: "Container and Presentational Components",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "A classic React pattern: split components into 'containers' that handle data and logic, and 'presentational' components that only render what they're given. Even with modern hooks, this separation keeps codebases navigable.",
            sections: [
              {
                heading: "The two roles",
                paragraphs: [
                  "A presentational component receives everything via props and renders it. It doesn't fetch, doesn't subscribe, and barely has state beyond small UI details like 'is this menu open'. Because its output depends only on its props, it is trivial to reuse and to test with fixed inputs.",
                  "A container owns the data: it calls hooks (useState, useEffect, or a data library like RTK Query), reads app state, and passes results down. It knows about data shapes and side effects; the presentational child knows only about pixels.",
                ],
                code: {
                  lang: "jsx",
                  text: `// Presentational\nfunction JobTable({ jobs, onSelect }) {\n  if (jobs.length === 0) return <p>No jobs yet.</p>;\n  return (\n    <table>\n      <tbody>\n        {jobs.map((job) => (\n          <tr key={job.id} onClick={() => onSelect(job.id)}>\n            <td>{job.title}</td>\n            <td>{job.company}</td>\n          </tr>\n        ))}\n      </tbody>\n    </table>\n  );\n}\n\n// Container\nfunction JobTableContainer({ onSelect }) {\n  const { data: jobs = [], isLoading } = useGetJobsQuery();\n  if (isLoading) return <Spinner />;\n  return <JobTable jobs={jobs} onSelect={onSelect} />;\n}`,
                },
              },
              {
                heading: "Why it still matters",
                paragraphs: [
                  "The strict container/presentational split predates hooks and is now often folded into one file — and that's fine. What endures is the principle: keep data concerns at the edges and keep the rendering core pure. A component that both fetches AND renders a complicated table is harder to change, because every visual tweak risks touching data logic.",
                  "In interviews and code reviews, describing your components in these terms signals that you understand separation of concerns in React — including the trade-off that splitting too aggressively creates prop-drilling boilerplate for small features.",
                ],
                list: [
                  "Presentational: props in, markup out, no data fetching.",
                  "Container: owns fetching/state, composes presentational children.",
                  "Split when a component does both — don't split mechanically everywhere.",
                ],
              },
            ],
            takeaways: [
              "Separate a fetching container from a pure presentational table.",
              "Describe the trade-off between splitting and prop-drilling.",
              "Decide when a single combined component is the better choice.",
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
          "A job list re-renders after jobs are prepended to the top of the array, and rows suddenly show stale hover/state behavior. What is the most likely cause?",
        options: [
          "The list should use useState instead of props",
          "The key prop is the array index, so React mismatches rows after reordering",
          "React cannot render more than a few rows without memo",
          "The map callback must use forEach instead",
        ],
        answerIndex: 1,
        explanation:
          "Index keys identify rows by position, not identity. When items are prepended, React reuses each DOM node for whatever now sits at that position, so per-row state (hover, input values, focus) sticks to the position instead of the item. Stable ids as keys fix this. forEach returns undefined and cannot build elements; memo is a performance tool, not a correctness fix.",
        skillSlug: "react",
      },
      {
        prompt: "What is true about props in React?",
        options: [
          "Components may mutate their own props to keep rendering fast",
          "Props are only available to class components",
          "Props are read-only inputs; the parent owns the data and a child must not modify them",
          "Props and state are the same thing with different names",
        ],
        answerIndex: 2,
        explanation:
          "Props flow one way (parent to child) and are read-only — mutating them breaks React's assumption that a component's output depends only on its inputs. Function components receive props as the first argument (usually destructured). State is a component's own changeable data, updated via setters, so the two are distinct.",
        skillSlug: "react",
      },
      {
        prompt:
          "A controlled <input> shows what the user types. Which combination of props produces that behavior?",
        options: [
          "defaultValue={query} without handlers",
          "value={query} together with onChange updating query",
          "value={query} alone — React syncs typing automatically",
          "onChange={setQuery} alone with no value prop",
        ],
        answerIndex: 1,
        explanation:
          "A controlled input is value bound to state plus an onChange handler that updates that state on every keystroke. value alone makes the input read-only (the user can't type because React keeps resetting it). defaultValue creates an uncontrolled input that manages its own DOM value.",
        skillSlug: "react",
      },
      {
        prompt:
          "In useEffect(() => { ... }, [query]), when does the effect body run?",
        options: [
          "Before every render, including the first",
          "Once, when the component first mounts, never again",
          "After the component renders, and again whenever query differs from the previous render (Object.is comparison)",
          "Only when the user interacts with the page",
        ],
        answerIndex: 2,
        explanation:
          "useEffect runs after paint, not during render. With a dependency array it re-runs when any dependency changed since the last render, comparing values with Object.is (so a fresh object or array identity counts as a change). The empty array [] would run only on mount; no array runs after every render.",
        skillSlug: "react",
      },
      {
        prompt:
          "Two components need the same data-fetching behavior (query in, jobs + loading out). What is the idiomatic React way to share it?",
        options: [
          "Create a base component class and make both extend it",
          "Extract a custom hook (useJobs(query)) that both components call",
          "Copy the useEffect into both components",
          "Store jobs on window so any component can read it",
        ],
        answerIndex: 1,
        explanation:
          "React skips component inheritance entirely — composition is the answer, and a custom hook is the standard unit for sharing stateful logic. It keeps the state per-caller (each component gets its own copy) and stays testable. Copying effects duplicates bugs; global mutable state like window bypasses React's rendering model.",
        skillSlug: "react",
      },
    ],
  },
};

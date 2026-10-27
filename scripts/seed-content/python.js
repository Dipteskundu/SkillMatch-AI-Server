// scripts/seed-content/python.js — hand-authored, real Python curriculum (Phase 4 seed).
// 4 modules · 8 lessons · 5-question quiz with explanations.

export const pythonPath = {
  technologySlug: "programming",
  skillSlug: "python",
  title: "Python",
  slug: "python",
  level: "beginner",
  estimatedHours: 4,
  modules: [
    {
      title: "Language Fundamentals",
      lessons: [
        {
          title: "Variables, Types and f-strings",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Python is dynamically typed: variables are names bound to objects, and the object carries the type. This lesson covers the core scalar types, how assignment works, and f-strings — the modern way to format text.",
            sections: [
              {
                heading: "Names and types",
                paragraphs: [
                  "Assignment binds a name to a value: name = \"Ada\". Python has no separate declaration step, and the same name can be rebound to a value of a different type (don't rely on that — it confuses readers). The core types you'll use constantly are str, int, float, bool, and None (the absence of a value).",
                  "Types are objects: type(3) is int, type(3.5) is float, type(\"3\") is str. Conversions are explicit — int(\"42\") parses, float(\"3.5\") works, str(42) stringifies. A failed conversion raises ValueError, so validate input before casting.",
                ],
                list: [
                  "int, float — numbers (float division: 7 / 2 == 3.5; floor: 7 // 2 == 3).",
                  "str — immutable text; + concatenates, * repeats.",
                  "bool — True/False; None is the null-like singleton.",
                  "Naming: snake_case for variables and functions, Capitalized for classes.",
                ],
              },
              {
                heading: "f-strings for formatting",
                paragraphs: [
                  "An f-string (prefix the literal with f) interpolates expressions inside curly braces. It is the recommended formatting style since Python 3.6: readable, fast, and capable of full expressions, not just names.",
                ],
                code: {
                  lang: "python",
                  text: `name = "Ada"\nscore = 87.5\nprint(f"{name} scored {score:.1f}%")   # Ada scored 87.5%\nprint(f"{42 * 2 = }")                  # 42 * 2 = 84  (debug syntax, 3.8+)`,
                },
                list: [
                  "Format specs: {price:.2f}, {name:>10} (right-align), {n:,} (thousands).",
                  "Escaping literal braces: {{ and }}.",
                  "Older styles (%, .format()) still appear in legacy code — read them, but write f-strings.",
                ],
              },
            ],
            takeaways: [
              "Bind names to values and convert between core types safely.",
              "Use f-strings with format specs for readable output.",
              "Recognize None and test for it with `is None`, not == None.",
            ],
          },
        },
        {
          title: "Control Flow: if, for, while",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Python's control flow is defined by indentation. if/elif/else branches, for iterates over any iterable, and while repeats until a condition flips. Truthiness rules tie them all together.",
            sections: [
              {
                heading: "Conditionals and truthiness",
                paragraphs: [
                  "Python treats many values as implicitly true or false in a condition — empty strings, 0, empty lists/dicts/sets, and None are falsy; almost everything else is truthy. That lets you write idioms like if items: (run only if the list is non-empty). Explicit is often better: if len(items) > 0: reads clearer to newcomers, but if items: is the Pythonic norm.",
                ],
                code: {
                  lang: "python",
                  text: `def letter_grade(score):\n    if score >= 90:\n        return "A"\n    elif score >= 80:\n        return "B"\n    elif score >= 70:\n        return "C"\n    else:\n        return "F"`,
                },
              },
              {
                heading: "Loops",
                paragraphs: [
                  "for loops iterate directly over a sequence's values — you rarely need an index counter. range(n) produces 0..n-1 when you genuinely need positions, and enumerate(items) gives (index, value) pairs. while loops repeat while a condition holds; make sure something inside the loop can end it, or you have an infinite loop.",
                  "break exits the innermost loop; continue skips to the next iteration. for...else runs the else clause only if the loop completed without break — a little-known feature that's handy for 'did we find it?' searches.",
                ],
                code: {
                  lang: "python",
                  text: `for index, skill in enumerate(skills, start=1):\n    print(f"{index}. {skill}")\n\nwhile queue:\n    job = queue.pop(0)\n    if should_skip(job):\n        continue\n    process(job)\n    if done():\n        break`,
                },
                list: [
                  "Iterate values with for x in seq; positions with enumerate.",
                  "range(start, stop, step) — stop is exclusive.",
                  "Prefer for over while when iterating a collection.",
                ],
              },
            ],
            takeaways: [
              "Write if/elif/else chains using Python's truthiness rules.",
              "Iterate with for, enumerate, and range instead of manual counters.",
              "Use while only for condition-driven repetition and guarantee termination.",
            ],
          },
        },
      ],
    },
    {
      title: "Data Structures",
      lessons: [
        {
          title: "Lists and Tuples",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Lists are Python's growable, ordered, mutable sequences; tuples are their immutable cousins. Choosing between them — and knowing the performance implications of common operations — is everyday Python.",
            sections: [
              {
                heading: "Lists: ordered and mutable",
                paragraphs: [
                  "A list is a heterogeneous, ordered collection that supports append, insert, pop, sort, and slicing. Lists are references: assigning or passing one does NOT copy it — both names point to the same object, so mutation is visible everywhere. Copy explicitly with list.copy(), list(x), or slicing [:] when you need independence (or copy.deepcopy for nested structures).",
                ],
                code: {
                  lang: "python",
                  text: `skills = ["SQL", "Python"]\nskills.append("React")\nskills[0] = "Advanced SQL"     # in-place item assignment\nlast = skills.pop()            # remove + return\nlength = len(skills)\nexists = "Python" in skills    # membership test`,
                },
              },
              {
                heading: "Tuples: fixed and hashable",
                paragraphs: [
                  "A tuple is immutable: after creation you cannot add, remove, or replace elements. That makes tuples safe as dictionary keys and set members (lists, being mutable, are unhashable and raise TypeError), and it signals 'this collection is a fixed record'. Coordinates, DB rows, and function multi-return values are classic tuple use cases.",
                  "Watch the parentheses trap: (1) is just the integer 1; a single-element tuple needs the comma — (1,). And immutability is shallow: a tuple containing a list can't have its elements replaced, but the list inside it can still be mutated.",
                ],
                code: {
                  lang: "python",
                  text: `point = (10, 20)          # tuple: usable as dict key\nlocations = {(10, 20): "A"}\nlocations[point]\n\npair = 1, 2               # parentheses are optional\nsingle = (1,)             # comma, not parens, makes a tuple\nx, y = point              # unpacking`,
                },
                list: [
                  "Use a list when the data changes; a tuple for fixed records.",
                  "Tuples are hashable (usable in sets/dicts); lists are not.",
                  "Unpack with x, y = pair — cleaner than indexing.",
                ],
              },
            ],
            takeaways: [
              "Choose list vs tuple by mutability needs.",
              "Explain aliasing: assignment passes references, not copies.",
              "Use tuples as dict keys; remember the (x,) single-element syntax.",
            ],
          },
        },
        {
          title: "Dictionaries and Sets",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Dictionaries map keys to values with near-constant-time lookups; sets hold unique members. Together they replace most manual bookkeeping — counting, deduplicating, membership tests — with clean one-liners.",
            sections: [
              {
                heading: "Dictionaries",
                paragraphs: [
                  "A dict stores key → value pairs with average O(1) lookup. Keys must be hashable (strings, numbers, tuples — not lists or dicts); values can be anything. Access with brackets raises KeyError for missing keys; get(key, default) returns a fallback instead.",
                ],
                code: {
                  lang: "python",
                  text: `scores = {"react": 80, "sql": 90}\nscores["python"] = 75          # insert / update\nvalue = scores.get("go", 0)   # missing -> default 0\n\nfor skill, value in scores.items():\n    print(skill, value)\n\nword_counts = {}\nfor w in words:\n    word_counts[w] = word_counts.get(w, 0) + 1`,
                },
              },
              {
                heading: "Sets and common idioms",
                paragraphs: [
                  "A set holds unique hashable members with O(1) membership tests — vastly faster than scanning a list for large collections. set(list) deduplicates; set operations model real problems: intersection (&) finds shared skills, difference (-) finds gaps, union (|) combines pools. This powers the 'missing skills' logic in any job-matching feature.",
                ],
                code: {
                  lang: "python",
                  text: `required = {"sql", "python", "aws"}\nmine = {"sql", "react"}\n\nmissing = required - mine      # {'python', 'aws'}\nshared  = required & mine      # {'sql'}\npool    = required | mine      # union\n\nseen = set()                   # dedupe while iterating\nunique_jobs = [j for j in jobs if not (j.id in seen or seen.add(j.id))]`,
                },
                list: [
                  "dict.get(key, default) instead of try/except for optional lookups.",
                  "Set membership beats list scanning at scale.",
                  "Use collections.Counter when you just need counts.",
                ],
              },
            ],
            takeaways: [
              "Store and retrieve keyed data with dicts, using get for missing keys.",
              "Deduplicate and compute overlaps with sets.",
              "Model skill-gap comparisons as set difference and intersection.",
            ],
          },
        },
      ],
    },
    {
      title: "Functions and Environments",
      lessons: [
        {
          title: "Functions, Arguments and Return Values",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Functions package logic behind a name. Python gives you positional args, keyword args with defaults, *args/**kwargs for flexibility, and multiple return values via tuples — plus one famous gotcha to avoid.",
            sections: [
              {
                heading: "Defining and calling",
                paragraphs: [
                  "def defines a function; return ends it (falling off the end returns None). Parameters with defaults become optional at call sites. Keyword arguments let callers name their arguments explicitly (client.search(query=\"react\", remote=True)), which reads well when a function has several options.",
                ],
                code: {
                  lang: "python",
                  text: `def match_score(candidate, job, weight=1.0, *, verbose=False):\n    score = compute(candidate, job) * weight\n    if verbose:\n        print(score)\n    return score\n\nmatch_score(ada, job)                 # positional\nmatch_score(ada, job, weight=1.5)     # keyword\nmatch_score(ada, job, verbose=True)   # verbose is keyword-only (after *)`,
                },
              },
              {
                heading: "The mutable-default trap",
                paragraphs: [
                  "Default values are evaluated ONCE, at function definition. If the default is a mutable object (a list or dict), every call that uses the default shares the SAME instance — values accumulate across calls. This is the classic Python bug. Use None as the sentinel and create the fresh object inside the function.",
                ],
                code: {
                  lang: "python",
                  text: `# BUGGY: one shared list across all calls\ndef add_bad(items=[]):\n    items.append("x")\n    return items\n\n# CORRECT\ndef add_skill(skills=None):\n    if skills is None:\n        skills = []\n    skills.append("python")\n    return skills`,
                },
                list: [
                  "*args collects extra positionals into a tuple; **kwargs collects extra keywords into a dict.",
                  "Return None explicitly only for side-effecting functions.",
                  "Raise ValueError (or a custom exception) for invalid input; let callers decide.",
                ],
              },
            ],
            takeaways: [
              "Write functions with defaults and keyword-only parameters.",
              "Explain why mutable defaults are shared across calls and fix with None.",
              "Return multiple values with tuple unpacking.",
            ],
          },
        },
        {
          title: "Virtual Environments and pip",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "A virtual environment gives each project its own isolated set of packages. Using one is considered mandatory Python hygiene — it stops dependency conflicts between projects and makes installs reproducible.",
            sections: [
              {
                heading: "Why isolation matters",
                paragraphs: [
                  "Python packages install into a shared site-packages directory by default. If project A needs requests 2.28 and project B needs 2.31, a shared install means someone loses. A virtual environment creates a per-project directory containing its own interpreter link and package set; activating it points `python` and `pip` at that directory.",
                ],
                code: {
                  lang: "bash",
                  text: `python -m venv .venv          # create (Windows: .venv\\Scripts\\activate)\nsource .venv/bin/activate     # activate (bash/zsh)\npip install requests          # installs INTO the venv\npip freeze > requirements.txt # record exact versions\ndeactivate                    # leave the environment`,
                },
              },
              {
                heading: "Reproducible installs",
                paragraphs: [
                  "Commit requirements.txt (or use pyproject.toml with a lock file such as uv.lock or poetry.lock) so teammates and CI install identical versions: pip install -r requirements.txt. Pinning matters — unpinned installs can pull a breaking minor release tomorrow.",
                  "Modern alternatives (uv, poetry, pipenv) wrap venv + pip with lock files and faster resolution; the underlying concept is the same. `python -m pip` instead of bare pip guarantees you install into the interpreter currently active — a good habit on machines with multiple Pythons.",
                ],
                list: [
                  "One venv per project; never pip install globally for app dependencies.",
                  "Commit the lock/requirements file, not the venv directory.",
                  "Match your Python version to what production runs (see .python-version).",
                ],
              },
            ],
            takeaways: [
              "Create and activate a virtual environment with python -m venv.",
              "Record and reinstall dependencies with requirements.txt.",
              "Explain the dependency-conflict problem virtual environments solve.",
            ],
          },
        },
      ],
    },
    {
      title: "Working with Data",
      lessons: [
        {
          title: "Comprehensions",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Comprehensions build lists, sets, and dicts from iterables in a single expressive line. They replace explicit loop-and-append boilerplate — and double as the canonical filter mechanism.",
            sections: [
              {
                heading: "List comprehensions",
                paragraphs: [
                  "The pattern is [expression for item in iterable if condition]: transform each item, optionally skipping those that fail the condition. Nested loops work too (read them left to right: first loop is outermost). Keep comprehensions to one or two for clauses — deeper nesting belongs in a plain loop for readability.",
                ],
                code: {
                  lang: "python",
                  text: `titles = [j.title for j in jobs]\nremote = [j.title for j in jobs if j.remote]\nsenior = [j.title.upper() for j in jobs if j.level == "senior"]\n\n# equivalent explicit loop\ntitles = []\nfor j in jobs:\n    titles.append(j.title)`,
                },
              },
              {
                heading: "Set/dict comprehensions and generators",
                paragraphs: [
                  "Set comprehensions dedupe as they build ({s.name for s in skills}); dict comprehensions build mappings ({j.id: j.title for j in jobs}). When you only need to iterate once — sum, min, max, feeding another loop — a generator expression ((x for x in iterable), round brackets) produces values lazily instead of materializing a whole list in memory.",
                ],
                code: {
                  lang: "python",
                  text: `skill_names = {s.name.lower() for s in skills}   # unique, lowercase\ntitle_by_id = {j.id: j.title for j in jobs}\n\ntotal_minutes = sum(l.duration for l in lessons)  # generator: no big list\nfirst_match = next((j for j in jobs if "senior" in j.title.lower()), None)`,
                },
                list: [
                  "Comprehension = transform + filter in one expression.",
                  "Use generators for large or single-pass data.",
                  "If you need if/elif logic per item, use a loop or a helper function.",
                ],
              },
            ],
            takeaways: [
              "Transform and filter an iterable with a list comprehension.",
              "Build unique collections and key→value maps with set/dict comprehensions.",
              "Choose a generator expression when you only consume values once.",
            ],
          },
        },
        {
          title: "Reading and Writing Files",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "File I/O in Python centers on the with statement, which guarantees the file is closed even if an exception occurs. This lesson covers text files, common encodings, and parsing line-based formats.",
            sections: [
              {
                heading: "with: the only way you should open files",
                paragraphs: [
                  "open() returns a file object; with open(...) as f: sets up a context that closes the file when the block ends — including when an exception unwinds. Always pass an explicit encoding (encoding=\"utf-8\") so behavior doesn't depend on the machine's locale. Forgetting the encoding is the most common source of mojibake bugs when files move between Windows and Linux.",
                ],
                code: {
                  lang: "python",
                  text: `with open("jobs.csv", encoding="utf-8") as f:\n    header = f.readline()\n    rows = [line.strip().split(",") for line in f if line.strip()]\n\nwith open("report.txt", "w", encoding="utf-8") as f:\n    f.write("Match report\\n")`,
                },
              },
              {
                heading: "Structured data",
                paragraphs: [
                  "For CSV with quoting and embedded commas, use the csv module instead of splitting by hand — csv.reader handles escaped quotes correctly. For JSON use json.load / json.dump. Both integrate naturally with with blocks.",
                  "Reading a whole file at once (f.read()) is fine for small files; iterate line by line for large ones so memory stays flat. Write mode \"w\" truncates the file — use \"a\" to append.",
                ],
                list: [
                  "Always with open(...) and an explicit encoding.",
                  "csv module for CSV; json module for JSON — don't hand-roll parsers.",
                  "\"w\" overwrites, \"a\" appends, \"r+\" reads and writes.",
                ],
              },
            ],
            takeaways: [
              "Read and write text files safely with with and explicit encodings.",
              "Parse CSV and JSON with the standard library.",
              "Explain why bare open() without with risks leaked file handles.",
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
        prompt: "What does this function return after two calls to add_skill()?\n\ndef add_skill(skills=None):\n    if skills is None:\n        skills = []\n    skills.append(\"python\")\n    return skills\n\nadd_skill(); add_skill()",
        options: [
          "['python'] both times — the default list resets each call",
          "['python', 'python'] — both calls appended to one shared list",
          "A TypeError: default arguments cannot be mutable",
          "None on the second call because the list was already used",
        ],
        answerIndex: 0,
        explanation:
          "The None sentinel pattern creates a FRESH list inside the function on every call, so each call appends to its own list and both return ['python']. The buggy version (skills=[]) would share one list across calls and accumulate ['python', 'python']. There is no TypeError — Python allows mutable defaults, which is exactly why the trap exists.",
        skillSlug: "python",
      },
      {
        prompt: "Why can a tuple be used as a dictionary key while a list cannot?",
        options: [
          "Tuples are faster to create than lists",
          "Dictionary keys must be hashable; tuples are immutable and hashable, lists are mutable and unhashable",
          "Dictionaries only accept string and number keys",
          "Lists are automatically converted to tuples when used as keys",
        ],
        answerIndex: 1,
        explanation:
          "Dict keys must have a stable hash that doesn't change while stored. Tuples of hashable elements are immutable and therefore hashable; lists can be mutated after insertion, which would invalidate their hash, so Python raises TypeError. Strings and numbers also work; lists are never silently converted.",
        skillSlug: "python",
      },
      {
        prompt: "required = {'sql', 'python'}; mine = {'sql', 'react'}. What is required - mine?",
        options: ["{'sql'}", "{'python'}", "{'sql', 'python', 'react'}", "{'react'}"],
        answerIndex: 1,
        explanation:
          "The - operator is set difference: members in the first set that are NOT in the second. Only 'python' qualifies. {'sql'} is the intersection (&), the union (|) would be all three, and 'react' is in mine but not required (mine - required).",
        skillSlug: "python",
      },
      {
        prompt:
          "You create a virtual environment with python -m venv .venv and activate it. What does that accomplish?",
        options: [
          "It installs Python itself so you don't need a system interpreter",
          "It locks your code so no one can modify it",
          "It gives the project its own interpreter + package directory, so pip installs are isolated per project",
          "It compiles your Python files for production speed",
        ],
        answerIndex: 2,
        explanation:
          "A venv creates a project-local environment directory with its own site-packages. After activation, python and pip point there, so installed versions can't conflict with other projects on the same machine. It doesn't install Python (it uses your existing interpreter), doesn't lock code, and doesn't compile anything — Python remains interpreted.",
        skillSlug: "python",
      },
      {
        prompt: "What is the output of: [len(s) for s in ['sql', 'python', 'go'] if len(s) > 2] ?",
        options: ["[3, 6, 2]", "[3, 6]", "[2]", "SyntaxError"],
        answerIndex: 1,
        explanation:
          "The comprehension maps len(s) over the list but the if clause filters FIRST: only strings longer than 2 characters contribute. 'sql' (3) and 'python' (6) pass; 'go' (2) is excluded, so the result is [3, 6].",
        skillSlug: "python",
      },
    ],
  },
};

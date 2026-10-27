// scripts/seed-content/system-design.js — hand-authored system design curriculum (Phase 4 seed).
// 3 modules · 9 lessons · 5-question quiz with explanations.

export const systemDesignPath = {
  technologySlug: "software-engineering",
  skillSlug: "system-design",
  title: "System Design",
  slug: "system-design",
  level: "intermediate",
  estimatedHours: 3.5,
  modules: [
    {
      title: "Scaling a Service",
      lessons: [
        {
          title: "Vertical vs Horizontal Scaling",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Scaling means adding capacity to meet demand. Vertical scaling (bigger machine) is simple; horizontal scaling (more machines) is where reliability and design complexity live. Understanding the trade-off is the first step of system design.",
            sections: [
              {
                heading: "Two directions of growth",
                paragraphs: [
                  "Vertical scaling ('scale up') means upgrading the current machine — more CPU, RAM, disk. It requires almost no code change and keeps things like in-memory state working, but it has a hard ceiling (the biggest machine a cloud sells), a big downtime/risk blast radius when you outgrow it, and usually a superlinear price tag.",
                  "Horizontal scaling ('scale out') adds more machines behind a load balancer. Capacity is effectively unlimited and any single machine can fail without taking the service down. The price is complexity: sessions and caches must be shareable or sticky, data must live somewhere all nodes can reach, and operations like deploys and consistent configuration get harder.",
                ],
                list: [
                  "Scale up first when traffic is modest — premature distribution is costly.",
                  "Scale out when you need resilience or you're near a single machine's ceiling.",
                  "Statelessness is the enabler of scale-out: any node can serve any request.",
                  "Bottlenecks often aren't CPU — databases and single-threaded paths (queues, locks) frequently cap you first.",
                ],
              },
              {
                heading: "Statelessness in practice",
                paragraphs: [
                  "To run N identical servers, nothing request-specific can live only in one server's memory: session state goes to a shared store (database, Redis), uploads go to object storage, and configuration comes from environment or a config service. Once stateless, scaling out is just changing an instance count, and rolling deploys become safe.",
                ],
              },
            ],
            takeaways: [
              "Compare scale-up and scale-out with cost, ceiling, and failure implications.",
              "Explain why stateless services scale horizontally.",
              "Identify a non-CPU bottleneck that could cap a service.",
            ],
          },
        },
        {
          title: "Load Balancing",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "A load balancer distributes incoming requests across healthy instances. It's the component that turns 'many servers' into 'one service', and it doubles as the traffic switch for deploys and failovers.",
            sections: [
              {
                heading: "Where it sits and how it routes",
                paragraphs: [
                  "Layer 4 load balancers forward TCP/UDP packets without inspecting content — fast, protocol-agnostic, but blind to URLs. Layer 7 (HTTP) balancers understand requests and can route by path or header (route /api to the API pool, /static to the CDN pool), do TLS termination, and health-check application endpoints.",
                  "Routing algorithms: round-robin spreads evenly; least-connections favors the least-busy node (good when request cost varies widely); consistent hashing sticks a key (user id) to the same node (useful for caches and WebSocket affinity).",
                ],
                list: [
                  "Health checks remove failed instances from rotation automatically.",
                  "TLS termination at the balancer offloads crypto from app servers.",
                  "Blue/green and canary deploys use the balancer to shift traffic gradually.",
                  "A single balancer is a single point of failure — run a managed pair/VIP.",
                ],
              },
              {
                heading: "Sessions after the balancer",
                paragraphs: [
                  "Once requests can land on any server, in-process sessions break: your next request hits a different instance and you're logged out. The fixes are shared session storage (Redis or the database), signed stateless tokens (JWTs) that carry the session data, or sticky sessions (affinity by cookie) — the last is simple but fragile, because instance changes still lose the session and it complicates autoscaling.",
                ],
              },
            ],
            takeaways: [
              "Distinguish L4 and L7 load balancing and when each is used.",
              "Explain sticky sessions and why shared state or tokens is usually better.",
              "Describe how a load balancer enables zero-downtime deploys.",
            ],
          },
        },
        {
          title: "Caching and Cache Invalidation",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Caching stores computed results closer to the consumer so repeated requests skip the expensive path. It's the highest-leverage performance tool in distributed systems — and cache invalidation is the famously hard part.",
            sections: [
              {
                heading: "Where caches live",
                paragraphs: [
                  "Client/CDN caches serve static assets and even API GETs close to the user (cache headers like Cache-Control control TTLs). Application caches (in-process LRU or a shared Redis) memoize expensive queries. Database caches and buffer pools speed page reads invisibly. Each layer has different staleness tolerance: a CDN can serve a logo for a day; a job's application count usually can't lag more than seconds.",
                ],
                code: {
                  lang: "text",
                  text: `Read path:  Client -> CDN? -> App -> [cache HIT] -> return\n                             \\-> [cache MISS] -> DB -> populate cache -> return`,
                },
              },
              {
                heading: "Invalidation strategies",
                paragraphs: [
                  "TTL (time-to-live) is the simplest: entries expire after N seconds, bounding staleness without coordination. Cache-aside (lazy population) means the app checks the cache, reads the DB on miss, and writes the entry; updates must explicitly evict or overwrite keys. Write-through updates the cache synchronously with the DB for freshness at the cost of write latency.",
                  "The failure modes are worth memorizing: the thundering herd (a cold cache sends every request to the DB at once — solve with request coalescing, jittered TTLs, or stale-while-revalidate) and stampedes on invalidation. Remember Phil Karlton's line: there are only two hard things — cache invalidation and naming things.",
                ],
                list: [
                  "Pick TTLs from how stale the data may legally be.",
                  "Cache-aside: app owns population; evict on write.",
                  "Jitter TTLs to avoid synchronized expiry.",
                  "Never cache non-idempotent results without a key scheme you can invalidate.",
                ],
              },
            ],
            takeaways: [
              "Place caches at client, CDN, app, and DB layers with appropriate TTLs.",
              "Explain cache-aside vs write-through.",
              "Diagnose a thundering herd and propose two mitigations.",
            ],
          },
        },
      ],
    },
    {
      title: "Data at Scale",
      lessons: [
        {
          title: "SQL vs NoSQL Trade-offs",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "'Use NoSQL for scale' is a myth that collapses in interviews. Each storage family buys different guarantees: relational databases give transactions and flexible queries; document/KV stores give horizontal scale and schema flexibility at the cost of weaker guarantees.",
            sections: [
              {
                heading: "What each side optimizes",
                paragraphs: [
                  "Relational (PostgreSQL, MySQL): normalized schema, SQL's ad-hoc joins, ACID transactions across rows and tables, and mature tooling. Scaling is vertical-first; read replicas and sharding add write scale but cost complexity.",
                  "Document/KV (MongoDB, DynamoDB): data shaped as it's accessed (one document = one read), horizontal scale built in, and flexible schemas per record. But multi-document transactions are limited or expensive, joins are discouraged or unavailable, and query patterns must be designed up front — access patterns drive the model.",
                ],
                list: [
                  "Strong consistency + ad-hoc queries + transactions → relational.",
                  "Very high write/read volume with known access patterns → document/KV.",
                  "Polyglot persistence is normal: transactions in Postgres, sessions in Redis, blobs in S3.",
                  "Start with one relational database — most products never need to leave it.",
                ],
              },
              {
                heading: "Schema design questions to ask",
                paragraphs: [
                  "In a document store, 'how is this read?' decides the shape: if a job page always renders job + company + first 10 applications, denormalizing those into one document turns three queries into one. The cost is duplication — an update must touch every copy, possibly eventually.",
                  "In SQL, ask what must stay consistent at once: if money moves between accounts, those rows want one transaction. That answer often picks the database before anything else does.",
                ],
              },
            ],
            takeaways: [
              "Contrast the guarantees of relational and document stores.",
              "Pick a storage choice for a given access pattern and justify it.",
              "Explain denormalization as a read-vs-write trade-off.",
            ],
          },
        },
        {
          title: "Replication and Sharding",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Replication copies data across machines for read scale and availability; sharding splits data across machines for write scale. They solve different problems and are often combined — with distinct failure modes each.",
            sections: [
              {
                heading: "Replication",
                paragraphs: [
                  "A primary/replica setup writes to one node and copies the log to replicas, which serve reads. Replicas improve read throughput and provide failover targets, but replication is usually asynchronous — a failover can lose recent writes (that's the consistency/availability trade-off in practical form). Replication lag also causes stale reads from replicas; read-your-own-writes traffic often pins to the primary.",
                ],
              },
              {
                heading: "Sharding",
                paragraphs: [
                  "Sharding partitions rows across databases by a shard key — user_id, or region. Done well, each shard handles a slice of the load; done poorly, hot shards bottleneck while others idle. Bad keys (monotonically increasing ids, or one giant tenant) create exactly that. Cross-shard queries and transactions become expensive or impossible, and resharding (adding shards, rebalancing) is a real operational project.",
                ],
                code: {
                  lang: "text",
                  text: `Shard by user_id % N:\n  shard 0: users 0-9,999   shard 1: users 10k-19,999 ...\n  + even spread, easy lookup by id\n  - range queries and rebalancing get awkward\nConsistent hashing limits remapping when N changes.`,
                },
                list: [
                  "Replication: more reads + availability; watch lag and failover loss.",
                  "Sharding: more writes; choose a uniform, low-cardinality shard key.",
                  "Cross-shard joins/transactions are the tax — design them out.",
                  "Many teams add read replicas long before they shard.",
                ],
              },
            ],
            takeaways: [
              "Explain primary/replica flow and replication lag consequences.",
              "Choose a sensible shard key and explain a bad one.",
              "Decide whether a given workload needs replication, sharding, or both.",
            ],
          },
        },
        {
          title: "Message Queues and Async Processing",
          durationMin: 7,
          type: "article",
          content: {
            intro:
              "Queues decouple producers from consumers: work that can wait (emails, thumbnail generation, fit-score recomputation) is enqueued and processed asynchronously. This absorbs traffic spikes and isolates failures between services.",
            sections: [
              {
                heading: "Why queue at all?",
                paragraphs: [
                  "Synchronous chains fail together: if the email provider slows down, your request threads pile up and the whole endpoint times out. With a queue, the request only does what must be immediate (persist the order) and returns; a worker pool processes emails at its own pace. Spikes become backlog instead of 500s, and consumers can scale independently of the web tier.",
                ],
                code: {
                  lang: "text",
                  text: `POST /orders -> API: save order, enqueue {orderId}, return 200\nWorker: pull message -> charge card -> send email -> ack\nRetry on failure (at-least-once); idempotent consumers required.`,
                },
              },
              {
                heading: "Delivery semantics",
                paragraphs: [
                  "At-most-once drops messages on failure; at-least-once redelivers after a crash (the common default — hence idempotent consumers keyed by message id); exactly-once is expensive and usually emulated via idempotency + dedupe. Competing consumers process in parallel (one message, one worker); pub/sub fan-out sends each message to many subscribers (notifications to multiple services).",
                  "Design notes for interviews: order matters (a queue per partition key preserves per-key order), poison messages need a retry cap + dead-letter queue, and monitoring backlog depth is your early-warning system.",
                ],
                list: [
                  "Enqueue the fact of work; never the results the user must see immediately.",
                  "Consumers must be idempotent under at-least-once delivery.",
                  "Dead-letter queues catch messages that repeatedly fail.",
                  "Backlog length is the health metric that matters.",
                ],
              },
            ],
            takeaways: [
              "Explain how a queue protects an API from slow downstream work.",
              "Compare at-most-once, at-least-once, and exactly-once delivery.",
              "Design a retry + dead-letter strategy for poison messages.",
            ],
          },
        },
      ],
    },
    {
      title: "Designing Reliable Systems",
      lessons: [
        {
          title: "Consistency and Latency Trade-offs",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Once data lives on multiple machines, copies disagree for some window. Consistency models describe how long clients may see stale data — and stronger guarantees always cost latency or availability.",
            sections: [
              {
                heading: "Strong vs eventual consistency",
                paragraphs: [
                  "Strong consistency means every read sees the latest write — as if there were a single copy. It's achieved by quorums (require reading from enough replicas to intersect writers) or by routing reads through the primary, and it costs latency (coordination is slow) and availability (if you can't reach a quorum, writes fail).",
                  "Eventual consistency lets replicas converge once writes stop. Users may briefly see stale or conflicting data — a comment that disappears after refresh, a counter that lags. For many features (feeds, analytics, like counts) that's acceptable; for balances, inventory, and permissions it usually isn't.",
                ],
                list: [
                  "CAP in practice: under a network partition you choose consistency or availability.",
                  "Read-your-own-writes: send the user's reads to their write's region/primary.",
                  "Pick per-feature: payments strong, analytics eventually.",
                  "Conflicts need a policy: last-write-wins, CRDTs, or app-level resolution.",
                ],
              },
              {
                heading: "Reasoning about windows of staleness",
                paragraphs: [
                  "Interview tip: when you choose eventual consistency, state the staleness window explicitly ('counts may lag up to 5 seconds') and what breaks if they do. That one sentence demonstrates you understand the trade rather than reciting buzzwords — and it usually steers the design toward a hybrid: strong for the write path, cached reads with short TTL for everything else.",
                ],
              },
            ],
            takeaways: [
              "State what strong consistency costs in latency and availability.",
              "Give a feature-level example of an acceptable staleness window.",
              "Apply read-your-own-writes reasoning to a global app.",
            ],
          },
        },
        {
          title: "Rate Limiting and Resilience Patterns",
          durationMin: 6,
          type: "article",
          content: {
            intro:
              "Dependencies fail: providers time out, traffic spikes arrive, one bad client can exhaust your capacity. Rate limiting and a handful of resilience patterns keep a failure in one place from becoming an outage everywhere.",
            sections: [
              {
                heading: "Rate limiting algorithms",
                paragraphs: [
                  "Fixed window counts requests per calendar window — simple but allows a 2x burst across the boundary. Sliding window/log is accurate but memory-hungry. Token bucket allows bursts up to bucket size while sustaining a steady rate — the common choice for APIs (and the express-rate-limit library's spirit). Leaky bucket smooths output to a constant rate.",
                  "Limiters are enforced at the edge (CDN/gateway) for cheap protection and per-user in the app for fairness; counters live in Redis when you run more than one gateway node.",
                ],
              },
              {
                heading: "Timeouts, retries, circuit breakers",
                paragraphs: [
                  "Always set timeouts — an unbounded wait is how one slow dependency converts into thread-pool exhaustion. Retries must be bounded and use exponential backoff with jitter, and only for idempotent operations; otherwise a retry duplicates work. A circuit breaker stops calling a failing dependency for a cooldown period (fast-fail instead of piling up), then half-opens to test recovery. Bulkheads partition resources so one workload can't starve the others. Graceful degradation (serve stale data, disable a feature) beats a blank error page.",
                ],
                list: [
                  "Timeouts on every outbound call.",
                  "Bounded retries + backoff + jitter; retry only idempotent work.",
                  "Circuit breaker to stop hammering a dead dependency.",
                  "Shed load early (rate limit, queue caps) rather than collapse late.",
                ],
              },
            ],
            takeaways: [
              "Pick a rate-limiting algorithm and note its burst behavior.",
              "Explain why retries need backoff, jitter, and idempotency.",
              "Describe the circuit-breaker states (closed, open, half-open).",
            ],
          },
        },
        {
          title: "Case Study: Design a URL Shortener",
          durationMin: 8,
          type: "article",
          content: {
            intro:
              "The classic warm-up design question: given a long URL, return a short one; given a short code, redirect fast. Small enough for 40 minutes, rich enough to touch ID generation, hashing, caching, and analytics.",
            sections: [
              {
                heading: "Requirements and the core math",
                paragraphs: [
                  "Clarify: ~100M new links/month, 10:1 read/write ratio, links never expire (or after 5 years), custom aliases allowed, redirects must be fast and tracked. 100M/month ≈ 40 writes/second average — a single database can ingest that; this problem is about read latency and availability, not write scale.",
                  "Code generation: base62-encode an auto-increment id (62^7 ≈ 3.5 trillion combinations — 7 characters suffices for decades). Alternatives: a hash of the URL (MD5/SHA truncated, handle collisions by re-hashing) or a pre-allocated range per datacenter. Random generation + uniqueness check is simplest and fine at this scale.",
                ],
                code: {
                  lang: "text",
                  text: `Write:  long URL -> generate 7-char code -> store (code, url) -> return short link\nRead:   GET /{code} -> cache lookup -> DB fallback -> 301/302 redirect\n        301 = permanent (browser caches; you lose analytics)\n        302 = temporary  (every hit reaches you; keeps counting)`,
                },
              },
              {
                heading: "Read path, scale-out, extras",
                paragraphs: [
                  "Reads dominate, so put a Redis cache in front of the mapping table — popular links stay hot and most redirects never touch the database. Replicate the mapping table for read scale; the write path stays on one primary. If analytics are required, redirect events go through a queue to an async aggregation pipeline — never onto the redirect hot path.",
                  "Wrap it up with the operations view: rate limiting per user against abuse (someone shortening millions of URLs), idempotent custom-alias creation, monitoring on redirect latency and cache hit rate, and a plan for hot keys (a viral link — serve from cache, optionally pre-warm).",
                ],
                list: [
                  "Estimate storage: ~14 bytes/row × 100M rows/month ≈ 1.4GB/month — modest.",
                  "301 loses analytics; 302 keeps them.",
                  "Cache aggressively — reads outnumber writes ~10:1.",
                  "Analytics via queue, not on the redirect path.",
                ],
              },
            ],
            takeaways: [
              "Size the workload with back-of-envelope estimates before designing.",
              "Choose an ID-generation scheme and defend it against collisions and sequential-id leakage.",
              "Walk the full read and write paths, including cache and analytics.",
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
          "A service is horizontally scaled behind a load balancer, but users get logged out randomly. Most likely cause?",
        options: [
          "The load balancer's round-robin algorithm is broken",
          "Session state lives in each server's memory, and consecutive requests hit different instances",
          "The database is too slow",
          "HTTP cannot carry authentication",
        ],
        answerIndex: 1,
        explanation:
          "Stateless scaling requires session state in a shared place (database, Redis) or in a stateless token (JWT). With in-process sessions, the next request can land on a different instance and finds no session. Sticky sessions are a workaround but fragile; slow databases cause timeouts, not random logouts.",
        skillSlug: "system-design",
      },
      {
        prompt: "What is the classic 'thundering herd' problem and a good mitigation?",
        options: [
          "Too many cache entries evicting each other; mitigate by enlarging the cache",
          "A hot key serving millions of reads; mitigate by deleting it",
          "A cold cache or expired TTL sending every concurrent request to the database at once; mitigate with jittered TTLs or request coalescing",
          "Clients retrying failed requests; mitigate by removing the load balancer",
        ],
        answerIndex: 2,
        explanation:
          "When a popular cache entry expires, all concurrent requests miss together and hammer the origin simultaneously. Jittered (randomized) TTLs desynchronize expirations, and request coalescing/singleflight lets one request recompute while the others wait for the result.",
        skillSlug: "system-design",
      },
      {
        prompt:
          "You must shard a jobs collection. Which shard key is the worst choice?",
        options: [
          "hash(user_id) of the posting recruiter",
          "job_id hashed with consistent hashing",
          "the createdAt timestamp (monotonically increasing)",
          "region, if traffic is balanced across regions",
        ],
        answerIndex: 2,
        explanation:
          "Monotonic keys concentrate all new writes in one shard — the 'hot shard' problem — while older shards idle. Hashed ids spread writes evenly. Region works when regions are balanced; user_id is a classic key when data is per-user.",
        skillSlug: "system-design",
      },
      {
        prompt: "Why do at-least-once queue consumers need to be idempotent?",
        options: [
          "Queues reorder messages, breaking processing",
          "A crash between processing and acknowledgment can cause the same message to be redelivered, so the work may run twice",
          "Idempotency makes messages smaller",
          "At-most-once delivery retries every message forever",
        ],
        answerIndex: 1,
        explanation:
          "With at-least-once delivery, the broker redelivers messages that weren't acknowledged — so handlers may execute twice for the same message. Idempotent processing (dedupe keys, natural idempotency like 'set status = X') makes the duplicate harmless. That's the trade: no silent message loss, but duplicates must be tolerated.",
        skillSlug: "system-design",
      },
      {
        prompt:
          "A URL shortener gets ~100M new links per month with a 10:1 read/write ratio. What does this suggest?",
        options: [
          "Shard the mapping table across 50 databases immediately",
          "The write load is modest (~40/s) — prioritize a fast cached read path and simple ID generation over massive write infrastructure",
          "Use a graph database for the redirect path",
          "No cache is needed; the database can serve every redirect",
        ],
        answerIndex: 1,
        explanation:
          "Back-of-envelope: 100M/month ≈ 40 writes/second — one database handles that easily. The design pressure is the ~400 redirects/second (and spikiness), so the right bets are a Redis cache in front of the mapping table, read replicas, and fast code generation. Graph databases are irrelevant here; skipping the cache wastes the cheapest optimization available.",
        skillSlug: "system-design",
      },
    ],
  },
};

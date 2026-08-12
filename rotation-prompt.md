I want you to modify this repository

IMPORTANT:
- Work directly against the CURRENT repository code.
- Inspect the repository before making changes.
- Do not assume the architecture from this prompt if the actual source differs.
- Preserve all existing functionality and tests.
- Do not make unrelated refactors.
- I want a production-quality implementation, not a quick hack.
- After implementing, run the existing test suite and add tests for the new behavior.

==================================================
GOAL
==================================================

Implement API-key + model rotation for Claude Code's three model tiers:

- Opus
- Sonnet
- Haiku

Each tier has its own ordered list of Gemini models.

For example:

KEY1:
  Haiku:  ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
  Sonnet: ["gemini-3.5-flash", "gemini-3-flash"]
  Opus:   ["gemini-3.6-flash"]

KEY2:
  Haiku:  ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
  Sonnet: ["gemini-3.5-flash", "gemini-3-flash"]
  Opus:   ["gemini-3.6-flash"]

KEY3:
  Haiku:  ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
  Sonnet: ["gemini-3.5-flash", "gemini-3-flash"]
  Opus:   ["gemini-3.6-flash"]

etc.

The important part is that the rotation is PER TIER.

Do NOT create one global pool where an Opus request can accidentally fall
back to a Haiku model or vice versa.

==================================================
EXPECTED ROTATION
==================================================

For each incoming request, first determine its Claude Code tier from the
incoming request/model routing.

Then use ONLY that tier's configured model list.

Example:

Haiku configuration:

  KEY1 + gemini-3.5-flash-lite
  KEY1 + gemini-3.1-flash-lite
  KEY2 + gemini-3.5-flash-lite
  KEY2 + gemini-3.1-flash-lite
  KEY3 + gemini-3.5-flash-lite
  KEY3 + gemini-3.1-flash-lite

If:

  KEY1 + gemini-3.5-flash-lite

returns a rate-limit response, try:

  KEY1 + gemini-3.1-flash-lite

If that fails with a retryable error, try:

  KEY2 + gemini-3.5-flash-lite

then:

  KEY2 + gemini-3.1-flash-lite

etc.

The ordering MUST be deterministic.

For N keys and M models in a tier, there are N*M combinations.

==================================================
CRITICAL REQUIREMENT: NO REQUEST SPAM
==================================================

This is extremely important.

A failed/rate-limited combination must NOT continue receiving requests
in the background.

There must never be multiple simultaneous retries such as:

  KEY1 + model1 -> 429
  KEY1 + model1 -> 429
  KEY1 + model1 -> 429
  KEY1 + model2 -> request
  KEY1 + model1 -> request

Do NOT implement background retry loops.

For one incoming Claude request:

  attempt combination #1
       |
       | retryable error
       v
  attempt combination #2
       |
       | retryable error
       v
  attempt combination #3
       |
       | success
       v
  return response to Claude

Only ONE upstream Gemini request should be active for a given incoming
Claude request at a time.

==================================================
RATE-LIMIT / FAILURE HANDLING
==================================================

Treat Gemini HTTP/API errors such as these as retryable:

- 429
- 500
- 502
- 503
- 504

If the Gemini API/client exposes another clearly identifiable temporary
availability/rate-limit error, handle it appropriately too.

For a retryable error:

  1. record the failure
  2. move to the next key/model combination
  3. make exactly one request using that combination
  4. continue until success or the pool is exhausted

Do NOT retry the same failed combination immediately.

Non-retryable errors should NOT blindly rotate through every key.

For example, malformed request / invalid configuration / authentication
errors that clearly indicate a permanent configuration problem should be
returned appropriately.

Use the actual error types/status handling already present in this
repository rather than inventing a parallel HTTP abstraction.

==================================================
IMPORTANT: RETRY STATE / COOLDOWN
==================================================

Because this is a long-running proxy, maintain temporary health state for
key/model combinations.

If:

  KEY1 + gemini-3.5-flash-lite

gets rate limited, it should optionally be marked unavailable for a
configurable cooldown period.

Example:

  KEY1 + model1 -> 429
  cooldown = 60 seconds

A subsequent unrelated Claude request arriving during that cooldown should
prefer healthy combinations instead of immediately hitting the same
rate-limited combination again.

However:

- cooldown MUST NOT cause requests to fail if healthy combinations exist
- cooldown MUST be configurable
- cooldown state should be in-memory unless the repository already has a
  persistent state mechanism
- expired cooldowns must automatically become eligible again

Use a sensible default cooldown.

Do NOT implement an aggressive retry loop.

If the entire pool is temporarily rate limited, return a clear upstream
error rather than continuously hammering Gemini.

==================================================
KEY CONFIGURATION
==================================================

Design configuration so multiple API keys can be supplied securely through
environment variables.

Do NOT hard-code API keys.

Prefer a structure that is easy to understand and maintain.

For example, something along the lines of:

GEMINI_API_KEYS=key1,key2,key3

or, if the repository's existing configuration architecture makes it
cleaner:

GEMINI_API_KEY_1=...
GEMINI_API_KEY_2=...
GEMINI_API_KEY_3=...

Choose the approach that best fits the existing project.

The API keys must never be logged.

Never print full API keys.

If logging key identity is useful, use a short SHA-256 fingerprint, e.g.:

KEY1 fingerprint=abc123...

Do not expose secrets in errors.

==================================================
MODEL CONFIGURATION
==================================================

Each tier must have its own ordered model list.

I want configuration conceptually equivalent to:

HAIKU_MODELS=gemini-3.5-flash-lite,gemini-3.1-flash-lite
SONNET_MODELS=gemini-3.5-flash,gemini-3-flash
OPUS_MODELS=gemini-3.6-flash

The exact environment-variable names may be changed if the existing
repository has a better configuration convention.

The important requirement is:

  Opus -> ONLY Opus models
  Sonnet -> ONLY Sonnet models
  Haiku -> ONLY Haiku models

The order in each environment variable is significant.

For example:

HAIKU_MODELS=a,b,c

means:

  first a
  then b
  then c

Do not alphabetically sort the models.

Do not randomize them unless explicitly configured to do so.

==================================================
TIER DETECTION
==================================================

Inspect the repository and determine exactly how it currently identifies
Opus/Sonnet/Haiku requests.

The repository already supports:

  ANTHROPIC_DEFAULT_OPUS_MODEL
  ANTHROPIC_DEFAULT_SONNET_MODEL
  ANTHROPIC_DEFAULT_HAIKU_MODEL
  ANTHROPIC_MODEL

Do not break this behavior.

The proxy should determine the tier from the incoming request/model routing
in a robust way.

Do NOT assume that the literal incoming Gemini model name itself tells you
whether something is Opus/Sonnet/Haiku.

The tier association must come from the proxy's routing/configuration.

If necessary, introduce an explicit mapping/configuration layer.

==================================================
NORMAL SUCCESS PATH
==================================================

If the first combination succeeds:

  KEY1 + first configured model

then return immediately.

Do NOT unnecessarily try other keys/models.

Example:

Haiku:

  KEY1 + gemini-3.5-flash-lite -> SUCCESS

Result:

  return response

No request should be sent to:

  KEY1 + gemini-3.1-flash-lite
  KEY2 + anything
  KEY3 + anything

==================================================
FAILOVER EXAMPLE
==================================================

Given:

HAIKU_MODELS=
  gemini-3.5-flash-lite,
  gemini-3.1-flash-lite

and:

KEY1
KEY2
KEY3

The deterministic sequence is:

1. KEY1 + gemini-3.5-flash-lite
2. KEY1 + gemini-3.1-flash-lite
3. KEY2 + gemini-3.5-flash-lite
4. KEY2 + gemini-3.1-flash-lite
5. KEY3 + gemini-3.5-flash-lite
6. KEY3 + gemini-3.1-flash-lite

If #1 returns 429 and #2 succeeds:

ONLY #1 and #2 are called.

If #1, #2, #3 fail and #4 succeeds:

ONLY #1 -> #2 -> #3 -> #4 are called.

==================================================
CONCURRENCY
==================================================

Be careful about concurrent Claude Code requests.

There may be several incoming requests at once.

Do NOT create a global mutex that serializes the entire proxy unless
absolutely necessary.

Different Claude requests should be able to execute concurrently.

However, shared cooldown/health state must be concurrency-safe.

Example:

Request A:
  KEY1 + model1 -> 429

Request B arriving shortly afterwards should see the cooldown and preferably
skip KEY1 + model1.

But Request A and Request B should still be able to use different healthy
combinations concurrently.

Use the project's existing async/runtime patterns.

==================================================
STREAMING
==================================================

This repository supports Anthropic Messages API behavior.

Do NOT break streaming responses.

Rotation should happen BEFORE a successful upstream stream is returned.

If an upstream request fails before a usable stream has started, it is safe
to rotate to the next combination.

Do NOT attempt to transparently restart a stream after partial content has
already been sent to Claude Code unless the existing architecture explicitly
supports that safely.

Once response data has started streaming to the client:

  do not silently switch models mid-response.

If the upstream fails after streaming has begun, propagate the failure
according to the existing proxy behavior.

==================================================
RESPONSE MODEL FIELD
==================================================

When a fallback model is used, make sure the response remains compatible
with Claude Code and the existing proxy's response translation.

Inspect how the repository currently sets the response `model` field.

Do not accidentally expose an incorrect internal model identifier if the
existing API contract expects the actual Gemini model.

Preserve current behavior unless a change is required for rotation.

==================================================
LOGGING
==================================================

Add useful but non-sensitive logs.

For example:

  Gemini request:
    tier=haiku
    key=KEY1
    fingerprint=abc123
    model=gemini-3.5-flash-lite
    attempt=1/6

On rate limit:

  Gemini rate limited:
    tier=haiku
    key=KEY1
    model=gemini-3.5-flash-lite
    cooldown=60s

Then:

  Rotating Gemini:
    tier=haiku
    KEY1 + gemini-3.5-flash-lite
    ->
    KEY1 + gemini-3.1-flash-lite

On success:

  Gemini request succeeded:
    tier=haiku
    key=KEY1
    model=gemini-3.1-flash-lite

NEVER log:

  full API keys
  Authorization headers
  request contents
  Claude conversation contents

unless the repository already has an explicit secure debug mechanism.

==================================================
TESTING
==================================================

Add comprehensive unit tests.

At minimum test:

1. Single key + single model succeeds.

2. First model succeeds:
   - only one upstream request occurs.

3. First model returns 429:
   - second model is attempted.

4. First model returns 500:
   - second model is attempted.

5. First key/model fails:
   - next combination is attempted in exact order.

6. Multiple keys + multiple models produce deterministic ordering.

For:

keys:
  KEY1
  KEY2
  KEY3

models:
  modelA
  modelB

expect:

  KEY1/modelA
  KEY1/modelB
  KEY2/modelA
  KEY2/modelB
  KEY3/modelA
  KEY3/modelB

7. Opus only uses the Opus model pool.

8. Sonnet only uses the Sonnet model pool.

9. Haiku only uses the Haiku model pool.

10. A Haiku failure never causes fallback to a Sonnet model.

11. A Sonnet failure never causes fallback to an Opus model.

12. A successful fallback stops the sequence.

13. No concurrent duplicate retries are created.

14. Cooldown marks a failed combination unavailable.

15. A combination becomes eligible again after cooldown expires.

16. Healthy combinations are preferred over combinations in cooldown.

17. If every combination is unavailable, return an appropriate error.

18. API keys never appear in logs.

19. Streaming behavior remains intact.

20. Existing tests continue to pass.

Use mocks for Gemini HTTP/API calls. Do not make real API requests in tests.

==================================================
CONFIGURATION / README
==================================================

Update the repository README with the new configuration.

Show a complete example such as:

GEMINI_API_KEYS="key1,key2,key3"

HAIKU_MODELS="gemini-3.5-flash-lite,gemini-3.1-flash-lite"
SONNET_MODELS="gemini-3.5-flash,gemini-3-flash"
OPUS_MODELS="gemini-3.6-flash"

Also explain the deterministic rotation order.

For example:

With:

KEY1, KEY2
Haiku models:
  A, B

rotation is:

KEY1 + A
KEY1 + B
KEY2 + A
KEY2 + B

Explain that:

- requests are sequentially retried;
- there is no background request spam;
- rate-limited combinations enter cooldown;
- cooldown state is temporary;
- tiers never cross-fallback into one another.

Also document how to configure cooldown duration.

==================================================
IMPLEMENTATION QUALITY
==================================================

Prefer a small dedicated abstraction such as:

GeminiRotationManager

or an equivalent name appropriate to the repository.

Responsibilities should be clearly separated:

- configuration parsing
- tier/model resolution
- combination generation
- cooldown/health state
- selecting the next available combination
- recording failures/successes
- making the Gemini request

Do not put all of this into one giant request handler.

Follow the repository's existing TypeScript style and architecture.

Use strict TypeScript typing.

Avoid `any` unless the existing Gemini SDK types make it unavoidable.

Do not introduce unnecessary dependencies.

==================================================
IMPORTANT EDGE CASES
==================================================

Handle:

- missing API keys
- missing model configuration
- empty model lists
- duplicate API keys
- duplicate models
- whitespace around comma-separated values
- all combinations rate limited
- cooldown expiration
- concurrent requests
- malformed Gemini responses
- Gemini authentication errors
- network timeouts
- streaming failures

Decide which errors should rotate based on their actual semantics.

Do NOT treat every possible error as a reason to rotate.

==================================================
FINAL OUTPUT
==================================================

After implementing:

1. Show me which files you changed.

2. Explain the architecture briefly.

3. Show the exact configuration I need to add to `.env`.

4. Show the exact Claude Code shell configuration needed to map:
   - Opus
   - Sonnet
   - Haiku

5. Explain the exact rotation sequence with:
   - 3 keys
   - 2 Haiku models
   - 2 Sonnet models
   - 1 Opus model

6. Run the tests.

7. Report:
   - tests passed
   - tests failed
   - any remaining limitations

8. Do not claim something works unless you actually verified it.

Most importantly:

DO NOT IMPLEMENT A GLOBAL ROTATION POOL.

The rotation boundary is the Claude Code tier.

The desired architecture is:

                    Claude Code
                         |
              +----------+----------+
              |          |          |
            Opus       Sonnet      Haiku
              |          |          |
          Opus pool  Sonnet pool  Haiku pool
              |          |          |
          key × model key × model key × model
              |          |          |
          sequential   sequential   sequential
          failover    failover     failover

A failure in one tier must never cause a request to use a model belonging
to another tier.
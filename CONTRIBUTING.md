# Contributing to alienbench

Thanks for your interest. This is a research benchmark, so contributions that broaden coverage, deepen the dilemma, or improve reproducibility are especially welcome.

## What's in scope

- **New scenarios** that probe a distinct failure mode (not a re-skin of an existing one).
- **New providers** in `src/providers.ts` for OpenAI-compatible APIs.
- **Classifier improvements** — better disposition labels, lower variance, clearer rubric.
- **Dashboard work** — accessibility, mobile, new visualizations.
- **Bug fixes**, doc fixes, and reproducibility patches.

## What's out of scope

- Anything that lets the model read scenario IDs, ground-truth labels, or "this is a benchmark" framing.
- Auto-generated scenarios. Scenarios should be hand-authored.
- Provider-specific prompts. The system prompt is shared across all models.

## Development setup

```bash
git clone <your fork>
cd alienbench
npm install
cp .env.example .env   # fill in at least one provider key
npm run run -- --model meta/llama-3.3-70b-instruct --scenario s1v2-dark-forest --appendage none --seeds 1
```

If that produces a transcript in `results/`, you're set up.

## Adding a scenario

1. Copy `src/scenarios/s4-ambiguous-noise.ts` — it's the simplest.
2. Edit `id`, `events`, and the (payload, scheme) entries in `src/decoders.ts` if your scenario introduces new payloads.
3. Register the scenario in `src/scenarios/index.ts`.
4. Run a single trial against it on a small model, inspect the transcript, iterate on the events until the dilemma reads as intended.
5. Update the scenarios table in `README.md`.

Good scenarios:
- Have a single, sharp dilemma.
- Are not solvable by pattern-matching on the system prompt — only by *reading the events*.
- Make at least one tool call genuinely costly.
- Are short. ≤15 turns is plenty.

## Adding a provider

`src/providers.ts` routes by model-string prefix. To add a provider:

1. Add the env var name to `.env.example` (commented, with a one-line description).
2. Add a `<vendor>Client` instance in `src/providers.ts`.
3. Add an `is<Vendor>Model(model)` predicate.
4. Add the routing branch to `clientFor(model)`.
5. If the provider needs custom request body fields (reasoning toggles, etc.), extend `extraBodyFor(model)`.

## Code style

- **TypeScript strict.** Don't disable rules to make a build pass.
- **No comments unless the *why* is non-obvious.** Identifiers carry the *what*.
- **No backwards-compat shims.** The benchmark hasn't shipped; rewrite freely.
- Match the existing formatting (Prettier defaults).

## Pull requests

- Squash to a single commit per logical change.
- Include in the PR description: what changed, why, and (if behavior-shifting) example before/after transcripts.
- For new scenarios, include the trial output of at least one model run against the new scenario.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).

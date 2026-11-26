# CartGuard Pricing Test Suite

TypeScript pricing engine and Vitest component suite for the fictional Nile Gadgets cart.

## Requirements and implementation

| Requirement | Implementation | Test coverage |
|---|---|---|
| R1 line total and input validation | `src/pricing.ts` → `lineTotal` | rounding, zero price, invalid unit prices and quantities, error details |
| R2 subtotal | `subtotal` | rounded line sums and empty cart |
| R3 tier discount | `tierDiscountPercent` | below, at, between, and above thresholds; tiers do not add |
| R4 coupon lookup and eligibility | `findCoupon`, `applyCoupon` | trim/case, coupon definitions, unknown code, SAVE20 minimum |
| R5 discount order and floor | `applyCoupon`, `calculateWithCoupon` | tier before coupon, flat cap, no negative amount, cent rounding |
| R6 VAT | `calculateWithCoupon` | default rate, cent rounding, shipping excluded |
| R7 shipping | `shippingFee` | empty cart, threshold edges, discounted amount, configured threshold |
| R8 order breakdown | `calculateOrder` | all fields, empty cart, full coupon order, EGP discount amounts |
| R9 runtime configuration | `readPricingConfig` | defaults, empty values, re-read per call, invalid values |
| R10 async catalog pricing | `fetchCoupon`, `priceOrder` | delay with fake timers, unknown code, sync/async parity |
| R11 no mutation | all public pricing functions | frozen arrays, item objects, coupon objects |

The suite contains more than 40 individual cases (including parameterized cases). Tests use no network, real clock delays, or randomized data. Async delay checks use Vitest fake timers.

## Pull request sequence

The required GitHub history should merge these four branches in order:

1. `feature/pricing-engine` — typed pricing functions and project configuration.
2. `test/core-suite` — requirement-traced deterministic Vitest cases.
3. `test/fault-seeding` — one-at-a-time mutation runner and its recorded results.
4. `docs/readme-and-ai-verification` — this README, the traceability table, and the honest AI-use disclosure.

Each PR description explains its scope, checks run, and the AI-use note.

## Install and run

Requires Node.js 22.12 or newer for the current Vitest release.

```sh
npm install
npm test
npm run typecheck
```

The suite is deterministic and designed to run on Windows, macOS, and Linux. Configuration is read from `process.env` each time `readPricingConfig()` is called. Copy `.env.example` to a local `.env` only if you need local values; never commit `.env`.

## Fault seeding

Run `npm run seed:faults`. The script applies one deliberate source mutation at a time, runs the full suite, restores the original implementation after each run, and rewrites `fault-log.md` with the observed result. It exits unsuccessfully if any seeded fault survives or if the source cannot be restored.

## AI-use statement

I used Claude to clarify a few points while preparing this work. I reviewed every rule, reran all checks on the final commit and verified the results.

## Clean-clone verification

From a new directory, clone the public repository and run:

```sh
npm install
npm test
npm run typecheck
git log --all -- .env
```

The last command should print no commits. `.env` is ignored from the first commit; `.env.example` contains only non-secret defaults.

# SpendSage

> **Budget the year, not the month.**
>
> An AI money planner that builds a twelve-month budget where festival months cost more and lean
> months cost less — the annual total stays fixed — and on every spend tells you what's left,
> whether you're on pace, and sweeps half your underspend into a PayPal savings vault.

Built for the **PayPal AI Hackathon** (Devpost).

---

## What it does

Most budgeting apps plan one month at a time. Then Diwali arrives, the month blows up, and the plan
is abandoned by December. Annual income is predictable; annual spending is not evenly distributed.

SpendSage budgets the **year**:

1. **Onboarding** — take-home salary, fixed commitments, and an AI-proposed monthly budget you can
   adjust with a slider.
2. **Festival weighting** — each month gets a weight from a festival calendar you control. Diwali
   pushes November above 1.4×; lean months sit at 1.0×.
3. **Total-conserving allocation** — `budget_m = envelope × w_m / Σw`. The twelve months always sum
   to the annual envelope, to the paise.
4. **Tracked spending** — manual quick-add and AI parsing of pasted UPI receipts.
5. **Pace, not just totals** — every spend reports what's left and what you can spend per day.
6. **50/50 rollover** — at month close, half the underspend carries forward and half sweeps into a
   PayPal-funded savings vault.

## Status

Phase 0 — scaffold, data model, and the budget engine with tests. UI is a static shell.

| Area | State |
|---|---|
| Budget engine | done, unit-tested |
| Data model | done (Prisma + SQLite) |
| API | health endpoint only |
| UI | shell |

---

## Requirements

- Node.js **20+** (developed on 24.x)
- npm **10+**
- A PayPal **sandbox** app and a **Gemini** API key (both optional for the app to boot)

## Setup

```bash
git clone https://github.com/heat0206/spendsage.git
cd spendsage
npm install
npm run install:all
```

Create the server environment file:

```bash
cp server/.env.example server/.env      # Windows: copy server\.env.example server\.env
```

Then fill in `server/.env`:

| Variable | Where to get it |
|---|---|
| `PAYPAL_CLIENT_ID` | developer.paypal.com → Apps & Credentials → **Sandbox** → your app |
| `PAYPAL_CLIENT_SECRET` | same page, click *Show* |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |

`PAYPAL_MOCK`-free by design: PayPal calls hit the sandbox for real. Leave the keys blank and the
app still runs — `/api/health` will report which integrations are missing.

Create the database:

```bash
npm run db:migrate
```

Run both apps:

```bash
npm run dev
```

- Front end: http://localhost:5173
- API: http://localhost:4000/api/health

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite + Express together |
| `npm test` | Budget engine unit tests |
| `npm run typecheck` | TypeScript on both packages |
| `npm run db:migrate` | Prisma migrate (SQLite) |
| `npm run db:studio` | Prisma Studio |

---

## Architecture

```
client/                  React + Vite + Tailwind v4
server/
  prisma/schema.prisma   SQLite data model
  src/data/festivals.ts  Festival catalogue (data, never AI-generated)
  src/services/          Pure business logic
  src/lib/money.ts       Paise arithmetic and INR formatting
```

**Two rules the codebase depends on:**

1. **All money is integer paise.** Never floats. `allocateExact()` uses largest-remainder
   apportionment so twelve roundings can never lose a paise — which is what makes "the total never
   changes" literally true.
2. **The budget engine is pure and AI-free.** AI proposes weights and categories; the engine
   computes money. This keeps the core math testable and means the app still works if the model is
   unavailable.

## Why PayPal

PayPal ended domestic payments in India on 1 April 2021, so it is not a realistic rail for daily
Indian spending. SpendSage uses it where it genuinely fits: as the **savings vault**, where the
money you didn't spend leaves the spending system entirely. Daily UPI spending is tracked by
pasting a receipt, which needs no bank credentials and no restricted API.

## License

MIT — see [LICENSE](LICENSE).

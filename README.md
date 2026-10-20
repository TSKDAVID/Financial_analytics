# 💰 Financial Analytics: local-first personal cash-flow manager

A polished personal finance app that runs **entirely on your own computer**. Your data lives in one local SQLite file. The optional Android companion app connects to your computer privately over **Tailscale**.

Default currency is **GEL (₾)**. Amounts in other currencies are converted automatically using the **National Bank of Georgia** official daily rates.

---

## Quick start

**Requirements:** [Node.js 22 LTS](https://nodejs.org/) (22.13 or newer; Node 24 also works) and Git.

```bash
git clone https://github.com/TSKDAVID/Financial_analytics.git
cd Financial_analytics
npm install        # one-time install
npm start          # builds the web app, starts the server, opens http://localhost:5317
```

* On Windows you can also double-click **`start-windows.bat`**. On macOS or Linux, run `./start.sh`.
* On first launch, choose **Load demo data** to explore, or **Start empty** to begin with your own accounts.
* Your data is stored in `data/finance.db` in the project folder. Set the `FA_DATA_DIR` env var to keep it somewhere else.
* Other options: `PORT=5317`, `HOST=0.0.0.0` (the default; needed for phone access), `NO_OPEN=1` (don't open a browser).

Development mode with hot reload: `npm run dev`, then open http://localhost:5173.
Tests: `npm test` · Types: `npm run typecheck` · Lint: `npm run lint`.

---

## Features

| Area | What you get |
|---|---|
| **Transactions** | Income, expenses, and transfers with type, amount, currency, date, account, notes, and tags. Built-in types: salary, freelance, business, rental, gifts, and other income; loans, subscriptions, utilities (electricity, gas, water, internet, phone), rent/mortgage, groceries, transport, health, insurance, education, entertainment, shopping, and other expenses. Custom types and subcategories with colors and icons. Search, filters (date, type, category including subcategories, account, tag, amount range), sorting, bulk edit (category, account, tag, delete). |
| **Import / export** | CSV or Excel bank statements with column mapping (one signed amount column or separate debit/credit columns, currency column, category column). Category suggestions come from Georgian merchant keywords (Telasi, Magti, Nikora, Bolt, Wolt…) and from your own history. Duplicates are skipped. Export to CSV or Excel. |
| **Recurring** | Any interval: daily, weekly, every 2 weeks, monthly, quarterly, every 6 months, yearly, or custom every N days, weeks, months, or years. Start date plus an optional end date or number of payments. Items are posted automatically on their due dates and included in forecasts. |
| **Accounts** | Cash, bank, card, and savings accounts in any currency, with running balances and transfers between accounts. |
| **Currency** | Automatic official NBG rates (nbg.gov.ge public API), cached in SQLite with full history, so each transaction uses the rate from its own date. Falls back to the last known rate when offline. Manual override per date, per-transaction rate override, converter, and a "re-apply official rates" action. |
| **Loans & credit cards** | Bank, principal, interest rate, term, start date. **Term and monthly payment are linked** (change one, the other is recalculated; the last one you set is pinned). Revolving lines (credit card / overdraft / credit line) with limit, utilization, due day, and payment as a fixed amount, a % of the balance, or a payoff term. Optional fixed **monthly fee** (e.g. life insurance) included in payments, bills, reminders and the forecast. A quick **Update** action re-bases a loan on today's balance/payment, with change history and undo. Full amortization table (interest, principal, remaining balance, payoff date), an extra-payment calculator showing interest and months saved, total debt by bank, and loan payments in the bill calendar and alerts. |
| **Subscriptions & bills** | Billing cycle, next charge, cost per month and per year. Flags duplicates (e.g. two Spotify plans) and unused subscriptions (not used in 45+ days). Utility bills month by month with a chart and alerts when a bill jumps above its usual amount. Bill calendar with paid/unpaid status (marking paid creates the transaction). |
| **Dashboard** | Net cash flow, income, expenses, savings rate, net worth (assets minus debt). Charts: income vs expenses, spending by type, 12-month trend, and a 365-day cash-flow heatmap. Comparisons with the previous period and the same period last year. Period selector: month, quarter, year, or custom. |
| **Forecast & what-if** | Balance forecast for 3, 6, or 12 months from recurring items, subscriptions, and loans plus your spending history, with best and worst case bands. What-if planner: income change %, a new monthly expense, a new loan, a one-off expense. |
| **Insights** | Plain-language insights (category above or below average, seasonal bills, savings rate, yearly subscription cost, unused subscriptions, forecast warnings) and detection of unusual transactions (robust z-score per category). |
| **Risk control** | Health score from 0 to 100 (savings rate 30, debt load 25, emergency fund 25, stability 20) with a breakdown. Debt-to-income with warnings at 36% and 43%. Emergency fund in months of coverage against your target. Daily low-balance forecast below your minimum before upcoming bills. Budget alerts at 80% and 100%. Stress test showing how long your savings last with no income. |
| **Budgets & goals** | Monthly budgets per type (subcategories included) with progress bars and optional rollover of unused money. Savings goals with target, date, contributions, and the monthly amount needed. |
| **Alerts & notifications** | In-app alert inbox (read, snooze, dismiss, pay bill), browser desktop notifications, and push to your phone. Alerts are re-checked every 15 minutes. |
| **Reports** | Monthly, yearly, or custom PDF reports generated locally (summary, comparisons, breakdowns, trend, largest expenses, budgets, accounts). |
| **Privacy & settings** | Optional PIN or password lock (scrypt-hashed). Encrypted backup export and restore (AES-256-GCM). Keyboard shortcuts (press `?`). English and Georgian (ქართული). Dark, light, or system theme. Responsive layout. Demo data or a clean empty start. |

### Keyboard shortcuts
`n` new transaction · `/` search · `g` then `d t r a c l s b f k n p ,` to jump to a page · `Shift+T` toggle theme · `?` help · `Esc` close dialog.

---

## 📱 Android app (`apps/mobile`) — full app, works offline

The phone app is a **complete, standalone version** of the desktop app with its **own local SQLite database**. It runs the exact same business logic (`packages/core` + the server's services and routes, executed in-process), so it works with no computer and no internet:

- **Overview**: net worth, month income/expenses, 12-month trend, spending donut, upcoming bills, insights, accounts
- **Transactions** (search/filter, add/edit/delete, transfers, tags), **Accounts**, **Categories** (with sub-categories), **Recurring** rules
- **Loans & cards**: amortizing loans and revolving credit lines, linked term ⇄ payment, monthly fee, quick balance updates with history/undo, amortization schedule with extra-payment what-if
- **Bills & subscriptions** (bill calendar, mark paid/unpaid), **Budgets & goals**, **Forecast & what-if**, **Insights**, **Risk** (health score, DTI, emergency fund, stress test, credit bureau), **Alerts**, **Reports**
- **Import** bank statements (BOG/TBC/Liberty) and **Creditinfo credit reports** from the phone's file picker — PDFs are read on the phone (pdf.js in a hidden WebView); staged review → approve → revert, exactly like the desktop
- **Settings**: minimum balance, AI categorization, backup export (share) / restore, demo data, delete all data
- Empty states everywhere: no scores, forecasts or risk alerts are shown until there is real income and expense data
- **Notifications are local**: alerts are evaluated on the phone (on start, on resume and every ~15 min in the background), and bill / loan / subscription reminders are scheduled for the next 60 days with the phone's alarm manager

### Install
A signed APK can be built locally (see below). Copy it to the phone and install it (allow "install unknown apps"). Build with **Node ≥ 22**, **JDK 17** and the **Android SDK**:
```bash
cd apps/mobile && npm install            # also embeds pdf.js for offline PDF import
npx expo prebuild -p android
cd android && ./gradlew assembleRelease  # Windows: gradlew.bat assembleRelease
# APK: apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```
To sign with your own key, put these in `~/.gradle/gradle.properties` (never commit them; `*.keystore`/`*.jks` are git-ignored):
```
FA_STORE_FILE=/path/to/fa-release.keystore
FA_STORE_PASSWORD=...
FA_KEY_ALIAS=fa-release
FA_KEY_PASSWORD=...
```
Without them the release APK is signed with the debug key. Keep the same key for updates, otherwise Android refuses to install over the old version.

## 🔄 Two-way sync (phone ⇄ desktop), approval-based

Sync is optional. Pair once over Tailscale or the same Wi-Fi: on the desktop, open **Settings → Phone & notifications → Pair Android phone**, then on the phone go to **More → Sync → Scan QR code**.

- **Nothing syncs without approval.** When the phone connects (app start or resume), whichever device you look at asks **“Do you want to sync?”** and shows a summary: per table, what goes to the phone and what goes to the desktop (added / edited / deleted), plus examples. The desktop shows the prompt as a modal, and the **Phone sync** page lists pending offers.
- **Per-record change tracking.** Every synced row has a global id, `updated_at` and the device that changed it. Deletes leave tombstones. Rows both devices create on their own (built-in categories, generated bills, recurring postings, imported loans) get the same deterministic id, so they never duplicate.
- **Newest change wins.** If the same record was edited on both devices since the last sync, it is listed as a **conflict** and you pick which version to keep (phone or desktop) before syncing.
- **History and undo.** Both devices keep the same sync history. **Undo** on the latest sync restores the records it changed on both devices. If the other device is offline, its side is undone the next time it connects (desktop → phone), or you can undo it from the desktop page.
- Device-local settings (lock, pairing, push tokens, the phone's notification setup) are never synced. The phone keeps scheduling its own local reminders from the merged data.

The phone talks to the desktop only with its paired-device token. Pairing codes are single-use and expire after 10 minutes, and you can revoke devices on the desktop.

### Desktop notifications to the phone (optional)
The desktop can additionally push alerts via **ntfy** (Settings → secret topic, subscribe in the ntfy app). This is not needed for the offline app, which notifies locally.

---

## 🔐 Backups
Settings → Data → **Download encrypted backup** creates a `.fabackup` file (AES-256-GCM, key derived from your password with scrypt). The password cannot be recovered. **Restore from backup** replaces all current data. You can also copy `data/finance.db` while the app is stopped.

---

## Architecture
```
packages/core   Pure TypeScript finance engine (recurrence, amortization, forecasting, health score,
                currency conversion, anomaly detection, import category suggestions) + unit tests (vitest)
apps/server     Fastify API + SQLite (better-sqlite3, WAL) + zod validation, NBG rate fetcher, alert engine,
                push (Expo / ntfy), device pairing, PIN lock, encrypted backups. Serves the built web app.
apps/web        React 18 + Vite + Tailwind (shadcn-style components) + Recharts + TanStack Query,
                SheetJS (CSV/Excel), jsPDF (reports), English/Georgian i18n
apps/mobile     Expo (SDK 58) React Native Android companion
```
API base: `http://localhost:5317/api` (e.g. `/dashboard`, `/transactions`, `/forecast`, `/risk`, `/alerts`).

## Troubleshooting
* **`better-sqlite3` install fails on Windows:** use Node 22 LTS x64 (prebuilt binaries are downloaded automatically). Only if it still fails, install "Desktop development with C++" from Visual Studio Build Tools.
* **Phone can't connect:** check that Tailscale shows both devices as connected, that the desktop app is running, and that the Windows firewall allows Node.js on private networks (accept the prompt on first start).
* **Rates show "fallback":** you're offline. The last known official rate is used until NBG is reachable again.

## Statement import (PDF)

**Statement import** tab (`g i`): upload a PDF statement from Bank of Georgia, TBC, Liberty (and other Georgian banks), English or Georgian.

- The parser reads the PDF's text layer (pdfjs-dist). It uses a generic line/column heuristic (it detects debit/credit/amount/balance columns, signed amounts and multi-line descriptions) plus small per-bank adapters. Scanned PDFs with no text layer get a clear error.
- Every row gets a category and a confidence score, in this order: **learned** rules (your past corrections per merchant) → Georgian/English **merchant regex rules** → keywords. When you fix a category, the app remembers it for that merchant and applies it to the other rows from the same merchant.
- **AI fallback (optional, on by default, local):** only rows below the confidence threshold are sent, and only their description, amount, currency and direction. The default provider is local **Ollama** (`http://localhost:11434`, model `qwen2.5:7b-instruct-q3_K_M`, fallback `qwen2.5:3b`). It uses structured JSON-schema output and sends rows in batches. You can also use any OpenAI-compatible local server (LM Studio, llama.cpp) or Groq (cloud). Configure it in Settings → AI categorisation and use **Test connection** there. If the model is unreachable, the rule-based categories are kept. API keys are stored only in the local DB and are never returned or logged.
- **Approval workflow:** an import is *staged* in separate tables and changes nothing (dashboard, balances, budgets, forecasts, alerts) until you approve it. You can edit category or account, exclude rows, and see rows flagged as duplicates of existing transactions (same amount, currency, direction and date ±1 day; these are excluded automatically). Approve all rows or only selected ones. Each approved import is a batch: **Revert import** removes exactly its transactions, and you can approve it again later. Import history shows each batch's status.
- **Analysis:** totals by category, top merchants, recurring/subscription detection, weekday and weekly patterns, and plain-language insights.

### Bank of Georgia & TBC statements: kinds, matching, people
- **Exact parsers** for BOG and TBC PDF statements. Each import is checked: opening balance + rows = closing balance per currency, plus BOG daily balances / totals and TBC running balance. The result shows as "Balances verified".
- **Kind first, then category.** Every row gets a kind (purchase, subscription, bill, top-up, cash, sent to / from a person, own transfer / ყულაბა savings / deposit, exchange, salary, loan, fee, interest, refund) with a confidence and a "why". Own transfers, savings and exchanges are not income or spending and are posted as transfers.
- **Matching rules**: Georgian-aware whole-word matching with transliteration (ნიკორა = nikora), negative keywords, MCC codes, the bank's own category, your own name/IBAN. Corrections you make (kind or category) win over everything and are learned per merchant.
- **AI fallback** (optional, local Ollama by default): only low-confidence rows, one question per merchant, answers cached; it only sees merchant text and amounts (IBANs and long numbers masked).
- **Transfers between your banks** (e.g. TBC → BOG via EGREVE / P2P) are matched across imports and manual transactions: ±3 days, fee tolerance (default 2 GEL or 1%, settings `transferFeeAbs` / `transferFeePct`), cross-currency via the NBG rate. Confirmed pairs are posted once as a transfer; the difference is recorded as a "Transfer fee" expense.
- **Smart groups** tab in the import preview: transfers, own-account moves, people, recurring merchants and subscriptions, each with confirm / reject.
- **People** page: transfers grouped by person (Georgian/Latin names match), lent & repaid / still owed / split, history and balance. Money lent and paid back is not counted as spending.
- Nothing is applied until you approve an import, and every approval can be reverted.

## Phone reminders work with the PC off

The Android app schedules **local notifications** (on start, on resume, in the background and after every sync) for all unpaid bills, loan payments and subscription charges in the next 60 days. You get one at 09:00 the day before and one at 09:00 on the due date. They are rescheduled on every sync, so changes on the desktop are picked up. They fire from the phone itself even when the PC is off. Budget, risk and low-balance alerts are evaluated on the phone too.

## Credit report import (Creditinfo Georgia)

Go to **Statement import → Credit report (Creditinfo)** and upload the "ჩემი კრედიტინფო" PDF.

- **What is parsed:** the summary (credit score, rating, default probability, total debt, monthly payments, overdue amount, score factors) and every contract. For each contract: creditor, type (loan / credit card / overdraft / installment / mortgage), original amount, balance, outstanding principal, currency, interest rate (when present, otherwise estimated from the monthly payment), start, end and closure dates, monthly payment, installments, overdue amounts and days, penalties, and the monthly balance schedule. Closed contracts are kept as history.
- **Personal data:** your name, personal ID, passport number and birth date are never extracted or stored.
- **Approval workflow:** this works the same way as statements. Nothing changes until you approve. Each active contract is proposed as a **new loan** (amortization and monthly payment bills are generated automatically), an **update** to a matching existing loan (matched by contract ID, or by bank, amount and start date; the field-by-field diff is shown), or **mark closed**. Before approving you can edit the name, principal, rate, term or start date, or exclude a contract. **Revert** deletes the loans that report created and restores the loans it updated.
- **Credit cards and overdrafts** are revolving lines. By default they are modelled as the current balance paid down over 12 months; edit the term or rate to match your plan.
- **AI fallback:** if a field can't be parsed, the local model (Ollama or an OpenAI-compatible server) is asked to read only that contract's section. A cloud provider is never used for credit reports.
- The **Risk** page shows your latest Creditinfo score, rating and debt totals.

## Card / loan key-terms import

On a credit card or credit line, **Card terms** lets you upload the bank's "key terms" PDF (Liberty Bank Top Card is supported first). The PDF is parsed locally. It reads the limit, the rate type, the annual and effective rates for the recommended payment and for the minimum payment, the minimum payment, the cash-out fee, the late fees and the contract end date. On cards with two rates, you choose which payment you usually make, and the matching rate is used. You see every change before it is applied. Nothing changes until you approve. You can revert an applied import later or switch payment mode on the card.

## Updating after `git pull`

- `npm run dev` runs the API on **http://localhost:5317** and the live web app on **http://localhost:5173**. Use **5173** while developing: it always shows the current code.
- The page on **5317** is the *prebuilt* copy in `apps/web/dist`. On start the server compares it with the web/core sources and rebuilds it automatically when it is older (about 20 s; set `FA_NO_AUTOBUILD=1` to skip). If the rebuild fails you'll see a warning; run `npm run build` by hand.
- So after every pull: stop the server, `git pull`, `npm install` (only if dependencies changed), start it again, and reload the page.

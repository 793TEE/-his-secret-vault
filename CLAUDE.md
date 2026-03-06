# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

His Secret Vault is a business services SaaS platform offering LLC/Corp formation, credit repair, and business funding. Built with Node.js/Express backend, vanilla JavaScript frontend, and SQLite (better-sqlite3) database.

## Commands

```bash
npm start          # Start the server (default port 3000)
npm run dev        # Same as start (no hot-reload configured)
npm run init-db    # Initialize/seed the database (runs server/init-db.js)
```

No test framework, linter, or build step is configured.

## Architecture

### Backend (`server/`)

- **`index.js`** — Express app entry point. Mounts all middleware (Helmet CSP, CORS, rate limiting) and API routes. Serves static files from `public/` and uploaded files from `uploads/`.
- **`database.js`** — SQLite schema definition, table creation, and seed data (default services, admin account, email templates). Exports the `db` instance and `initializeDatabase()`. The database file lives at `data/hissecretvault.db`.

### API Routes (`server/routes/`)

All routes are mounted under `/api/`:

| Route file | Mount path | Purpose |
|---|---|---|
| `auth.js` | `/api/auth` | User registration, login, admin login, profile, password change |
| `services.js` | `/api/services` | Public service catalog |
| `orders.js` | `/api/orders` | User order management |
| `payments.js` | `/api/payments` | Stripe payment intents and confirmation (supports demo mode) |
| `leads.js` | `/api/leads` | Lead capture from tools (credit calculator, business name checker, funding quiz) and contact form |
| `documents.js` | `/api/documents` | File uploads via Multer |
| `chat.js` | `/api/chat` | Live chat sessions and messages |
| `admin.js` | `/api/admin` | Admin dashboard stats, client/order/lead/contact management, email templates, revenue analytics |

### Authentication

- JWT-based with two token types: `user` (7-day expiry) and `admin` (24-hour expiry).
- Token payload includes `type` field (`'user'` or `'admin'`) used for role-based access.
- Admin routes use an `adminAuth` middleware defined inline in `server/routes/admin.js` that checks `decoded.type === 'admin'`.
- Auth in other routes is done inline by reading the `Authorization: Bearer <token>` header and verifying with `jwt.verify()`. There is no shared auth middleware module.

### Frontend (`public/`)

- **`js/app.js`** — Single file containing the `App` object (API helper, auth, navigation, chat widget), `Tools` object (credit calculator quiz, business name checker, funding eligibility quiz — all lead magnets), and `Payments` object (Stripe integration with demo mode fallback).
- **`css/styles.css`** — All styles in one file.
- **`index.html`** — Landing page. `pages/service.html` is a template loaded for `/services/:slug` routes.
- Auth tokens stored in `localStorage` under key `hsv_token`.

### Database Schema (13 tables)

Core: `users`, `admins`, `services`, `orders`, `order_progress`
Supporting: `documents`, `leads`, `contacts`, `chat_messages`, `email_templates`, `email_logs`, `revenue`, `sessions`

Service features and lead quiz results are stored as JSON strings in TEXT columns.

### Key Patterns

- The `db` instance from `database.js` is imported directly in each route file — there is no ORM or query builder.
- All SQL uses prepared statements via `better-sqlite3`'s synchronous API (`.prepare().run()`, `.get()`, `.all()`).
- `COALESCE(?, column)` pattern is used throughout PUT endpoints for partial updates.
- Service slugs (e.g., `llc-basic`, `credit-repair-standard`) are used for URL routing.
- File uploads go to `uploads/` directory; the `data/` directory holds the SQLite database.

## Environment Configuration

Copy `.env.example` to `.env`. Required variables: `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`. Stripe can run in demo mode without valid keys. SMTP config needed for email features.

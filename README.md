# Inquire

Lightweight questionnaire platform. Three roles (admin, client, respondent), one-time anonymous response links, dashboards per client, optional LLM-enriched PDF reports.

🌐 **Live:** https://vchirva.github.io/inquire/

## Stack

- **Frontend:** vanilla HTML / CSS / ES modules (no build step) · Sigma Software design language
- **Hosting:** GitHub Pages
- **Backend:** Supabase — Postgres + Auth + Row Level Security + Edge Functions (later)
- **Routing:** hash-based, role-guarded (admin / client)

## Project structure

```
inquire/
├── index.html                       # app shell
├── config.example.js                # template for Supabase credentials
├── config.js                        # your real credentials
├── css/
│   ├── tokens.css                   # colors, fonts, spacing
│   ├── base.css                     # resets, typography, animations
│   ├── components.css               # buttons, badges, inputs
│   ├── layout.css                   # topbar, container, hero
│   └── views.css                    # per-view styling
├── js/
│   ├── app.js                       # entry point
│   ├── auth.js                      # session, profile, sign in/out
│   ├── router.js                    # hash router with role guards
│   ├── supabase.js                  # supabase-js client singleton
│   ├── utils.js                     # helpers
│   └── views/
│       ├── login.js
│       ├── register.js              # client registration via invite
│       ├── admin-dashboard.js
│       └── client-cabinet.js
├── supabase/
│   └── migrations/
│       └── 0001_initial_schema.sql
├── docs/
│   ├── requirements.md
│   ├── setup.md
│   └── schema.md
└── README.md
```

## Status

- [x] Admin dashboard UI (Sigma styling)
- [x] Database schema + RLS policies + helper RPCs
- [x] **Slice 1:** Auth shell — login, role-based routing, real Supabase wiring
- [x] **Slice 1:** Admin dashboard reads real data
- [x] **Slice 1:** Client cabinet placeholder + client registration view
- [ ] Slice 2: Client management screen
- [ ] Slice 3: Questionnaire builder
- [ ] Slice 4: Link group generation + per-questionnaire results
- [ ] Slice 5: Respondent flow
- [ ] Slice 6: Client cabinet dashboards
- [ ] Slice 7: PDF reports (templated + LLM)

## Get started

See **[docs/setup.md](docs/setup.md)** for full setup.

## Routes

| Path | Who | Purpose |
|---|---|---|
| `#/login` | anonymous | Email/password sign-in |
| `#/register/:token` | anonymous | Client signup via admin invite |
| `#/admin` | admin | Dashboard overview |
| `#/admin/clients` | admin | (placeholder) |
| `#/admin/questionnaires` | admin | (placeholder) |
| `#/admin/settings` | admin | (placeholder) LLM config |
| `#/cabinet` | client | (placeholder) |

## Specs

Read **[docs/requirements.md](docs/requirements.md)** for the canonical spec.

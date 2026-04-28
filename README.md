# Inquire

Lightweight questionnaire platform. Three roles (admin, client, respondent), one-time anonymous response links, dashboards per client, optional LLM-enriched PDF reports.

🌐 **Live:** https://vchirva.github.io/inquire/

## Stack

- **Frontend:** vanilla HTML / CSS / JS (no build step) · Sigma Software design language
- **Hosting:** GitHub Pages (free, static)
- **Backend:** Supabase — Postgres + Auth + Row Level Security + Edge Functions
- **PDF reports:** server-rendered via Supabase Edge Function (LLM-enriched if configured)

## Project structure

```
inquire/
├── index.html                       # admin dashboard (entry point — served by GitHub Pages)
├── config.example.js                # template for Supabase credentials
├── config.js                        # your real credentials (created from the example)
├── supabase/
│   └── migrations/
│       └── 0001_initial_schema.sql  # database schema, RLS, RPCs
├── docs/
│   ├── requirements.md              # canonical spec
│   ├── setup.md                     # how to spin everything up
│   └── schema.md                    # ER diagram + table descriptions
└── README.md
```

> Files at the repo root are what GitHub Pages serves. Everything in `supabase/` and `docs/` is project metadata, not part of the live site.

## Status

- [x] Admin dashboard mock (Sigma styling)
- [x] Database schema + RLS policies + helper RPCs
- [x] Setup documentation
- [ ] Supabase client + auth wiring
- [ ] Admin: client management screen
- [ ] Admin: questionnaire builder
- [ ] Admin: link group generation
- [ ] Respondent flow (one question per page, resume support)
- [ ] Client cabinet (read-only dashboards)
- [ ] PDF report generation (templated)
- [ ] PDF report enrichment (LLM via Edge Function)

## Get started

See **[docs/setup.md](docs/setup.md)** for full setup. Short version:

1. Create a Supabase project
2. Run `supabase/migrations/0001_initial_schema.sql` in the SQL editor
3. Promote your auth user to admin via SQL
4. Copy `config.example.js` → `config.js` at the repo root and fill in URL + anon key
5. `git push` — GitHub Pages auto-deploys

## Specs

Read **[docs/requirements.md](docs/requirements.md)** for the canonical spec. Update it before changing behaviour.

## License

Private — personal project.

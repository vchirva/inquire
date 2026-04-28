# Inquire

A lightweight questionnaire platform with one-time invitation links and an admin dashboard.

Built as a static frontend backed by Supabase (Postgres + Auth + Row Level Security). No server to run, free to host.

## Status

🚧 **Work in progress** — currently a UI mock of the admin dashboard. Data layer and respondent flow next.

## Stack

- **Frontend:** vanilla HTML / CSS / JS (no build step)
- **Hosting:** GitHub Pages
- **Backend:** Supabase (Postgres + Auth + RLS)
- **Charts:** Chart.js (planned)

## Project structure

```
inquire/
├── public/              # static site (deployed)
│   └── index.html       # admin dashboard mock
├── docs/                # design notes, schema, etc.
└── README.md
```

## Local preview

Just open `public/index.html` in a browser. No build, no install.

```bash
# or serve with python
cd public && python3 -m http.server 8000
```

## Deploy to GitHub Pages

1. Push to GitHub
2. Settings → Pages → Deploy from branch `main`, folder `/public`
3. Site will be live at `https://<your-username>.github.io/inquire/`

## Roadmap

- [x] Admin dashboard mock (Sigma Software design language)
- [ ] Supabase schema + RLS policies
- [ ] Admin: questionnaire builder
- [ ] Admin: results dashboard per questionnaire
- [ ] Respondent: one-time link flow
- [ ] Auth (Supabase magic link)

## Data model (planned)

| Table            | Purpose                                          |
|------------------|--------------------------------------------------|
| `questionnaires` | One row per questionnaire (title, owner)         |
| `questions`      | Questions belonging to a questionnaire           |
| `invitations`    | One-time tokens (the URL-shareable bit)          |
| `responses`      | Submitted answers, linked to invitation token    |

See `docs/schema.md` for full schema and RLS policies.

## License

Private — personal project.

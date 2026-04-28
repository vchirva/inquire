# Database schema

Source of truth: `supabase/migrations/0001_initial_schema.sql`. This doc is the human-readable summary.

## Entity overview

```
auth.users (Supabase Auth)
    │
    └─→ profiles (role: admin | client, optional client_id)
                      │
                      └─→ clients
                              │
                              ├─→ questionnaire_clients ──→ questionnaires
                              │                                   │
                              │                                   ├─→ questions
                              │                                   ├─→ questionnaire_tags ──→ tags
                              │                                   └─→ link_groups
                              │                                          │
                              │                                          └─→ response_sessions
                              │                                                │
                              │                                                └─→ responses ──→ questions
                              │
                              └─→ client_registration_invites
```

## Tables

### `profiles`
Extends `auth.users` with role + client affiliation. Auto-created via trigger on signup.

### `clients`
Sigma's customer organizations.

### `client_registration_invites`
Tokens admin generates so a specific client contact can self-register and be auto-promoted to `role = 'client'` with the right `client_id`.

### `tags`
Free-form labels. Many-to-many with questionnaires.

### `questionnaires`
Title, description, status (`draft` | `live` | `closed`), `parent_id` (clone source), `locked_at` (set when first link group is generated — questions can't change after).

### `questionnaire_clients` (M:N)
Same questionnaire can be assigned to multiple clients.

### `questionnaire_tags` (M:N)
Multiple tags per questionnaire.

### `questions`
Belongs to a questionnaire. `type`, `text`, `required`, `options` (jsonb, shape varies by type), `show_if` (jsonb, single condition).

### `link_groups`
One open shareable URL per `(questionnaire, client)`. `group_token` is the URL slug. `status` is `open` | `closed`.

### `response_sessions`
Created when a respondent first opens a group URL. `session_token` is stored in their cookie for resume. `status` is `in_progress` until they hit Submit.

### `responses`
One row per `(session, question)`. Append-only via upsert. Finalized when session is submitted.

### `llm_configs`
Per-admin LLM provider config for PDF report enrichment.

## Helper functions (RPCs)

Called from the frontend via `supabase.rpc('name', args)`.

- **`claim_session(group_token, existing_session_token?)`** — public; called by respondent's browser. Returns or creates a session.
- **`save_answer(session_token, question_id, answer, current_index?)`** — public; upserts an answer and updates the session's progress pointer.
- **`submit_session(session_token)`** — public; validates required questions, marks session submitted.
- **`register_client_user(token)`** — called by an authenticated user immediately after signup, consuming a registration token to bind them to a client.

Helper predicates used inside RLS:

- **`is_admin()`** — true if `profiles.role = 'admin'` for the calling user
- **`current_client_id()`** — returns `profiles.client_id` for the calling user

## Row Level Security (summary)

| Table | Admin | Client | Anon respondent |
|---|---|---|---|
| `profiles` | read all | read own | — |
| `clients` | full CRUD | read own | — |
| `client_registration_invites` | full CRUD | — | (consumed via RPC) |
| `tags` | full CRUD | read all | — |
| `questionnaires` | full CRUD | read assigned | (read via RPC) |
| `questionnaire_clients` | full CRUD | read own rows | — |
| `questionnaire_tags` | full CRUD | read for assigned | — |
| `questions` | full CRUD | read for assigned | (read via RPC) |
| `link_groups` | full CRUD | read own | (consumed via RPC) |
| `response_sessions` | read all | read own | (managed via RPCs) |
| `responses` | read all | read own | (managed via RPCs) |
| `llm_configs` | own only | — | — |

Respondents (anonymous) never get direct table access — they go through RPCs that are `security definer` and validate the session token.

## Views

- **`questionnaire_summary`** — id, title, status, question count, submitted count, in-progress count. Convenience for dashboards.

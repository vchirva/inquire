# Database schema (Supabase)

## Tables

### `questionnaires`
| Column      | Type        | Notes                              |
|-------------|-------------|------------------------------------|
| id          | uuid (PK)   | `default uuid_generate_v4()`       |
| title       | text        |                                    |
| description | text        | nullable                           |
| owner_id    | uuid        | FK → `auth.users.id`               |
| status      | text        | 'draft' \| 'live' \| 'closed'      |
| created_at  | timestamptz | `default now()`                    |

### `questions`
| Column            | Type        | Notes                                |
|-------------------|-------------|--------------------------------------|
| id                | uuid (PK)   |                                      |
| questionnaire_id  | uuid        | FK → `questionnaires.id`             |
| text              | text        |                                      |
| type              | text        | 'single' \| 'multi' \| 'text' \| 'rating' |
| options           | jsonb       | nullable, for choice questions       |
| order_index       | int         |                                      |

### `invitations`
| Column            | Type        | Notes                                |
|-------------------|-------------|--------------------------------------|
| token             | uuid (PK)   | this goes in the URL                 |
| questionnaire_id  | uuid        | FK → `questionnaires.id`             |
| respondent_label  | text        | optional, e.g. name or email         |
| used_at           | timestamptz | nullable; null = unused              |
| created_at        | timestamptz | `default now()`                      |

### `responses`
| Column            | Type        | Notes                                |
|-------------------|-------------|--------------------------------------|
| id                | uuid (PK)   |                                      |
| invitation_token  | uuid        | FK → `invitations.token`             |
| question_id       | uuid        | FK → `questions.id`                  |
| answer            | jsonb       | flexible across question types       |
| submitted_at      | timestamptz | `default now()`                      |

## Row Level Security

The site is fully static — the browser talks to Supabase directly. RLS is what makes that safe.

### `questionnaires`
- **SELECT:** owner only
- **INSERT/UPDATE/DELETE:** owner only

### `questions`
- **SELECT:** owner of parent questionnaire, OR anyone with a valid unused invitation token
- **INSERT/UPDATE/DELETE:** owner only

### `invitations`
- **SELECT:** owner of parent questionnaire only (respondents never list invitations, they only use one specific token)
- A separate function `validate_token(token)` returns `{valid: bool, questionnaire_id: uuid}` for respondents
- **INSERT/UPDATE/DELETE:** owner only

### `responses`
- **SELECT:** owner of parent questionnaire only
- **INSERT:** anyone, IF the `invitation_token` is valid and unused; insert atomically marks the invitation as used (via a Supabase function)
- **UPDATE/DELETE:** nobody (responses are append-only)

## Open questions

- Anonymous vs labeled responses — toggle per questionnaire?
- Multi-page questionnaires?
- Partial save / resume on respondent side?

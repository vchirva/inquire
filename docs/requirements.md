# Requirements

The single source of truth for what Inquire is. Update this as decisions evolve.

## Users

| Role | Auth | Description |
|---|---|---|
| **Admin** (Sigma) | email + password | Creates clients, questionnaires, distributes links, views all results, generates PDF reports |
| **Client** | email + password (registers via admin link) | Sees dashboards for their own questionnaires only |
| **Respondent** | none — one-time link | Anonymous; answers one questionnaire |

## Core flows

### Client onboarding
1. Admin creates client (org name + contact email)
2. Admin generates a registration token → manually sends URL to client
3. Client opens link, sets password, lands in their cabinet

### Questionnaire creation
1. Admin creates questionnaire (title + description)
2. Admin assigns to one or more clients
3. Admin attaches one or more tags
4. Admin adds questions (one or more types: single, multi, text, rating, date, ranking)
5. Each question can be required and/or have a single conditional show rule
6. Admin publishes — once first link group is generated, **questions are locked**

### Cloning
- Admin can "build from existing": creates a new draft questionnaire with all questions copied, fully editable
- Source must be the admin's own previous questionnaire (no public template library)

### Distribution (Mode C — open shareable link)
1. Admin creates a "link group" for `(questionnaire, client)`
2. System generates one shareable URL: `inquire.app/g/<group-token>`
3. Admin distributes via Slack/email/etc. (no built-in notifications)
4. Admin can close the link group manually (no seat limits)

### Respondent flow
1. Opens shareable URL
2. System auto-claims a fresh response session and sets a browser cookie
3. One question per page · "Question Y of X" indicator · Back/Next navigation
4. Answers saved per-question on Next
5. Conditional questions appear/disappear based on prior answers
6. Required questions block submit if unanswered
7. Final page: review all answers · "Submit questionnaire" button
8. On submit: session marked `submitted`, link consumed (cookie discarded)
9. If respondent closes browser mid-flow and reopens the group URL: cookie restores their session, answers preserved
10. If cookie missing: brand-new session

### Client cabinet
- Sees only questionnaires their org was assigned
- Per-questionnaire dashboard: response counts, completion rate, charts per question
- No PDF export, no LLM features, no permalinks

### Admin dashboard
- Group questionnaires by client
- Filter by tag(s)
- Per-questionnaire results: charts, raw responses, response sessions list
- "Generate PDF report" — uses LLM if API key configured, else templated output

## Question types

| Type | Options shape | Answer shape |
|---|---|---|
| `single_choice` | `["Red", "Green", "Blue"]` | `"Red"` |
| `multi_choice` | `["A", "B", "C"]` | `["A", "C"]` |
| `text` | null | `"free text"` |
| `rating` | `{min: 1, max: 5, min_label?, max_label?}` | `4` |
| `date` | null | `"2026-04-28"` |
| `ranking` | `["Item A", "Item B", "Item C"]` | `["Item B", "Item A", "Item C"]` (ordered) |

## Conditional logic

Single condition per question (no AND/OR chains):

```json
{ "question_id": "<uuid-of-earlier-question>", "operator": "equals" | "not_equals" | "contains", "value": <any> }
```

- Reference must be to an *earlier* question (lower `order_index`)
- `contains` is for multi_choice and ranking answers
- If the referenced question hasn't been answered, the conditional question is hidden

## LLM PDF reports (admin only)

- Per-admin LLM config in Settings: provider + API key (or Ollama base URL)
- Providers: Claude, OpenAI, Mistral, Grok, Ollama
- If no LLM config: PDF still generated using templated layout (charts + summary stats + raw responses)
- If LLM config present: prompt sent server-side (Edge Function), executive summary + recommendations injected into PDF
- API keys never exposed to frontend

## Out of scope (for now)

- Notifications (email, push, etc.)
- Multi-language UI (English only)
- Per-questionnaire branding (fixed Sigma look)
- Editing questionnaires after launch
- Public template library
- Read-only result permalinks
- Respondent identity (always anonymous)
- AND/OR conditional logic
- File upload questions
- Multi-page logical branching (only per-question show/hide)
- Client-side LLM features

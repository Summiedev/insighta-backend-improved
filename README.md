# Insighta Labs+ Backend

Backend repository for Stage 3 of Insighta Labs+. This README covers only the backend responsibilities in the TRD: authentication, access control, profile APIs, rate limiting, logging, seeding, and deployment.

## Scope

This service is the single source of truth for:

- GitHub OAuth with PKCE
- JWT access and refresh token lifecycle
- Role-based access control
- Versioned profile APIs
- CSV export
- Rate limiting and structured logging

It is consumed by the CLI and the web portal, but those interfaces are documented in their own repositories.

## Architecture

- Runtime: Node.js 18+
- Deployment model: Vercel serverless functions in `api/`
- Database: MongoDB Atlas via the native `mongodb` driver
- IDs: UUID v7
- Auth model: GitHub OAuth + PKCE + JWT access/refresh tokens
- Response format: `{ "status": "success" | "error", ... }`

## Repository Layout

```text
api/
  health.js
  seed.js
  auth/
    me.js
  v1/
    auth/
      github/
        login.js
        callback.js
      me.js
      refresh.js
      logout.js
    admin/
      users/
        index.js
  profiles/
    index.js
    [id].js
    export.js
    search/
      index.js
src/
  auth.js
  db.js
  helpers.js
  nlParser.js
  queryBuilder.js
  profileService.js
  uuidv7.js
```

## Authentication System

### Endpoints

- `GET /auth/github`
- `GET /auth/github/callback`
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /auth/logout`

### Flow

1. The client starts GitHub OAuth with PKCE.
2. The backend stores the `state`, `code_verifier`, and redirect metadata.
3. GitHub redirects back to the backend callback endpoint.
4. The backend exchanges the code for a GitHub access token.
5. The backend creates or updates the user record.
6. The backend issues:
   - access token with a 3 minute TTL
   - refresh token with a 5 minute TTL
7. Refresh tokens are invalidated on use and replaced with a new pair.

### Token Rules

- Access token expiry: 3 minutes
- Refresh token expiry: 5 minutes
- Logout revokes the refresh token server-side
- Disabled users (`is_active = false`) must be rejected with `403 Forbidden`

## User Model

Collection: `users`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID v7 | Primary key |
| `github_id` | String | Unique |
| `username` | String | GitHub username |
| `email` | String | Optional |
| `avatar_url` | String | Optional |
| `role` | String | `admin` or `analyst` |
| `is_active` | Boolean | If false, reject all requests |
| `last_login_at` | Timestamp | Last successful login |
| `created_at` | Timestamp | Created time |

### Roles

- `admin`: full access, including create, delete, and export actions
- `analyst`: read-only access for list and search operations
- Default role: `analyst`

### Access Control

Auth and utility endpoints must require authentication and enforce role permissions through the shared auth middleware. The checks are centralized; they are not scattered across each route handler.

## Profile APIs

All profile-related requests must send:

```http
X-API-Version: 1
```

Requests without the version header are rejected with:

```json
{ "status": "error", "message": "API version header required" }
```

### List Profiles

- `GET /api/profiles`

Supports filtering, sorting, and pagination.

### Search Profiles

- `GET /api/profiles/search?q=...`

Uses the rule-based natural language parser from Stage 2. No AI or LLMs.

### Get Profile

- `GET /api/profiles/:id`

### Create Profile

- `POST /api/profiles`
- Admin only

Behavior:

- Calls external enrichment APIs
- Transforms the returned data
- Stores the profile in MongoDB
- Returns the saved profile

### Export Profiles

- `GET /api/profiles/export?format=csv`
- Admin only

Behavior:

- Uses the same filters and sorting as `GET /api/profiles`
- Streams CSV output
- Returns `Content-Type: text/csv`

CSV columns, in order:

`id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at`

### Pagination Contract

Paginated responses must include:

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "total_pages": 203,
  "links": {
    "self": "/api/profiles?page=1&limit=10",
    "next": "/api/profiles?page=2&limit=10",
    "prev": null
  },
  "data": []
}
```

The same response shape applies to `GET /api/profiles/search`.

## Rate Limiting

| Scope | Limit |
|---|---|
| Auth endpoints (`/auth/*`) | 10 requests per minute |
| All other endpoints | 60 requests per minute per user |

Exceeded limits must return `429 Too Many Requests`.

## Logging

Every request must log:

- Method
- Endpoint
- Status code
- Response time

## Database Notes

### Profiles collection

The `profiles` collection stores the enriched demographic records produced by the Stage 1/2 pipeline.

Important fields:

- `id`
- `name`
- `gender`
- `gender_probability`
- `age`
- `age_group`
- `country_id`
- `country_name`
- `country_probability`
- `created_at`

### Indexes

The backend should maintain indexes for the common query and uniqueness paths, especially:

- `name` unique
- `gender`
- `age_group`
- `country_id`
- `age`
- `gender_probability`
- `country_probability`
- `created_at`

## Error Responses

All errors must use the same shape:

```json
{ "status": "error", "message": "message" }
```

Common status codes:

| Code | Meaning |
|---|---|
| `400` | Bad request or missing required input |
| `401` | Not authenticated |
| `403` | Authenticated but not allowed |
| `404` | Resource not found |
| `405` | Method not allowed |
| `409` | Duplicate or conflicting resource |
| `422` | Invalid input or unparseable query |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Upstream API failure |
| `503` | Database or backend dependency unavailable |

## Environment Variables

Example `.env` values:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/?appName=Cluster0
MONGODB_DB=profileapi

GITHUB_CLIENT_ID=<github-client-id>
GITHUB_CLIENT_SECRET=<github-client-secret>
GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback

JWT_ACCESS_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-secret>

CORS_ALLOWED_ORIGINS=http://localhost:4000,http://127.0.0.1:4000
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_AUTH_WINDOW_SEC=60
RATE_LIMIT_QUERY_MAX=60
RATE_LIMIT_QUERY_WINDOW_SEC=60
```

## Local Run

```bash
npm install
npx vercel dev
```

The backend should be reachable on `http://localhost:3000` during local development.

## CI/CD

- Workflow: `.github/workflows/backend-ci-cd.yml`
- Required checks: lint, tests, build, deploy
- Target: production backend deployment on push to `main`

## Stage 3 Summary

This backend implements the TRD requirements for:

- GitHub OAuth with PKCE
- Session token issuance and refresh
- Role-based authorization
- Versioned profile APIs
- CSV export
- Rate limiting
- Structured logging
- Stable API responses for all clients

## Public Route Summary

The current public surface is:

- Auth: `/auth/github`, `/auth/github/callback`, `/auth/me`, `/auth/refresh`, `/auth/logout`
- Health: `/health`
- Seeding: `/seed`
- Profiles: `/api/profiles`, `/api/profiles/search`, `/api/profiles/export`, `/api/profiles/:id`

Profiles remain the only public family using the `/api` prefix.

## Submission Bundle

Use these values when submitting Stage 3:

- Backend repo: https://github.com/Summiedev/insighta-backend.git
- CLI repo: https://github.com/Summiedev/insighta-cli.git
- Portal repo: https://github.com/Summiedev/insighta-portal.git
- Live backend: https://insighta-backend-mauve.vercel.app
- Live portal: https://insighta-portal-seven.vercel.app

Verification completed in this workspace:

- Backend auth endpoints and protected profile APIs responded correctly with a valid admin token.
- CLI `whoami` and `logout` completed successfully against the live backend.
- Portal loaded successfully at the production URL.

Provide the admin and analyst test tokens separately in the submission form if the grader asks for them. Do not commit secrets into the repository.

It preserves the Stage 2 behavior for filtering, sorting, pagination, and natural language search while adding secure access control on top.

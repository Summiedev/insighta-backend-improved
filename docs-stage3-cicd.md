# Stage 3 CI/CD Setup (3 Repositories)

This workspace currently contains backend, CLI, and portal folders. In a multi-repo setup:

- Backend repo should contain `.github/workflows/backend-ci-cd.yml`
- CLI repo should contain `.github/workflows/cli-ci-cd.yml`
- Portal repo should contain `.github/workflows/portal-ci-cd.yml`

## Required Secrets

### Backend + Portal

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

### CLI

- `NPM_TOKEN`

## Pipeline Stages

All repositories use the same baseline gates:

1. lint
2. test
3. build
4. deploy/publish

## Deployment Targets

- Backend -> Vercel production (`main` branch)
- Portal -> Vercel production (`main` branch)
- CLI -> npm registry (version tag push)

## Practical Notes

- Workflows run `npm run <script> --if-present` for optional script compatibility.
- Add stricter lints/tests incrementally without breaking existing delivery.
- Keep branch protections enabled for `main` and `develop`.
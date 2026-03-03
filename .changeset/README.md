# Changesets

Create a changeset for every user-facing change in package code:

```bash
npx changeset
```

CI will open or update a release PR with version bumps and changelogs.
After that PR is merged to `main`, packages are published to npm and tags/releases are created automatically.

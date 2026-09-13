## Summary

<!-- What and why. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm test` and `pnpm typecheck` pass
- [ ] Tests colocated as `*.test.ts` if behavior changed
- [ ] Schema change updates both `src/lib/db/schema.ts` and `src/lib/db/migrate.ts`
- [ ] No new persistence outside `var/`; no new webhook route file
- [ ] User-visible change noted under **Unreleased** in `CHANGELOG.md`
- [ ] I did not stage `.env`, `var/`, or `.factory/` notes

## Test plan

<!-- How a reviewer can verify. -->

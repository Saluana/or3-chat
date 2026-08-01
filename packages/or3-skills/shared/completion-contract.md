# Completion contract

Every completed skill run reports these sections, in this order:

1. **Architecture** — primary surface, runtime when relevant, trust tier, and
   whether core changed.
2. **Changes** — user-visible result and important files or configuration.
3. **Permissions** — grants, network domains, server access, secrets handling,
   and trusted execution; write `None` where applicable.
4. **Validation** — exact commands or checks and whether each passed.
5. **Artifact or installation** — package path, installed ID, or precise
   blocker. Never infer activation from successful packaging.
6. **Rollback** — disable, uninstall, config restore, or revert path.
7. **Remaining risks** — only unresolved, material risks.

Do not call a run complete after scaffolding alone. Do not package, promote, or
claim installation after a known failed check.

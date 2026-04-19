# s-group

Groups and memberships. Publishes `group.user.activated` / `group.user.deactivated` events that drive `s-authz` to rebuild `AuthzView`.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules.

## Phase 1 scope

- Group CRUD (`Groups` table, `ByName` GSI)
- Membership records (`GroupUsers` table, `ByGroupId` / `ByUserId` GSIs)
- Domain-based auto-assignment on `user.registered`
- Activate/deactivate membership API

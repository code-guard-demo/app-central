---
name: db-review
description: Review SQL migrations and data-access code for locking, data loss, and performance risks.
---

# Database Review Skill

Apply these checks to changed SQL migrations, models, and repository/data-access code.

## Migration safety (PostgreSQL assumptions)
- `CREATE INDEX` without `CONCURRENTLY` on an existing table blocks writes. CRITICAL.
- `DROP COLUMN`, `DROP TABLE`, or renaming a column/table that running application code may still use. CRITICAL (needs an expand/contract rollout).
- `ALTER TABLE ... ADD COLUMN ... NOT NULL` without a default, or a type change that rewrites the table. CRITICAL on large tables.
- Adding a foreign key or CHECK constraint without `NOT VALID` then `VALIDATE`. WARNING.
- No rollback/down migration, or a migration that mixes schema and bulk data changes in one transaction. WARNING.

## Query and access patterns
- Foreign key columns or frequent filter/join columns with no index. WARNING.
- Queries inside loops (N+1). WARNING.
- `SELECT *` in production queries, or unbounded queries without `LIMIT`/pagination. WARNING.
- String-concatenated SQL (injection). BLOCKER.

## Escalation
- For every CRITICAL finding, report severity `BLOCKER` and start the message with the DB escalation tag you were given (for example `@org/db-admins`).
- Non-critical findings do not get the tag.

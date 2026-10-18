# Down migrations

One script per migration of the upgrade program, to be run **by hand**, newest
first, against a database you have backed up. The migrator never runs these.

Each script refuses (raises) when undoing it would lose data that only the
newer structure can hold, rather than silently dropping it. Values added to
Postgres enums cannot be removed; they are left in place and are harmless.

After running one, remove its row from the migrator's journal so it can be
applied again later:

```sql
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
```

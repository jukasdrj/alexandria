---
description: Test a database query via SSH
argument-hint: SQL query to execute (e.g., "SELECT * FROM editions LIMIT 5")
user-invocable: true
model: haiku
context: main
allowed-tools:
  - Bash(ssh root@Tower.local *)
  - AskUserQuestion
---

Test a PostgreSQL query on the Alexandria database.

## Usage

When invoked, ask the user for the SQL query they want to test, then:

1. Connect to the database via SSH:
   ```bash
   ssh root@Tower.local "docker exec postgres psql -U openlibrary -d openlibrary -c '$QUERY'"
   ```

2. Show the results

3. If successful and the user wants to implement this in the Worker:
   - Remind them to add input validation
   - Show example Worker code with try-catch
   - Reference the "Code Patterns" section in CLAUDE.md

## Important

- Always sanitize user input in Worker code
- Use parameterized queries to prevent SQL injection
- Test queries here before implementing in Worker

# Cash Loan applications

This project stores applications in PostgreSQL and keeps uploaded ID photos in a private server directory. Applicant records and photos are not served publicly. Admin list and CSV endpoints require a bearer token.

## Local setup (Windows)

1. Create a PostgreSQL database and apply the schema:

   ```powershell
   createdb cash_loan
   psql -d cash_loan -f schema.sql
   ```

   This also updates an existing `loan_applications` table to distinguish test records from real submissions.

2. Create `.env` from `.env.example`, then set `DATABASE_URL` to your PostgreSQL username/password and generate an admin token:

   ```powershell
   Copy-Item .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Put the generated value in `ADMIN_API_TOKEN` in `.env`. Keep `.env` private and never commit or share the token.

3. Install dependencies and start the server:

   ```powershell
   npm.cmd install
   npm.cmd start
   ```

   Open `http://127.0.0.1:3000`. The server binds to localhost by default.

## Generate 500 test applications

After configuring `.env` and applying `schema.sql`, run:

```powershell
npm.cmd run seed
```

This inserts 500 synthetic applications with reserved `TEST-0001` to `TEST-0500` phone labels, varied statuses, and submission dates across the past year. Rows are marked `is_test = true`, have no ID photos, and can be safely seeded again without creating duplicates. The existing form only collects a phone number and ID photo, so the generated rows contain no names, income, or loan amounts. Test rows are labeled in the admin API and CSV export.

## Staff data access

Use the token from `.env` to list recent applications or download an analysis CSV:

```powershell
curl.exe -H "Authorization: Bearer YOUR_ADMIN_API_TOKEN" http://127.0.0.1:3000/api/admin/applications
curl.exe -H "Authorization: Bearer YOUR_ADMIN_API_TOKEN" http://127.0.0.1:3000/api/admin/export.csv -o applications.csv
```

The list endpoint returns at most 100 records per request and accepts `limit` and `offset`. ID photos can be viewed through `/api/admin/applications/ID/id-photo` with the same authorization header. For analysis, connect directly to PostgreSQL using the credentials in `DATABASE_URL`; for example, `psql "$env:DATABASE_URL"` in PowerShell.

## Importing previous applications

No historical applicant data is included. To import a CSV with `phone` and `created_at` headers, validate that the numbers are in international format (for example `+15551234567`) and run this in `psql`:

```sql
\copy loan_applications (phone, created_at) FROM 'C:/path/to/previous-applications.csv' WITH (FORMAT csv, HEADER true)
```

Imported records may omit photo details; new website submissions require an ID photo.

## Before public deployment

This is a starter backend, not a compliance or production deployment. Loan applications and ID images are sensitive personal information. Before exposing it to the internet, deploy behind HTTPS, use a managed/private PostgreSQL service with encrypted storage and backups, restrict database network access, set `HOST=0.0.0.0` only behind a correctly configured hosting platform, and establish access, retention, deletion, and incident-response policies for your jurisdiction. The private photo directory must use persistent private storage in production; do not place it under a public web directory. Never expose the database or admin token to browser code.
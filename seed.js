import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(`
    INSERT INTO loan_applications (phone, status, is_test, test_reference, created_at)
    SELECT
      'TEST-' || lpad(applicant_number::text, 4, '0'),
      CASE applicant_number % 20
        WHEN 0 THEN 'pending'
        WHEN 1 THEN 'pending'
        WHEN 2 THEN 'pending'
        WHEN 3 THEN 'pending'
        WHEN 4 THEN 'pending'
        WHEN 5 THEN 'reviewing'
        WHEN 6 THEN 'reviewing'
        WHEN 7 THEN 'reviewing'
        WHEN 8 THEN 'reviewing'
        WHEN 9 THEN 'approved'
        WHEN 10 THEN 'approved'
        WHEN 11 THEN 'approved'
        WHEN 12 THEN 'approved'
        WHEN 13 THEN 'approved'
        WHEN 14 THEN 'approved'
        WHEN 15 THEN 'approved'
        WHEN 16 THEN 'approved'
        WHEN 17 THEN 'approved'
        ELSE 'declined'
      END,
      true,
      'seed-500-' || lpad(applicant_number::text, 4, '0'),
      now() - ((applicant_number % 365) * interval '1 day')
        - (((applicant_number * 37) % 1440) * interval '1 minute')
    FROM generate_series(1, 500) AS applicant_number
    ON CONFLICT DO NOTHING
    RETURNING id
  `);

  const count = await pool.query(
    "SELECT count(*)::int AS total FROM loan_applications WHERE is_test = true AND test_reference LIKE 'seed-500-%'"
  );
  console.log(`Inserted ${result.rowCount} test applications. Total in this seed set: ${count.rows[0].total}.`);
} finally {
  await pool.end();
}
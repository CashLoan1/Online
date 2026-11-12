import "dotenv/config";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const adminToken = process.env.ADMIN_API_TOKEN || "";
const uploadDirectory = path.resolve(process.env.PRIVATE_UPLOAD_DIR || "private_uploads");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

if (adminToken.length < 32) {
  throw new Error("ADMIN_API_TOKEN must be at least 32 characters. Set it in .env.");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 }
});

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));

function requireAdmin(req, res, next) {
  const supplied = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(adminToken);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: "Admin authorization required." });
  }
  next();
}

function detectImage(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", extension: "png" };
  }
  return null;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

app.get("/", (_req, res) => res.sendFile(path.join(process.cwd(), "index.html")));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post(
  "/api/applications",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false }),
  upload.single("idPhoto"),
  async (req, res, next) => {
    let photoPath;
    try {
      const phone = String(req.body.phone || "").trim();
      if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
        return res.status(400).json({ error: "Enter a valid phone number including its country code." });
      }
      if (!req.file) return res.status(400).json({ error: "Choose a photo of your ID." });

      const image = detectImage(req.file.buffer);
      if (!image || image.mime !== req.file.mimetype) {
        return res.status(400).json({ error: "The ID photo must be a valid JPG or PNG image." });
      }

      const filename = `${randomUUID()}.${image.extension}`;
      photoPath = path.join(uploadDirectory, filename);
      await writeFile(photoPath, req.file.buffer, { flag: "wx", mode: 0o600 });

      const result = await pool.query(
        `INSERT INTO loan_applications (phone, id_photo_filename, id_photo_mime)
         VALUES ($1, $2, $3) RETURNING id`,
        [phone, filename, image.mime]
      );
      res.status(201).json({ id: result.rows[0].id, message: "Application received." });
    } catch (error) {
      if (photoPath) await unlink(photoPath).catch(() => {});
      next(error);
    }
  }
);

app.get("/api/admin/applications", requireAdmin, async (req, res, next) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const requestedOffset = Number.parseInt(req.query.offset, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const offset = Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
  try {
    const result = await pool.query(
      `SELECT id, phone, status, is_test, created_at, id_photo_filename IS NOT NULL AS has_id_photo
       FROM loan_applications ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.set("Cache-Control", "no-store").json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/export.csv", requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, phone, status, is_test, created_at, id_photo_filename IS NOT NULL AS has_id_photo FROM loan_applications ORDER BY created_at"
    );
    const rows = ["id,phone,status,is_test,created_at,has_id_photo"];
    for (const application of result.rows) {
      rows.push([
        application.id,
        application.phone,
        application.status,
        application.is_test,
        application.created_at.toISOString(),
        application.has_id_photo
      ].map(csvCell).join(","));
    }
    res.set({ "Cache-Control": "no-store", "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=loan-applications.csv" });
    res.send(rows.join("\r\n"));
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/applications/:id/id-photo", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id_photo_filename, id_photo_mime FROM loan_applications WHERE id = $1",
      [req.params.id]
    );
    const application = result.rows[0];
    if (!application?.id_photo_filename) return res.status(404).json({ error: "ID photo not found." });
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.type(application.id_photo_mime).sendFile(path.join(uploadDirectory, application.id_photo_filename));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? "The ID photo must be no larger than 5 MB." : "Invalid application upload." });
  }
  console.error(error);
  res.status(500).json({ error: "The request could not be completed." });
});

await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
await pool.query("SELECT 1");
app.listen(port, host, () => console.log(`Cash Loan server listening on http://${host}:${port}`));
import { Request, Response, NextFunction } from "express";

export function requireJsonContentType(req: Request, res: Response, next: NextFunction) {
  if (req.method === "POST" || req.method === "PATCH") {
    const contentLength = req.headers["content-length"];
    const transferEncoding = req.headers["transfer-encoding"];
    // Skip the check if there is no request body (no content-length or it is zero,
    // and no chunked transfer encoding). This allows body-less POST endpoints
    // such as /api/auth/refresh to work without requiring a Content-Type header.
    const hasBody =
      (contentLength !== undefined && contentLength !== "0") ||
      transferEncoding !== undefined;

    if (hasBody) {
      const contentType = req.headers["content-type"];
      if (!contentType || !contentType.startsWith("application/json")) {
        res.status(415).json({ error: "Content-Type must be application/json" });
        return;
      }
    }
  }
  next();
}

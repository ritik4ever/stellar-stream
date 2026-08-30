import { Request, Response, NextFunction } from "express";

export function requireJsonContentType(req: Request, res: Response, next: NextFunction) {
  if (req.method === "POST" || req.method === "PATCH") {
    const contentLength = req.headers["content-length"];
    // Skip the check only when the request explicitly declares an empty body
    // (Content-Length: 0). Real HTTP clients always send this header for a
    // body-less POST (e.g. /api/auth/refresh); a missing header is otherwise
    // treated as "has a body" so the Content-Type is still enforced.
    const hasBody = contentLength !== "0";

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

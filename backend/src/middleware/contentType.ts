import { Request, Response, NextFunction } from "express";

export function requireJsonContentType(req: Request, res: Response, next: NextFunction) {
  if (req.method === "POST" || req.method === "PATCH") {
    // Body-less requests (a POST explicitly sent with Content-Length: 0, e.g.
    // routes like /api/auth/refresh) are allowed without a Content-Type header.
    // Anything that carries a body — declared via a non-zero Content-Length or
    // chunked transfer-encoding — must declare application/json.
    const contentLength = req.headers["content-length"];
    const transferEncoding = req.headers["transfer-encoding"];
    const hasBody = contentLength !== "0" || transferEncoding !== undefined;

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

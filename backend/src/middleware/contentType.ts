import { Request, Response, NextFunction } from "express";

export function requireJsonContentType(req: Request, res: Response, next: NextFunction) {
  if (req.method === "POST" || req.method === "PATCH") {
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.startsWith("application/json")) {
      res.status(415).json({ error: "Content-Type must be application/json" });
      return;
    }
  }
  next();
}

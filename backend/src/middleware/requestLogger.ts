import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logEntry = {
      requestId,
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    };

    console.log(JSON.stringify(logEntry));
  });

  next();
}

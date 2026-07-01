import pino from "pino";
import { getCorrelationId } from "./correlationContext";

const STELLAR_SECRET_REGEX = /^S[0-9A-Z]{55}$/;
const isProduction =
  process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test";

function redactValue(value: unknown): unknown {
  if (typeof value === "string" && STELLAR_SECRET_REGEX.test(value)) {
    return "[REDACTED]";
  }
  return value;
}

function redactObject(obj: any): any {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "secretKey" || k === "privateKey" || k === "seed") {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactObject(v);
      }
    }
    return out;
  }
  return redactValue(obj);
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // keep path-based redaction for structured fields
  redact: {
    paths: ["*.secretKey", "*.privateKey", "*.seed"],
    censor: "[REDACTED]",
  },
  // ensure values (strings) that match Stellar secret pattern are redacted anywhere
  formatters: {
    bindings(bindings) {
      return {
        pid: bindings.pid,
        host: bindings.hostname,
      };
    },
    log(obj: Record<string, any>) {
      // Automatically inject correlation_id from AsyncLocalStorage context
      const correlationId = getCorrelationId();
      if (correlationId && !obj.correlation_id) {
        obj.correlation_id = correlationId;
      }
      return redactObject(obj);
    },
  },
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,host",
          translateTime: "SYS:standard",
        },
      },
});

export { logger, redactObject, STELLAR_SECRET_REGEX };

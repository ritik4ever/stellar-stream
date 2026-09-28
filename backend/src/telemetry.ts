import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";

const serviceName = process.env.OTEL_SERVICE_NAME ?? "stellar-stream-backend";
const configuredEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const traceEndpoint = configuredEndpoint.endsWith("/v1/traces")
  ? configuredEndpoint
  : `${configuredEndpoint.replace(/\/$/, "")}/v1/traces`;

const sdk = new NodeSDK({
  serviceName,
  traceExporter: new OTLPTraceExporter({ url: traceEndpoint }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

// Instrumentation must be registered before Express, HTTP, or database
// modules are imported. The exporter is best-effort: the API remains usable
// when Jaeger/OTLP is unavailable.
sdk.start();

const shutdown = async () => {
  await sdk.shutdown();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

export { sdk };

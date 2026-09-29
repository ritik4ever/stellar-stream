import { describe, it, expect } from "vitest";
import SwaggerParser from "@apidevtools/swagger-parser";
import { swaggerDocument } from "./swagger";

describe("OpenAPI 3.0 Spec Validation", () => {
  it("should be valid against the OpenAPI 3.0 schema", async () => {
    const result = (await SwaggerParser.validate(swaggerDocument as any)) as any;
    expect(result).toBeDefined();
    expect(result.openapi).toBe("3.0.0");
    expect(result.info).toBeDefined();
    expect(result.info.title).toBe("StellarStream API");
    expect(result.paths).toBeDefined();
  });

  it("should have required OpenAPI 3.0 fields", () => {
    expect(swaggerDocument).toHaveProperty("openapi", "3.0.0");
    expect(swaggerDocument).toHaveProperty("info");
    expect(swaggerDocument.info).toHaveProperty("title");
    expect(swaggerDocument.info).toHaveProperty("version");
    expect(swaggerDocument).toHaveProperty("paths");
    expect(swaggerDocument).toHaveProperty("components.schemas");
  });
});

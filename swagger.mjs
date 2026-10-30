import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import swaggerJsdoc from "swagger-jsdoc";

const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "routes");
const routeFiles = fs
  .readdirSync(routesDir)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => path.join(routesDir, name));

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Pet Sitter API Documentation",
      version: "1.0.0",
      description:
        "API for pet owner, sitter, booking, and admin. Phase 3: boarding / dog walking / in-home quote, checkout, and status lifecycle. See docs/phase3-api.md.",
    },
    servers: [{ url: "http://localhost:4000" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        BookingQuoteRequest: {
          type: "object",
          required: ["sitterId", "serviceType"],
          properties: {
            sitterId: { type: "string", format: "uuid" },
            serviceType: {
              type: "string",
              enum: ["boarding", "dog_walking", "in_home"],
            },
            mode: {
              type: "string",
              enum: ["per_walk", "duration", "visit", "overnight"],
              nullable: true,
            },
            checkIn: { type: "string", example: "2026-11-01" },
            checkOut: { type: "string", example: "2026-11-05" },
            date: { type: "string", example: "2026-11-02" },
            startTime: { type: "string", example: "09:00" },
            endTime: { type: "string" },
            durationMinutes: { type: "integer", enum: [30, 45, 60] },
            visitHours: { type: "integer", example: 2 },
            petIds: { type: "array", items: { type: "integer" } },
            totalPrice: {
              type: "number",
              description: "Ignored. Server always recomputes.",
            },
          },
        },
        CreateBookingRequest: {
          allOf: [
            { $ref: "#/components/schemas/BookingQuoteRequest" },
            {
              type: "object",
              required: ["petIds", "paymentMethod"],
              properties: {
                paymentMethod: { type: "string", enum: ["cash", "stripe"] },
                message: { type: "string" },
                ownerAddress: {
                  type: "string",
                  description: "Required for in_home",
                },
                accessInstructions: { type: "string" },
              },
            },
          ],
        },
      },
    },
  },
  apis: routeFiles,
});

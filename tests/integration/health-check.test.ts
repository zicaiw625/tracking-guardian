/**
 * Health Check Integration Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("../../app/db.server", () => ({
    default: {
        $queryRaw: vi.fn(),
    },
}));

import prisma from "../../app/db.server";

describe("Health Check Endpoint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Basic Health Check", () => {
        it("should return healthy status when database is connected", async () => {
            // Mock successful database query
            vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);

            // Import the loader dynamically to get fresh module
            const { loader } = await import("../../app/routes/api.health");

            const request = new Request("http://localhost/api/health");
            const response = await loader({ request, params: {}, context: {} });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.status).toBe("healthy");
            expect(data.timestamp).toBeDefined();
            expect(data.uptime).toBeGreaterThanOrEqual(0);
        });

        it("should return unhealthy status when database is unavailable", async () => {
            // Mock failed database query
            vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("Connection refused"));

            const { loader } = await import("../../app/routes/api.health");

            const request = new Request("http://localhost/api/health");
            const response = await loader({ request, params: {}, context: {} });
            const data = await response.json();

            expect(response.status).toBe(503);
            expect(data.status).toBe("unhealthy");
        });
    });

    describe("Detailed Health Check", () => {
        it("should return detailed checks when authenticated with detailed=true", async () => {
            // Set up CRON_SECRET for authentication
            const originalCronSecret = process.env.CRON_SECRET;
            process.env.CRON_SECRET = "test-secret";
            
            vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);

            const { loader } = await import("../../app/routes/api.health");

            // Include Bearer token for authenticated access
            const request = new Request("http://localhost/api/health?detailed=true", {
                headers: {
                    "Authorization": "Bearer test-secret",
                },
            });
            const response = await loader({ request, params: {}, context: {} });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.checks).toBeDefined();
            expect(data.checks.database).toBeDefined();
            expect(data.checks.database.status).toBe("pass");
            expect(data.checks.memory).toBeDefined();
            expect(data.checks.memory.status).toBe("pass");
            
            // Restore original CRON_SECRET
            process.env.CRON_SECRET = originalCronSecret;
        });
        
        it("should downgrade to basic health check without authentication", async () => {
            vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);

            const { loader } = await import("../../app/routes/api.health");

            // Request detailed without auth - should be downgraded
            const request = new Request("http://localhost/api/health?detailed=true");
            const response = await loader({ request, params: {}, context: {} });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.status).toBe("healthy");
            // Without auth, checks should NOT be included
            expect(data.checks).toBeUndefined();
        });
    });
});

describe("Readiness Check Endpoint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return ready when all checks pass", async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);

        const { loader } = await import("../../app/routes/api.ready");

        const request = new Request("http://localhost/api/ready");
        const response = await loader({ request, params: {}, context: {} });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.ready).toBe(true);
        expect(data.checks.database).toBe(true);
    });

    it("should return not ready when database is unavailable", async () => {
        vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("Connection refused"));

        const { loader } = await import("../../app/routes/api.ready");

        const request = new Request("http://localhost/api/ready");
        const response = await loader({ request, params: {}, context: {} });
        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data.ready).toBe(false);
        expect(data.checks.database).toBe(false);
    });
});


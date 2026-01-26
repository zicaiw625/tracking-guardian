import type { Session } from "@shopify/shopify-api";

interface SessionStorage {
  storeSession(session: Session): Promise<boolean>;
  loadSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;
  deleteSessions(ids: string[]): Promise<boolean>;
  findSessionsByShop(shop: string): Promise<Session[]>;
}
import { encryptAccessToken, decryptAccessToken, isTokenEncrypted, TokenDecryptionError } from "./token-encryption.server";
import { logger } from "./logger.server";
export function createEncryptedSessionStorage(baseStorage: SessionStorage): SessionStorage {
    function cloneSession<T extends Session>(session: T, override?: Partial<T>): T {
        return Object.assign(Object.create(Object.getPrototypeOf(session)), session, override);
    }
    return {
        async storeSession(session: Session): Promise<boolean> {
            const sessionWithRefreshToken = session as Session & { refreshToken?: string };
            const cloned = cloneSession(session);
            const clonedWithRefreshToken = cloned as Session & { refreshToken?: string };
            if (cloned.accessToken) {
                clonedWithRefreshToken.accessToken = encryptAccessToken(cloned.accessToken);
            }
            if (sessionWithRefreshToken.refreshToken) {
                clonedWithRefreshToken.refreshToken = encryptAccessToken(sessionWithRefreshToken.refreshToken);
            }
            return await baseStorage.storeSession(cloned);
        },
        async loadSession(id: string): Promise<Session | undefined> {
            const session = await baseStorage.loadSession(id);
            if (!session) {
                return undefined;
            }
            const sessionWithRefreshToken = session as Session & { refreshToken?: string };
            const override: Partial<Session & { refreshToken?: string }> = {};
            let hasToken = false;
            if (session.accessToken) {
                hasToken = true;
                try {
                    override.accessToken = decryptAccessToken(session.accessToken);
                }
                catch (error) {
                    if (error instanceof TokenDecryptionError) {
                        logger.error(`[EncryptedSessionStorage] Failed to decrypt accessToken for session ${id}. ` +
                            "Clearing session to force re-authentication.");
                        await baseStorage.deleteSession(id);
                        return undefined;
                    }
                    throw error;
                }
            }
            if (sessionWithRefreshToken.refreshToken) {
                hasToken = true;
                try {
                    override.refreshToken = decryptAccessToken(sessionWithRefreshToken.refreshToken);
                }
                catch (error) {
                    if (error instanceof TokenDecryptionError) {
                        logger.error(`[EncryptedSessionStorage] Failed to decrypt refreshToken for session ${id}. ` +
                            "Clearing session to force re-authentication.");
                        await baseStorage.deleteSession(id);
                        return undefined;
                    }
                    throw error;
                }
            }
            if (hasToken) {
                return cloneSession(session, override);
            }
            return cloneSession(session);
        },
        async deleteSession(id: string): Promise<boolean> {
            return baseStorage.deleteSession(id);
        },
        async deleteSessions(ids: string[]): Promise<boolean> {
            return baseStorage.deleteSessions(ids);
        },
        async findSessionsByShop(shop: string): Promise<Session[]> {
            const sessions = await baseStorage.findSessionsByShop(shop);
            const decryptedSessions: Session[] = [];
            for (const session of sessions) {
                const sessionWithRefreshToken = session as Session & { refreshToken?: string };
                const override: Partial<Session & { refreshToken?: string }> = {};
                let hasToken = false;
                let shouldSkip = false;
                if (session.accessToken) {
                    hasToken = true;
                    try {
                        override.accessToken = decryptAccessToken(session.accessToken);
                    }
                    catch (error) {
                        if (error instanceof TokenDecryptionError) {
                            logger.warn(`[EncryptedSessionStorage] Skipping session with undecryptable accessToken for shop ${shop}`);
                            const sid = (session as { id?: string }).id;
                            if (typeof sid === "string") {
                                await baseStorage.deleteSession(sid);
                            }
                            shouldSkip = true;
                        } else {
                            throw error;
                        }
                    }
                }
                if (!shouldSkip && sessionWithRefreshToken.refreshToken) {
                    hasToken = true;
                    try {
                        override.refreshToken = decryptAccessToken(sessionWithRefreshToken.refreshToken);
                    }
                    catch (error) {
                        if (error instanceof TokenDecryptionError) {
                            logger.warn(`[EncryptedSessionStorage] Skipping session with undecryptable refreshToken for shop ${shop}`);
                            const sid = (session as { id?: string }).id;
                            if (typeof sid === "string") {
                                await baseStorage.deleteSession(sid);
                            }
                            shouldSkip = true;
                        } else {
                            throw error;
                        }
                    }
                }
                if (shouldSkip) {
                    continue;
                }
                if (hasToken) {
                    decryptedSessions.push(cloneSession(session, override));
                } else {
                    decryptedSessions.push(cloneSession(session));
                }
            }
            return decryptedSessions;
        },
    };
}
export async function migrateSessionTokensToEncrypted(prisma: {
    session: {
        findMany: (args?: { select?: { id?: boolean; accessToken?: boolean; refreshToken?: boolean } }) => Promise<Array<{ id: string; accessToken: string | null; refreshToken: string | null }>>;
        update: (args: { where: { id: string }; data: { accessToken?: string; refreshToken?: string } }) => Promise<unknown>;
    };
}): Promise<{
    migrated: number;
    skipped: number;
    errors: number;
}> {
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    const sessions = await prisma.session.findMany({
        select: { id: true, accessToken: true, refreshToken: true },
    });
    for (const session of sessions) {
        const needsAccessTokenMigration = session.accessToken && !isTokenEncrypted(session.accessToken);
        const needsRefreshTokenMigration = session.refreshToken && !isTokenEncrypted(session.refreshToken);
        if (!needsAccessTokenMigration && !needsRefreshTokenMigration) {
            skipped++;
            continue;
        }
        try {
            const updateData: { accessToken?: string; refreshToken?: string } = {};
            if (needsAccessTokenMigration) {
                updateData.accessToken = encryptAccessToken(session.accessToken!);
            }
            if (needsRefreshTokenMigration) {
                updateData.refreshToken = encryptAccessToken(session.refreshToken!);
            }
            await prisma.session.update({
                where: { id: session.id },
                data: updateData,
            });
            migrated++;
        }
        catch (error) {
            logger.error(`[Migration] Failed to encrypt session ${session.id}`, error);
            errors++;
        }
    }
    logger.info(`[Token Migration] Completed: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
    return { migrated, skipped, errors };
}

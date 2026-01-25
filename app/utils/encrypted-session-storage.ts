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
            const originalToken = session.accessToken;
            if (session.accessToken) {
                session.accessToken = encryptAccessToken(session.accessToken);
            }
            try {
                return await baseStorage.storeSession(session);
            }
            finally {
                session.accessToken = originalToken;
            }
        },
        async loadSession(id: string): Promise<Session | undefined> {
            const session = await baseStorage.loadSession(id);
            if (!session) {
                return undefined;
            }
            if (session.accessToken) {
                try {
                    const decryptedAccessToken = decryptAccessToken(session.accessToken);
                    return cloneSession(session, { accessToken: decryptedAccessToken });
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
                if (session.accessToken) {
                    try {
                        const decryptedAccessToken = decryptAccessToken(session.accessToken);
                        decryptedSessions.push(cloneSession(session, { accessToken: decryptedAccessToken }));
                    }
                    catch (error) {
                        if (error instanceof TokenDecryptionError) {
                            logger.warn(`[EncryptedSessionStorage] Skipping session with undecryptable token for shop ${shop}`);
                            const sid = (session as { id?: string }).id;
                            if (typeof sid === "string") {
                                await baseStorage.deleteSession(sid);
                            }
                            continue;
                        }
                        throw error;
                    }
                }
                else {
                    decryptedSessions.push(cloneSession(session));
                }
            }
            return decryptedSessions;
        },
    };
}
export async function migrateSessionTokensToEncrypted(prisma: {
    session: {
        findMany: (args?: { select?: { id?: boolean; accessToken?: boolean } }) => Promise<Array<{ id: string; accessToken: string | null }>>;
        update: (args: { where: { id: string }; data: { accessToken: string } }) => Promise<unknown>;
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
        select: { id: true, accessToken: true },
    });
    for (const session of sessions) {
        if (!session.accessToken) {
            skipped++;
            continue;
        }
        if (isTokenEncrypted(session.accessToken)) {
            skipped++;
            continue;
        }
        try {
            const encryptedToken = encryptAccessToken(session.accessToken);
            await prisma.session.update({
                where: { id: session.id },
                data: { accessToken: encryptedToken },
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

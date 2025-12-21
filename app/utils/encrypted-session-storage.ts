import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import type { Session } from "@shopify/shopify-api";
import { 
  encryptAccessToken, 
  decryptAccessToken, 
  isTokenEncrypted,
  TokenDecryptionError 
} from "./token-encryption";

export function createEncryptedSessionStorage(
  baseStorage: SessionStorage
): SessionStorage {
  return {
    async storeSession(session: Session): Promise<boolean> {
      // Store original accessToken for restoration after storage
      const originalToken = session.accessToken;
      
      // Encrypt the token in-place if it exists
      if (session.accessToken) {
        session.accessToken = encryptAccessToken(session.accessToken);
      }
      
      try {
        return await baseStorage.storeSession(session);
      } finally {
        // Restore original token to avoid side effects
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
          session.accessToken = decryptAccessToken(session.accessToken);
        } catch (error) {
          if (error instanceof TokenDecryptionError) {
            console.error(
              `[EncryptedSessionStorage] Failed to decrypt accessToken for session ${id}. ` +
              "Clearing session to force re-authentication."
            );
            await baseStorage.deleteSession(id);
            return undefined;
          }
          throw error;
        }
      }
      
      return session;
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
            session.accessToken = decryptAccessToken(session.accessToken);
            decryptedSessions.push(session);
          } catch (error) {
            if (error instanceof TokenDecryptionError) {
              console.warn(
                `[EncryptedSessionStorage] Skipping session with undecryptable token for shop ${shop}`
              );
              continue;
            }
            throw error;
          }
        } else {
          decryptedSessions.push(session);
        }
      }
      
      return decryptedSessions;
    },
  };
}

export async function migrateSessionTokensToEncrypted(
  prisma: { session: { findMany: Function; update: Function } }
): Promise<{ migrated: number; skipped: number; errors: number }> {
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
    } catch (error) {
      console.error(`[Migration] Failed to encrypt session ${session.id}:`, error);
      errors++;
    }
  }
  
  console.log(
    `[Token Migration] Completed: ${migrated} migrated, ${skipped} skipped, ${errors} errors`
  );
  
  return { migrated, skipped, errors };
}

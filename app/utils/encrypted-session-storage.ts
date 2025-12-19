/**
 * Encrypted Session Storage
 * 
 * P0-1: Wraps PrismaSessionStorage to automatically encrypt/decrypt accessToken
 * 
 * This adapter ensures that all access tokens stored in the Session table are encrypted
 * using AES-256-GCM. It transparently handles encryption on store and decryption on load.
 * 
 * Design:
 * - Wraps the standard PrismaSessionStorage from @shopify/shopify-app-session-storage-prisma
 * - Encrypts accessToken before storage, decrypts on retrieval
 * - Handles legacy unencrypted tokens gracefully (auto-migrates on next store)
 * - Decryption failures trigger token clearing (forces re-auth)
 */

import type { SessionStorage, Session } from "@shopify/shopify-app-session-storage-prisma";
import { 
  encryptAccessToken, 
  decryptAccessToken, 
  isTokenEncrypted,
  TokenDecryptionError 
} from "./token-encryption";

/**
 * Creates an encrypted session storage wrapper
 * 
 * @param baseStorage - The underlying PrismaSessionStorage instance
 * @returns A SessionStorage that encrypts/decrypts accessToken
 */
export function createEncryptedSessionStorage(
  baseStorage: SessionStorage
): SessionStorage {
  return {
    /**
     * Store a session with encrypted accessToken
     */
    async storeSession(session: Session): Promise<boolean> {
      // Clone the session to avoid mutating the original
      const encryptedSession = { ...session };
      
      // Encrypt the access token if present
      if (encryptedSession.accessToken) {
        encryptedSession.accessToken = encryptAccessToken(encryptedSession.accessToken);
      }
      
      return baseStorage.storeSession(encryptedSession);
    },
    
    /**
     * Load a session with decrypted accessToken
     */
    async loadSession(id: string): Promise<Session | undefined> {
      const session = await baseStorage.loadSession(id);
      
      if (!session) {
        return undefined;
      }
      
      // Decrypt the access token if present
      if (session.accessToken) {
        try {
          session.accessToken = decryptAccessToken(session.accessToken);
        } catch (error) {
          if (error instanceof TokenDecryptionError) {
            // Decryption failed - clear the session to force re-auth
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
    
    /**
     * Delete a session (passthrough)
     */
    async deleteSession(id: string): Promise<boolean> {
      return baseStorage.deleteSession(id);
    },
    
    /**
     * Delete sessions for a shop (passthrough)
     */
    async deleteSessions(ids: string[]): Promise<boolean> {
      return baseStorage.deleteSessions(ids);
    },
    
    /**
     * Find sessions by shop (decrypt accessToken for each)
     */
    async findSessionsByShop(shop: string): Promise<Session[]> {
      const sessions = await baseStorage.findSessionsByShop(shop);
      
      // Decrypt access tokens for all sessions
      const decryptedSessions: Session[] = [];
      
      for (const session of sessions) {
        if (session.accessToken) {
          try {
            session.accessToken = decryptAccessToken(session.accessToken);
            decryptedSessions.push(session);
          } catch (error) {
            if (error instanceof TokenDecryptionError) {
              // Skip sessions that can't be decrypted (they'll be cleaned up on next access)
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

/**
 * P0-1: Migrate existing unencrypted sessions to encrypted format
 * 
 * This function can be called during app startup or as a one-time migration
 * to encrypt all existing plaintext access tokens in the Session table.
 * 
 * @param prisma - Prisma client instance
 * @returns Migration statistics
 */
export async function migrateSessionTokensToEncrypted(
  prisma: { session: { findMany: Function; update: Function } }
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  
  // Find all sessions
  const sessions = await prisma.session.findMany({
    select: { id: true, accessToken: true },
  });
  
  for (const session of sessions) {
    if (!session.accessToken) {
      skipped++;
      continue;
    }
    
    // Check if already encrypted
    if (isTokenEncrypted(session.accessToken)) {
      skipped++;
      continue;
    }
    
    // Encrypt and update
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

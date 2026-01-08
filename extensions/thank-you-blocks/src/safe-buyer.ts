export function canUseBuyerInfo(api: unknown): boolean {

  if (!api || typeof api !== "object") {
    return false;
  }

  if (!("buyer" in api)) {
    return false;
  }

  const buyer = (api as { buyer?: unknown }).buyer;

  if (buyer === null || buyer === undefined) {
    return false;
  }

  return true;
}

export async function safeBuyer(
  api: unknown
): Promise<{
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
  };
  company?: string;
} | null> {
  if (!canUseBuyerInfo(api)) {
    return null;
  }

  try {
    const buyer = (api as { buyer?: unknown }).buyer;

    if (!buyer) {
      return null;
    }

    const buyerData = buyer instanceof Promise ? await buyer : buyer;

    if (!buyerData || typeof buyerData !== "object") {
      return null;
    }

    const buyerObj = buyerData as Record<string, unknown>;

    return {
      email: typeof buyerObj.email === "string" ? buyerObj.email : undefined,
      phone: typeof buyerObj.phone === "string" ? buyerObj.phone : undefined,
      firstName: typeof buyerObj.firstName === "string" ? buyerObj.firstName : undefined,
      lastName: typeof buyerObj.lastName === "string" ? buyerObj.lastName : undefined,
      address: buyerObj.address && typeof buyerObj.address === "object"
        ? {
            address1: typeof (buyerObj.address as Record<string, unknown>).address1 === "string"
              ? (buyerObj.address as Record<string, unknown>).address1 as string
              : undefined,
            address2: typeof (buyerObj.address as Record<string, unknown>).address2 === "string"
              ? (buyerObj.address as Record<string, unknown>).address2 as string
              : undefined,
            city: typeof (buyerObj.address as Record<string, unknown>).city === "string"
              ? (buyerObj.address as Record<string, unknown>).city as string
              : undefined,
            province: typeof (buyerObj.address as Record<string, unknown>).province === "string"
              ? (buyerObj.address as Record<string, unknown>).province as string
              : undefined,
            zip: typeof (buyerObj.address as Record<string, unknown>).zip === "string"
              ? (buyerObj.address as Record<string, unknown>).zip as string
              : undefined,
            country: typeof (buyerObj.address as Record<string, unknown>).country === "string"
              ? (buyerObj.address as Record<string, unknown>).country as string
              : undefined,
          }
        : undefined,
      company: typeof buyerObj.company === "string" ? buyerObj.company : undefined,
    };
  } catch (error) {

    console.warn("[safeBuyer] Failed to access buyer info:", error);
    return null;
  }
}

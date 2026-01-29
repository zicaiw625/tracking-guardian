import { jsonApi } from "~/utils/security-headers";

export const loader = () => jsonApi({ ok: true });

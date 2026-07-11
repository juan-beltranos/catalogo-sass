import { collection, getDocs, limit, query, where } from "@/lib/supabaseFirestore";
import { db } from "./supabase";

export type StoreLookup = {
  id: string;
  data: Record<string, any>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: StoreLookup | null; expiresAt: number }>();
const pending = new Map<string, Promise<StoreLookup | null>>();

/**
 * Reuses the owner-to-store lookup across admin screens in the same tab.
 * Pending requests are shared too, so layout and page mounts do not duplicate reads.
 */
export const getStoreForOwner = async (ownerUid: string): Promise<StoreLookup | null> => {
  const now = Date.now();
  const cached = cache.get(ownerUid);
  if (cached && cached.expiresAt > now) return cached.value;

  const inFlight = pending.get(ownerUid);
  if (inFlight) return inFlight;

  const request = getDocs(
    query(collection(db, "stores"), where("ownerUid", "==", ownerUid), limit(1)),
  )
    .then((snap) => {
      const value = snap.empty ? null : { id: snap.docs[0].id, data: snap.docs[0].data() as Record<string, any> };
      cache.set(ownerUid, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    })
    .finally(() => pending.delete(ownerUid));

  pending.set(ownerUid, request);
  return request;
};

export const invalidateStoreForOwner = (ownerUid?: string) => {
  if (ownerUid) cache.delete(ownerUid);
  else cache.clear();
};

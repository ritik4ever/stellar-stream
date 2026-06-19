import { useState } from "react";

export function useClaimStream() {
  const [claiming, setClaiming] = useState(false);

  const claimBatch = async (streamIds: string[]) => {
    setClaiming(true);
    try {
      const results = await Promise.allSettled(
        streamIds.map(id => fetch(`/api/streams/${id}/claim`, { method: "POST" }))
      );
      return results;
    } finally {
      setClaiming(false);
    }
  };

  return { claimBatch, claiming };
}

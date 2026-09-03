import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickProposalService } from "../lighttick-proposal.service.ts";

/** The only material-change tools exposed to agents; both require an owner and current version. */
export function createLightTickProposalTools(service: LightTickProposalService, owner: LightTickOwner) {
  return {
    accept: async (input: { proposal_id: string; base_version: number; confirmed: true }) => {
      if (input.confirmed !== true) throw new Error("Explicit proposal confirmation is required.");
      return await service.accept(owner, input.proposal_id, input.base_version);
    },
    reject: async (input: { proposal_id: string; base_version: number }) =>
      await service.reject(owner, input.proposal_id, input.base_version),
  };
}

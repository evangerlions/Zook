import type { DatabaseSeed } from "../../shared/types.ts";
import { ApplicationDatabase } from "../database/application-database.ts";
import { KVManager } from "./kv-manager.ts";

interface ManagedStatePayload {
  version: 1;
  apps?: DatabaseSeed["apps"];
  roles?: DatabaseSeed["roles"];
  rolePermissions?: DatabaseSeed["rolePermissions"];
  appConfigs?: DatabaseSeed["appConfigs"];
}

const MANAGED_STATE_SCOPE = "zook.managed-state";
const MANAGED_STATE_KEY = "bootstrap";

export class ManagedStateStore {
  constructor(
    private readonly kvManager: KVManager,
    private readonly options: {
      enabled?: boolean;
    } = {},
  ) {}

  async load(): Promise<Partial<DatabaseSeed>> {
    if (this.options.enabled === false) {
      return {};
    }

    const payload = await this.kvManager.getJson<ManagedStatePayload>(
      MANAGED_STATE_SCOPE,
      MANAGED_STATE_KEY,
    );
    if (!payload) {
      return {};
    }

    return {
      apps: Array.isArray(payload.apps) ? payload.apps : undefined,
      roles: Array.isArray(payload.roles) ? payload.roles : undefined,
      rolePermissions: Array.isArray(payload.rolePermissions) ? payload.rolePermissions : undefined,
      appConfigs: Array.isArray(payload.appConfigs) ? payload.appConfigs : undefined,
    };
  }

  async save(database: ApplicationDatabase): Promise<void> {
    if (this.options.enabled === false) {
      return;
    }

    const state = await database.exportManagedState();
    const payload: ManagedStatePayload = {
      version: 1,
      apps: structuredClone(state.apps),
      roles: structuredClone(state.roles),
      rolePermissions: structuredClone(state.rolePermissions),
      appConfigs: structuredClone(state.appConfigs),
    };

    await this.kvManager.setJson(MANAGED_STATE_SCOPE, MANAGED_STATE_KEY, payload);
  }
}

export function applyManagedState(baseSeed: DatabaseSeed, persisted: Partial<DatabaseSeed>): DatabaseSeed {
  return {
    ...baseSeed,
    apps: persisted.apps ?? baseSeed.apps ?? [],
    roles: persisted.roles ?? baseSeed.roles ?? [],
    rolePermissions: persisted.rolePermissions ?? baseSeed.rolePermissions ?? [],
    appConfigs: persisted.appConfigs ?? baseSeed.appConfigs ?? [],
  };
}

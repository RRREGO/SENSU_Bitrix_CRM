# Communications flags audit (v11)

Date: 2026-07-15

## Flags found

| Flag | Location(s) | Role |
|------|-------------|------|
| `COMMUNICATIONS_ENABLED` | `src/communications/config.js` | Hub master switch (canonical) |
| `COMMUNICATIONS_SEND_ENABLED` | Hub config, scheduler, runners | Canonical real-send switch |
| `COMMUNICATIONS_DRY_RUN` | Hub config (default `true`) | Force dry-run path |
| `COMMUNICATION_SEND_ENABLED` | Legacy auth/config + `.env.example` | **Deprecated alias** for send |
| `WAZZUP_ENABLED` / `MAX_BOT_ENABLED` | Provider enablement | Unchanged |
| `BITRIX_WRITE_ENABLED` | `operationalModes.js` | Unchanged (separate kill switch) |

## Conflict findings

1. **Before v11:** Hub used `COMMUNICATIONS_SEND_ENABLED` while `auth/config.js` and `operationalModes.js` read only `COMMUNICATION_SEND_ENABLED`. Setting only the Hub flag left auth/operational modes believing send was off (or vice versa).
2. **Resolution model (`resolveCommunicationSendFlags()`):**
   - Only `COMMUNICATIONS_SEND_ENABLED` set → use it.
   - Only `COMMUNICATION_SEND_ENABLED` set → use it (`usedDeprecatedAlias: true`).
   - Both set and **disagree** → `flagsConflict: true`, force `sendEnabled=false`, `dryRun=true`.
   - Both set and agree → use canonical value.
3. **Error code:** `COMMUNICATION_FLAGS_CONFLICT` via `assertCommunicationFlagsOk()`.
4. **`operationalModes.communicationSendEnabled`** now uses the **same** resolved `sendEnabled` from `getCommunicationsConfig()`.
5. **`auth.getAuthConfig().communicationSendEnabled`** uses `resolveCommunicationSendFlags().sendEnabled`.

## Safe defaults

```env
COMMUNICATIONS_ENABLED=false
COMMUNICATIONS_SEND_ENABLED=false
COMMUNICATIONS_DRY_RUN=true
COMMUNICATIONS_REQUIRE_CERTIFICATION=true
```

Dry-run / send-disabled paths are **not** blocked by missing certification. Certification gates apply only to **real** provider sends.

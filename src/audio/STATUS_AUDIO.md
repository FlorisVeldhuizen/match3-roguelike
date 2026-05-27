# Status & shield combat audio

How status and armor sounds map to gameplay. Implementation: `bindings.ts`, `procBlockSfx.ts`, trail handlers in `AnimationController.ts`.

## Three layers (do not merge)

| Layer | When (gameplay) | Trail purpose | Config map | Typical sound |
|-------|------------------|---------------|------------|----------------|
| **Apply** | Status lands on a target | `status-apply` | `STATUS_APPLY_SFX` | Burn hiss, weak stagger, etc. |
| **Proc damage** | DoT tick deals HP damage | `status-proc` · `damage` | `STATUS_PROC_DAMAGE_SFX` | Burn impact |
| **Proc block** | DoT tick is absorbed by armor | `status-proc` · `block` | `procBlockSfx` + slot | Shield thump / crack |

**Apply** = “you caught the effect.” **Proc** = “the effect ticked this turn.” Different moments, different sounds.

Sources that use proc trails are listed in `PROC_DAMAGE_STATUS` (`core/combat/statuses.ts`). Today: `burn` only.

## Shield sounds (thump vs crack)

| Combat outcome | Event | Player timing | Enemy timing |
|----------------|-------|---------------|--------------|
| All damage blocked, **armor left** | `block-absorbed` | Immediate thump | Proc: trail `arrivalMs`; non-proc: ~attack-trail delay |
| All damage blocked, **armor depleted** | `block-broken` only | Immediate crack | Same proc / delay rules |
| Partial: block + HP | `block-broken` + HP on `damage-taken` | Crack + attack/impact | Crack + attack/impact |

**Thump** = clean block (armor still up). **Crack** = armor gave way (even if no HP was lost).

Enemy attack with `onHitRider: burn` uses **attack** + burst visuals — not the proc pipeline (that is for DoT ticks).

## Step-by-step: burn on player

### A — Enemy applies burn

1. `status-applied` (enemy source) → **apply** sound immediately (`playBurnApplySfx`).
2. Or board/spell apply → chip flies (`status-apply` trail) → apply sound at trail landing.

No proc block, no burn impact.

### B — Burn ticks (player phase start)

1. `damage-taken` (`source: burn`) — stores `blocked` / `amount`; arms proc block slot if `blocked > 0`.
2. `block-absorbed` or `block-broken` — sets proc kind + **backup timer** (`PROC_BLOCK_TRAIL_BACKUP_MS`).
3. Animation may spawn up to two trails from the status chip:
   - **HP facet** (`amount > 0`) → `STATUS_PROC_DAMAGE_SFX` at `arrivalMs`.
   - **Block facet** (`blocked > 0`) → thump/crack at `arrivalMs` (trail claims audio; backup fires if trail never runs).
4. `status-ticked` / `status-expired` — visuals; no dedicated tick SFX in bindings.

Same tick with block + HP = **impact then armor stress** (two beats, same proc timing).

### C — Enemy attacks (same turn or later)

1. `damage-taken` (`enemy-attack`) — **clears** proc block slot (no stale burn flags).
2. HP damage → `playAttackSfx`.
3. `block-absorbed` / `block-broken` — immediate thump/crack (not proc-deferred).

## Step-by-step: you hit a blocked enemy

1. `damage-dealt` — attack SFX if HP > 0; records blocked/unblocked.
2. Proc burn on enemy — same dual-trail model as player.
3. Non-proc full block — `block-absorbed` uses generic trail-arrival delay unless proc pending.

## Adding a new DoT (e.g. poison)

Extend in one pass:

1. `DamageSource` + `PROC_DAMAGE_STATUS` in `statuses.ts`
2. `STATUS_APPLY_SFX` — sound when status is applied
3. `STATUS_PROC_DAMAGE_SFX` — sound on proc HP facet
4. `STATUS_TRAIL` + `procPopupTint` in `AnimationController.ts`

Proc **block** facet needs no per-DoT audio map — `playProcBlockSfx` handles thump/crack for any proc damage source.

## Related (not proc-block)

- **Blue pool / `block-gained`** — `playShieldParticleTickSfx` / thump on earn (building armor, not absorbing a hit).
- **Tile burn** — ignite / burst / fizzle on board events.
- **Vulnerable apply** — reuses crack synth on **apply**; distinct from armor break on a **proc block** trail.

## Files

| File | Role |
|------|------|
| `bindings.ts` | Event + trail routing, maps above |
| `procBlockSfx.ts` | Thump/crack resolution, trail backup, dedup |
| `synths/shield.ts` | Thump / crack synths |
| `synths/burn.ts` | Apply / impact / board burn |

# Proposal

## Why

Golden fixture: a change classified as `factory-change` with `blast_radius: SYSTEM`, kept as the snapshot of the effective policy
that pack `core-sdd` produces for that profile at risk level HIGH.

## What Changes

- Adds the capability `golden-factory`, a placeholder behaviour the fixture can describe in a spec delta.

## Capabilities

### New Capabilities

- `golden-factory`: the placeholder capability this golden fixture declares.

### Modified Capabilities

<!-- none -->

## Impact

Nothing outside this fixture: the project exists only to be resolved by `warrant resolve` and `warrant status`.

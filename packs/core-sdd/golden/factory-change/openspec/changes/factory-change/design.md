# Design

## Context

The fixture is a minimal WARRANT project; see `proposal.md` for the motivation.

## Goals / Non-Goals

**Goals:**

- Carry the four artifacts profile `feature` requires, which `factory-change` inherits through `extends`.

**Non-Goals:**

- Any real implementation: the fixture is data, not code.

## Decisions

- The artifacts stay minimal, because the golden compares effective policy, not prose.

## Risks / Trade-offs

- [A future OpenSpec release tightens `--strict`] → the fixture is revalidated by the golden test suite.

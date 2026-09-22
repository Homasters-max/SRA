# Spec Delta: golden-factory

## Purpose

Placeholder capability of the `factory-change` golden fixture: it exists so the change carries one valid spec delta with a stable ID.

## ADDED Requirements

### Requirement: Golden fixture declares one capability
<!-- id: REQ-GLD-001 -->

The `factory-change` golden fixture SHALL declare exactly one capability so that `openspec validate --strict` accepts the change.

#### Scenario: Validate accepts the fixture
<!-- id: SCN-GLD-001 -->
- **WHEN** `openspec validate factory-change --strict` runs inside the fixture
- **THEN** it exits with code 0

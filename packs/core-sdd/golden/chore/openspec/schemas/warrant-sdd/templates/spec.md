# Spec Delta

## Purpose
<!-- New capabilities only: one or two sentences (50+ characters) on what this capability is for. Delete this section for an existing capability. -->

## ADDED Requirements

### Requirement: <!-- requirement name -->
<!-- id: REQ-AREA-NNN -->
<!-- requirement text -->

#### Scenario: <!-- scenario name -->
<!-- id: SCN-AREA-NNN -->
- **WHEN** <!-- condition -->
- **THEN** <!-- expected outcome -->

<!-- WARRANT: the `<!- - id: ... - ->` comment goes DIRECTLY UNDER its own heading and is
     followed by a non-empty body. Allocate every id with `warrant id REQ <AREA>` /
     `warrant id SCN <AREA>`; AREA must be declared in `.warrant/local/areas.json`.
     Example:

     ### Requirement: Idempotent ingestion
     <!- - id: REQ-ING-001 - ->

     The system SHALL produce the same logical result when ingestion is repeated.

     #### Scenario: Repeated run
     <!- - id: SCN-ING-003 - ->
     - **WHEN** ingestion runs twice for input version V
     - **THEN** the target dataset is identical after both runs
-->

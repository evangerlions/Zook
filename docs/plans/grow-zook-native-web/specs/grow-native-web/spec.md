## ADDED Requirements

### Requirement: Independent framework frontend repository
Grow SHALL rebuild its frontend as a statically built React/TypeScript application in `/Volumes/肖豪/project/grow`. Zook MUST NOT maintain a duplicate frontend source tree, and the frontend MUST NOT require SSR or a dedicated backend process.

#### Scenario: Frontend is packaged
- **WHEN** a fixed Grow revision is built
- **THEN** the artifact contains only approved browser assets and a version manifest, without Python, environment files, private data or credentials

### Requirement: Existing Web hosting with pinned artifact compatibility
The existing Zook Web process SHALL host the versioned Grow artifact at `/grow/` without an additional service or port. The release SHALL bind frontend digest, source revision, backend revision and contract compatibility.

#### Scenario: Artifact is absent or incompatible
- **WHEN** Grow is enabled and the artifact is absent, altered or incompatible
- **THEN** promotion is rejected, while the existing deployment remains available

#### Scenario: Deep link and missing resource
- **WHEN** a declared Grow page or missing asset is requested
- **THEN** the page loads through the declared frontend route, the missing asset returns404 and API calls never return SPA HTML

### Requirement: Product-scoped session and state
Grow SHALL use Zook ordinary-user identity and its own registered app membership. Browser state, cached responses and drafts SHALL be partitioned by actual appId/userId and independent of Admin state.

#### Scenario: Account changes during editing
- **WHEN** the active identity changes while an editor or generation request is active
- **THEN** old requests are cancelled, private caches are cleared or isolated, input is protected and paid or mutating operations are not automatically replayed

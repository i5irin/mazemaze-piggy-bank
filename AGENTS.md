# Mazemaze Piggy Bank Working Agreements

This file contains repository-specific guidance. Apply it together with the
applicable workspace and machine-level instructions. A maintainer's explicit
instructions take precedence.

## Canonical Sources

- `docs/specification.md` is the canonical Product, Domain, Persistence,
  Storage, Sharing, UI, UX, and PWA specification.
- `docs/brand/README.md` is the canonical Brand specification.
- `README.md` is the project overview and the entry point for setup,
  development, and deployment.
- Code and tests describe the current implementation and executable behavior.

The Specification is not a task tracker. When the Specification and the
implementation differ, identify the difference explicitly. Do not silently
merge them or guess which one is correct.

## Language

- UI-visible text must be English.
- Code comments must be English.
- Suggested commit messages and PR text must follow the applicable
  machine-level convention.

## Planning and Approval for Material Changes

Prepare an explicit implementation plan and obtain human approval before
making substantial, hard-to-reverse changes involving:

- the Product Specification or major architecture;
- persistence contracts or database schemas;
- authentication, identity, authorization, sharing, or tenancy;
- destructive data migration or reset behavior;
- external-service architecture or major dependency choices.

For small, localized, readily reversible work, proceed autonomously under the
applicable workspace instructions.

## Before Substantial Work

Read the sources relevant to the change instead of mechanically reading the
entire repository:

- Read `README.md` when setup, deployment, or project-entry context matters.
- Read `docs/specification.md` for Product, Domain, Persistence, Storage,
  Sharing, UI, UX, or PWA behavior.
- Read `docs/brand/README.md` for branding work.
- Read the relevant code, tests, and package configuration for implementation
  work.

## Engineering Rules

- Keep changes minimal, focused, and easy to review. Avoid unrelated cleanup
  and broad formatting changes.
- Keep TypeScript strict. Treat external input as `unknown`, narrow it, and
  validate it at system boundaries. Avoid `any` unless a narrow, documented
  exception is necessary.
- Respect React and Next.js server-client boundaries. Keep UI components
  focused on presentation, and place data access and domain logic in the
  appropriate hooks, services, or domain modules.
- Preserve domain invariants at trusted boundaries; client-provided data is
  not authoritative merely because it matches a TypeScript type.
- Treat network and storage operations as fallible. User-facing failures must
  explain the next useful action, using English UI text, while logs must avoid
  sensitive data.
- For changed interactions, preserve keyboard access, visible focus, logical
  focus order, labels or accessible names, sufficient contrast, and meaning
  that does not depend on color alone.
- Do not place secrets in source control or client-exposed configuration.
  Treat client-side code and `NEXT_PUBLIC_*` values as public.
- Do not add telemetry or analytics unless explicitly requested.

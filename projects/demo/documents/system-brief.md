# Synthetic Support Assistant

This document describes a fictional system created only for the public demo package.

## Current baseline

1. A request intake component receives a support question made of synthetic text.
2. A policy router selects a grounded-assistance path or sends the request directly to a person.
3. The retrieval service reads a local synthetic knowledge index to prepare a cited response draft.
4. A human review workspace is the only component allowed to finalize the response.

## Boundary

The demo contains no customer records, production endpoints, credentials, or external integrations.
The architecture viewer is demonstrating reviewable design data rather than a live service.

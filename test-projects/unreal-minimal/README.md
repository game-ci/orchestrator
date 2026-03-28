# Minimal Unreal Engine Test Project

This directory is a placeholder for Unreal Engine CI smoke testing.

## Why a placeholder?

Unreal Engine Docker images are **very large** (10-50+ GB) and require:
- EULA acceptance
- Epic Games GitHub access (for source-based images)
- Or a pre-built custom image

This makes automated CI testing impractical for public workflows.

## Manual Testing

To test the orchestrator with Unreal Engine manually:

1. Build or pull an Unreal Engine Docker image (e.g., via `ue4-docker`)
2. Create a minimal `.uproject`:
   ```json
   {
     "FileVersion": 3,
     "EngineAssociation": "5.4",
     "Description": "Minimal CI test",
     "Modules": []
   }
   ```
3. Run: `game-ci serve --provider-strategy local-docker`
4. Send a run-task request with the UE image and build commands

## Automated Testing (when UE images are available)

The `engine-smoke-test.yml` workflow supports an optional Unreal test
that can be triggered manually with a custom image URL.

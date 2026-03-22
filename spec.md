# Tractor Race Game - 3D Conversion

## Current State
A 2D Canvas-based tractor racing game with:
- Race track drawn via Canvas 2D API
- Tractor drawn as 2D shapes
- Race brake steering physics (throttle, brake, steer)
- Three camera modes: Fixed, Follow, Chase (switchable via C key or button)
- Touch controls for mobile (D-pad)
- HUD with lap times, speed bar, boost indicator
- 5-lap race with best lap tracking

## Requested Changes (Diff)

### Add
- Full 3D scene using React Three Fiber (@react-three/fiber)
- 3D tractor model built from Three.js geometry (box/cylinder primitives)
- 3D oval/rounded-rect race track with road surface, kerbs, and grass
- 3D camera modes: orbit-fixed (top-down), follow (behind-above), chase (low behind tractor)
- Lighting: ambient + directional sunlight
- Sky/environment: simple colored sky background
- Trees or simple 3D decorations on infield
- Shadow casting for tractor

### Modify
- Replace Canvas 2D renderer with React Three Fiber Canvas
- Physics/game loop stays in useRef/requestAnimationFrame (same logic)
- HUD (lap, time, speed) rendered as HTML overlay on top of 3D canvas
- Touch controls remain as HTML overlay
- Camera switching (C key + button) adapted for 3D cameras

### Remove
- All Canvas 2D drawing functions (drawTrack, drawTractor, drawKerbs, drawOverlay)
- 2D camera transform logic

## Implementation Plan
1. Set up React Three Fiber Canvas replacing the 2D canvas element
2. Build 3D track: flat plane for grass, extruded rounded-rect road, finish line stripes
3. Build 3D tractor from box/cylinder meshes (body, wheels, cab, exhaust)
4. Implement 3D cameras: Fixed (high top-down), Follow (behind and above), Chase (low chase)
5. Keep existing physics/game state in refs, update tractor mesh position/rotation each frame
6. Keep HUD and touch controls as HTML overlays on top of Three.js canvas
7. Add lighting and shadows

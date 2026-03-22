import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// ─── Game Constants ────────────────────────────────────────────────────────
const MAX_SPEED = 5;
const BOOST_SPEED = 8.5;
const ACCEL = 0.09;
const BRAKE_FORCE = 0.15;
const DRAG = 0.013;
const STEER = 0.038;
const TOTAL_LAPS = 5;

const TRACK_CX = 350;
const TRACK_CY = 250;
const TRACK_W = 480;
const TRACK_H = 300;
const TRACK_R = 110;
const TRACK_HALF_W = 58;

const FINISH_Y = 415;
const FINISH_X1 = 295;
const FINISH_X2 = 405;

const START_X = (FINISH_X1 + FINISH_X2) / 2;
const START_Y = FINISH_Y - 25;
const START_ANGLE = -Math.PI / 2;

// World coordinate helpers (2D canvas → 3D world)
const toWX = (x: number) => x - TRACK_CX;
const toWZ = (y: number) => y - TRACK_CY;

// ─── Types ────────────────────────────────────────────────────────────────
type CameraMode = 0 | 1 | 2;
type Phase = "start" | "racing" | "finished";

const CAMERA_LABELS: Record<CameraMode, string> = {
  0: "Fixed",
  1: "Follow",
  2: "Chase",
};

interface RaceState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  throttle: boolean;
  braking: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  boosting: boolean;
  phase: Phase;
  lap: number;
  lapStartTime: number;
  lapTimes: number[];
  bestLap: number;
  lastCrossY: number;
  raceStartTime: number;
}

interface UISnap {
  phase: Phase;
  lap: number;
  lapTime: number;
  bestLap: number;
  speed: number;
  boosting: boolean;
  lapTimes: number[];
}

// ─── Physics Helpers ──────────────────────────────────────────────────────
function closestPointOnRoundedRect(px: number, py: number): number {
  const hw = TRACK_W / 2 - TRACK_R;
  const hh = TRACK_H / 2 - TRACK_R;
  const dx = px - TRACK_CX;
  const dy = py - TRACK_CY;
  const cornerX = (dx >= 0 ? 1 : -1) * hw;
  const cornerY = (dy >= 0 ? 1 : -1) * hh;
  let nearX: number;
  let nearY: number;
  if (Math.abs(dx) > hw && Math.abs(dy) > hh) {
    const toDx = dx - cornerX;
    const toDy = dy - cornerY;
    const toD = Math.sqrt(toDx * toDx + toDy * toDy) || 1;
    nearX = TRACK_CX + cornerX + (toDx / toD) * TRACK_R;
    nearY = TRACK_CY + cornerY + (toDy / toD) * TRACK_R;
  } else if (Math.abs(dy) > hh) {
    nearX = TRACK_CX + Math.max(-hw, Math.min(hw, dx));
    nearY = TRACK_CY + (dy >= 0 ? 1 : -1) * (hh + TRACK_R);
  } else {
    nearX = TRACK_CX + (dx >= 0 ? 1 : -1) * (hw + TRACK_R);
    nearY = TRACK_CY + Math.max(-hh, Math.min(hh, dy));
  }
  return Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
}

function isOnTrack(px: number, py: number): boolean {
  return closestPointOnRoundedRect(px, py) <= TRACK_HALF_W;
}

function initRace(): RaceState {
  return {
    x: START_X,
    y: START_Y,
    angle: START_ANGLE,
    speed: 0,
    throttle: false,
    braking: false,
    steerLeft: false,
    steerRight: false,
    boosting: false,
    phase: "start",
    lap: 0,
    lapStartTime: 0,
    lapTimes: [],
    bestLap: Number.POSITIVE_INFINITY,
    lastCrossY: -1,
    raceStartTime: 0,
  };
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--:--.---";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msec = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(msec).padStart(3, "0")}`;
}

// ─── THREE.js Shape Helpers ───────────────────────────────────────────────
function traceRoundedRect(
  target: THREE.Shape | THREE.Path,
  hw: number,
  hh: number,
  r: number,
  clockwise = false,
) {
  if (!clockwise) {
    target.moveTo(-hw + r, hh);
    target.lineTo(hw - r, hh);
    target.quadraticCurveTo(hw, hh, hw, hh - r);
    target.lineTo(hw, -hh + r);
    target.quadraticCurveTo(hw, -hh, hw - r, -hh);
    target.lineTo(-hw + r, -hh);
    target.quadraticCurveTo(-hw, -hh, -hw, -hh + r);
    target.lineTo(-hw, hh - r);
    target.quadraticCurveTo(-hw, hh, -hw + r, hh);
  } else {
    // clockwise for holes
    target.moveTo(-hw + r, hh);
    target.quadraticCurveTo(-hw, hh, -hw, hh - r);
    target.lineTo(-hw, -hh + r);
    target.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    target.lineTo(hw - r, -hh);
    target.quadraticCurveTo(hw, -hh, hw, -hh + r);
    target.lineTo(hw, hh - r);
    target.quadraticCurveTo(hw, hh, hw - r, hh);
    target.lineTo(-hw + r, hh);
  }
}

// ─── Track 3D Component ───────────────────────────────────────────────────
function Track3D() {
  // Road ring shape (outer rounded rect with inner hole)
  const roadShape = useMemo(() => {
    const outHW = TRACK_W / 2 + TRACK_HALF_W + 8;
    const outHH = TRACK_H / 2 + TRACK_HALF_W + 8;
    const outR = TRACK_R + TRACK_HALF_W + 8;
    const shape = new THREE.Shape();
    traceRoundedRect(shape, outHW, outHH, outR, false);

    const inHW = TRACK_W / 2 - TRACK_HALF_W;
    const inHH = TRACK_H / 2 - TRACK_HALF_W;
    const inR = Math.max(4, TRACK_R - TRACK_HALF_W);
    const hole = new THREE.Path();
    traceRoundedRect(hole, inHW, inHH, inR, true);
    shape.holes.push(hole);
    return shape;
  }, []);

  // Infield shape
  const infieldShape = useMemo(() => {
    const iHW = TRACK_W / 2 - TRACK_HALF_W - 4;
    const iHH = TRACK_H / 2 - TRACK_HALF_W - 4;
    const iR = Math.max(4, TRACK_R - TRACK_HALF_W - 4);
    const shape = new THREE.Shape();
    traceRoundedRect(shape, iHW, iHH, iR, false);
    return shape;
  }, []);

  // Finish line checkerboard texture
  const finishTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 110;
    c.height = 20;
    const ctx = c.getContext("2d");
    if (ctx) {
      for (let xi = 0; xi < 11; xi++) {
        for (let yi = 0; yi < 2; yi++) {
          ctx.fillStyle = (xi + yi) % 2 === 0 ? "#ffffff" : "#111111";
          ctx.fillRect(xi * 10, yi * 10, 10, 10);
        }
      }
    }
    return new THREE.CanvasTexture(c);
  }, []);

  // Kerb dot positions (adapted from original 2D drawKerbs logic)
  const kerbData = useMemo(() => {
    const segCount = 72;
    const hw = TRACK_W / 2 - TRACK_R;
    const hh = TRACK_H / 2 - TRACK_R;
    const outer: Array<{ pos: [number, number, number]; red: boolean }> = [];
    const inner: Array<{ pos: [number, number, number]; red: boolean }> = [];

    for (let i = 0; i < segCount; i++) {
      const t = (i / segCount) * Math.PI * 2;
      const cosA = Math.cos(t);
      const sinA = Math.sin(t);

      const getPoint = (offset: number): [number, number, number] => {
        let px: number;
        let py: number;
        const inCX = Math.abs(cosA * 9999) > hw;
        const inCY = Math.abs(sinA * 9999) > hh;
        if (inCX && inCY) {
          const cx = (cosA > 0 ? 1 : -1) * hw;
          const cy = (sinA > 0 ? 1 : -1) * hh;
          const aa = Math.atan2(sinA * 9999 - cy, cosA * 9999 - cx);
          px = TRACK_CX + cx + Math.cos(aa) * (TRACK_R + offset);
          py = TRACK_CY + cy + Math.sin(aa) * (TRACK_R + offset);
        } else if (inCX) {
          px = TRACK_CX + (cosA > 0 ? 1 : -1) * (hw + TRACK_R + offset);
          py = TRACK_CY + Math.max(-hh, Math.min(hh, sinA * 9999));
        } else {
          px = TRACK_CX + Math.max(-hw, Math.min(hw, cosA * 9999));
          py = TRACK_CY + (sinA > 0 ? 1 : -1) * (hh + TRACK_R + offset);
        }
        return [toWX(px), 0.5, toWZ(py)];
      };

      outer.push({ pos: getPoint(TRACK_HALF_W + 2), red: i % 2 === 0 });
      inner.push({ pos: getPoint(-(TRACK_HALF_W + 2)), red: i % 2 === 0 });
    }
    return { outer, inner };
  }, []);

  // Tree positions in the infield
  const trees: [number, number, number][] = [
    [toWX(350), 0, toWZ(195)],
    [toWX(280), 0, toWZ(230)],
    [toWX(420), 0, toWZ(230)],
    [toWX(305), 0, toWZ(265)],
    [toWX(395), 0, toWZ(265)],
    [toWX(350), 0, toWZ(300)],
  ];

  return (
    <group>
      {/* Ground plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.2, 0]}
        receiveShadow
      >
        <planeGeometry args={[4000, 4000]} />
        <meshLambertMaterial color="#3d6b27" />
      </mesh>

      {/* Road surface ring */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.05, 0]}
        receiveShadow
      >
        <shapeGeometry args={[roadShape, 64]} />
        <meshLambertMaterial color="#2e2e2e" />
      </mesh>

      {/* Road edge border (slightly larger, darker) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <shapeGeometry
          args={[
            (() => {
              const outHW = TRACK_W / 2 + TRACK_HALF_W + 16;
              const outHH = TRACK_H / 2 + TRACK_HALF_W + 16;
              const outR = TRACK_R + TRACK_HALF_W + 16;
              const s2 = new THREE.Shape();
              traceRoundedRect(s2, outHW, outHH, outR, false);
              const inHW2 = TRACK_W / 2 - TRACK_HALF_W - 8;
              const inHH2 = TRACK_H / 2 - TRACK_HALF_W - 8;
              const inR2 = Math.max(4, TRACK_R - TRACK_HALF_W - 8);
              const h2 = new THREE.Path();
              traceRoundedRect(h2, inHW2, inHH2, inR2, true);
              s2.holes.push(h2);
              return s2;
            })(),
            32,
          ]}
        />
        <meshLambertMaterial color="#555555" />
      </mesh>

      {/* Infield grass */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.03, 0]}
        receiveShadow
      >
        <shapeGeometry args={[infieldShape, 64]} />
        <meshLambertMaterial color="#4a7c2f" />
      </mesh>

      {/* Center line dashes - visual only, few boxes along the track */}
      {Array.from({ length: 20 }, (_, i) => {
        const t = (i / 20) * Math.PI * 2;
        const cosA = Math.cos(t);
        const sinA = Math.sin(t);
        const hw2 = TRACK_W / 2 - TRACK_R;
        const hh2 = TRACK_H / 2 - TRACK_R;
        let px: number;
        let py: number;
        if (Math.abs(cosA * 9999) > hw2 && Math.abs(sinA * 9999) > hh2) {
          const cx = (cosA > 0 ? 1 : -1) * hw2;
          const cy = (sinA > 0 ? 1 : -1) * hh2;
          const aa = Math.atan2(sinA * 9999 - cy, cosA * 9999 - cx);
          px = TRACK_CX + cx + Math.cos(aa) * TRACK_R;
          py = TRACK_CY + cy + Math.sin(aa) * TRACK_R;
        } else if (Math.abs(cosA * 9999) > hw2) {
          px = TRACK_CX + (cosA > 0 ? 1 : -1) * (hw2 + TRACK_R);
          py = TRACK_CY + Math.max(-hh2, Math.min(hh2, sinA * 9999));
        } else {
          px = TRACK_CX + Math.max(-hw2, Math.min(hw2, cosA * 9999));
          py = TRACK_CY + (sinA > 0 ? 1 : -1) * (hh2 + TRACK_R);
        }
        return (
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: static geometry
            key={`dash-${i}`}
            rotation={[-Math.PI / 2, 0, -t + Math.PI / 2]}
            position={[toWX(px), 0.1, toWZ(py)]}
          >
            <planeGeometry args={[22, 3]} />
            <meshBasicMaterial
              color="rgba(255,255,255,0.25)"
              transparent
              opacity={0.3}
            />
          </mesh>
        );
      })}

      {/* Finish line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, toWZ(FINISH_Y)]}>
        <planeGeometry args={[FINISH_X2 - FINISH_X1, 20]} />
        <meshBasicMaterial map={finishTex} />
      </mesh>

      {/* START text indicator (small flat plane with color) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.22, toWZ(FINISH_Y + 26)]}
      >
        <planeGeometry args={[80, 14]} />
        <meshBasicMaterial color="#F2B233" transparent opacity={0.5} />
      </mesh>

      {/* Outer kerb dots */}
      {kerbData.outer.map((k, i) => (
        <mesh // biome-ignore lint/suspicious/noArrayIndexKey: static geometry
          key={`ok${i}`}
          position={k.pos}
        >
          <sphereGeometry args={[3.8, 6, 5]} />
          <meshLambertMaterial color={k.red ? "#e53935" : "#ffffff"} />
        </mesh>
      ))}

      {/* Inner kerb dots */}
      {kerbData.inner.map((k, i) => (
        <mesh // biome-ignore lint/suspicious/noArrayIndexKey: static geometry
          key={`ik${i}`}
          position={k.pos}
        >
          <sphereGeometry args={[3.2, 6, 5]} />
          <meshLambertMaterial color={k.red ? "#e53935" : "#ffffff"} />
        </mesh>
      ))}

      {/* Trees */}
      {trees.map((pos, i) => (
        <group // biome-ignore lint/suspicious/noArrayIndexKey: static geometry
          key={`tree${i}`}
          position={pos}
        >
          {/* Trunk */}
          <mesh position={[0, 10, 0]} castShadow>
            <cylinderGeometry args={[2.5, 3.5, 20, 7]} />
            <meshLambertMaterial color="#5D4037" />
          </mesh>
          {/* Lower foliage */}
          <mesh position={[0, 27, 0]} castShadow>
            <coneGeometry args={[13, 22, 7]} />
            <meshLambertMaterial color="#2E7D32" />
          </mesh>
          {/* Upper foliage */}
          <mesh position={[0, 38, 0]} castShadow>
            <coneGeometry args={[9, 18, 7]} />
            <meshLambertMaterial color="#388E3C" />
          </mesh>
          {/* Top tip */}
          <mesh position={[0, 48, 0]}>
            <coneGeometry args={[5, 12, 6]} />
            <meshLambertMaterial color="#43A047" />
          </mesh>
        </group>
      ))}

      {/* Grandstand / bleacher (simple box) */}
      <mesh position={[toWX(350), 8, toWZ(FINISH_Y + 60)]} castShadow>
        <boxGeometry args={[80, 16, 20]} />
        <meshLambertMaterial color="#0F2E43" />
      </mesh>
      <mesh position={[toWX(350), 15, toWZ(FINISH_Y + 62)]}>
        <boxGeometry args={[76, 2, 1]} />
        <meshLambertMaterial color="#F2B233" />
      </mesh>
    </group>
  );
}

// ─── Tractor 3D Component ─────────────────────────────────────────────────
function Tractor3D({
  stateRef,
}: { stateRef: React.MutableRefObject<RaceState> }) {
  const groupRef = useRef<THREE.Group>(null);
  const flameRef = useRef<THREE.Mesh>(null);
  const wheelRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((_, delta) => {
    const s = stateRef.current;
    if (!groupRef.current) return;

    groupRef.current.position.set(toWX(s.x), 5, toWZ(s.y));
    // rotation.y: Three.js Y-rotation that makes +Z face the direction (cos(angle), 0, sin(angle))
    // forward = (sin(ry), 0, cos(ry)) in Three.js, so ry = PI/2 - angle
    groupRef.current.rotation.y = Math.PI / 2 - s.angle;

    // Wheel spin
    if (s.speed > 0.1) {
      const spin = (s.speed / MAX_SPEED) * delta * 8;
      for (const w of wheelRefs.current) {
        if (w) w.rotation.x += spin;
      }
    }

    // Boost flame
    if (flameRef.current) {
      flameRef.current.visible = s.boosting;
      if (s.boosting) {
        flameRef.current.scale.y = 0.7 + Math.random() * 0.6;
        flameRef.current.scale.x = 0.7 + Math.random() * 0.4;
      }
    }
  });

  return (
    <group
      ref={groupRef}
      position={[toWX(START_X), 5, toWZ(START_Y)]}
      rotation={[0, Math.PI / 2 - START_ANGLE, 0]}
    >
      {/* Shadow blob on ground */}
      <mesh position={[0, -4.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[13, 12]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} />
      </mesh>

      {/* Main body - yellow */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[18, 9, 28]} />
        <meshLambertMaterial color="#F2B233" />
      </mesh>
      {/* Body side detail */}
      <mesh position={[0, 2, 0]}>
        <boxGeometry args={[18.5, 3, 20]} />
        <meshLambertMaterial color="#C98A1A" />
      </mesh>

      {/* Cab - green */}
      <mesh position={[0, 12, -6]} castShadow>
        <boxGeometry args={[15, 12, 18]} />
        <meshLambertMaterial color="#2E7D32" />
      </mesh>

      {/* Front windshield - light blue tinted */}
      <mesh position={[0, 12, 5.1]}>
        <boxGeometry args={[13, 9, 0.8]} />
        <meshLambertMaterial color="#B2EBF2" transparent opacity={0.75} />
      </mesh>
      {/* Windshield frame */}
      <mesh position={[0, 12, 5.2]}>
        <boxGeometry args={[15, 11, 0.4]} />
        <meshLambertMaterial color="#1B5E20" />
      </mesh>

      {/* Rear window */}
      <mesh position={[0, 12, -15.1]}>
        <boxGeometry args={[11, 7, 0.6]} />
        <meshLambertMaterial color="#90CAF9" transparent opacity={0.6} />
      </mesh>

      {/* Roof */}
      <mesh position={[0, 18.5, -6]}>
        <boxGeometry args={[15.5, 1.5, 19]} />
        <meshLambertMaterial color="#1B5E20" />
      </mesh>

      {/* Rear left wheel (large) */}
      <mesh
        ref={(el) => {
          wheelRefs.current[0] = el;
        }}
        position={[-11.5, -1.5, -8]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[7.5, 7.5, 5.5, 16]} />
        <meshLambertMaterial color="#1a1a1a" />
      </mesh>
      {/* Rear left hub */}
      <mesh position={[-15, -1.5, -8]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[3, 3, 1, 12]} />
        <meshLambertMaterial color="#888" />
      </mesh>

      {/* Rear right wheel (large) */}
      <mesh
        ref={(el) => {
          wheelRefs.current[1] = el;
        }}
        position={[11.5, -1.5, -8]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[7.5, 7.5, 5.5, 16]} />
        <meshLambertMaterial color="#1a1a1a" />
      </mesh>
      {/* Rear right hub */}
      <mesh position={[15, -1.5, -8]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[3, 3, 1, 12]} />
        <meshLambertMaterial color="#888" />
      </mesh>

      {/* Front left wheel (small) */}
      <mesh
        ref={(el) => {
          wheelRefs.current[2] = el;
        }}
        position={[-10, -3.5, 11]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[5, 5, 4.5, 14]} />
        <meshLambertMaterial color="#1a1a1a" />
      </mesh>

      {/* Front right wheel (small) */}
      <mesh
        ref={(el) => {
          wheelRefs.current[3] = el;
        }}
        position={[10, -3.5, 11]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[5, 5, 4.5, 14]} />
        <meshLambertMaterial color="#1a1a1a" />
      </mesh>

      {/* Exhaust pipe */}
      <mesh position={[5, 20, -5]}>
        <cylinderGeometry args={[1.5, 2, 12, 8]} />
        <meshLambertMaterial color="#555" />
      </mesh>
      {/* Exhaust cap */}
      <mesh position={[5, 26.5, -5]}>
        <cylinderGeometry args={[2.5, 1.5, 2, 8]} />
        <meshLambertMaterial color="#333" />
      </mesh>

      {/* Headlights */}
      <mesh position={[-4.5, 10, 14.5]}>
        <boxGeometry args={[3.5, 2.5, 1]} />
        <meshBasicMaterial color="#FFF9C4" />
      </mesh>
      <mesh position={[4.5, 10, 14.5]}>
        <boxGeometry args={[3.5, 2.5, 1]} />
        <meshBasicMaterial color="#FFF9C4" />
      </mesh>

      {/* Headlight glow halos */}
      <mesh position={[-4.5, 10, 15]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5, 12]} />
        <meshBasicMaterial color="#FFFF88" transparent opacity={0.15} />
      </mesh>
      <mesh position={[4.5, 10, 15]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5, 12]} />
        <meshBasicMaterial color="#FFFF88" transparent opacity={0.15} />
      </mesh>

      {/* Boost flame */}
      <mesh ref={flameRef} position={[5, 34, -5]} visible={false}>
        <coneGeometry args={[3.5, 12, 7]} />
        <meshBasicMaterial color="#FF6D00" transparent opacity={0.9} />
      </mesh>
      {/* Flame inner (brighter) */}
      <mesh position={[5, 32, -5]}>
        <coneGeometry args={[2, 8, 7]} />
        <meshBasicMaterial color="#FFD600" transparent opacity={0} />
      </mesh>
    </group>
  );
}

// ─── Game Loop + Camera ───────────────────────────────────────────────────
interface GameLoopProps {
  stateRef: React.MutableRefObject<RaceState>;
  cameraMode: CameraMode;
  onUiSync: (s: RaceState) => void;
}

function GameLoop({ stateRef, cameraMode, onUiSync }: GameLoopProps) {
  const { camera } = useThree();
  const syncTimer = useRef(0);
  const camPos = useMemo(() => new THREE.Vector3(0, 420, 260), []);
  const camLook = useMemo(() => new THREE.Vector3(0, 0, 20), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpLook = useMemo(() => new THREE.Vector3(), []);
  const cameraModeRef = useRef(cameraMode);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  useFrame((_, delta) => {
    const fd = Math.min(delta * 60, 5);
    const s = stateRef.current;

    // ── Physics ──────────────────────────────────────────────────────────
    if (s.phase === "racing") {
      const maxSpd = s.boosting ? BOOST_SPEED : MAX_SPEED;
      const effectiveMax = isOnTrack(s.x, s.y) ? maxSpd : 2;

      if (s.throttle) {
        s.speed = Math.min(effectiveMax, s.speed + ACCEL * fd);
      } else if (s.braking) {
        s.speed = Math.max(0, s.speed - BRAKE_FORCE * fd);
      } else {
        s.speed = Math.max(0, s.speed - DRAG * fd);
      }
      if (s.speed > effectiveMax)
        s.speed = Math.max(effectiveMax, s.speed - 0.1 * fd);

      const steerAmt = STEER * (s.speed / MAX_SPEED) * fd;
      if (s.steerLeft) s.angle -= steerAmt;
      if (s.steerRight) s.angle += steerAmt;

      s.x += Math.cos(s.angle) * s.speed * fd;
      s.y += Math.sin(s.angle) * s.speed * fd;

      // Lap detection
      const curSign = s.y < FINISH_Y ? -1 : 1;
      if (
        s.lastCrossY === 1 &&
        curSign === -1 &&
        s.x >= FINISH_X1 &&
        s.x <= FINISH_X2
      ) {
        const lapTime = Date.now() - s.lapStartTime;
        if (s.lap > 0) {
          s.lapTimes.push(lapTime);
          if (lapTime < s.bestLap) s.bestLap = lapTime;
        }
        if (s.lapTimes.length >= TOTAL_LAPS) {
          s.phase = "finished";
          onUiSync(s);
        } else {
          s.lap = s.lapTimes.length + 1;
          s.lapStartTime = Date.now();
          onUiSync(s);
        }
      }
      s.lastCrossY = curSign;
    }

    // ── Camera ───────────────────────────────────────────────────────────
    const tx = toWX(s.x);
    const tz = toWZ(s.y);
    const mode = cameraModeRef.current;

    if (mode === 0) {
      // Fixed: bird's-eye view of whole track
      camera.position.set(0, 420, 260);
      camera.lookAt(0, 0, 20);
    } else if (mode === 1) {
      // Follow: smooth behind + above
      const dist = 115;
      tmpPos.set(
        tx - Math.cos(s.angle) * dist,
        70,
        tz - Math.sin(s.angle) * dist,
      );
      camPos.lerp(tmpPos, 0.09);
      camera.position.copy(camPos);
      tmpLook.set(tx, 8, tz);
      camLook.lerp(tmpLook, 0.12);
      camera.lookAt(camLook);
    } else {
      // Chase: low behind, facing forward
      const dist = 48;
      tmpPos.set(
        tx - Math.cos(s.angle) * dist,
        26,
        tz - Math.sin(s.angle) * dist,
      );
      camPos.lerp(tmpPos, 0.13);
      camera.position.copy(camPos);
      tmpLook.set(tx + Math.cos(s.angle) * 35, 10, tz + Math.sin(s.angle) * 35);
      camLook.lerp(tmpLook, 0.15);
      camera.lookAt(camLook);
    }

    // ── Periodic UI sync ─────────────────────────────────────────────────
    syncTimer.current += delta;
    if (syncTimer.current >= 0.1) {
      syncTimer.current = 0;
      onUiSync(s);
    }
  });

  return null;
}

// ─── Sky / Environment ────────────────────────────────────────────────────
function Sky() {
  return (
    <>
      <color attach="background" args={["#87CEEB"]} />
      <fog attach="fog" args={["#87CEEB", 700, 2200]} />
      {/* Sun disc */}
      <mesh position={[300, 280, -500]}>
        <sphereGeometry args={[28, 12, 12]} />
        <meshBasicMaterial color="#FFF8E1" />
      </mesh>
      {/* Distant hills */}
      {(
        [
          [-500, 0, -350, 90, 55],
          [-300, 0, -380, 70, 50],
          [200, 0, -360, 80, 60],
          [450, 0, -340, 65, 45],
        ] as [number, number, number, number, number][]
      ).map(([x, y, z, rx, ry], i) => (
        <mesh // biome-ignore lint/suspicious/noArrayIndexKey: static geometry
          key={`hill${i}`}
          position={[x, y, z]}
        >
          <sphereGeometry args={[Math.max(rx, ry), 8, 6]} />
          <meshLambertMaterial color="#4a7c2f" />
        </mesh>
      ))}
    </>
  );
}

// ─── Touch Button ─────────────────────────────────────────────────────────
interface TouchBtnProps {
  label: string;
  onActivate: () => void;
  onDeactivate: () => void;
  active?: boolean;
  style?: React.CSSProperties;
  dataOcid?: string;
}

function TouchBtn({
  label,
  onActivate,
  onDeactivate,
  active,
  style,
  dataOcid,
}: TouchBtnProps) {
  return (
    <button
      type="button"
      data-ocid={dataOcid}
      style={{
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: "bold",
        fontSize: "1.2rem",
        border: active
          ? "2px solid #F2B233"
          : "2px solid rgba(255,255,255,0.15)",
        background: active ? "rgba(242,178,51,0.9)" : "rgba(255,255,255,0.1)",
        color: active ? "#0F2E43" : "rgba(255,255,255,0.85)",
        boxShadow: active ? "0 0 14px rgba(242,178,51,0.5)" : "none",
        cursor: "pointer",
        transition: "background 0.07s, border-color 0.07s",
        ...style,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onActivate();
      }}
      onMouseUp={(e) => {
        e.preventDefault();
        onDeactivate();
      }}
      onMouseLeave={onDeactivate}
      onTouchStart={(e) => {
        e.preventDefault();
        onActivate();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onDeactivate();
      }}
      onTouchCancel={(e) => {
        e.preventDefault();
        onDeactivate();
      }}
    >
      {label}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────
export default function App() {
  const stateRef = useRef<RaceState>(initRace());
  const [cameraMode, setCameraMode] = useState<CameraMode>(0);
  const [uiSnap, setUiSnap] = useState<UISnap>({
    phase: "start",
    lap: 0,
    lapTime: 0,
    bestLap: Number.POSITIVE_INFINITY,
    speed: 0,
    boosting: false,
    lapTimes: [],
  });
  const [touchActive, setTouchActive] = useState({
    throttle: false,
    braking: false,
    steerLeft: false,
    steerRight: false,
    boosting: false,
  });

  const syncUI = useCallback((s: RaceState) => {
    const lapTime = s.phase === "racing" ? Date.now() - s.lapStartTime : 0;
    setUiSnap({
      phase: s.phase,
      lap: s.lap,
      lapTime,
      bestLap: s.bestLap,
      speed: s.speed,
      boosting: s.boosting,
      lapTimes: [...s.lapTimes],
    });
  }, []);

  const startRace = useCallback(() => {
    const s = initRace();
    s.phase = "racing";
    s.lap = 1;
    s.lapStartTime = Date.now();
    s.raceStartTime = Date.now();
    stateRef.current = s;
    setUiSnap({
      phase: "racing",
      lap: 1,
      lapTime: 0,
      bestLap: Number.POSITIVE_INFINITY,
      speed: 0,
      boosting: false,
      lapTimes: [],
    });
  }, []);

  const cycleCamera = useCallback(() => {
    setCameraMode((prev) => ((prev + 1) % 3) as CameraMode);
  }, []);

  // Touch handlers
  const pressThrottle = useCallback(() => {
    stateRef.current.throttle = true;
    setTouchActive((p) => ({ ...p, throttle: true }));
  }, []);
  const releaseThrottle = useCallback(() => {
    stateRef.current.throttle = false;
    setTouchActive((p) => ({ ...p, throttle: false }));
  }, []);
  const pressBraking = useCallback(() => {
    stateRef.current.braking = true;
    setTouchActive((p) => ({ ...p, braking: true }));
  }, []);
  const releaseBraking = useCallback(() => {
    stateRef.current.braking = false;
    setTouchActive((p) => ({ ...p, braking: false }));
  }, []);
  const pressLeft = useCallback(() => {
    stateRef.current.steerLeft = true;
    setTouchActive((p) => ({ ...p, steerLeft: true }));
  }, []);
  const releaseLeft = useCallback(() => {
    stateRef.current.steerLeft = false;
    setTouchActive((p) => ({ ...p, steerLeft: false }));
  }, []);
  const pressRight = useCallback(() => {
    stateRef.current.steerRight = true;
    setTouchActive((p) => ({ ...p, steerRight: true }));
  }, []);
  const releaseRight = useCallback(() => {
    stateRef.current.steerRight = false;
    setTouchActive((p) => ({ ...p, steerRight: false }));
  }, []);
  const pressBoost = useCallback(() => {
    stateRef.current.boosting = true;
    setTouchActive((p) => ({ ...p, boosting: true }));
  }, []);
  const releaseBoost = useCallback(() => {
    stateRef.current.boosting = false;
    setTouchActive((p) => ({ ...p, boosting: false }));
  }, []);

  // Keyboard
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      )
        e.preventDefault();
      if (e.key === " ") {
        if (s.phase !== "racing") startRace();
        return;
      }
      if (e.key === "c" || e.key === "C") {
        cycleCamera();
        return;
      }
      if (["ArrowUp", "w", "W"].includes(e.key)) s.throttle = true;
      if (["ArrowDown", "s", "S"].includes(e.key)) s.braking = true;
      if (["ArrowLeft", "a", "A"].includes(e.key)) s.steerLeft = true;
      if (["ArrowRight", "d", "D"].includes(e.key)) s.steerRight = true;
      if (e.key === "Shift") s.boosting = true;
    };
    const onUp = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (["ArrowUp", "w", "W"].includes(e.key)) s.throttle = false;
      if (["ArrowDown", "s", "S"].includes(e.key)) s.braking = false;
      if (["ArrowLeft", "a", "A"].includes(e.key)) s.steerLeft = false;
      if (["ArrowRight", "d", "D"].includes(e.key)) s.steerRight = false;
      if (e.key === "Shift") s.boosting = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [startRace, cycleCamera]);

  const speedKmh = Math.round((uiSnap.speed / MAX_SPEED) * 180);
  const speedPct = Math.min(100, (uiSnap.speed / BOOST_SPEED) * 100);

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "#0a1a2e",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'Bricolage Grotesque', 'Figtree', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <header
        style={{ padding: "10px 16px 0", textAlign: "center", width: "100%" }}
      >
        <h1
          style={{
            color: "#F2B233",
            fontWeight: 800,
            fontSize: "clamp(1.1rem, 3.5vw, 1.7rem)",
            textShadow: "0 2px 16px rgba(242,178,51,0.4)",
            margin: 0,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          🚜 Tractor Race 3D
        </h1>
      </header>

      {/* Game card */}
      <div
        style={{
          maxWidth: 820,
          width: "100%",
          margin: "8px auto 0",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 32px 96px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.3)",
          border: "1px solid rgba(242,178,51,0.15)",
        }}
      >
        {/* HUD bar */}
        <div
          style={{
            background: "#0F2E43",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid rgba(242,178,51,0.2)",
          }}
        >
          {/* Lap info */}
          <div
            style={{ display: "flex", flexDirection: "column", minWidth: 72 }}
          >
            <span
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
              }}
            >
              Lap
            </span>
            <span
              style={{
                fontWeight: 800,
                fontSize: "1.15rem",
                lineHeight: 1.1,
                color: "#F2B233",
                fontFamily: "'Bricolage Grotesque', system-ui",
              }}
            >
              {uiSnap.phase === "racing"
                ? `${uiSnap.lap} / ${TOTAL_LAPS}`
                : "–"}
            </span>
          </div>

          {/* Times */}
          <div style={{ display: "flex", gap: 14 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                Current
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {uiSnap.phase === "racing"
                  ? formatTime(uiSnap.lapTime)
                  : "--:--.---"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                Best
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "#66BB6A",
                }}
              >
                {formatTime(uiSnap.bestLap)}
              </span>
            </div>
          </div>

          {/* Speed + camera */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
              minWidth: 96,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {uiSnap.boosting && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    background: "#e65100",
                    color: "#fff",
                    padding: "2px 7px",
                    borderRadius: 99,
                  }}
                >
                  BOOST
                </span>
              )}
              <span
                style={{
                  fontWeight: 800,
                  fontSize: "1.05rem",
                  color: uiSnap.boosting ? "#FF7043" : "#F2B233",
                  fontFamily: "'Bricolage Grotesque', system-ui",
                }}
              >
                {speedKmh}
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.45)",
                    fontWeight: 400,
                    marginLeft: 2,
                  }}
                >
                  km/h
                </span>
              </span>
            </div>
            <div
              style={{
                width: 76,
                height: 5,
                background: "rgba(255,255,255,0.12)",
                borderRadius: 99,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${speedPct}%`,
                  height: "100%",
                  background: uiSnap.boosting ? "#FF7043" : "#F2B233",
                  borderRadius: 99,
                  transition: "width 0.1s",
                }}
              />
            </div>
            <button
              type="button"
              data-ocid="camera.toggle"
              onClick={cycleCamera}
              style={{
                fontSize: 11,
                padding: "2px 9px",
                borderRadius: 99,
                background: "rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(255,255,255,0.15)",
                cursor: "pointer",
              }}
            >
              📷 {CAMERA_LABELS[cameraMode]}
            </button>
          </div>
        </div>

        {/* 3D Canvas area */}
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "7/5",
            background: "#87CEEB",
          }}
        >
          <Canvas
            camera={{ fov: 75, near: 0.5, far: 3000, position: [0, 420, 260] }}
            style={{ width: "100%", height: "100%" }}
            gl={{ antialias: true }}
            shadows
          >
            <Sky />
            <ambientLight intensity={0.65} color="#FFF5E0" />
            <directionalLight
              position={[200, 320, 80]}
              intensity={1.3}
              color="#FFF8DC"
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
              shadow-camera-far={1500}
              shadow-camera-left={-500}
              shadow-camera-right={500}
              shadow-camera-top={400}
              shadow-camera-bottom={-400}
            />
            {/* Fill light */}
            <directionalLight
              position={[-100, 80, -200]}
              intensity={0.3}
              color="#CCE5FF"
            />

            <Track3D />
            <Tractor3D stateRef={stateRef} />
            <GameLoop
              stateRef={stateRef}
              cameraMode={cameraMode}
              onUiSync={syncUI}
            />
          </Canvas>

          {/* Start / Finish overlay */}
          {uiSnap.phase !== "racing" && (
            <div
              data-ocid="game.modal"
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") startRace();
              }}
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(5,18,35,0.88)",
                backdropFilter: "blur(3px)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 24,
              }}
              onClick={() => {
                if (uiSnap.phase !== "racing") startRace();
              }}
            >
              {uiSnap.phase === "start" ? (
                <>
                  <div
                    style={{
                      fontSize: "clamp(1.6rem,5.5vw,2.6rem)",
                      fontWeight: 800,
                      color: "#F2B233",
                      marginBottom: 16,
                      textAlign: "center",
                      textShadow: "0 0 24px rgba(242,178,51,0.4)",
                    }}
                  >
                    🚜 TRACTOR RACE 3D
                  </div>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.72)",
                      fontSize: "clamp(0.75rem,2.2vw,0.9rem)",
                      lineHeight: 2.1,
                      textAlign: "center",
                    }}
                  >
                    <div>↑ W = Gas &nbsp;|&nbsp; ↓ S = Brake</div>
                    <div>← A = Steer Left &nbsp;|&nbsp; → D = Steer Right</div>
                    <div>Shift = BOOST &nbsp;|&nbsp; C = Camera</div>
                    <div
                      style={{
                        marginTop: 4,
                        color: "rgba(255,255,255,0.45)",
                        fontSize: "0.8em",
                      }}
                    >
                      Complete {TOTAL_LAPS} laps as fast as you can!
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 22,
                      fontSize: "clamp(0.9rem,2.8vw,1.1rem)",
                      fontWeight: 700,
                      color: "#F2B233",
                      border: "2px solid #F2B233",
                      borderRadius: 99,
                      padding: "8px 28px",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Press SPACE or Tap to Start
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: "0.78rem",
                      color: "rgba(255,255,255,0.35)",
                    }}
                  >
                    📱 Touch controls available below
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      fontSize: "clamp(1.4rem,4.5vw,2.2rem)",
                      fontWeight: 800,
                      color: "#F2B233",
                      marginBottom: 12,
                      textAlign: "center",
                    }}
                  >
                    🏁 RACE COMPLETE!
                  </div>
                  <div
                    style={{
                      color: "#66BB6A",
                      fontWeight: 700,
                      fontSize: "1.05rem",
                      marginBottom: 12,
                    }}
                  >
                    Best Lap: {formatTime(uiSnap.bestLap)}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      marginBottom: 16,
                    }}
                  >
                    {uiSnap.lapTimes.map((t, i) => (
                      <div
                        key={`lap-${i + 1}-${t}`}
                        style={{
                          color:
                            t === uiSnap.bestLap
                              ? "#F2B233"
                              : "rgba(255,255,255,0.65)",
                          fontSize: "0.88rem",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        Lap {i + 1}: {formatTime(t)}
                        {t === uiSnap.bestLap ? " ⭐" : ""}
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      fontSize: "1rem",
                      fontWeight: 700,
                      color: "#F2B233",
                      border: "2px solid #F2B233",
                      borderRadius: 99,
                      padding: "8px 28px",
                    }}
                  >
                    Press SPACE or Tap to Race Again
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Touch Controls */}
        <div style={{ background: "#09192c", padding: "12px 16px 16px" }}>
          {(uiSnap.phase === "start" || uiSnap.phase === "finished") && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 10,
              }}
            >
              <button
                type="button"
                data-ocid="game.primary_button"
                onClick={startRace}
                style={{
                  padding: "10px 32px",
                  borderRadius: 99,
                  background: "#F2B233",
                  color: "#0F2E43",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontFamily: "'Bricolage Grotesque', system-ui",
                }}
              >
                {uiSnap.phase === "finished" ? "↩ Race Again" : "▶ Start Race"}
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            {/* Steer buttons */}
            <div style={{ display: "flex", gap: 8 }}>
              <TouchBtn
                label="◀"
                dataOcid="controls.toggle"
                onActivate={pressLeft}
                onDeactivate={releaseLeft}
                active={touchActive.steerLeft}
                style={{ width: 62, height: 62 }}
              />
              <TouchBtn
                label="▶"
                dataOcid="controls.toggle"
                onActivate={pressRight}
                onDeactivate={releaseRight}
                active={touchActive.steerRight}
                style={{ width: 62, height: 62 }}
              />
            </div>

            {/* Centre: boost + hint */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <TouchBtn
                label="⚡ BOOST"
                dataOcid="controls.button"
                onActivate={pressBoost}
                onDeactivate={releaseBoost}
                active={touchActive.boosting}
                style={{
                  width: "100%",
                  height: 44,
                  fontSize: "0.82rem",
                  background: touchActive.boosting
                    ? "rgba(230,81,0,0.9)"
                    : "rgba(230,81,0,0.3)",
                  border: touchActive.boosting
                    ? "2px solid #FF7043"
                    : "2px solid rgba(230,81,0,0.5)",
                  color: "#fff",
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.28)",
                  textAlign: "center",
                }}
              >
                ◀▶ Steer · ↑ Gas · ↓ Brake
              </span>
            </div>

            {/* Throttle / Brake */}
            <div style={{ display: "flex", gap: 8 }}>
              <TouchBtn
                label="▲"
                dataOcid="controls.toggle"
                onActivate={pressThrottle}
                onDeactivate={releaseThrottle}
                active={touchActive.throttle}
                style={{ width: 62, height: 62, fontSize: "1.3rem" }}
              />
              <TouchBtn
                label="▼"
                dataOcid="controls.toggle"
                onActivate={pressBraking}
                onDeactivate={releaseBraking}
                active={touchActive.braking}
                style={{
                  width: 62,
                  height: 62,
                  fontSize: "1.3rem",
                  background: touchActive.braking
                    ? "rgba(244,67,54,0.9)"
                    : "rgba(255,255,255,0.1)",
                  border: touchActive.braking
                    ? "2px solid #ef5350"
                    : "2px solid rgba(255,255,255,0.15)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ padding: "12px 16px 16px", textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", margin: 0 }}>
          © {new Date().getFullYear()}. Built with ♥ using{" "}
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "rgba(255,255,255,0.35)",
              textDecoration: "underline",
            }}
          >
            caffeine.ai
          </a>
        </p>
      </footer>
    </div>
  );
}

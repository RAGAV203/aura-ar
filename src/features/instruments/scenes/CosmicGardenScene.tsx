"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createRandom } from "@/lib/math";
import type { QualityLevel } from "@/types/instruments";
import { MAX_ORBS, type CosmicGardenModel } from "../engines/cosmicGarden";

const STAR_COUNT: Record<QualityLevel, number> = { high: 4200, balanced: 2400, battery: 1000 };
const RIBBON_POINTS: Record<QualityLevel, number> = { high: 260, balanced: 180, battery: 100 };
const DPR: Record<QualityLevel, [number, number]> = { high: [1, 2], balanced: [1, 1.5], battery: [0.75, 1] };

function createPointTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function Stars({ model, quality }: { model: CosmicGardenModel; quality: QualityLevel }) {
  const ref = useRef<THREE.Points>(null);
  const density = model.params.starDensity ?? 0.7;
  const count = Math.round(STAR_COUNT[quality] * density);
  const texture = useMemo(() => createPointTexture(), []);
  const geometry = useMemo(() => {
    const random = createRandom(model.seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    const baseHue = (model.params.hue ?? 220) / 360;
    for (let i = 0; i < count; i++) {
      // Distribute in a thick spherical shell around the garden.
      const r = 6 + random() * 26;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
      positions[i * 3 + 2] = r * Math.cos(phi);
      color.setHSL((baseHue + (random() - 0.5) * 0.25 + 1) % 1, 0.6, 0.6 + random() * 0.35);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [count, model.seed, model.params.hue]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    if (!ref.current) return;
    ref.current.rotation.y = model.phase * 0.15;
    ref.current.rotation.x = Math.sin(model.phase * 0.07) * 0.1;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        map={texture}
        size={0.22}
        sizeAttenuation
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Orbs({ model }: { model: CosmicGardenModel }) {
  const cores = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const version = useRef(-1);
  const temp = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const parentQuat = useMemo(() => new THREE.Quaternion(), []);
  const glow = useMemo(() => createPointTexture(), []);
  useEffect(() => () => glow.dispose(), [glow]);

  useFrame((state) => {
    const coreMesh = cores.current;
    const haloMesh = halos.current;
    if (!coreMesh || !haloMesh) return;
    const orbs = model.orbs;
    const changed = version.current !== model.orbsVersion;
    version.current = model.orbsVersion;
    coreMesh.count = orbs.length;
    haloMesh.count = orbs.length;
    // Halos are camera-facing quads: undo the garden's rotation, then face the camera.
    haloMesh.parent?.getWorldQuaternion(parentQuat);
    parentQuat.invert().multiply(state.camera.quaternion);
    for (let i = 0; i < orbs.length; i++) {
      const orb = orbs[i];
      if (!orb) continue;
      const breathe = 1 + Math.sin(model.time * 1.3 + i * 1.7) * 0.12 + model.pulse * 0.6;
      temp.position.set(orb.x, orb.y + Math.sin(model.time * 0.6 + i) * 0.15, orb.z);
      temp.quaternion.identity();
      temp.scale.setScalar(orb.size * breathe);
      temp.updateMatrix();
      coreMesh.setMatrixAt(i, temp.matrix);
      temp.quaternion.copy(parentQuat);
      temp.scale.setScalar(orb.size * breathe * 7);
      temp.updateMatrix();
      haloMesh.setMatrixAt(i, temp.matrix);
      if (changed) {
        color.setHSL(orb.hue / 360, 0.9, 0.7);
        coreMesh.setColorAt(i, color);
        color.setHSL(orb.hue / 360, 0.95, 0.6);
        haloMesh.setColorAt(i, color);
      }
    }
    coreMesh.instanceMatrix.needsUpdate = true;
    haloMesh.instanceMatrix.needsUpdate = true;
    if (changed) {
      if (coreMesh.instanceColor) coreMesh.instanceColor.needsUpdate = true;
      if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={cores} args={[undefined, undefined, MAX_ORBS]} frustumCulled={false}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={halos} args={[undefined, undefined, MAX_ORBS]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={glow} transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function Ribbons({ model, quality }: { model: CosmicGardenModel; quality: QualityLevel }) {
  const count = RIBBON_POINTS[quality];
  const lines = useMemo(() => {
    return [0, 1, 2].map((i) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geometry, material);
      line.userData.index = i;
      return line;
    });
  }, [count]);

  useEffect(
    () => () =>
      lines.forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }),
    [lines],
  );

  useFrame(() => {
    const baseHue = (model.params.hue ?? 220) / 360;
    lines.forEach((line, k) => {
      const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attr.array as Float32Array;
      const p = model.phase + k * 2.1;
      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1)) * Math.PI * 2;
        const radius = 2.6 + k * 0.7 + Math.sin(t * 3 + p) * 0.5;
        array[i * 3] = Math.cos(t + p * 0.3) * radius;
        array[i * 3 + 1] = Math.sin(t * 2 + p) * (0.8 + k * 0.3);
        array[i * 3 + 2] = Math.sin(t + p * 0.3) * radius;
      }
      attr.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).color.setHSL((baseHue + k * 0.08) % 1, 0.85, 0.6 + model.pulse * 0.2);
    });
  });

  return (
    <>
      {lines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </>
  );
}

function Garden({ model, quality }: { model: CosmicGardenModel; quality: QualityLevel }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (group.current) {
      group.current.rotation.y = model.yaw;
      group.current.rotation.x = model.pitch * 0.6;
      group.current.scale.setScalar(model.scale);
    }
    state.camera.position.y = -model.pitch * 1.5;
    state.camera.lookAt(0, 0, 0);
  });

  return (
    <group ref={group}>
      <Stars model={model} quality={quality} />
      <Ribbons model={model} quality={quality} />
      <Orbs model={model} />
    </group>
  );
}

/** Clear to the page colour, or to transparent when the camera shows behind the scene. */
function Background({ transparent }: { transparent: boolean }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    gl.setClearColor("#080914", transparent ? 0 : 1);
    invalidate();
  }, [gl, transparent, invalidate]);
  // Fog fades distant stars into the page colour; over the camera it would tint them navy.
  return transparent ? null : <fog attach="fog" args={["#080914", 14, 40]} />;
}

/** Exposes R3F's invalidate() so the shared studio loop can drive frames. */
function FrameBridge({ onReady }: { onReady: (invalidate: () => void, canvas: HTMLCanvasElement) => void }) {
  const { invalidate, gl } = useThree();
  useEffect(() => onReady(invalidate, gl.domElement), [invalidate, gl, onReady]);
  return null;
}

export interface CosmicGardenSceneProps {
  model: CosmicGardenModel;
  quality: QualityLevel;
  transparent?: boolean;
  onReady: (invalidate: () => void, canvas: HTMLCanvasElement) => void;
  onContextLost: () => void;
  className?: string;
}

export default function CosmicGardenScene({ model, quality, transparent = false, onReady, onContextLost, className }: CosmicGardenSceneProps) {
  return (
    <Canvas
      className={className}
      frameloop="demand"
      dpr={DPR[quality]}
      camera={{ position: [0, 0, 10], fov: 55, near: 0.1, far: 100 }}
      gl={{ antialias: quality !== "battery", preserveDrawingBuffer: true, powerPreference: quality === "battery" ? "low-power" : "high-performance", alpha: true, premultipliedAlpha: true }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          onContextLost();
        });
      }}
    >
      <Background transparent={transparent} />
      <Garden model={model} quality={quality} />
      <FrameBridge onReady={onReady} />
    </Canvas>
  );
}

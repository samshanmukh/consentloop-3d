"use client";

import { CameraControls, Html, RoundedBox, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  ScanSearch,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  Suspense,
} from "react";
import type CameraControlsImpl from "camera-controls";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  anatomyCommandEvent,
  initialAnatomyState,
  reduceAnatomyCommand,
  type AnatomyCommand,
  type AnatomyState,
  type ProcedureStage,
} from "../lib/anatomy-commands";
import {
  translateVizCommand,
  vizCapabilities,
  sceneCommandToVizCommand,
  sharedSceneCommandEvent,
  vizCommandEvent,
  vizResultEvent,
  type VizCommandV1,
  type VizResultV1,
} from "../lib/viz-contract";
import type { SceneCommand } from "@consentloop/shared";

const stageLabels: Record<ProcedureStage, string> = {
  overview: "Whole-body orientation",
  tear: "Meniscus tear",
  scope: "Arthroscope path",
  treatment: "Possible treatment area",
  recovery: "Protected recovery",
};

const RIGHT_KNEE_ANCHOR = new THREE.Vector3(-0.42, -1.46, 0.08);

interface KneeViewerProps {
  compact?: boolean;
  className?: string;
  onStateChange?: (state: AnatomyState) => void;
}

function BoneMaterial({ opacity = 1 }: { opacity?: number }) {
  return (
    <meshPhysicalMaterial
      color="#f4eee5"
      roughness={0.28}
      metalness={0.02}
      clearcoat={0.35}
      clearcoatRoughness={0.28}
      transparent={opacity < 1}
      opacity={opacity}
    />
  );
}

function SoftTissueMaterial({ highlighted = false }: { highlighted?: boolean }) {
  return (
    <meshPhysicalMaterial
      color={highlighted ? "#ff4f62" : "#c64154"}
      roughness={0.42}
      clearcoat={0.24}
      emissive={highlighted ? "#ff1f44" : "#270008"}
      emissiveIntensity={highlighted ? 0.7 : 0.08}
    />
  );
}

function CameraDirector({
  controls,
  state,
  reducedMotion,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  state: AnatomyState;
  reducedMotion: boolean;
}) {
  useEffect(() => {
    const instance = controls.current;
    if (!instance) return;

    const isBody = state.viewMode === "body";
    const target = isBody ? new THREE.Vector3(0, 0, 0) : RIGHT_KNEE_ANCHOR;
    const distance = (isBody ? 10.8 : 3.65) / state.zoom;
    const height = isBody ? 0.16 : 0.06;
    const position = new THREE.Vector3(
      target.x + Math.sin(state.rotation) * distance,
      target.y + height,
      target.z + Math.cos(state.rotation) * distance,
    );

    void instance.setLookAt(
      position.x,
      position.y,
      position.z,
      target.x,
      target.y,
      target.z,
      !reducedMotion,
    );
  }, [controls, reducedMotion, state.rotation, state.viewMode, state.zoom]);

  useFrame((_, delta) => {
    if (state.autoRotate && !reducedMotion) {
      void controls.current?.rotate(delta * 0.18, 0, false);
    }
  });

  return null;
}

function BodyLoadingModel() {
  return (
    <group aria-label="Loading full-body anatomy">
      <mesh position={[0, 2.55, 0]}>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshPhysicalMaterial color="#d86c76" transparent opacity={0.42} />
      </mesh>
      <mesh position={[0, 0.7, 0]} scale={[1.4, 1, 0.62]}>
        <capsuleGeometry args={[0.5, 2.25, 12, 24]} />
        <meshPhysicalMaterial color="#cc5261" transparent opacity={0.38} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.94, 0.7, 0]} rotation={[0, 0, side * -0.08]}>
            <capsuleGeometry args={[0.18, 2.7, 10, 18]} />
            <meshPhysicalMaterial color="#d45b68" transparent opacity={0.4} />
          </mesh>
          <mesh position={[side * 0.38, -1.78, 0]}>
            <capsuleGeometry args={[0.25, 2.45, 10, 18]} />
            <meshPhysicalMaterial color="#c94555" transparent opacity={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function FullBodyModel({
  state,
  onFocusKnee,
}: {
  state: AnatomyState;
  onFocusKnee: () => void;
}) {
  const { scene } = useGLTF("/models/body/anatomy.glb", "/draco-gltf/");
  const bodyGeometry = useMemo(() => {
    scene.updateMatrixWorld(true);
    const geometries: THREE.BufferGeometry[] = [];

    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      Object.keys(geometry.attributes).forEach((attribute) => {
        if (attribute !== "position" && attribute !== "normal") {
          geometry.deleteAttribute(attribute);
        }
      });
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
      geometries.push(geometry);
    });

    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) return new THREE.SphereGeometry(0.01);

    merged.rotateX(-Math.PI / 2);
    merged.computeBoundingBox();
    const box = merged.boundingBox ?? new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const normalizer = 6.2 / Math.max(size.y, 0.001);
    merged.translate(-center.x, -center.y, -center.z);
    merged.scale(normalizer, normalizer, normalizer);
    merged.computeBoundingSphere();
    return merged;
  }, [scene]);

  useEffect(
    () => () => {
      bodyGeometry.dispose();
    },
    [bodyGeometry],
  );

  return (
    <group>
      <mesh geometry={bodyGeometry}>
        <meshPhysicalMaterial
          color="#cf4052"
          roughness={0.5}
          metalness={0}
          clearcoat={0.24}
          clearcoatRoughness={0.42}
          emissive="#34030b"
          emissiveIntensity={0.16}
          side={THREE.DoubleSide}
          transparent
          opacity={state.viewMode === "body" ? 0.98 : 0.1}
          depthWrite={state.viewMode === "body"}
        />
      </mesh>
      <mesh position={RIGHT_KNEE_ANCHOR.toArray()}>
        <sphereGeometry args={[0.17, 28, 28]} />
        <meshPhysicalMaterial
          color="#ff7b87"
          emissive="#ff2446"
          emissiveIntensity={state.viewMode === "body" ? 1.8 : 0.45}
          transparent
          opacity={state.viewMode === "body" ? 0.66 : 0.18}
        />
      </mesh>
      <mesh position={RIGHT_KNEE_ANCHOR.toArray()}>
        <torusGeometry args={[0.29, 0.025, 14, 72]} />
        <meshBasicMaterial color="#ffd7db" transparent opacity={0.9} />
      </mesh>
      {state.viewMode === "body" && (
        <Html position={RIGHT_KNEE_ANCHOR.toArray()} center distanceFactor={7.5}>
          <button
            type="button"
            className="body-knee-hotspot"
            onClick={onFocusKnee}
            aria-label="Zoom into the right knee"
          >
            <span className="body-knee-hotspot-ring" aria-hidden="true" />
            <span className="body-knee-hotspot-card">
              <strong>Right knee</strong>
              <small>Meniscus tear · explore</small>
            </span>
          </button>
        </Html>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.14, 0]}>
        <ringGeometry args={[1.05, 1.08, 96]} />
        <meshBasicMaterial color="#7fb6eb" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function getAnatomyCategory(object: THREE.Object3D) {
  const path: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current) {
    path.push(current.name.toLowerCase());
    current = current.parent;
  }
  const name = path.join(" / ");

  if (name.includes("meniscus")) return "meniscus";
  if (
    name.includes("cruciate ligament") ||
    name.includes("collateral ligament") ||
    name.includes("collatertal ligament") ||
    name.includes("patellar ligament") ||
    name.includes("quadriceps common tendon")
  ) return "ligament";
  if (name.includes("cartilage")) return "cartilage";
  if (
    name.includes("femur.r") ||
    name.includes("tibia.r") ||
    name.includes("fibula.r") ||
    name.includes("patella.r")
  ) return "bone";
  return "other";
}

function DetailedKneeModel({ state }: { state: AnatomyState }) {
  const { scene } = useGLTF("/models/knee/anatomy.glb", "/draco-gltf/");
  const group = useRef<THREE.Group>(null);
  const scope = useRef<THREE.Group>(null);

  const model = useMemo(() => {
    const clone = scene.clone(true);

    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const category = getAnatomyCategory(object);
      object.visible = category !== "other";
      object.castShadow = false;
      object.receiveShadow = false;

      const sourceMaterial = Array.isArray(object.material)
        ? object.material[0]
        : object.material;
      const material = new THREE.MeshPhysicalMaterial({
        color:
          category === "bone"
            ? "#f1e7da"
            : category === "meniscus"
              ? "#d64a5b"
              : category === "cartilage"
                ? "#63c7e8"
                : "#e7b8a3",
        roughness: category === "bone" ? 0.36 : 0.52,
        metalness: 0,
        clearcoat: category === "bone" ? 0.22 : 0.12,
        transparent: category === "cartilage",
        opacity: category === "cartilage" ? 0.46 : 1,
        side: THREE.DoubleSide,
        name: `${sourceMaterial?.name ?? "material"}-${category}`,
      });
      material.userData.anatomyCategory = category;
      object.material = material;
    });

    clone.updateMatrixWorld(true);
    const box = new THREE.Box3();
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) {
        box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      }
    });
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const normalizer = 4.7 / Math.max(size.y, size.x, size.z, 0.001);
    clone.scale.setScalar(normalizer);
    clone.position.set(
      -center.x * normalizer,
      -center.y * normalizer,
      -center.z * normalizer,
    );
    clone.rotation.set(0.04, -0.18, 0);
    return clone;
  }, [scene]);

  useEffect(() => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = Array.isArray(object.material)
        ? object.material[0]
        : object.material;
      if (!(material instanceof THREE.MeshPhysicalMaterial)) return;
      const category = material.userData.anatomyCategory as string;
      const meniscusFocus =
        state.target === "meniscus" ||
        state.target === "tear" ||
        state.stage === "tear" ||
        state.stage === "treatment";
      const ligamentFocus = state.target === "ligaments";
      const dimContext = meniscusFocus || ligamentFocus;
      const highlighted =
        (meniscusFocus && category === "meniscus") ||
        (ligamentFocus && category === "ligament");

      material.transparent = category === "cartilage" || dimContext;
      material.opacity =
        category === "cartilage"
          ? meniscusFocus ? 0.12 : 0.42
          : dimContext && !highlighted
            ? 0.2
            : 1;
      material.emissive.set(
        highlighted
          ? category === "meniscus" ? "#6e0718" : "#005dcf"
          : "#000000",
      );
      material.emissiveIntensity = highlighted ? 0.7 : 0;
      material.needsUpdate = true;
    });
  }, [model, state.stage, state.target]);

  useFrame((clock, delta) => {
    if (!group.current) return;
    const autoMotion = state.autoRotate ? clock.clock.elapsedTime * 0.2 : 0;
    group.current.rotation.y = THREE.MathUtils.damp(
      group.current.rotation.y,
      state.rotation + autoMotion,
      4,
      delta,
    );
    const focusScale =
      state.target === "tear" || state.target === "meniscus" ? 1.13 : 1;
    const nextScale = THREE.MathUtils.damp(
      group.current.scale.x,
      focusScale,
      4,
      delta,
    );
    group.current.scale.setScalar(nextScale);

    if (scope.current) {
      const visible = state.stage === "scope" || state.stage === "treatment";
      scope.current.scale.setScalar(
        THREE.MathUtils.damp(scope.current.scale.x, visible ? 1 : 0.001, 6, delta),
      );
      scope.current.position.x = THREE.MathUtils.damp(
        scope.current.position.x,
        visible ? 0.85 : 2.25,
        4,
        delta,
      );
    }
  });

  return (
    <group ref={group} position={[0, -0.08, 0]}>
      <primitive object={model} />
      <mesh position={[-0.42, -0.08, 0.53]}>
        <sphereGeometry args={[0.105, 24, 24]} />
        <meshStandardMaterial
          color="#ff3451"
          emissive="#ff173d"
          emissiveIntensity={state.stage === "tear" || state.target === "tear" ? 2.4 : 0.35}
          transparent
          opacity={state.stage === "overview" ? 0.38 : 0.96}
        />
      </mesh>
      <group ref={scope} position={[2.25, -0.04, 0.84]} rotation={[0, 0, Math.PI / 2]} scale={0.001}>
        <mesh>
          <cylinderGeometry args={[0.055, 0.055, 2.2, 24]} />
          <meshPhysicalMaterial color="#daeaf5" metalness={0.82} roughness={0.15} />
        </mesh>
        <mesh position={[0, -1.08, 0]}>
          <sphereGeometry args={[0.1, 22, 22]} />
          <meshStandardMaterial color="#00baff" emissive="#0077ff" emissiveIntensity={2.2} />
        </mesh>
      </group>
      {(state.target === "tear" || state.stage === "tear") && (
        <Html position={[-0.52, 0.05, 0.72]} center distanceFactor={7}>
          <div className="anatomy-label anatomy-label-danger"><span />Damaged meniscus</div>
        </Html>
      )}
      {(state.stage === "scope" || state.target === "portals") && (
        <Html position={[1.0, 0.12, 0.92]} center distanceFactor={7}>
          <div className="anatomy-label anatomy-label-blue"><span />Camera portal</div>
        </Html>
      )}
    </group>
  );
}

function KneeModel({ state }: { state: AnatomyState }) {
  const group = useRef<THREE.Group>(null);
  const scope = useRef<THREE.Group>(null);
  const tearPulse = useRef<THREE.Mesh>(null);
  const targetScale =
    state.target === "tear" || state.target === "meniscus" ? 1.2 : 1;

  useFrame((clock, delta) => {
    if (!group.current) return;
    const autoMotion = state.autoRotate ? clock.clock.elapsedTime * 0.22 : 0;
    group.current.rotation.y = THREE.MathUtils.damp(
      group.current.rotation.y,
      state.rotation + autoMotion,
      4,
      delta,
    );
    const scale = THREE.MathUtils.damp(
      group.current.scale.x,
      targetScale,
      4,
      delta,
    );
    group.current.scale.setScalar(scale);

    if (scope.current) {
      const visible = state.stage === "scope" || state.stage === "treatment";
      scope.current.scale.setScalar(
        THREE.MathUtils.damp(scope.current.scale.x, visible ? 1 : 0.001, 6, delta),
      );
      scope.current.position.x = THREE.MathUtils.damp(
        scope.current.position.x,
        visible ? 0.75 : 2.2,
        4,
        delta,
      );
    }

    if (tearPulse.current) {
      const pulse = 1 + Math.sin(clock.clock.elapsedTime * 4) * 0.14;
      tearPulse.current.scale.setScalar(pulse);
    }
  });

  const meniscusHighlighted =
    state.target === "meniscus" ||
    state.target === "tear" ||
    state.stage === "tear" ||
    state.stage === "treatment";
  const ligamentsHighlighted = state.target === "ligaments";
  const showRecovery = state.stage === "recovery";

  return (
    <group ref={group} position={[0, 0.2, 0]} rotation={[0.08, -0.18, -0.04]}>
      <group aria-label="Femur">
        <RoundedBox args={[1.22, 2.7, 1.05]} radius={0.48} position={[0, 1.72, 0]}>
          <BoneMaterial opacity={showRecovery ? 0.62 : 0.97} />
        </RoundedBox>
        <mesh position={[-0.52, 0.28, 0.02]} scale={[0.68, 0.62, 0.77]}>
          <sphereGeometry args={[0.72, 48, 48]} />
          <BoneMaterial />
        </mesh>
        <mesh position={[0.52, 0.28, 0.02]} scale={[0.68, 0.62, 0.77]}>
          <sphereGeometry args={[0.72, 48, 48]} />
          <BoneMaterial />
        </mesh>
      </group>

      <group aria-label="Tibia and fibula">
        <RoundedBox args={[1.85, 0.48, 1.18]} radius={0.2} position={[0, -0.56, 0]}>
          <BoneMaterial />
        </RoundedBox>
        <RoundedBox args={[1.12, 2.7, 0.9]} radius={0.38} position={[-0.08, -2.02, -0.02]}>
          <BoneMaterial opacity={showRecovery ? 0.68 : 0.96} />
        </RoundedBox>
        <mesh position={[0.94, -1.84, -0.12]} rotation={[0, 0, -0.06]}>
          <cylinderGeometry args={[0.22, 0.18, 2.65, 32]} />
          <BoneMaterial opacity={0.92} />
        </mesh>
      </group>

      <group aria-label="Articular cartilage">
        <mesh position={[0, -0.27, 0]} scale={[1.02, 0.12, 0.66]}>
          <cylinderGeometry args={[0.9, 0.9, 0.28, 64]} />
          <meshPhysicalMaterial
            color="#69d4ef"
            transparent
            opacity={0.34}
            transmission={0.42}
            roughness={0.16}
          />
        </mesh>
      </group>

      <group aria-label="Meniscus">
        <mesh position={[-0.48, -0.29, 0.02]} rotation={[Math.PI / 2, 0, 0.06]} scale={[0.7, 0.52, 0.72]}>
          <torusGeometry args={[0.48, 0.115, 20, 72, Math.PI * 1.78]} />
          <SoftTissueMaterial highlighted={meniscusHighlighted} />
        </mesh>
        <mesh position={[0.48, -0.29, 0.02]} rotation={[Math.PI / 2, 0, Math.PI + 0.06]} scale={[0.7, 0.52, 0.72]}>
          <torusGeometry args={[0.48, 0.115, 20, 72, Math.PI * 1.78]} />
          <SoftTissueMaterial highlighted={meniscusHighlighted} />
        </mesh>
      </group>

      <group aria-label="Cruciate ligaments">
        <mesh position={[-0.12, -0.01, 0.03]} rotation={[0.46, 0.12, -0.3]}>
          <cylinderGeometry args={[0.075, 0.075, 1.3, 24]} />
          <meshPhysicalMaterial
            color={ligamentsHighlighted ? "#34b7ff" : "#ecd5bd"}
            emissive={ligamentsHighlighted ? "#0069ff" : "#000000"}
            emissiveIntensity={ligamentsHighlighted ? 0.5 : 0}
            roughness={0.65}
          />
        </mesh>
        <mesh position={[0.15, -0.02, -0.02]} rotation={[-0.45, -0.08, 0.28]}>
          <cylinderGeometry args={[0.07, 0.07, 1.25, 24]} />
          <meshPhysicalMaterial
            color={ligamentsHighlighted ? "#34b7ff" : "#e5c8ac"}
            emissive={ligamentsHighlighted ? "#0069ff" : "#000000"}
            emissiveIntensity={ligamentsHighlighted ? 0.5 : 0}
            roughness={0.68}
          />
        </mesh>
      </group>

      <mesh position={[0, -0.04, 0.9]} scale={[0.46, 0.72, 0.22]}>
        <sphereGeometry args={[0.72, 48, 48]} />
        <BoneMaterial opacity={0.92} />
      </mesh>

      <mesh ref={tearPulse} position={[-0.69, -0.27, 0.46]}>
        <sphereGeometry args={[0.13, 28, 28]} />
        <meshPhysicalMaterial
          color="#ff334f"
          emissive="#ff163d"
          emissiveIntensity={state.stage === "tear" || state.target === "tear" ? 2.4 : 0.45}
          transparent
          opacity={state.stage === "overview" ? 0.38 : 0.95}
        />
      </mesh>

      <group ref={scope} position={[2.2, -0.12, 0.96]} rotation={[0, 0, Math.PI / 2]} scale={0.001}>
        <mesh>
          <cylinderGeometry args={[0.075, 0.075, 2.4, 28]} />
          <meshPhysicalMaterial color="#d8e8f4" metalness={0.78} roughness={0.18} />
        </mesh>
        <mesh position={[0, -1.18, 0]}>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshStandardMaterial color="#00baff" emissive="#0077ff" emissiveIntensity={2} />
        </mesh>
      </group>

      {showRecovery && (
        <group aria-label="Recovery protection">
          <mesh position={[0, -0.72, 0]}>
            <torusGeometry args={[1.2, 0.055, 12, 96]} />
            <meshStandardMaterial color="#0878ff" emissive="#0878ff" emissiveIntensity={0.75} />
          </mesh>
          <mesh position={[0, -1.28, 0]}>
            <torusGeometry args={[1.1, 0.045, 12, 96]} />
            <meshStandardMaterial color="#66b5ff" />
          </mesh>
        </group>
      )}

      {(state.target === "tear" || state.stage === "tear") && (
        <Html position={[-0.8, -0.14, 0.62]} center distanceFactor={7}>
          <div className="anatomy-label anatomy-label-danger">
            <span />
            Damaged meniscus
          </div>
        </Html>
      )}
      {state.target === "ligaments" && (
        <Html position={[0.16, 0.18, 0.3]} center distanceFactor={7}>
          <div className="anatomy-label">
            <span />
            ACL &amp; PCL
          </div>
        </Html>
      )}
      {(state.stage === "scope" || state.target === "portals") && (
        <Html position={[1.16, 0.1, 1]} center distanceFactor={7}>
          <div className="anatomy-label anatomy-label-blue">
            <span />
            Camera portal
          </div>
        </Html>
      )}
    </group>
  );
}

function Scene({
  state,
  reducedMotion,
  onFocusKnee,
}: {
  state: AnatomyState;
  reducedMotion: boolean;
  onFocusKnee: () => void;
}) {
  const controls = useRef<CameraControlsImpl | null>(null);
  const lights = useMemo(
    () => ({ key: new THREE.Color("#d6ecff"), fill: new THREE.Color("#ffdee2") }),
    [],
  );

  return (
    <>
      <ambientLight intensity={1.7} />
      <directionalLight position={[4, 7, 6]} intensity={3.4} color={lights.key} />
      <directionalLight position={[-5, 2, 4]} intensity={2.5} color={lights.fill} />
      <pointLight position={[0, -2, 5]} intensity={1.4} color="#42a8ff" />
      <Suspense fallback={<BodyLoadingModel />}>
        <FullBodyModel state={state} onFocusKnee={onFocusKnee} />
      </Suspense>

      {state.viewMode === "knee" && (
        <group position={RIGHT_KNEE_ANCHOR.toArray()} scale={0.42}>
          <Suspense fallback={<KneeModel state={state} />}>
            <DetailedKneeModel state={state} />
          </Suspense>
        </group>
      )}

      <CameraControls
        ref={controls}
        makeDefault
        minDistance={2.1}
        maxDistance={14}
        minPolarAngle={Math.PI * 0.12}
        maxPolarAngle={Math.PI * 0.88}
        dollyToCursor
        smoothTime={reducedMotion ? 0.01 : 0.55}
        draggingSmoothTime={reducedMotion ? 0.01 : 0.12}
      />
      <CameraDirector controls={controls} state={state} reducedMotion={reducedMotion} />
    </>
  );
}

export function KneeViewer({
  compact = false,
  className = "",
  onStateChange,
}: KneeViewerProps) {
  const [state, dispatch] = useReducer(reduceAnatomyCommand, initialAnatomyState);
  const [reducedMotion, setReducedMotion] = useState(false);
  const stateRef = useRef(state);
  const sectionRef = useRef<HTMLElement>(null);
  const revisionRef = useRef(0);
  const processedCommands = useRef(new Set<string>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const execute = useCallback((command: AnatomyCommand) => {
    dispatch(command);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void sectionRef.current?.requestFullscreen();
  }, []);

  const executeViz = useCallback(
    async (command: VizCommandV1): Promise<VizResultV1> => {
      if (
        !command?.id ||
        command.schema !== "consentloop.viz-command.v1"
      ) {
        return {
          schema: "consentloop.viz-result.v1",
          commandId: command?.id ?? "unknown",
          status: "rejected",
          code: "INVALID_PAYLOAD",
          message: "The visualization command is missing a supported schema or id.",
          stateRevision: revisionRef.current,
        };
      }

      if (processedCommands.current.has(command.id)) {
        return {
          schema: "consentloop.viz-result.v1",
          commandId: command.id,
          status: "superseded",
          message: "This visualization command was already applied.",
          stateRevision: revisionRef.current,
        };
      }

      const commands = translateVizCommand(command);
      if (!commands.length) {
        return {
          schema: "consentloop.viz-result.v1",
          commandId: command.id,
          status: "rejected",
          code: "UNSUPPORTED_ACTION",
          message: "The requested visualization action is not supported by this demo.",
          stateRevision: revisionRef.current,
        };
      }

      processedCommands.current.add(command.id);
      commands.forEach(execute);
      revisionRef.current += 1;
      const result: VizResultV1 = {
        schema: "consentloop.viz-result.v1",
        commandId: command.id,
        status: "completed",
        message: `Applied ${commands.length} visualization action${commands.length === 1 ? "" : "s"}.`,
        stateRevision: revisionRef.current,
      };
      window.dispatchEvent(new CustomEvent(vizResultEvent, { detail: result }));
      return result;
    },
    [execute],
  );

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<AnatomyCommand>).detail;
      if (command?.type) execute(command);
    };
    const handleVizCommand = (event: Event) => {
      void executeViz((event as CustomEvent<VizCommandV1>).detail);
    };
    const handleSharedSceneCommand = (event: Event) => {
      const command = (event as CustomEvent<SceneCommand>).detail;
      if (command?.type) void executeViz(sceneCommandToVizCommand(command));
    };

    window.addEventListener(anatomyCommandEvent, handleCommand);
    window.addEventListener(vizCommandEvent, handleVizCommand);
    window.addEventListener(sharedSceneCommandEvent, handleSharedSceneCommand);
    window.consentLoop3D = {
      execute,
      getState: () => stateRef.current,
    };
    window.consentLoopViz = {
      execute: executeViz,
      executeSceneCommand: (command) => executeViz(sceneCommandToVizCommand(command)),
      capabilities: vizCapabilities,
    };

    return () => {
      window.removeEventListener(anatomyCommandEvent, handleCommand);
      window.removeEventListener(vizCommandEvent, handleVizCommand);
      window.removeEventListener(sharedSceneCommandEvent, handleSharedSceneCommand);
      if (window.consentLoop3D?.execute === execute) {
        delete window.consentLoop3D;
      }
      if (window.consentLoopViz?.execute === executeViz) {
        delete window.consentLoopViz;
      }
    };
  }, [execute, executeViz]);

  const stages: ProcedureStage[] = [
    "overview",
    "tear",
    "scope",
    "treatment",
    "recovery",
  ];

  return (
    <section
      ref={sectionRef}
      className={`knee-viewer ${compact ? "knee-viewer-compact" : ""} ${className}`}
      aria-label="Interactive 3D whole-body and right-knee anatomy"
    >
      <div className="viewer-ambient viewer-ambient-blue" />
      <div className="viewer-ambient viewer-ambient-coral" />
      <div className="viewer-canvas">
        <Canvas
          camera={{ position: [0, 0.16, 10.8], fov: 34 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          fallback={<div className="canvas-fallback">3D preview unavailable</div>}
        >
          <Scene
            state={state}
            reducedMotion={reducedMotion}
            onFocusKnee={() => execute({ type: "focus", target: "knee" })}
          />
        </Canvas>
      </div>

      <div className="viewer-topline">
        <div className="live-model-chip">
          <span className="live-dot" />
          Interactive model
        </div>
        <div className="viewer-stage-label" aria-live="polite">
          {state.viewMode === "body" ? "Whole body · right knee marked" : stageLabels[state.stage]}
        </div>
      </div>
      <a
        className="viewer-license"
        href="https://github.com/Poilon/carabin/tree/87cbaf4ee882b741d0fd1d6403c00ec0d23eaf83/corps-humain"
        target="_blank"
        rel="noreferrer"
      >
        BodyParts3D body + Open3D knee · CC BY-SA
      </a>

      {!compact && (
        <>
          <div className="stage-rail" aria-label="Procedure visualization stages">
            {stages.map((stage, index) => (
              <button
                key={stage}
                type="button"
                className={state.stage === stage ? "active" : ""}
                onClick={() => execute({ type: "set-stage", stage })}
                aria-pressed={state.stage === stage}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {stageLabels[stage]}
              </button>
            ))}
          </div>

          <div className="viewer-controls" aria-label="3D model controls">
            <button
              type="button"
              onClick={() => execute({ type: "rotate", direction: "left" })}
              aria-label="Rotate model left"
            >
              <RotateCcw size={17} />
            </button>
            <button
              type="button"
              onClick={() => execute({ type: "rotate", direction: "right" })}
              aria-label="Rotate model right"
            >
              <RotateCw size={17} />
            </button>
            <button
              type="button"
              onClick={() => execute({ type: "zoom", direction: "in" })}
              aria-label="Zoom in"
            >
              <ZoomIn size={17} />
            </button>
            <button
              type="button"
              onClick={() => execute({ type: "zoom", direction: "out" })}
              aria-label="Zoom out"
            >
              <ZoomOut size={17} />
            </button>
            <button
              type="button"
              className={state.autoRotate ? "active" : ""}
              onClick={() =>
                execute({ type: "set-auto-rotate", enabled: !state.autoRotate })
              }
              aria-label={state.autoRotate ? "Pause rotation" : "Play rotation"}
            >
              {state.autoRotate ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="View model full screen"
            >
              <Maximize2 size={17} />
            </button>
          </div>

          <button
            type="button"
            className="viewer-focus-cta"
            onClick={() =>
              execute({
                type: "focus",
                target: state.viewMode === "body" ? "knee" : "body",
              })
            }
          >
            <ScanSearch size={17} />
            {state.viewMode === "body" ? "Zoom to right knee" : "Back to whole body"}
          </button>
          <div className="viewer-gesture-hint">Drag to rotate · scroll or pinch to zoom</div>
        </>
      )}
    </section>
  );
}

useGLTF.preload("/models/knee/anatomy.glb", "/draco-gltf/");
useGLTF.preload("/models/body/anatomy.glb", "/draco-gltf/");

"use client";

import { CameraControls, Html, RoundedBox, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Maximize2,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  ScanSearch,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import type CameraControlsImpl from "camera-controls";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  anatomyCommandToVisualizationControls,
  anatomyCommandEvent,
  visualizationSnapshotToAnatomyState,
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
import {
  bodyRegions,
  bodyViews,
  getProcedureStep,
  type VisualizationCommand,
} from "../lib/procedure-visualization";
import {
  executeVisualizationControl,
  getExpectedVisualizationRenderCommit,
  initialVisualizationSnapshot,
  isVisualizationRenderCommitSatisfied,
  settleVisualizationState,
  visualizationCapabilities,
  type VisualizationControlCommand,
  type VisualizationRenderCommit,
  type VisualizationRejectCode,
  type VisualizationSnapshot,
} from "../lib/visualization-controller";
import type { SceneCommand } from "@consentloop/shared";

const stageLabels: Record<ProcedureStage, string> = {
  overview: "Whole-body orientation",
  tear: "Meniscus tear",
  scope: "Arthroscope path",
  treatment: "Possible treatment area",
  recovery: "Protected recovery",
};

const RIGHT_KNEE_REGION = bodyRegions["right-knee"];
const RIGHT_KNEE_ANCHOR = new THREE.Vector3(...RIGHT_KNEE_REGION.worldPosition);
type SceneLayer = VisualizationRenderCommit["layer"];
type CameraPhase = VisualizationRenderCommit["phase"];

interface KneeViewerProps {
  compact?: boolean;
  className?: string;
  onStateChange?: (state: AnatomyState) => void;
  onVisualizationStateChange?: (state: VisualizationSnapshot) => void;
}

export interface VisualizationControllerResult {
  status: "completed" | "rejected";
  code?: VisualizationRejectCode;
  message: string;
  stateRevision: number;
  snapshot: VisualizationSnapshot;
}

declare global {
  interface Window {
    consentLoopVisualization?: {
      execute: (command: VisualizationCommand) => Promise<VisualizationControllerResult>;
      getSnapshot: () => VisualizationSnapshot;
      capabilities: typeof visualizationCapabilities;
    };
  }
}

function StaticViewerFallback() {
  return (
    <div className="canvas-fallback" role="img" aria-label="Static whole-body procedure location preview">
      <div className="canvas-fallback-figure" aria-hidden="true">
        <span className="canvas-fallback-head" />
        <span className="canvas-fallback-body" />
        <span className="canvas-fallback-arm canvas-fallback-arm-left" />
        <span className="canvas-fallback-arm canvas-fallback-arm-right" />
        <span className="canvas-fallback-leg canvas-fallback-leg-left" />
        <span className="canvas-fallback-leg canvas-fallback-leg-right" />
        <span className="canvas-fallback-knee" />
      </div>
      <div>
        <strong>Right knee · educational preview</strong>
        <span>Interactive 3D is unavailable. The consent guide and procedure steps still work.</span>
      </div>
    </div>
  );
}

class ViewerErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <StaticViewerFallback /> : this.props.children;
  }
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
  phase,
  reducedMotion,
  userInteracting,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  state: VisualizationSnapshot;
  phase: "body-overview" | "body-region" | "knee-detail";
  reducedMotion: boolean;
  userInteracting: React.RefObject<boolean>;
}) {
  const isBodyOverview = phase === "body-overview";
  const isRegionFocus = phase === "body-region";
  const bodyRotation = isBodyOverview ? state.rotation : 0;
  const framingKey = `${phase}:${bodyRotation}`;
  const previousFramingKey = useRef<string | null>(null);

  useEffect(() => {
    const instance = controls.current;
    if (!instance) return;

    const target = isRegionFocus
      ? new THREE.Vector3(...RIGHT_KNEE_REGION.cameraTarget)
      : isBodyOverview
        ? new THREE.Vector3(0, 0, 0)
        : RIGHT_KNEE_ANCHOR;
    const distance = (isBodyOverview ? 10.8 : 3.65) / state.zoom;
    const focusDistance = new THREE.Vector3(...RIGHT_KNEE_REGION.cameraPosition)
      .distanceTo(new THREE.Vector3(...RIGHT_KNEE_REGION.cameraTarget));
    if (previousFramingKey.current === framingKey) {
      void instance.dollyTo(
        (isRegionFocus ? focusDistance : isBodyOverview ? 10.8 : 3.65) / state.zoom,
        !reducedMotion,
      );
      return;
    }
    previousFramingKey.current = framingKey;
    const position = isRegionFocus
      ? new THREE.Vector3(...RIGHT_KNEE_REGION.cameraPosition)
      : new THREE.Vector3(
          target.x + Math.sin(bodyRotation) * distance,
          target.y + (isBodyOverview ? 0.16 : 0.06),
          target.z + Math.cos(bodyRotation) * distance,
        );

    if (isRegionFocus) {
      position.sub(target).multiplyScalar(1 / state.zoom).add(target);
    }

    void instance.setLookAt(
      position.x,
      position.y,
      position.z,
      target.x,
      target.y,
      target.z,
      !reducedMotion,
    );
  }, [bodyRotation, controls, framingKey, isBodyOverview, isRegionFocus, reducedMotion, state.zoom]);

  useFrame((_, delta) => {
    if (isBodyOverview && state.autoRotate && !reducedMotion && !userInteracting.current) {
      void controls.current?.rotate(delta * 0.075, 0, false);
    }
  });

  return null;
}

function BodyLoadingModel() {
  return (
    <group aria-label="Loading full-body anatomy">
      <mesh position={[0, 2.55, 0]}>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshPhysicalMaterial color="#dce8f2" emissive="#8dbde5" emissiveIntensity={0.12} transparent opacity={0.58} />
      </mesh>
      <mesh position={[0, 0.7, 0]} scale={[1.4, 1, 0.62]}>
        <capsuleGeometry args={[0.5, 2.25, 12, 24]} />
        <meshPhysicalMaterial color="#d6e4ef" emissive="#8dbde5" emissiveIntensity={0.1} transparent opacity={0.54} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.94, 0.7, 0]} rotation={[0, 0, side * -0.08]}>
            <capsuleGeometry args={[0.18, 2.7, 10, 18]} />
            <meshPhysicalMaterial color="#dbe7f0" transparent opacity={0.5} />
          </mesh>
          <mesh position={[side * 0.38, -1.78, 0]}>
            <capsuleGeometry args={[0.25, 2.45, 10, 18]} />
            <meshPhysicalMaterial color="#cfdfeb" transparent opacity={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const highlightHex = {
  blue: "#2f8cff",
  orange: "#f28a3a",
  red: "#e35666",
  green: "#20a878",
} as const;

function FullBodyModel({
  state,
  reducedMotion,
  onFocusKnee,
  onReady,
}: {
  state: VisualizationSnapshot;
  reducedMotion: boolean;
  onFocusKnee: () => void;
  onReady: () => void;
}) {
  const { scene } = useGLTF("/models/body/anatomy.glb", "/draco-gltf/");
  const animatedGroup = useRef<THREE.Group>(null);
  const bodyMaterial = useRef<THREE.MeshPhysicalMaterial>(null);
  const innerMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const kneePulse = useRef<THREE.Mesh>(null);
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

  useEffect(() => {
    onReady();
  }, [onReady]);

  const regionHighlight =
    state.highlights.find((highlight) => highlight.structureId === "whole-knee") ??
    state.highlights[0];
  const regionColor = highlightHex[regionHighlight?.color ?? "blue"];
  const overviewOpacity =
    state.visualMode === "xray"
      ? 0.42
      : state.visualMode === "isolated"
        ? 0.28
        : state.visualMode === "normal"
          ? 0.76
          : 0.64;
  const bodyOpacityTarget = overviewOpacity;
  const showKneeHighlight =
    state.target !== "body" ||
    state.highlights.some(
      (highlight) => highlight.structureId === "whole-knee" && highlight.color === "green",
    );

  useFrame((clock, delta) => {
    const material = bodyMaterial.current;
    const internal = innerMaterial.current;
    if (material) {
      material.opacity = reducedMotion
        ? bodyOpacityTarget
        : THREE.MathUtils.damp(material.opacity, bodyOpacityTarget, 4.5, delta);
      material.depthWrite = material.opacity > 0.45;
    }
    if (internal) {
      const internalTarget = 0.11;
      internal.opacity = reducedMotion
        ? internalTarget
        : THREE.MathUtils.damp(internal.opacity, internalTarget, 4.5, delta);
    }
    if (animatedGroup.current) {
      const elapsed = clock.clock.elapsedTime;
      const breath = reducedMotion ? 1 : 1 + Math.sin(elapsed * 1.2) * 0.0025;
      animatedGroup.current.scale.set(breath, 1 + (breath - 1) * 0.65, breath);
      animatedGroup.current.rotation.z = reducedMotion
        ? 0
        : Math.sin(elapsed * 0.34) * 0.006;
      animatedGroup.current.position.y = reducedMotion
        ? 0
        : Math.sin(elapsed * 0.7) * 0.006;
    }
    if (kneePulse.current) {
      const pulse = reducedMotion ? 1 : 1 + Math.sin(clock.clock.elapsedTime * 2.5) * 0.1;
      kneePulse.current.scale.setScalar(pulse);
    }
  });

  return (
    <group>
      <group ref={animatedGroup}>
        <mesh geometry={bodyGeometry}>
          <meshPhysicalMaterial
            ref={bodyMaterial}
            color="#dbe5ed"
            roughness={0.34}
            metalness={0.01}
            clearcoat={0.52}
            clearcoatRoughness={0.3}
            emissive="#6f9fc8"
            emissiveIntensity={0.12}
            side={THREE.DoubleSide}
            transparent
            opacity={overviewOpacity}
            depthWrite
          />
        </mesh>
        <mesh geometry={bodyGeometry} scale={0.993}>
          <meshBasicMaterial
            ref={innerMaterial}
            color="#5983a8"
            side={THREE.BackSide}
            transparent
            opacity={0.11}
            depthWrite={false}
          />
        </mesh>
        {showKneeHighlight && (
          <>
            <mesh ref={kneePulse} position={RIGHT_KNEE_ANCHOR.toArray()}>
              <sphereGeometry args={[0.17, 28, 28]} />
              <meshPhysicalMaterial
                color={regionColor}
                emissive={regionColor}
                emissiveIntensity={1.9}
                transparent
                opacity={0.7}
                depthWrite={false}
              />
            </mesh>
            <mesh position={RIGHT_KNEE_ANCHOR.toArray()}>
              <torusGeometry args={[0.29, 0.025, 14, 72]} />
              <meshBasicMaterial color={regionColor} transparent opacity={0.82} depthWrite={false} />
            </mesh>
          </>
        )}
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
                <strong>{RIGHT_KNEE_REGION.label}</strong>
                <small>Meniscus tear · explore</small>
              </span>
            </button>
          </Html>
        )}
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.14, 0]}>
        <circleGeometry args={[1.12, 96]} />
        <meshPhysicalMaterial color="#edf7ff" transparent opacity={0.52} roughness={0.18} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.125, 0]}>
        <ringGeometry args={[1.08, 1.12, 96]} />
        <meshBasicMaterial color="#73ace0" transparent opacity={0.66} />
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

function DetailedKneeModel({
  state,
  visualization,
  reducedMotion,
  visible,
}: {
  state: AnatomyState;
  visualization: VisualizationSnapshot;
  reducedMotion: boolean;
  visible: boolean;
}) {
  const { scene } = useGLTF("/models/knee/anatomy.glb", "/draco-gltf/");
  const group = useRef<THREE.Group>(null);
  const scope = useRef<THREE.Group>(null);
  const layerOpacity = useRef(reducedMotion && visible ? 1 : 0);

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
      material.userData.renderOpacity = category === "cartilage" ? 0.46 : 1;
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
  const activeHighlight = visualization.highlights.at(-1);
  const activeColor = highlightHex[activeHighlight?.color ?? "orange"];
  const meniscusOverlayActive = Boolean(
    activeHighlight?.structureId.includes("meniscus"),
  );
  const portalOverlayActive =
    activeHighlight?.structureId === "camera-portals" ||
    activeHighlight?.structureId === "incision-risk-area";

  useEffect(
    () => () => {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    },
    [model],
  );

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
      const baseColor =
        category === "bone"
          ? "#f1e7da"
          : category === "meniscus"
            ? "#d64a5b"
            : category === "cartilage"
              ? "#63c7e8"
              : "#e7b8a3";
      const comparisonContext = visualization.comparison && category !== "meniscus";
      const modeContext = visualization.visualMode === "isolated" && !highlighted;
      const renderOpacity = visualization.comparison
        ? category === "meniscus"
          ? 1
          : 0.18
        : category === "cartilage"
          ? meniscusFocus
            ? 0.12
            : visualization.visualMode === "xray"
              ? 0.16
              : 0.42
          : (dimContext || modeContext) && !highlighted
            ? visualization.visualMode === "xray" ? 0.12 : 0.2
            : visualization.visualMode === "transparent" ? 0.58 : 1;

      material.color.set(
        visualization.comparison
          ? category === "meniscus" ? activeColor : "#d86a76"
          : highlighted && category === "meniscus" && activeHighlight
            ? activeColor
            : baseColor,
      );
      material.transparent = true;
      material.userData.renderOpacity = comparisonContext ? 0.18 : renderOpacity;
      material.emissive.set(
        highlighted
          ? category === "meniscus"
            ? activeHighlight ? activeColor : "#6e0718"
            : "#005dcf"
          : comparisonContext
            ? "#58141c"
            : "#000000",
      );
      material.emissiveIntensity = highlighted ? 0.72 : comparisonContext ? 0.12 : 0;
      material.needsUpdate = true;
    });
  }, [activeColor, activeHighlight, model, state.stage, state.target, visualization.comparison, visualization.visualMode]);

  useFrame((clock, delta) => {
    if (!group.current) return;
    const autoMotion = state.autoRotate && !reducedMotion ? clock.clock.elapsedTime * 0.12 : 0;
    group.current.rotation.y = reducedMotion
      ? state.rotation
      : THREE.MathUtils.damp(
          group.current.rotation.y,
          state.rotation + autoMotion,
          4,
          delta,
        );
    const focusScale =
      state.target === "tear" || state.target === "meniscus" ? 1.13 : 1;
    const nextScale = reducedMotion
      ? focusScale
      : THREE.MathUtils.damp(group.current.scale.x, focusScale, 4, delta);
    group.current.scale.setScalar(nextScale);

    layerOpacity.current = reducedMotion
      ? visible ? 1 : 0
      : THREE.MathUtils.damp(layerOpacity.current, visible ? 1 : 0, 4.8, delta);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      if (!(material instanceof THREE.MeshPhysicalMaterial)) return;
      const renderOpacity = Number(material.userData.renderOpacity ?? 1);
      material.opacity = renderOpacity * layerOpacity.current;
    });

    if (scope.current) {
      const visible = state.stage === "scope" || state.stage === "treatment";
      scope.current.scale.setScalar(
        reducedMotion
          ? visible ? 1 : 0.001
          : THREE.MathUtils.damp(scope.current.scale.x, visible ? 1 : 0.001, 6, delta),
      );
      scope.current.position.x = reducedMotion
        ? visible ? 0.85 : 2.25
        : THREE.MathUtils.damp(scope.current.position.x, visible ? 0.85 : 2.25, 4, delta);
    }
  });

  return (
    <group ref={group} position={[0, -0.08, 0]}>
      <primitive object={model} />
      <mesh position={[-0.42, -0.08, 0.53]}>
        <sphereGeometry args={[0.105, 24, 24]} />
        <meshStandardMaterial
          color={visualization.comparison || meniscusOverlayActive ? activeColor : "#ff3451"}
          emissive={visualization.comparison || meniscusOverlayActive ? activeColor : "#ff173d"}
          emissiveIntensity={state.stage === "tear" || state.target === "tear" ? 2.4 : 0.35}
          transparent
          opacity={visible ? state.stage === "overview" ? 0.38 : 0.96 : 0}
        />
      </mesh>
      <group ref={scope} position={[2.25, -0.04, 0.84]} rotation={[0, 0, Math.PI / 2]} scale={0.001}>
        <mesh>
          <cylinderGeometry args={[0.055, 0.055, 2.2, 24]} />
          <meshPhysicalMaterial color="#daeaf5" metalness={0.82} roughness={0.15} />
        </mesh>
        <mesh position={[0, -1.08, 0]}>
          <sphereGeometry args={[0.1, 22, 22]} />
          <meshStandardMaterial
            color={portalOverlayActive ? activeColor : "#00baff"}
            emissive={portalOverlayActive ? activeColor : "#0077ff"}
            emissiveIntensity={2.2}
          />
        </mesh>
      </group>
      {(state.target === "tear" || state.stage === "tear") && (
        <Html position={[-0.52, 0.05, 0.72]} center distanceFactor={7}>
          <div className="anatomy-label anatomy-label-danger"><span />Damaged meniscus</div>
        </Html>
      )}
      {(state.stage === "scope" || state.target === "portals") && (
        <Html position={[1.0, 0.12, 0.92]} center distanceFactor={7}>
          <div className={`anatomy-label ${activeHighlight?.color === "red" ? "anatomy-label-danger" : "anatomy-label-blue"}`}>
            <span />{activeHighlight?.structureId === "incision-risk-area" ? "Access-site risk" : "Camera portal"}
          </div>
        </Html>
      )}
    </group>
  );
}

function KneeModel({ state, reducedMotion }: { state: AnatomyState; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const scope = useRef<THREE.Group>(null);
  const tearPulse = useRef<THREE.Mesh>(null);
  const targetScale =
    state.target === "tear" || state.target === "meniscus" ? 1.2 : 1;

  useFrame((clock, delta) => {
    if (!group.current) return;
    const autoMotion = state.autoRotate && !reducedMotion ? clock.clock.elapsedTime * 0.16 : 0;
    group.current.rotation.y = reducedMotion
      ? state.rotation
      : THREE.MathUtils.damp(
          group.current.rotation.y,
          state.rotation + autoMotion,
          4,
          delta,
        );
    const scale = reducedMotion
      ? targetScale
      : THREE.MathUtils.damp(group.current.scale.x, targetScale, 4, delta);
    group.current.scale.setScalar(scale);

    if (scope.current) {
      const visible = state.stage === "scope" || state.stage === "treatment";
      scope.current.scale.setScalar(
        reducedMotion
          ? visible ? 1 : 0.001
          : THREE.MathUtils.damp(scope.current.scale.x, visible ? 1 : 0.001, 6, delta),
      );
      scope.current.position.x = reducedMotion
        ? visible ? 0.75 : 2.2
        : THREE.MathUtils.damp(scope.current.position.x, visible ? 0.75 : 2.2, 4, delta);
    }

    if (tearPulse.current) {
      const pulse = reducedMotion ? 1 : 1 + Math.sin(clock.clock.elapsedTime * 4) * 0.14;
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
  anatomyState,
  reducedMotion,
  bodyAssetReady,
  onFocusKnee,
  onBodyReady,
  onSceneCommit,
}: {
  state: VisualizationSnapshot;
  anatomyState: AnatomyState;
  reducedMotion: boolean;
  bodyAssetReady: boolean;
  onFocusKnee: () => void;
  onBodyReady: () => void;
  onSceneCommit: (commit: VisualizationRenderCommit) => void;
}) {
  const controls = useRef<CameraControlsImpl | null>(null);
  const userInteracting = useRef(false);
  const resumeIdleTimer = useRef<number | null>(null);
  const [sceneLayer, setSceneLayer] = useState<SceneLayer>(
    state.viewMode === "body" ? "body" : "knee",
  );
  const [cameraPhase, setCameraPhase] = useState<CameraPhase>(
    state.viewMode === "body"
      ? state.target === "body"
        ? "body-overview"
        : "body-region"
      : "knee-detail",
  );
  const sceneLayerRef = useRef<SceneLayer>(sceneLayer);
  const cameraPhaseRef = useRef<CameraPhase>(cameraPhase);
  const lights = useMemo(
    () => ({ key: new THREE.Color("#d8edff"), fill: new THREE.Color("#dfe9f3") }),
    [],
  );

  useEffect(() => {
    const timers: number[] = [];
    const schedule = (callback: () => void, delay: number) => {
      timers.push(window.setTimeout(callback, delay));
    };
    const showLayer = (nextLayer: SceneLayer) => {
      sceneLayerRef.current = nextLayer;
      setSceneLayer(nextLayer);
    };
    const frameCamera = (nextPhase: CameraPhase) => {
      cameraPhaseRef.current = nextPhase;
      setCameraPhase(nextPhase);
    };

    if (state.viewMode === "body") {
      if (sceneLayerRef.current !== "body") {
        // A blank handoff frame guarantees that the two anatomy models never
        // occupy the scene together, including when reduced motion is enabled.
        showLayer("handoff");
        frameCamera(state.target === "body" ? "body-overview" : "body-region");
        schedule(() => showLayer("body"), reducedMotion ? 32 : 90);
      } else if (state.visualState === "focusing-region") {
        // Hold the whole-person framing long enough for the knee pulse to be
        // noticed before moving the camera toward the region.
        frameCamera("body-overview");
        schedule(() => frameCamera("body-region"), reducedMotion ? 0 : 300);
      } else {
        frameCamera(state.target === "body" ? "body-overview" : "body-region");
      }
    } else if (sceneLayerRef.current !== "knee") {
      const needsRegionOrientation = cameraPhaseRef.current === "body-overview";
      const enteringProcedure = state.visualState === "entering-procedure";
      const highlightHoldMs = reducedMotion
        ? 0
        : needsRegionOrientation
          ? enteringProcedure ? 280 : 140
          : 0;
      const zoomHoldMs = reducedMotion ? 0 : enteringProcedure ? 560 : 300;
      const handoffGapMs = reducedMotion ? 32 : 90;

      if (needsRegionOrientation) {
        schedule(() => frameCamera("body-region"), highlightHoldMs);
      }
      schedule(
        () => frameCamera("knee-detail"),
        highlightHoldMs + (reducedMotion ? 0 : 180),
      );
      schedule(
        () => showLayer("handoff"),
        highlightHoldMs + zoomHoldMs,
      );
      schedule(
        () => showLayer("knee"),
        highlightHoldMs + zoomHoldMs + handoffGapMs,
      );
    } else {
      frameCamera("knee-detail");
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reducedMotion, state.revision, state.target, state.viewMode, state.visualState]);

  useEffect(() => {
    onSceneCommit({
      layer: sceneLayer,
      phase: cameraPhase,
      revision: state.revision,
      visualState: state.visualState,
      bodyAssetReady,
    });
  }, [bodyAssetReady, cameraPhase, onSceneCommit, sceneLayer, state.revision, state.visualState]);

  useEffect(
    () => () => {
      if (resumeIdleTimer.current !== null) window.clearTimeout(resumeIdleTimer.current);
    },
    [],
  );

  return (
    <>
      <ambientLight intensity={1.7} />
      <directionalLight position={[4, 7, 6]} intensity={3.4} color={lights.key} />
      <directionalLight position={[-5, 2, 4]} intensity={2.5} color={lights.fill} />
      <pointLight position={[0, -2, 5]} intensity={1.4} color="#42a8ff" />
      {sceneLayer === "body" && (
        <Suspense fallback={<BodyLoadingModel />}>
          <FullBodyModel
            state={state}
            reducedMotion={reducedMotion}
            onFocusKnee={onFocusKnee}
            onReady={onBodyReady}
          />
        </Suspense>
      )}

      {sceneLayer === "knee" && (
        <group position={RIGHT_KNEE_ANCHOR.toArray()} scale={0.42}>
          <Suspense fallback={<KneeModel state={anatomyState} reducedMotion={reducedMotion} />}>
            <DetailedKneeModel
              state={anatomyState}
              visualization={state}
              reducedMotion={reducedMotion}
              visible
            />
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
        onControlStart={() => {
          if (resumeIdleTimer.current !== null) window.clearTimeout(resumeIdleTimer.current);
          userInteracting.current = true;
        }}
        onControlEnd={() => {
          resumeIdleTimer.current = window.setTimeout(() => {
            userInteracting.current = false;
          }, reducedMotion ? 0 : 1_400);
        }}
      />
      <CameraDirector
        controls={controls}
        state={state}
        phase={cameraPhase}
        reducedMotion={reducedMotion}
        userInteracting={userInteracting}
      />
    </>
  );
}

export function KneeViewer({
  compact = false,
  className = "",
  onStateChange,
  onVisualizationStateChange,
}: KneeViewerProps) {
  const [state, setState] = useState<VisualizationSnapshot>(initialVisualizationSnapshot);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [bodyAssetReady, setBodyAssetReady] = useState(false);
  const stateRef = useRef(state);
  const reducedMotionRef = useRef(false);
  const mountedRef = useRef(true);
  const commandQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const renderedSceneCommitRef = useRef<VisualizationRenderCommit | null>(null);
  const sceneCommitWaitersRef = useRef<
    Array<{
      expected: VisualizationRenderCommit;
      resolve: (settled: boolean) => void;
      timeout: number;
    }>
  >([]);
  const sectionRef = useRef<HTMLElement>(null);
  const processedCommands = useRef(new Set<string>());
  const processedCommandOrder = useRef<string[]>([]);
  const anatomyState = useMemo(
    () => visualizationSnapshotToAnatomyState(state),
    [state],
  );

  const publishState = useCallback((nextState: VisualizationSnapshot) => {
    stateRef.current = nextState;
    if (mountedRef.current) setState(nextState);
  }, []);

  const reportSceneCommit = useCallback((commit: VisualizationRenderCommit) => {
    renderedSceneCommitRef.current = commit;
    const settled = sceneCommitWaitersRef.current.filter(
      (waiter) => isVisualizationRenderCommitSatisfied(commit, waiter.expected),
    );
    if (!settled.length) return;
    sceneCommitWaitersRef.current = sceneCommitWaitersRef.current.filter(
      (waiter) => !isVisualizationRenderCommitSatisfied(commit, waiter.expected),
    );
    settled.forEach((waiter) => {
      window.clearTimeout(waiter.timeout);
      waiter.resolve(true);
    });
  }, []);

  const waitForSceneCommit = useCallback(
    (expected: VisualizationRenderCommit, timeoutMs = 2_500): Promise<boolean> => {
      if (
        isVisualizationRenderCommitSatisfied(
          renderedSceneCommitRef.current,
          expected,
        )
      ) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const waiter = {
          expected,
          resolve,
          timeout: 0,
        };
        waiter.timeout = window.setTimeout(() => {
          sceneCommitWaitersRef.current = sceneCommitWaitersRef.current.filter(
            (candidate) => candidate !== waiter,
          );
          resolve(false);
        }, timeoutMs);
        sceneCommitWaitersRef.current.push(waiter);
      });
    },
    [],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sceneCommitWaitersRef.current.forEach((waiter) => {
        window.clearTimeout(waiter.timeout);
        waiter.resolve(false);
      });
      sceneCommitWaitersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = media.matches;
      setReducedMotion(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const executeVisualization = useCallback(
    (command: VisualizationControlCommand): Promise<VisualizationControllerResult> => {
      const queued = commandQueueRef.current.then(async () => {
        const execution = executeVisualizationControl(stateRef.current, command);
        if (!execution.ok) {
          return {
            status: "rejected" as const,
            code: execution.code,
            message: execution.error,
            stateRevision: stateRef.current.revision,
            snapshot: stateRef.current,
          };
        }

        publishState(execution.state);
        const transitionMs = reducedMotionRef.current ? 0 : execution.transitionMs;
        if (transitionMs > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, transitionMs));
        }
        const settledState = settleVisualizationState(stateRef.current);
        if (settledState !== stateRef.current) publishState(settledState);

        const expectedCommit = getExpectedVisualizationRenderCommit(
          stateRef.current,
        );
        const rendererSettled = await waitForSceneCommit(expectedCommit);
        if (!rendererSettled) {
          return {
            status: "rejected" as const,
            code: "TRANSITION_TIMEOUT" as const,
            message: "The anatomy scene did not finish its visual handoff.",
            stateRevision: stateRef.current.revision,
            snapshot: stateRef.current,
          };
        }

        return {
          status: "completed" as const,
          message: execution.message,
          stateRevision: stateRef.current.revision,
          snapshot: stateRef.current,
        };
      });
      commandQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [publishState, waitForSceneCommit],
  );

  const executeLegacy = useCallback(
    async (command: AnatomyCommand): Promise<VisualizationControllerResult> => {
      let result: VisualizationControllerResult = {
        status: "completed",
        message: "No visualization change was needed.",
        stateRevision: stateRef.current.revision,
        snapshot: stateRef.current,
      };
      for (const nextCommand of anatomyCommandToVisualizationControls(command)) {
        result = await executeVisualization(nextCommand);
        if (result.status === "rejected") break;
      }
      return result;
    },
    [executeVisualization],
  );
  const executeLegacyBridge = useCallback(
    (command: AnatomyCommand) => {
      void executeLegacy(command);
    },
    [executeLegacy],
  );

  const focusAndEnterKnee = useCallback(async () => {
    const focusResult = await executeVisualization({
      type: "FOCUS_BODY_REGION",
      regionId: "right-knee",
    });
    if (focusResult.status === "completed") {
      await executeVisualization({
        type: "ENTER_PROCEDURE",
        procedureId: "knee-arthroscopy",
      });
    }
  }, [executeVisualization]);

  const markBodyReady = useCallback(() => {
    setBodyAssetReady(true);
    if (stateRef.current.visualState !== "loading") return;
    publishState(settleVisualizationState(stateRef.current));
  }, [publishState]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void sectionRef.current?.requestFullscreen();
  }, []);

  const executeViz = useCallback(
    async (command: VizCommandV1): Promise<VizResultV1> => {
      const publishResult = (result: VizResultV1) => {
        window.dispatchEvent(new CustomEvent(vizResultEvent, { detail: result }));
        return result;
      };
      if (
        !command?.id ||
        command.schema !== "consentloop.viz-command.v1"
      ) {
        return publishResult({
          schema: "consentloop.viz-result.v1",
          commandId: command?.id ?? "unknown",
          status: "rejected",
          code: "INVALID_PAYLOAD",
          message: "The visualization command is missing a supported schema or id.",
          stateRevision: stateRef.current.revision,
        });
      }

      if (processedCommands.current.has(command.id)) {
        return publishResult({
          schema: "consentloop.viz-result.v1",
          commandId: command.id,
          status: "superseded",
          message: "This visualization command was already applied.",
          stateRevision: stateRef.current.revision,
        });
      }

      const commands = translateVizCommand(command);
      if (!commands.length) {
        return publishResult({
          schema: "consentloop.viz-result.v1",
          commandId: command.id,
          status: "rejected",
          code: "UNSUPPORTED_ACTION",
          message: "The requested visualization action is not supported by this demo.",
          stateRevision: stateRef.current.revision,
        });
      }

      processedCommands.current.add(command.id);
      processedCommandOrder.current.push(command.id);
      if (processedCommandOrder.current.length > 128) {
        const expired = processedCommandOrder.current.shift();
        if (expired) processedCommands.current.delete(expired);
      }
      let lastResult: VisualizationControllerResult | null = null;
      for (const legacyCommand of commands) {
        lastResult = await executeLegacy(legacyCommand);
        if (lastResult.status === "rejected") break;
      }
      if (lastResult?.status === "rejected") {
        return publishResult({
          schema: "consentloop.viz-result.v1",
          commandId: command.id,
          status: "rejected",
          code: "UNSUPPORTED_ACTION",
          message: lastResult.message,
          stateRevision: lastResult.stateRevision,
        });
      }
      const result: VizResultV1 = {
        schema: "consentloop.viz-result.v1",
        commandId: command.id,
        status: "completed",
        message: lastResult?.message ?? `Applied ${commands.length} visualization action${commands.length === 1 ? "" : "s"}.`,
        stateRevision: stateRef.current.revision,
      };
      return publishResult(result);
    },
    [executeLegacy],
  );

  useEffect(() => {
    onStateChange?.(anatomyState);
    onVisualizationStateChange?.(state);
  }, [anatomyState, onStateChange, onVisualizationStateChange, state]);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<AnatomyCommand>).detail;
      if (command?.type) void executeLegacy(command);
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
      execute: executeLegacyBridge,
      getState: () => visualizationSnapshotToAnatomyState(stateRef.current),
    };
    window.consentLoopViz = {
      execute: executeViz,
      executeSceneCommand: (command) => executeViz(sceneCommandToVizCommand(command)),
      capabilities: vizCapabilities,
    };
    window.consentLoopVisualization = {
      execute: executeVisualization,
      getSnapshot: () => stateRef.current,
      capabilities: visualizationCapabilities,
    };

    return () => {
      window.removeEventListener(anatomyCommandEvent, handleCommand);
      window.removeEventListener(vizCommandEvent, handleVizCommand);
      window.removeEventListener(sharedSceneCommandEvent, handleSharedSceneCommand);
      if (window.consentLoop3D?.execute === executeLegacyBridge) {
        delete window.consentLoop3D;
      }
      if (window.consentLoopViz?.execute === executeViz) {
        delete window.consentLoopViz;
      }
      if (window.consentLoopVisualization?.execute === executeVisualization) {
        delete window.consentLoopVisualization;
      }
    };
  }, [executeLegacy, executeLegacyBridge, executeVisualization, executeViz]);

  const stages: ProcedureStage[] = [
    "overview",
    "tear",
    "scope",
    "treatment",
    "recovery",
  ];
  const currentStep = state.procedureId && state.stepId
    ? getProcedureStep(state.procedureId, state.stepId)
    : undefined;
  const transitionLabel =
    state.visualState === "loading"
      ? "Preparing educational anatomy"
      : state.visualState === "focusing-region"
        ? "Locating the right knee"
        : state.visualState === "entering-procedure"
          ? "Moving into the knee"
          : state.visualState === "returning-to-overview"
            ? "Returning to whole-body view"
            : null;

  return (
    <section
      ref={sectionRef}
      className={`knee-viewer ${compact ? "knee-viewer-compact" : ""} ${className}`}
      aria-label="Interactive 3D whole-body and right-knee anatomy"
    >
      <div className="viewer-ambient viewer-ambient-blue" />
      <div className="viewer-ambient viewer-ambient-coral" />
      <div className="viewer-canvas">
        <ViewerErrorBoundary>
          <Canvas
            camera={{ position: [0, 0.16, 10.8], fov: 34 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            fallback={<StaticViewerFallback />}
          >
            <Scene
              state={state}
              anatomyState={anatomyState}
              reducedMotion={reducedMotion}
              bodyAssetReady={bodyAssetReady}
              onFocusKnee={() => void focusAndEnterKnee()}
              onBodyReady={markBodyReady}
              onSceneCommit={reportSceneCommit}
            />
          </Canvas>
        </ViewerErrorBoundary>
      </div>

      <div className="viewer-topline">
        <div className="live-model-chip">
          <span className="live-dot" />
          Educational model
        </div>
        <div className="viewer-stage-label" aria-live="polite">
          {currentStep?.title ?? (state.viewMode === "body" ? "Whole body · right knee marked" : stageLabels[state.stage])}
        </div>
      </div>
      {transitionLabel && (
        <div className="viewer-transition-status" role="status">
          <span className="model-loading-orb" aria-hidden="true" />
          <strong>{transitionLabel}</strong>
        </div>
      )}
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
          <div className="body-view-switcher" role="group" aria-label="Whole-body view presets">
            {bodyViews.map((view) => (
              <button
                key={view}
                type="button"
                className={state.viewMode === "body" && state.bodyView === view ? "active" : ""}
                aria-pressed={state.viewMode === "body" && state.bodyView === view}
                onClick={() => void executeVisualization({ type: "SHOW_BODY_OVERVIEW", view })}
              >
                {view === "three-quarter" ? "3/4" : view[0].toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>
          <div className="stage-rail" aria-label="Procedure visualization stages">
            {stages.map((stage, index) => (
              <button
                key={stage}
                type="button"
                className={state.stage === stage ? "active" : ""}
                onClick={() => void executeLegacy({ type: "set-stage", stage })}
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
              onClick={() => void executeLegacy({ type: "rotate", direction: "left" })}
              aria-label="Rotate model left"
            >
              <RotateCcw size={17} />
            </button>
            <button
              type="button"
              onClick={() => void executeLegacy({ type: "rotate", direction: "right" })}
              aria-label="Rotate model right"
            >
              <RotateCw size={17} />
            </button>
            <button
              type="button"
              onClick={() => void executeLegacy({ type: "zoom", direction: "in" })}
              aria-label="Zoom in"
            >
              <ZoomIn size={17} />
            </button>
            <button
              type="button"
              onClick={() => void executeLegacy({ type: "zoom", direction: "out" })}
              aria-label="Zoom out"
            >
              <ZoomOut size={17} />
            </button>
            <button
              type="button"
              className={state.autoRotate ? "active" : ""}
              onClick={() =>
                void executeLegacy({ type: "set-auto-rotate", enabled: !state.autoRotate })
              }
              aria-label={state.autoRotate ? "Pause rotation" : "Play rotation"}
            >
              {state.autoRotate ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              type="button"
              onClick={() => void executeVisualization({ type: "RESET_VISUALIZATION" })}
              aria-label="Reset visualization"
            >
              <RefreshCcw size={17} />
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
            onClick={() => {
              if (state.viewMode === "knee") {
                void executeVisualization({ type: "RETURN_TO_OVERVIEW" });
              } else if (state.target === "body") {
                void executeVisualization({ type: "FOCUS_BODY_REGION", regionId: "right-knee" });
              } else {
                void executeVisualization({ type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" });
              }
            }}
          >
            <ScanSearch size={17} />
            {state.viewMode === "knee"
              ? "Back to whole body"
              : state.target === "body"
                ? "Focus right knee"
                : "Enter knee procedure"}
          </button>
          <div className="viewer-gesture-hint">Drag to rotate · scroll or pinch to zoom</div>
        </>
      )}
    </section>
  );
}

useGLTF.preload("/models/body/anatomy.glb", "/draco-gltf/");

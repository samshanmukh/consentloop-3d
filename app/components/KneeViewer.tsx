"use client";

import { Html, OrbitControls, RoundedBox, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
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
  Suspense,
} from "react";
import * as THREE from "three";
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
  vizCommandEvent,
  vizResultEvent,
  type VizCommandV1,
  type VizResultV1,
} from "../lib/viz-contract";

const stageLabels: Record<ProcedureStage, string> = {
  overview: "Healthy orientation",
  tear: "Meniscus tear",
  scope: "Arthroscope path",
  treatment: "Possible treatment area",
  recovery: "Protected recovery",
};

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

function CameraRig({ state }: { state: AnatomyState }) {
  const { camera } = useThree();

  useFrame(() => {
    const desiredDistance = 6.4 / state.zoom;
    const currentDistance = camera.position.length();
    if (currentDistance > 0.1) {
      const scale = THREE.MathUtils.lerp(
        1,
        desiredDistance / currentDistance,
        0.045,
      );
      camera.position.multiplyScalar(scale);
    }
  });

  return null;
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

function Scene({ state }: { state: AnatomyState }) {
  const lights = useMemo(
    () => ({ key: new THREE.Color("#d6ecff"), fill: new THREE.Color("#ffdee2") }),
    [],
  );

  return (
    <>
      <CameraRig state={state} />
      <ambientLight intensity={1.35} />
      <directionalLight position={[4, 7, 6]} intensity={3.1} color={lights.key} />
      <directionalLight position={[-5, 2, 2]} intensity={2.2} color={lights.fill} />
      <pointLight position={[0, -2, 4]} intensity={1.2} color="#42a8ff" />
      <Suspense fallback={<KneeModel state={state} />}>
        <DetailedKneeModel state={state} />
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={3.7}
        maxDistance={8.2}
        minPolarAngle={Math.PI * 0.22}
        maxPolarAngle={Math.PI * 0.78}
        autoRotate={state.autoRotate}
        autoRotateSpeed={0.75}
      />
    </>
  );
}

export function KneeViewer({
  compact = false,
  className = "",
  onStateChange,
}: KneeViewerProps) {
  const [state, dispatch] = useReducer(reduceAnatomyCommand, initialAnatomyState);
  const stateRef = useRef(state);
  const revisionRef = useRef(0);
  const processedCommands = useRef(new Set<string>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const execute = useCallback((command: AnatomyCommand) => {
    dispatch(command);
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

    window.addEventListener(anatomyCommandEvent, handleCommand);
    window.addEventListener(vizCommandEvent, handleVizCommand);
    window.consentLoop3D = {
      execute,
      getState: () => stateRef.current,
    };
    window.consentLoopViz = {
      execute: executeViz,
      capabilities: vizCapabilities,
    };

    return () => {
      window.removeEventListener(anatomyCommandEvent, handleCommand);
      window.removeEventListener(vizCommandEvent, handleVizCommand);
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
      className={`knee-viewer ${compact ? "knee-viewer-compact" : ""} ${className}`}
      aria-label="Interactive 3D knee anatomy"
    >
      <div className="viewer-ambient viewer-ambient-blue" />
      <div className="viewer-ambient viewer-ambient-coral" />
      <div className="viewer-canvas">
        <Canvas
          camera={{ position: [0.3, 0.15, 6.4], fov: 34 }}
          dpr={[1, 1.8]}
          gl={{ antialias: true, alpha: true }}
          fallback={<div className="canvas-fallback">3D preview unavailable</div>}
        >
          <Scene state={state} />
        </Canvas>
      </div>

      <div className="viewer-topline">
        <div className="live-model-chip">
          <span className="live-dot" />
          Interactive model
        </div>
        <div className="viewer-stage-label">{stageLabels[state.stage]}</div>
      </div>
      <a
        className="viewer-license"
        href="https://anatomytool.org/content/open3dmodel-knee-english-labels"
        target="_blank"
        rel="noreferrer"
      >
        Illustrative model · CC BY-SA 4.0
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
              onClick={() => execute({ type: "reset" })}
              aria-label="Reset 3D view"
            >
              <Maximize2 size={17} />
            </button>
          </div>

          <button
            type="button"
            className="viewer-focus-cta"
            onClick={() => execute({ type: "focus", target: "tear" })}
          >
            <ScanSearch size={17} />
            Focus on the tear
          </button>
        </>
      )}
    </section>
  );
}

useGLTF.preload("/models/knee/anatomy.glb", "/draco-gltf/");

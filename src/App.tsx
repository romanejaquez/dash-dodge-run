/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as fflate from 'fflate';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, ArrowLeft, ArrowRight, ArrowUp, Heart, Volume2, VolumeX } from 'lucide-react';

// Constants
const LANE_WIDTH = 3;
const LANES = [-LANE_WIDTH, 0, LANE_WIDTH];
const INITIAL_SPEED = 0.45;
const SPEED_INCREMENT = 0.0001;
const JUMP_FORCE = 0.15;
const GRAVITY = 0.006;

// Joystick Component for Mobile
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleStart = (e: React.PointerEvent) => {
    setIsDragging(true);
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2;

    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;

    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > maxRadius) {
      dx *= maxRadius / distance;
      dy *= maxRadius / distance;
    }

    setPosition({ x: dx, y: dy });
    onMove(dx / maxRadius, -dy / maxRadius); // Invert Y for standard joystick behavior
  };

  const handleEnd = () => {
    setIsDragging(false);
    setPosition({ x: 0, y: 0 });
    onMove(0, 0);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-32 h-32 rounded-full bg-black/20 backdrop-blur-md border-4 border-white/20 flex items-center justify-center touch-none"
      onPointerDown={handleStart}
      onPointerMove={handleMove}
      onPointerUp={handleEnd}
      onPointerCancel={handleEnd}
    >
      {/* Center dot */}
      <div className="absolute w-1 h-1 bg-white/40 rounded-full" />
      
      {/* Stick */}
      <motion.div 
        ref={stickRef}
        animate={{ x: position.x, y: position.y }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="w-16 h-16 rounded-full bg-white/40 backdrop-blur-lg border-2 border-white/40 shadow-xl pointer-events-none flex items-center justify-center"
      >
        <div className="w-8 h-8 rounded-full bg-white/20 border border-white/20" />
      </motion.div>

      {/* Visual indicators */}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-white/40"><ArrowUp size={16} /></div>
      <div className="absolute -left-6 top-1/2 -translate-y-1/2 text-white/40"><ArrowLeft size={16} /></div>
      <div className="absolute -right-6 top-1/2 -translate-y-1/2 text-white/40"><ArrowRight size={16} /></div>
    </div>
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'GAMEOVER' | 'WIN'>('START');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('dash_dodge_high_score');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [lives, setLives] = useState(3);
  const [timeLeft, setTimeLeft] = useState(60);
  const [loading, setLoading] = useState(true);
  const [isTopViewMain, setIsTopViewMain] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Game refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const topCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerRef = useRef<THREE.Group | null>(null);
  const dashGroupRef = useRef<THREE.Group | null>(null);
  const dashRunGroupRef = useRef<THREE.Group | null>(null);
  const dashMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const dashRunMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const eyelidsMeshRef = useRef<THREE.Mesh | null>(null);
  const signRef = useRef<THREE.Group | null>(null);
  const obstaclesRef = useRef<THREE.Mesh[]>([]);
  const treesRef = useRef<THREE.Group[]>([]);
  const treeModelRef = useRef<THREE.Group | null>(null);
  const obstacleModelRef = useRef<THREE.Group | null>(null);
  const heartModelRef = useRef<THREE.Group | null>(null);
  const coinModelRef = useRef<THREE.Group | null>(null);
  const flashModelRef = useRef<THREE.Group | null>(null);
  const collectiblesRef = useRef<THREE.Object3D[]>([]);
  const cloudsRef = useRef<THREE.Group[]>([]);
  const speedLinesRef = useRef<THREE.Group | null>(null);
  const trailParticlesRef = useRef<THREE.Group | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const roadMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const clockRef = useRef(new THREE.Clock());
  
  // Player state refs
  const playerLane = useRef(1); // 0, 1, 2
  const playerY = useRef(0);
  const playerVelocityY = useRef(0);
  const isJumping = useRef(false);
  const isInvulnerable = useRef(false);
  const invulnerableTimer = useRef(0);
  const isSupersonic = useRef(false);
  const supersonicTimer = useRef(0);
  const hasFlashSpawned = useRef(false);
  const hasHeartSpawnedThisGame = useRef(false);
  const pendingHearts = useRef(0);
  const normalSpeed = useRef(INITIAL_SPEED);
  const gameSpeed = useRef(INITIAL_SPEED);
  const distanceTraveled = useRef(0);
  const lastObstacleSpawnDistance = useRef(0);
  const nextObstacleDistance = useRef(15 + Math.random() * 10);
  const lastCollectibleSpawnDistance = useRef(0);
  const nextCollectibleDistance = useRef(10 + Math.random() * 20);
  const frameId = useRef<number | null>(null);

  // Audio refs
  const audioCoinRef = useRef<HTMLAudioElement | null>(null);
  const audioRunningRef = useRef<HTMLAudioElement | null>(null);
  const audioWinRef = useRef<HTMLAudioElement | null>(null);
  const audioLostRef = useRef<HTMLAudioElement | null>(null);
  const audioCrashRef = useRef<HTMLAudioElement | null>(null);
  const audioFlashRef = useRef<HTMLAudioElement | null>(null);
  const audioHeartRef = useRef<HTMLAudioElement | null>(null);
  const audioJumpRef = useRef<HTMLAudioElement | null>(null);
  const audioFastRunningRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioCoinRef.current = new Audio('/dashcoin.mp3');
    audioRunningRef.current = new Audio('/dashrunning.mp3');
    if (audioRunningRef.current) audioRunningRef.current.loop = true;
    audioFastRunningRef.current = new Audio('/dashfastrun.mp3');
    if (audioFastRunningRef.current) audioFastRunningRef.current.loop = true;
    audioWinRef.current = new Audio('/dashgamewin.mp3');
    audioLostRef.current = new Audio('/dashgamelost.mp3');
    audioCrashRef.current = new Audio('/dashcrash.mp3');
    audioFlashRef.current = new Audio('/dashflash.mp3');
    audioHeartRef.current = new Audio('/dashheart.mp3');
    audioJumpRef.current = new Audio('/dashjump.mp3');

    return () => {
      audioRunningRef.current?.pause();
      audioFastRunningRef.current?.pause();
    };
  }, []);

  // Sync mute state with audio elements
  useEffect(() => {
    const audios = [
      audioCoinRef.current,
      audioRunningRef.current,
      audioWinRef.current,
      audioLostRef.current,
      audioCrashRef.current,
      audioFlashRef.current,
      audioHeartRef.current,
      audioJumpRef.current,
      audioFastRunningRef.current
    ];
    audios.forEach(audio => {
      if (audio) audio.muted = isMuted;
    });
  }, [isMuted]);

  useEffect(() => {
    if (gameState === 'PLAYING') {
      if (!isJumping.current) {
        if (isSupersonic.current) {
          audioFastRunningRef.current?.play().catch(e => console.error("Audio play failed:", e));
        } else {
          audioRunningRef.current?.play().catch(e => console.error("Audio play failed:", e));
        }
      }
    } else {
      audioRunningRef.current?.pause();
      audioFastRunningRef.current?.pause();
      if (audioRunningRef.current) audioRunningRef.current.currentTime = 0;
      if (audioFastRunningRef.current) audioFastRunningRef.current.currentTime = 0;
      
      if (gameState === 'GAMEOVER') {
        audioLostRef.current?.play().catch(e => console.error("Audio play failed:", e));
      } else if (gameState === 'WIN') {
        audioWinRef.current?.play().catch(e => console.error("Audio play failed:", e));
      }
    }
  }, [gameState]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue
    sceneRef.current = scene;

    // Fog for depth
    scene.fog = new THREE.Fog(0x87ceeb, 100, 800);

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 3, 6);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;
    
    // Top Camera
    const topCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    topCamera.position.set(0, 25, -12);
    topCamera.up.set(0, 0, -1); // Set up vector to point forward
    topCamera.lookAt(0, 0, -12); // Look straight down at a point ahead of the player
    topCameraRef.current = topCamera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    console.log("Renderer initialized");

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.25); // Brighter ambient
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.8); // Sky blue top, dark gray bottom
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2); // Brighter directional
    dirLight.position.set(0, 40, 20); // Directly above and slightly more forward
    dirLight.castShadow = true;
    dirLight.shadow.bias = -0.0005; // Small negative bias to reduce shadow acne
    dirLight.shadow.normalBias = 0.02; // Normal bias is great for curved surfaces
    dirLight.shadow.radius = 4; // Softer shadow edges
    dirLight.shadow.mapSize.width = 2048; // Higher resolution
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    scene.add(dirLight);

    // Ground (Green Grass)
    const groundGeometry = new THREE.PlaneGeometry(200, 1000);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4CAF50, roughness: 0.6 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    groundRef.current = ground;

    // Road (Brown)
    const roadGeometry = new THREE.PlaneGeometry(LANE_WIDTH * 3.5, 1000);
    const roadMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513, 
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -4, // Stronger offset
      polygonOffsetUnits: -4
    }); 
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.renderOrder = 1; // Ensure it renders after ground
    // Add road as child of ground so it moves with it
    road.rotation.x = 0; 
    road.position.y = 0.2; // Higher elevation
    road.receiveShadow = true;
    ground.add(road);

    // Load Road Texture
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('/floorpattern.png', (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 100);
      roadMaterial.map = texture;
      roadMaterial.color.set(0xffffff); // Reset color to show texture
      roadMaterial.needsUpdate = true;
    });
    roadMaterialRef.current = roadMaterial;

    // Load Tree FBX
    const loader = new FBXLoader();
    const gltfLoader = new GLTFLoader();
    (window as any).fflate = fflate;

    // Helper to simplify materials to avoid MAX_TEXTURE_IMAGE_UNITS error
    const materialMap = new Map<THREE.Material, THREE.Material>();
    const simplifyMaterial = (material: THREE.Material, isIsland = false) => {
      if (!material) return material;
      if (materialMap.has(material)) return materialMap.get(material)!;

      const m = material as any;
      let color = m.color instanceof THREE.Color ? m.color.clone() : new THREE.Color(0xffffff);

      // Color overrides for island/trees to match environment
      if (isIsland || treeModelRef.current === null) { // Heuristic: if it's the island or we're still loading trees
        // Detect green-ish (leaves/grass)
        if (color.g > color.r && color.g > color.b * 1.2) {
          color.set(0x4CAF50);
        } 
        // Detect brown-ish (trunk/dirt)
        else if (color.r > color.g && color.r > color.b && color.g > color.b) {
          color.set(0x8B4513);
        }
      }
      
      // Use MeshStandardMaterial for everything to bypass lighting/shader issues
      // while still having basic lighting
      const newMaterial = new THREE.MeshStandardMaterial({
        color: color,
        map: null, 
        transparent: !!m.transparent,
        opacity: typeof m.opacity === 'number' ? m.opacity : 1,
        side: m.side || THREE.FrontSide,
        roughness: 0.5
      });
      
      materialMap.set(material, newMaterial);
      return newMaterial;
    };

    const processModel = (fbx: THREE.Group, isIsland = false, isPlayer = false) => {
      fbx.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          
          if (isPlayer) {
            // Ensure smooth shading for the player
            if (mesh.geometry) {
              // Merge vertices first to ensure computeVertexNormals works across facets
              mesh.geometry = BufferGeometryUtils.mergeVertices(mesh.geometry);
              mesh.geometry.computeVertexNormals();
            }
            
            // Force smooth shading on materials
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach(m => {
              if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhongMaterial) {
                (m as any).flatShading = false;
                m.needsUpdate = true;
              }
            });
          }

          // Don't simplify materials for player models to preserve skinning and original look
          if (!isPlayer) {
            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map(m => simplifyMaterial(m, isIsland));
            } else {
              mesh.material = simplifyMaterial(mesh.material, isIsland);
            }
          }
        }
      });
    };

    // Load Obstacle FBX (Island)
    loader.load('/island.fbx', 
      (fbx) => {
        console.log('Island loaded successfully');
        processModel(fbx, true);
        const wrapper = new THREE.Group();
        wrapper.add(fbx);

        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const targetHeight = 1.5;
        const scale = targetHeight / (size.y || 1);
        fbx.scale.set(scale, scale, scale);
        
        const scaledBox = new THREE.Box3().setFromObject(fbx);
        fbx.position.y = -scaledBox.min.y;
        fbx.position.x = -(scaledBox.max.x + scaledBox.min.x) / 2;
        fbx.position.z = -(scaledBox.max.z + scaledBox.min.z) / 2;
        
        processModel(fbx, true);
        obstacleModelRef.current = wrapper;
      },
      undefined,
      (error) => console.error('Error loading Island:', error)
    );

    // Load Tree FBX
    loader.load('/tree.fbx', 
      (fbx) => {
        console.log('Tree loaded successfully');
        
        const wrapper = new THREE.Group();
        wrapper.add(fbx);

        // Normalize tree origin and scale
        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const targetHeight = 4 + Math.random() * 2;
        const scale = targetHeight / (size.y || 1);
        fbx.scale.set(scale, scale, scale);
        
        // Center tree and place base at 0
        const scaledBox = new THREE.Box3().setFromObject(fbx);
        fbx.position.y = -scaledBox.min.y;
        fbx.position.x = -(scaledBox.max.x + scaledBox.min.x) / 2;
        fbx.position.z = -(scaledBox.max.z + scaledBox.min.z) / 2;
        
        processModel(fbx, true);
        
        treeModelRef.current = wrapper;
        // Spawn initial trees now that we have the model
        spawnInitialTrees();
      },
      undefined,
      (error) => {
        console.error('Error loading Tree:', error);
      }
    );

    // Load Heart Model
    loader.load('/heart.fbx', 
      (fbx) => {
        console.log('Heart loaded successfully');
        const wrapper = new THREE.Group();
        wrapper.add(fbx);

        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.2 / (size.y || 1);
        fbx.scale.set(scale, scale, scale);
        
        const scaledBox = new THREE.Box3().setFromObject(fbx);
        fbx.position.y = -scaledBox.min.y;
        fbx.position.x = -(scaledBox.max.x + scaledBox.min.x) / 2;
        fbx.position.z = -(scaledBox.max.z + scaledBox.min.z) / 2;

        processModel(fbx);
        // Force red color for heart
        fbx.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.material instanceof THREE.MeshStandardMaterial) {
              mesh.material.color.set(0xff0000);
            }
          }
        });
        heartModelRef.current = wrapper;
      },
      undefined,
      (error) => console.error('Error loading Heart:', error)
    );

    // Load Coin Model
    loader.load('/coin.fbx', 
      (fbx) => {
        console.log('Coin loaded successfully');
        const wrapper = new THREE.Group();
        wrapper.add(fbx);

        const box = new THREE.Box3().setFromObject(fbx);
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.0 / (size.y || 1);
        fbx.scale.set(scale, scale, scale);

        const scaledBox = new THREE.Box3().setFromObject(fbx);
        fbx.position.y = -scaledBox.min.y;
        fbx.position.x = -(scaledBox.max.x + scaledBox.min.x) / 2;
        fbx.position.z = -(scaledBox.max.z + scaledBox.min.z) / 2;

        processModel(fbx);
        // Force golden color for coin
        fbx.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.material instanceof THREE.MeshStandardMaterial) {
              mesh.material.color.set(0xffea00);
              mesh.material.metalness = 0.8;
              mesh.material.roughness = 0.2;
            }
          }
        });
        coinModelRef.current = wrapper;
      },
      undefined,
      (error) => console.error('Error loading Coin:', error)
    );

    // Load Dodge Sign
    gltfLoader.load('/dashdodgesign.glb', 
      (gltf) => {
        const model = gltf.scene;
        console.log('Dodge Sign loaded successfully');
        const wrapper = new THREE.Group();
        wrapper.add(model);

        // Normalize sign origin and scale
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const targetHeight = 15; // Even larger
        const scale = targetHeight / (size.y || 1);
        model.scale.set(scale, scale, scale);
        
        // Center sign and place base at 0 relative to wrapper
        const scaledBox = new THREE.Box3().setFromObject(model);
        model.position.y = -scaledBox.min.y;
        model.position.x = -(scaledBox.max.x + scaledBox.min.x) / 2;
        model.position.z = -(scaledBox.max.z + scaledBox.min.z) / 2;
        
        // Position it closer and slightly above ground to be clearly visible
        wrapper.position.set(0, 0.5, 0);
        wrapper.rotation.y = Math.PI; // Face the player
        
        // Make it large but not astronomical
        wrapper.scale.set(4, 4, 4);
        
        processModel(model, false, true); // Use isPlayer=true to skip material simplification and keep textures
        scene.add(wrapper);
        signRef.current = wrapper;
      },
      undefined,
      (error) => console.error('Error loading Dodge Sign:', error)
    );

    // Load Flash Model
    gltfLoader.load('/flash.glb', 
      (gltf) => {
        const model = gltf.scene;
        console.log('Flash loaded successfully');
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const targetHeight = 1.0; // Same as coin
        const scale = targetHeight / (size.y || 1);
        model.scale.set(scale, scale, scale);
        
        const scaledBox = new THREE.Box3().setFromObject(model);
        model.position.y = -scaledBox.min.y;
        model.position.x = -(scaledBox.max.x + scaledBox.min.x) / 2;
        model.position.z = -(scaledBox.max.z + scaledBox.min.z) / 2;
        
        processModel(model, false, true);
        flashModelRef.current = model;
      },
      undefined,
      (error) => console.error('Error loading Flash:', error)
    );

    // Speed Lines Setup
    const speedLines = new THREE.Group();
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 50; i++) {
      const lineGeo = new THREE.CylinderGeometry(0.02, 0.02, 10, 8);
      const line = new THREE.Mesh(lineGeo, lineMaterial);
      line.rotation.x = Math.PI / 2;
      line.position.set(
        (Math.random() - 0.5) * 40,
        Math.random() * 20,
        -Math.random() * 200
      );
      speedLines.add(line);
    }
    speedLines.visible = false;
    scene.add(speedLines);
    speedLinesRef.current = speedLines;

    // Trail Particles Setup
    const trailParticles = new THREE.Group();
    const particleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 40; i++) {
      const particleGeo = new THREE.SphereGeometry(0.2, 8, 8);
      const particle = new THREE.Mesh(particleGeo, particleMaterial);
      particle.position.set(0, -20, 0); // Hide initially
      (particle as any)._life = Math.random();
      trailParticles.add(particle);
    }
    scene.add(trailParticles);
    trailParticlesRef.current = trailParticles;

    // Player Loading
    const loadPlayer = async () => {
      const playerWrapper = new THREE.Group();
      playerRef.current = playerWrapper;
      scene.add(playerWrapper);

      const loadModel = (path: string, name: string) => {
        return new Promise<THREE.Group>((resolve, reject) => {
          gltfLoader.load(path, (gltf) => {
            const model = gltf.scene;
            console.log(`${name} loaded successfully, animations:`, gltf.animations.length);
            
            // Initial bounding box to determine size
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            
            // Scale to a standard height (2 units)
            const targetHeight = 2;
            const scale = targetHeight / (size.y || 1);
            model.scale.set(scale, scale, scale);
            
            // Turn Dash 180 degrees
            model.rotation.y = Math.PI;
            
            // Rigged models often have their own internal offsets. 
            // We only want to ensure the bottom is at Y=0.
            const scaledBox = new THREE.Box3().setFromObject(model);
            model.position.y = -scaledBox.min.y;
            
            // For X and Z, we only center if the model is significantly off-center
            if (Math.abs(scaledBox.max.x + scaledBox.min.x) > 0.5) {
              model.position.x = -(scaledBox.max.x + scaledBox.min.x) / 2;
            }
            if (Math.abs(scaledBox.max.z + scaledBox.min.z) > 0.5) {
              model.position.z = -(scaledBox.max.z + scaledBox.min.z) / 2;
            }
            
            processModel(model, false, true);

            // Attach animations to the model for later use
            (model as any).animations = gltf.animations;

            resolve(model);
          }, undefined, reject);
        });
      };

      try {
        const [dashGltf, dashRunGltf] = await Promise.all([
          loadModel('/dashfly.glb', 'Dash (Fly)'),
          loadModel('/dashrun.glb', 'Dash (Run)')
        ]);

        dashGroupRef.current = dashGltf;
        dashRunGroupRef.current = dashRunGltf;

        // Change feet color to cinnamon brown
        const cinnamonBrown = new THREE.Color(0xD2691E);
        [dashGltf, dashRunGltf].forEach(model => {
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && (child.name.toLowerCase().includes('foot') || child.name.toLowerCase().includes('feet'))) {
              const mesh = child as THREE.Mesh;
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              materials.forEach(m => {
                const mat = m as any;
                if (mat.color) mat.color.set(cinnamonBrown);
                if (mat.map) mat.map = null; // Remove texture to ensure color is solid
                mat.needsUpdate = true;
              });
            }
          });
        });

        // Find eyelids in dashrun
        dashRunGltf.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && child.name.toLowerCase().includes('eyelid')) {
            eyelidsMeshRef.current = child as THREE.Mesh;
            eyelidsMeshRef.current.visible = false; // Start with eyes open
          }
        });

        // Add both to wrapper
        playerWrapper.add(dashGltf);
        playerWrapper.add(dashRunGltf);

        // Setup mixers
        const dashAnims = (dashGltf as any).animations || [];
        if (dashAnims.length > 0) {
          const mixer = new THREE.AnimationMixer(dashGltf);
          dashMixerRef.current = mixer;
          
          // Find flight/jump animation
          const anim = dashAnims.find((a: any) => 
            a.name.toLowerCase().includes('jump') || 
            a.name.toLowerCase().includes('fly') ||
            a.name.toLowerCase().includes('air')
          ) || dashAnims[0];
          
          const action = mixer.clipAction(anim);
          action.setEffectiveTimeScale(1);
          action.setEffectiveWeight(1);
          action.play();
        }

        const dashRunAnims = (dashRunGltf as any).animations || [];
        if (dashRunAnims.length > 0) {
          const mixer = new THREE.AnimationMixer(dashRunGltf);
          dashRunMixerRef.current = mixer;
          
          // Try to find run animation or use the first one
          const anim = dashRunAnims.find((a: any) => 
            a.name.toLowerCase().includes('run') || 
            a.name.toLowerCase().includes('walk') ||
            a.name === 'moving_feet_leftAction'
          ) || dashRunAnims[0];

          const action = mixer.clipAction(anim);
          action.setEffectiveTimeScale(3);
          action.setEffectiveWeight(1);
          action.play();
        } else {
          console.warn("No animations found in dashrun.glb");
        }

        // Initial state: running on ground
        dashGltf.visible = false;
        dashRunGltf.visible = true;

        setLoading(false);
      } catch (error) {
        console.error('Error loading Dash models:', error);
        setLoading(false);
        
        // Fallback placeholder
        const geometry = new THREE.BoxGeometry(1, 2, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.5 });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.y = 1;
        cube.castShadow = true;
        cube.receiveShadow = true;
        playerWrapper.add(cube);
      }
    };

    loadPlayer();

    // Handle Resize
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const aspect = width / height;
      
      cameraRef.current.aspect = aspect;
      cameraRef.current.updateProjectionMatrix();
      
      if (topCameraRef.current) {
        topCameraRef.current.aspect = aspect;
        topCameraRef.current.updateProjectionMatrix();
      }

      rendererRef.current.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Safety timeout to clear loading screen if models take too long
    const safetyTimeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(safetyTimeout);
      if (frameId.current) cancelAnimationFrame(frameId.current);
      renderer.dispose();
    };
  }, []);

  // Controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'PLAYING') return;

      if (e.key === 'ArrowLeft' || e.key === 'a') {
        playerLane.current = Math.max(0, playerLane.current - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        playerLane.current = Math.min(2, playerLane.current + 1);
      } else if ((e.key === 'ArrowUp' || e.key === ' ' || e.key === 'w') && !isJumping.current) {
        playerVelocityY.current = JUMP_FORCE;
        isJumping.current = true;
        
        // Play jump sound and pause running sounds
        if (audioJumpRef.current) {
          audioJumpRef.current.currentTime = 0;
          audioJumpRef.current.play().catch(e => console.error("Audio play failed:", e));
        }
        audioRunningRef.current?.pause();
        audioFastRunningRef.current?.pause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState]);

  const spawnTree = (zPos = -100) => {
    if (!sceneRef.current) return;
    const side = Math.random() > 0.5 ? 1 : -1;
    // Ensure trees are far from the road (road edge is at +/- 5.25)
    const x = side * (12 + Math.random() * 20);
    
    let tree: THREE.Group | THREE.Object3D;
    
    if (treeModelRef.current) {
      tree = treeModelRef.current.clone();
      // Randomize scale
      const s = 0.7 + Math.random() * 0.6;
      tree.scale.multiplyScalar(s);
    } else {
      // Fallback procedural tree
      const trunkGeom = new THREE.CylinderGeometry(0.2, 0.3, 1.5);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.6 });
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      
      const leavesGeom = new THREE.ConeGeometry(1.2, 3, 8);
      const leavesMat = new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.6 });
      const leaves = new THREE.Mesh(leavesGeom, leavesMat);
      leaves.position.y = 1.8;
      
      tree = new THREE.Group();
      tree.add(trunk);
      tree.add(leaves);
    }
    
    tree.position.set(x, 0, zPos);
    tree.rotation.y = Math.random() * Math.PI * 2;

    sceneRef.current.add(tree);
    treesRef.current.push(tree as THREE.Group);
  };

  const spawnCloud = (zPos = -100) => {
    if (!sceneRef.current) return;
    const x = (Math.random() - 0.5) * 60;
    const y = 15 + Math.random() * 10;
    
    const cloud = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, roughness: 0.5 });
    
    // Create a "puffy" cloud with multiple spheres
    const numSpheres = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numSpheres; i++) {
      const size = 1 + Math.random() * 2;
      const geo = new THREE.SphereGeometry(size, 8, 8);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 4
      );
      cloud.add(mesh);
    }
    
    cloud.position.set(x, y, zPos);
    sceneRef.current.add(cloud);
    cloudsRef.current.push(cloud);
  };

  const spawnInitialTrees = () => {
    if (treesRef.current.length > 0) return; // Avoid double spawning
    for (let i = 0; i < 25; i++) {
      const z = -120 + (i * 5);
      spawnTree(z);
    }
  };

  const spawnInitialClouds = () => {
    for (let i = 0; i < 15; i++) {
      const z = -150 + (i * 15);
      spawnCloud(z);
    }
  };

  const spawnObstacle = (zPos = -100, laneOverride?: number) => {
    if (!sceneRef.current) return;
    const lane = laneOverride !== undefined ? laneOverride : Math.floor(Math.random() * 3);
    
    let obstacle: THREE.Object3D;
    
    if (obstacleModelRef.current) {
      obstacle = obstacleModelRef.current.clone();
      obstacle.position.set(LANES[lane], 0, zPos);
    } else {
      const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      const material = new THREE.MeshStandardMaterial({ color: 0xcd853f, roughness: 0.6 });
      obstacle = new THREE.Mesh(geometry, material);
      obstacle.position.set(LANES[lane], 0.75, zPos);
    }
    
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;
    (obstacle as any)._isObstacle = true;
    sceneRef.current.add(obstacle);
    obstaclesRef.current.push(obstacle as THREE.Mesh);
    return lane;
  };

  const spawnInitialObstacles = () => {
    // Spawn some obstacles initially so the action starts immediately
    spawnObstacle(-40);
    spawnObstacle(-70);
    spawnObstacle(-100);
  };

  const spawnCollectible = () => {
    if (!sceneRef.current) return;
    
    // Check if we should spawn the Flash item
    // Only once per round, and only if we have the model
    const shouldSpawnFlash = !hasFlashSpawned.current && flashModelRef.current && Math.random() < 0.05;
    
    let model: THREE.Object3D | null = null;
    let isHeart = false;
    let isFlash = false;
    
    if (shouldSpawnFlash) {
      model = flashModelRef.current;
      isFlash = true;
      hasFlashSpawned.current = true;
    } else {
      // Only spawn a heart if we have pending hearts from losing a life
      isHeart = pendingHearts.current > 0;
      if (isHeart) {
        pendingHearts.current--;
      }
      model = isHeart ? heartModelRef.current : coinModelRef.current;
    }
    
    if (!model) return;

    const lane = Math.floor(Math.random() * 3);
    const collectible = model.clone();
    collectible.position.set(LANES[lane], 1.2, -100);
    (collectible as any)._isHeart = isHeart;
    (collectible as any)._isCoin = !isHeart && !isFlash;
    (collectible as any)._isFlash = isFlash;
    
    sceneRef.current.add(collectible);
    collectiblesRef.current.push(collectible);
  };

  const resetGame = () => {
    setScore(0);
    setLives(3);
    setTimeLeft(60);
    gameSpeed.current = INITIAL_SPEED;
    normalSpeed.current = INITIAL_SPEED;
    isSupersonic.current = false;
    supersonicTimer.current = 0;
    hasFlashSpawned.current = false;
    playerLane.current = 1;
    playerY.current = 0;
    playerVelocityY.current = 0;
    isJumping.current = false;
    isInvulnerable.current = false;
    invulnerableTimer.current = 0;
    pendingHearts.current = 0;
    hasHeartSpawnedThisGame.current = false;
    
    // Clear obstacles
    obstaclesRef.current.forEach(obs => sceneRef.current?.remove(obs));
    obstaclesRef.current = [];

    // Clear collectibles
    collectiblesRef.current.forEach(col => sceneRef.current?.remove(col));
    collectiblesRef.current = [];

    // Clear trees
    treesRef.current.forEach(tree => sceneRef.current?.remove(tree));
    treesRef.current = [];

    // Clear clouds
    cloudsRef.current.forEach(cloud => sceneRef.current?.remove(cloud));
    cloudsRef.current = [];

    if (signRef.current) {
      signRef.current.position.z = 0;
      signRef.current.position.y = 0.5;
    }

    spawnInitialTrees();
    spawnInitialClouds();
    spawnInitialObstacles();
    setGameState('PLAYING');
  };

  // Game Loop
  useEffect(() => {
    console.log('Starting animation loop, gameState:', gameState);
    
    const animate = () => {
      frameId.current = requestAnimationFrame(animate);
      
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !topCameraRef.current) {
        return;
      }

      // Update top camera to follow player X and look straight down
      if (playerRef.current) {
        topCameraRef.current.position.x = playerRef.current.position.x;
        topCameraRef.current.position.z = -12; // Center of view is ahead of player
        topCameraRef.current.lookAt(playerRef.current.position.x, 0, -12); // Look straight down
      }

      // Render the scene
      const mainCamera = isTopViewMain ? topCameraRef.current : cameraRef.current;
      const pipCamera = isTopViewMain ? cameraRef.current : topCameraRef.current;

      // Ensure main camera aspect ratio is correct for full screen
      mainCamera.aspect = window.innerWidth / window.innerHeight;
      mainCamera.updateProjectionMatrix();

      rendererRef.current.setViewport(0, 0, window.innerWidth, window.innerHeight);
      rendererRef.current.render(sceneRef.current, mainCamera);

      // Render PiP
      const isMobile = window.innerWidth < 768;
      const pipWidth = isMobile ? 140 : 200;
      const pipHeight = isMobile ? 105 : 150;
      
      const pipX = 20; // 20px from left
      const pipY = 20; // 20px from bottom (Three.js viewport Y is from bottom)

      // Ensure PiP camera aspect ratio matches PiP viewport
      pipCamera.aspect = pipWidth / pipHeight;
      pipCamera.updateProjectionMatrix();

      rendererRef.current.setScissorTest(true);
      rendererRef.current.setScissor(pipX, pipY, pipWidth, pipHeight);
      rendererRef.current.setViewport(pipX, pipY, pipWidth, pipHeight);
      rendererRef.current.clearDepth();
      rendererRef.current.render(sceneRef.current, pipCamera);
      rendererRef.current.setScissorTest(false);

      // Diagnostic log every 100 frames
      if (Math.random() < 0.01) {
        console.log("Rendering frame, scene children:", sceneRef.current.children.length);
      }

      const delta = clockRef.current.getDelta();

      // Animation Switching & Mixer Updates (Always update for smooth visuals)
      if (playerRef.current) {
        // Blinking effect when invulnerable
        if (isInvulnerable.current) {
          invulnerableTimer.current -= delta;
          if (invulnerableTimer.current <= 0) {
            isInvulnerable.current = false;
            playerRef.current.visible = gameState === 'PLAYING';
          } else {
            // Toggle visibility every 0.1 seconds
            playerRef.current.visible = Math.floor(invulnerableTimer.current * 10) % 2 === 0;
          }
        } else {
          playerRef.current.visible = gameState === 'PLAYING';
        }

        // Supersonic Trail Particles
        if (isSupersonic.current && trailParticlesRef.current) {
          trailParticlesRef.current.children.forEach((p: any) => {
            // Move towards the camera (behind Dash)
            p.position.z += gameSpeed.current * 1.2; 
            p.scale.multiplyScalar(0.9);
            
            if (p.scale.x < 0.05 || p.position.z > 10) {
              p.position.set(
                playerRef.current!.position.x + (Math.random() - 0.5) * 1.0,
                playerRef.current!.position.y + 0.5 + (Math.random() - 0.5) * 1.0,
                playerRef.current!.position.z - 1.0 // Spawn slightly behind Dash
              );
              p.scale.set(1.5, 1.5, 1.5);
            }
          });
        } else if (trailParticlesRef.current) {
          // Hide particles when not supersonic
          trailParticlesRef.current.children.forEach((p: any) => {
            p.position.y = -20;
          });
        }
      }

      // Update Speed Lines
      if (speedLinesRef.current) {
        speedLinesRef.current.visible = isSupersonic.current;
        if (isSupersonic.current) {
          speedLinesRef.current.children.forEach((line: any) => {
            line.position.z += gameSpeed.current * 2;
            if (line.position.z > 10) {
              line.position.z = -100 - Math.random() * 50;
            }
          });
        }
      }

      if (dashGroupRef.current && dashRunGroupRef.current) {
        const isGrounded = playerY.current <= 0;
        if (gameState === 'PLAYING' || isInvulnerable.current) {
          dashGroupRef.current.visible = !isGrounded;
          dashRunGroupRef.current.visible = isGrounded;
        } else {
          dashGroupRef.current.visible = false;
          dashRunGroupRef.current.visible = false;
        }
        
        if (dashRunMixerRef.current) {
          dashRunMixerRef.current.update(delta);
          
          // Blinking logic (only if dashRun is visible)
          if (isGrounded && eyelidsMeshRef.current) {
            const time = clockRef.current.getElapsedTime();
            // Blink every 4 seconds for 0.15 seconds
            const isBlinking = (time % 4) < 0.15;
            eyelidsMeshRef.current.visible = isBlinking;
          }
        }
        
        if (dashMixerRef.current) {
          dashMixerRef.current.update(delta);
        }
      }

      if (gameState === 'PLAYING') {
        // Update Supersonic Timer
        if (isSupersonic.current) {
          supersonicTimer.current -= delta;
          if (supersonicTimer.current <= 0) {
            isSupersonic.current = false;
            gameSpeed.current = normalSpeed.current;
            // Switch back to normal running sound
            audioFastRunningRef.current?.pause();
            if (audioFastRunningRef.current) audioFastRunningRef.current.currentTime = 0;
            if (!isJumping.current) {
              audioRunningRef.current?.play().catch(e => console.error("Audio play failed:", e));
            }
          }
        }

        // Update Timer
        setTimeLeft(prev => {
          const next = prev - delta;
          if (next <= 0) {
            setGameState('WIN');
            return 0;
          }
          return next;
        });

        // Update Player Position
        if (playerRef.current) {
          // Smooth lane transition
          const targetX = LANES[playerLane.current];
          playerRef.current.position.x += (targetX - playerRef.current.position.x) * 0.2;

          // Jump logic
          playerY.current += playerVelocityY.current;
          playerVelocityY.current -= GRAVITY;

          if (playerY.current <= 0) {
            const wasJumping = isJumping.current;
            playerY.current = 0;
            playerVelocityY.current = 0;
            isJumping.current = false;
            
            // Resume running sound if we just landed
            if (wasJumping && gameState === 'PLAYING') {
              if (isSupersonic.current) {
                audioFastRunningRef.current?.play().catch(e => console.error("Audio play failed:", e));
              } else {
                audioRunningRef.current?.play().catch(e => console.error("Audio play failed:", e));
              }
            }
          }
          playerRef.current.position.y = playerY.current;
        }

        // Animate Road Texture Offset
        if (roadMaterialRef.current && roadMaterialRef.current.map) {
          roadMaterialRef.current.map.offset.y += gameSpeed.current * 0.1; // Adjust multiplier for speed feel
        }

        // Move Clouds
        for (let i = cloudsRef.current.length - 1; i >= 0; i--) {
          const cloud = cloudsRef.current[i];
          cloud.position.z += gameSpeed.current * 0.5; // Clouds move slower for parallax
          if (cloud.position.z > 30) {
            sceneRef.current?.remove(cloud);
            cloudsRef.current.splice(i, 1);
          }
        }

        // Move Trees
        for (let i = treesRef.current.length - 1; i >= 0; i--) {
          const tree = treesRef.current[i];
          tree.position.z += gameSpeed.current;
          if (tree.position.z > 20) {
            sceneRef.current?.remove(tree);
            treesRef.current.splice(i, 1);
          }
        }

        // Move Sign (Fixed in horizon as requested)
        if (signRef.current) {
          // No movement, just keep it at its initial position
        }

        // Move Obstacles
        for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
          const obs = obstaclesRef.current[i];
          obs.position.z += gameSpeed.current;

          // Collision Detection
          if (playerRef.current) {
            const playerBox = new THREE.Box3().setFromObject(playerRef.current);
            const obsBox = new THREE.Box3().setFromObject(obs);
            
            // Shrink boxes slightly for better feel
            playerBox.expandByScalar(-0.3);
            obsBox.expandByScalar(-0.3);

            if (playerBox.intersectsBox(obsBox)) {
              // Hit obstacle
              if (isInvulnerable.current) continue;

              sceneRef.current?.remove(obs);
              obstaclesRef.current.splice(i, 1);
              
              // Play crash sound
              if (audioCrashRef.current) {
                audioCrashRef.current.currentTime = 0;
                audioCrashRef.current.play().catch(e => console.error("Audio play failed:", e));
              }

              // Trigger blinking/invulnerability
              isInvulnerable.current = true;
              invulnerableTimer.current = 1.0; // 1 second

              setLives(l => {
                const newLives = l - 1;
                // Only spawn a heart once per game, triggered when losing the first life (3 -> 2)
                if (l === 3 && !hasHeartSpawnedThisGame.current) {
                  pendingHearts.current = 1;
                  hasHeartSpawnedThisGame.current = true;
                }
                if (newLives <= 0) {
                  setGameState('GAMEOVER');
                }
                return newLives;
              });
              continue;
            }
          }

          // Remove off-screen obstacles
          if (obs.position.z > 15) {
            sceneRef.current?.remove(obs);
            obstaclesRef.current.splice(i, 1);
          }
        }

        // Move Collectibles
        for (let i = collectiblesRef.current.length - 1; i >= 0; i--) {
          const col = collectiblesRef.current[i];
          col.position.z += gameSpeed.current;
          col.rotation.y += 0.05; // Spin animation

          // Collision Detection
          if (playerRef.current) {
            const playerBox = new THREE.Box3().setFromObject(playerRef.current);
            const colBox = new THREE.Box3().setFromObject(col);
            
            playerBox.expandByScalar(-0.2);
            colBox.expandByScalar(-0.2);

            if (playerBox.intersectsBox(colBox)) {
              if ((col as any)._isHeart) {
                // Play heart sound
                if (audioHeartRef.current) {
                  audioHeartRef.current.currentTime = 0;
                  audioHeartRef.current.play().catch(e => console.error("Audio play failed:", e));
                }
                setLives(l => Math.min(l + 1, 3));
                setScore(s => s + 20);
              } else if ((col as any)._isFlash) {
                // Play flash sound
                if (audioFlashRef.current) {
                  audioFlashRef.current.currentTime = 0;
                  audioFlashRef.current.play().catch(e => console.error("Audio play failed:", e));
                }
                // Activate Supersonic
                if (!isSupersonic.current) {
                  normalSpeed.current = gameSpeed.current;
                  gameSpeed.current *= 2.5; // Supersonic speed boost
                  // Switch to fast running sound
                  audioRunningRef.current?.pause();
                  if (audioRunningRef.current) audioRunningRef.current.currentTime = 0;
                  if (!isJumping.current) {
                    audioFastRunningRef.current?.play().catch(e => console.error("Audio play failed:", e));
                  }
                }
                isSupersonic.current = true;
                supersonicTimer.current = 10; // 10 seconds
                setScore(s => s + 50);
              } else {
                // Play coin sound
                if (audioCoinRef.current) {
                  audioCoinRef.current.currentTime = 0;
                  audioCoinRef.current.play().catch(e => console.error("Audio play failed:", e));
                }
                setScore(s => s + 10);
              }
              sceneRef.current?.remove(col);
              collectiblesRef.current.splice(i, 1);
              continue;
            }
          }

          // Remove off-screen collectibles
          if (col.position.z > 15) {
            sceneRef.current?.remove(col);
            collectiblesRef.current.splice(i, 1);
          }
        }

        // Spawn logic
        distanceTraveled.current += gameSpeed.current;
        
        // Obstacle Spawning
        if (distanceTraveled.current - lastObstacleSpawnDistance.current > nextObstacleDistance.current) {
          const usedLane = spawnObstacle();
          
          // 40% chance to spawn a second obstacle in a different lane for added challenge
          if (Math.random() < 0.4) {
            let secondLane = Math.floor(Math.random() * 3);
            while (secondLane === usedLane) {
              secondLane = Math.floor(Math.random() * 3);
            }
            spawnObstacle(-100, secondLane);
          }
          
          lastObstacleSpawnDistance.current = distanceTraveled.current;
          nextObstacleDistance.current = 15 + Math.random() * 10; // Randomize next spawn distance
        }

        // Collectible Spawning
        if (distanceTraveled.current - lastCollectibleSpawnDistance.current > nextCollectibleDistance.current) {
          spawnCollectible();
          lastCollectibleSpawnDistance.current = distanceTraveled.current;
          nextCollectibleDistance.current = 10 + Math.random() * 20;
        }

        if (Math.random() < 0.08) { // Increased tree spawn rate
          spawnTree();
        }
        if (Math.random() < 0.01) {
          spawnCloud();
        }

        // Increase speed
        normalSpeed.current += SPEED_INCREMENT;
        gameSpeed.current += SPEED_INCREMENT;
      }
    };

    animate();
    return () => {
      if (frameId.current) cancelAnimationFrame(frameId.current);
    };
  }, [gameState, isTopViewMain]);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('dash_dodge_high_score', score.toString());
    }
  }, [score, highScore]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-sky-400 font-sans">
      <div ref={containerRef} className="absolute inset-0" />

      {/* PiP Toggle Overlay */}
      <div 
        onClick={() => setIsTopViewMain(!isTopViewMain)}
        className="absolute bottom-5 left-5 w-[140px] h-[105px] md:w-[200px] md:h-[150px] border-2 border-white cursor-pointer z-20 hover:scale-105 transition-all overflow-hidden bg-transparent shadow-xl"
      >
        <div className="absolute bottom-1 right-2 text-[10px] text-white font-bold uppercase tracking-tighter drop-shadow-md pointer-events-none">
          {isTopViewMain ? 'POV VIEW' : 'TOP VIEW'}
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-sky-400">
          <div className="text-center flex flex-col items-center">
            <div className="relative flex items-center justify-center mb-8">
              {/* Spinner */}
              <div className="w-32 h-32 md:w-48 md:h-48 border-4 md:border-8 border-white border-t-transparent rounded-full animate-spin" />
              {/* Dash Silhouette */}
              <img 
                src="/dashsilhouette.png" 
                alt="Dash Silhouette" 
                className="absolute w-16 h-16 md:w-24 md:h-24 object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="text-white font-black text-2xl md:text-4xl tracking-widest animate-pulse uppercase">LOADING DASH...</div>
          </div>
        </div>
      )}

      {/* UI Overlay */}
      <div className="absolute top-4 left-4 md:top-8 md:left-8 z-10 flex flex-col gap-2 md:gap-4">
        <div className="bg-black/60 backdrop-blur-md p-2 md:p-4 rounded-xl md:rounded-2xl border border-white/20 text-white min-w-[100px] md:min-w-[140px] shadow-lg">
          <div className="text-[10px] md:text-xs uppercase tracking-widest opacity-80 mb-0.5 md:mb-1 font-black">Current Score</div>
          <div className="text-2xl md:text-4xl font-black">{score}</div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="bg-black/60 backdrop-blur-md p-2 md:p-4 rounded-xl md:rounded-2xl border border-white/20 text-white flex items-center gap-1 md:gap-2 shadow-lg w-fit">
            {Array.from({ length: 3 }).map((_, i) => (
              <Heart 
                key={i} 
                size={18} 
                className={`${i < lives ? 'text-red-400 fill-red-400' : 'text-white/10'} transition-all duration-300 drop-shadow-md md:w-6 md:h-6`} 
              />
            ))}
          </div>
          <img 
            src="/dashbadge.png" 
            alt="Dash Badge" 
            className="w-20 h-20 md:w-32 md:h-32 drop-shadow-lg"
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="bg-black/60 backdrop-blur-md p-2 md:p-4 rounded-xl md:rounded-2xl border border-white/20 text-white min-w-[100px] md:min-w-[140px] shadow-lg">
          <div className="text-[10px] md:text-xs uppercase tracking-widest opacity-80 mb-0.5 md:mb-1 font-black">Time Remaining</div>
          <div className="text-2xl md:text-4xl font-black font-mono flex items-baseline gap-1">
            {Math.ceil(timeLeft)}<span className="text-[0.5em] leading-none opacity-80">S</span>
          </div>
        </div>

        {/* Mute Button */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="w-10 h-10 md:w-14 md:h-14 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-lg hover:scale-110 transition-all active:scale-95"
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX size={20} className="md:w-6 md:h-6" /> : <Volume2 size={20} className="md:w-6 md:h-6" />}
        </button>
      </div>

      <div className="absolute top-4 right-4 md:top-8 md:right-8 z-10">
        <div className="bg-black/40 backdrop-blur-md p-2 md:p-4 rounded-xl md:rounded-2xl border border-white/20 text-white flex items-center gap-2 md:gap-3">
          <Trophy className="text-yellow-400" size={18} />
          <div>
            <div className="text-[10px] md:text-xs uppercase tracking-widest opacity-60">High Score</div>
            <div className="text-lg md:text-2xl font-bold">{highScore}</div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {gameState === 'START' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="text-center text-white max-w-md p-8">
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="mb-6"
              >
                <img 
                  src="/dashdodgetitle.png" 
                  alt="Dash Dodge" 
                  className="w-full max-w-[320px] mx-auto drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)]"
                  referrerPolicy="no-referrer"
                />
              </motion.div>
              <p className="text-lg opacity-80 mb-8">
                Help Dash dodge obstacles and set a new high score!
              </p>
              
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
                    <img src="/leftarrow.png" alt="Left" className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />
                  </div>
                  <span className="text-xs opacity-60">Left</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
                    <img src="/jumparrow.png" alt="Jump" className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />
                  </div>
                  <span className="text-xs opacity-60">Jump</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
                    <img src="/rightarrow.png" alt="Right" className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />
                  </div>
                  <span className="text-xs opacity-60">Right</span>
                </div>
              </div>

              <button 
                onClick={resetGame}
                className="transition-all hover:scale-105 active:scale-95 mx-auto block"
              >
                <img 
                  src="/startgamebtn.png" 
                  alt="Start Game" 
                  className="w-48 md:w-64 drop-shadow-lg" 
                  referrerPolicy="no-referrer" 
                />
              </button>
            </div>
          </motion.div>
        )}

        {gameState === 'WIN' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-md"
          >
            <div className="relative text-center text-white bg-[#1A1C1E]/95 p-10 md:p-12 rounded-[40px] border border-white/10 shadow-2xl max-w-lg w-full mx-4">
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40">
                <img 
                  src="/dashwin.png" 
                  alt="Winner" 
                  className="w-full h-full object-contain drop-shadow-2xl"
                  referrerPolicy="no-referrer"
                />
              </div>
              <h2 className="text-3xl md:text-5xl font-black mb-2 tracking-tighter uppercase mt-8">Challenge Complete!</h2>
              <div className="text-sm md:text-base font-black opacity-60 mb-6 uppercase tracking-widest">You survived the 1-minute dash!</div>
              <div className="text-2xl md:text-4xl font-black mb-8 text-[#FFC107] uppercase">Score: {score}</div>
              
              <button 
                onClick={resetGame}
                className="px-8 py-3 bg-white text-black font-black rounded-2xl transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto uppercase shadow-lg"
              >
                <RotateCcw size={20} />
                Play Again
              </button>
            </div>
          </motion.div>
        )}

        {gameState === 'GAMEOVER' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-md"
          >
            <div className="relative text-center text-white bg-[#2D241E]/95 p-10 md:p-12 rounded-[40px] border border-white/10 shadow-2xl max-w-lg w-full mx-4">
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40">
                <img 
                  src="/dashcrash.png" 
                  alt="Crashed" 
                  className="w-full h-full object-contain drop-shadow-2xl"
                  referrerPolicy="no-referrer"
                />
              </div>
              <h2 className="text-3xl md:text-5xl font-black mb-2 tracking-tighter uppercase mt-8">Crashed!</h2>
              <div className="text-sm md:text-base font-black opacity-60 mb-8 uppercase tracking-widest">You scored {score} points</div>
              
              <button 
                onClick={resetGame}
                className="px-8 py-3 bg-white text-black font-black rounded-2xl transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto uppercase shadow-lg"
              >
                <RotateCcw size={20} />
                Try Again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Controls (Joystick) */}
      <div className="absolute bottom-12 right-12 z-20 md:hidden">
        <Joystick 
          onMove={(x, y) => {
            if (gameState !== 'PLAYING') return;
            
            // Lane control
            if (x < -0.3) {
              playerLane.current = 0;
            } else if (x > 0.3) {
              playerLane.current = 2;
            } else {
              playerLane.current = 1;
            }

            // Jump control
            if (y > 0.5 && !isJumping.current) {
              playerVelocityY.current = JUMP_FORCE;
              isJumping.current = true;
              
              // Play jump sound and pause running sounds
              if (audioJumpRef.current) {
                audioJumpRef.current.currentTime = 0;
                audioJumpRef.current.play().catch(e => console.error("Audio play failed:", e));
              }
              audioRunningRef.current?.pause();
              audioFastRunningRef.current?.pause();
            }
          }}
        />
      </div>

      {/* Debug Info */}
      <div className="absolute bottom-4 right-4 z-10 text-[10px] font-mono text-white/30 pointer-events-none">
        {playerRef.current ? 'MODEL_READY' : 'MODEL_PENDING'} | {gameState}
      </div>
    </div>
  );
}

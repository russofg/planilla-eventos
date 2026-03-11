import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as random from 'maath/random/dist/maath-random.esm';

function ParticleField(props) {
  const ref = useRef();
  
  // Create a sphere of random points (Optimized count for performance)
  const sphere = useMemo(() => {
    return random.inSphere(new Float32Array(1200), { radius: 1.5 });
  }, []);

  useFrame((state, delta) => {
    if (ref.current) {
      // Very slow organic rotation
      ref.current.rotation.x -= delta / 10;
      ref.current.rotation.y -= delta / 15;
    }
  });

  return (
    <group rotation={[0, 0, Math.PI / 4]}>
      <Points ref={ref} positions={sphere} stride={3} frustumCulled={false} {...props}>
        <PointMaterial
          transparent
          color="#3b82f6" // Soft blue tone matching the ambient lights
          size={0.003}
          sizeAttenuation={true}
          depthWrite={false}
          opacity={0.4}
        />
      </Points>
    </group>
  );
}

export function ParticlesBackground() {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      <Canvas 
        camera={{ position: [0, 0, 1], fov: 75 }} 
        dpr={1} // Force 1x pixel ratio to save immense GPU overhead on Retina screens
        gl={{ powerPreference: "high-performance", alpha: true, antialias: false }}
      >
        <ParticleField />
      </Canvas>
    </div>
  );
}

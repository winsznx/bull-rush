import { Suspense, useLayoutEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Bull } from './Bull';
import { Track } from './Track';
import { SimScene } from './SimScene';
import { SIM_MODE } from '../sim/flag';

function SkyBackdrop() {
    const tex = useTexture('/skybox.jpg');
    const scene = useThree((s) => s.scene);
    useLayoutEffect(() => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        const prev = scene.background;
        scene.background = tex;
        return () => {
            if (scene.background === tex) scene.background = prev;
        };
    }, [tex, scene]);
    return null;
}

export function Game() {
    return (
        <Canvas
            shadows
            dpr={[1, 1.5]}
            camera={{ position: [0, 4.4, 8.5], fov: 62 }}
            gl={{ antialias: false, powerPreference: 'high-performance' }}
        >
            <fog attach="fog" args={['#070a16', 26, 110]} />

            <hemisphereLight args={['#244', '#020308', 0.5]} />
            <ambientLight intensity={0.35} />
            <directionalLight
                position={[6, 18, 6]}
                intensity={1.0}
                castShadow
                shadow-mapSize={[1024, 1024]}
                shadow-camera-near={0.5}
                shadow-camera-far={60}
                shadow-camera-left={-14}
                shadow-camera-right={14}
                shadow-camera-top={14}
                shadow-camera-bottom={-14}
            />
            <pointLight position={[0, 5, 2]} intensity={26} distance={38} decay={1.6} color="#39ff14" />
            <pointLight position={[0, 6, -30]} intensity={40} distance={70} decay={1.4} color="#8a2be2" />

            <Suspense fallback={null}>
                <SkyBackdrop />
                {SIM_MODE ? (
                    <SimScene />
                ) : (
                    <>
                        <Bull />
                        <Track />
                    </>
                )}
            </Suspense>

            <EffectComposer>
                <Bloom intensity={1.0} luminanceThreshold={0.25} luminanceSmoothing={0.3} mipmapBlur />
                <Vignette offset={0.28} darkness={0.85} />
            </EffectComposer>
        </Canvas>
    );
}

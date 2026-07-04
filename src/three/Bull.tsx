import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Trail } from '@react-three/drei';
import * as THREE from 'three';
import { Audio } from '../audio';
import {
    refs,
    useGameStore,
    LANE_WIDTH,
    LANE_LERP,
    START_SPEED,
    MAX_SPEED,
    SPEED_GROWTH,
    DASH_DURATION,
    DASH_COOLDOWN,
} from '../store';

export type LegRefs = {
    fl: RefObject<THREE.Group | null>;
    fr: RefObject<THREE.Group | null>;
    bl: RefObject<THREE.Group | null>;
    br: RefObject<THREE.Group | null>;
};

export function Bull() {
    const group = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const fl = useRef<THREE.Group>(null);
    const fr = useRef<THREE.Group>(null);
    const bl = useRef<THREE.Group>(null);
    const br = useRef<THREE.Group>(null);
    const runT = useRef(0);

    useEffect(() => {
        const dash = () => {
            if (useGameStore.getState().phase !== 'playing') return;
            if (refs.elapsed < refs.dashReadyAt) return;
            refs.dashUntil = refs.elapsed + DASH_DURATION;
            refs.dashReadyAt = refs.elapsed + DASH_COOLDOWN;
            refs.invulnUntil = Math.max(refs.invulnUntil, refs.dashUntil);
            refs.shake = Math.max(refs.shake, 0.28);
            Audio.sfx('dash');
        };
        const move = (dir: number) => {
            if (useGameStore.getState().phase !== 'playing') return;
            refs.laneTarget = THREE.MathUtils.clamp(refs.laneTarget + dir, -1, 1);
        };
        const onKey = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            if (k === 'arrowleft' || k === 'a') move(-1);
            else if (k === 'arrowright' || k === 'd') move(1);
            else if (k === 'arrowup' || k === 'w' || k === ' ') dash();
        };
        let sx = 0;
        let sy = 0;
        let st = 0;
        const onTS = (e: TouchEvent) => {
            const t = e.touches[0];
            sx = t.clientX;
            sy = t.clientY;
            st = performance.now();
        };
        const onTE = (e: TouchEvent) => {
            const t = e.changedTouches[0];
            const dx = t.clientX - sx;
            const dy = t.clientY - sy;
            const dt = performance.now() - st;
            if (Math.hypot(dx, dy) < 24 && dt < 250) {
                dash();
                return;
            }
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) move(dx > 0 ? 1 : -1);
            else if (dy < -30) dash();
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('touchstart', onTS, { passive: true });
        window.addEventListener('touchend', onTE, { passive: true });
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('touchstart', onTS);
            window.removeEventListener('touchend', onTE);
        };
    }, []);

    useFrame((state, delta) => {
        const g = group.current;
        if (!g) return;
        const dt = Math.min(delta, 0.05);
        const phase = useGameStore.getState().phase;
        const dashing = refs.elapsed < refs.dashUntil;

        runT.current += dt * (phase === 'playing' ? refs.speed * 0.9 : 8);

        if (phase === 'playing') {
            refs.elapsed += dt;
            refs.speed = Math.min(MAX_SPEED, refs.speed + SPEED_GROWTH * dt);
            refs.pos.z -= refs.speed * dt;
            refs.distance += refs.speed * dt;
            refs.pos.x = THREE.MathUtils.lerp(refs.pos.x, refs.laneTarget * LANE_WIDTH, dt * LANE_LERP);

            const dashPct =
                refs.elapsed >= refs.dashReadyAt
                    ? 1
                    : THREE.MathUtils.clamp(1 - (refs.dashReadyAt - refs.elapsed) / DASH_COOLDOWN, 0, 1);
            useGameStore.getState().tick(refs.speed * dt, refs.distance, dashPct);
        }

        g.position.copy(refs.pos);

        const amp = dashing ? 1.5 : 1.05;
        if (fl.current && fr.current && bl.current && br.current) {
            fl.current.rotation.x = Math.sin(runT.current) * amp;
            br.current.rotation.x = Math.sin(runT.current) * amp;
            fr.current.rotation.x = Math.sin(runT.current + Math.PI) * amp;
            bl.current.rotation.x = Math.sin(runT.current + Math.PI) * amp;
        }
        if (body.current) {
            const xDiff = refs.laneTarget * LANE_WIDTH - refs.pos.x;
            body.current.rotation.z = THREE.MathUtils.lerp(body.current.rotation.z, -xDiff * 0.18, dt * 10);
            body.current.position.y = Math.abs(Math.sin(runT.current)) * 0.14 + (dashing ? 0.12 : 0);
            body.current.scale.z = THREE.MathUtils.lerp(body.current.scale.z, dashing ? 1.14 : 1, dt * 10);
        }

        // blink only for post-hit invuln; stay solid (unstoppable) during Black Cloud
        if (phase === 'playing' && refs.elapsed < refs.invulnUntil && !dashing && refs.elapsed >= refs.cloudUntil) {
            g.visible = Math.floor(refs.elapsed * 20) % 2 === 0;
        } else {
            g.visible = true;
        }

        const cam = state.camera as THREE.PerspectiveCamera;
        const targetFov = dashing ? 76 : Math.min(72, 62 + (refs.speed - START_SPEED) * 0.25);
        cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, dt * 3);
        cam.updateProjectionMatrix();

        const sway = Math.sin(state.clock.elapsedTime * 0.6) * 0.25;
        let camX = refs.pos.x * 0.55 + sway;
        let camY = 4.4;
        if (refs.shake > 0.01) {
            camX += (Math.random() - 0.5) * refs.shake * 2;
            camY += (Math.random() - 0.5) * refs.shake * 2;
            refs.shake = THREE.MathUtils.lerp(refs.shake, 0, dt * 4);
        }
        cam.position.x = THREE.MathUtils.lerp(cam.position.x, camX, dt * 6);
        cam.position.y = THREE.MathUtils.lerp(cam.position.y, camY, dt * 6);
        cam.position.z = refs.pos.z + 8.5;
        cam.lookAt(refs.pos.x * 0.4, 1.4, refs.pos.z - 14);
        cam.rotation.z = THREE.MathUtils.lerp(cam.rotation.z, -(refs.laneTarget * LANE_WIDTH - refs.pos.x) * 0.03, dt * 5);
    });

    return (
        <group ref={group}>
            <pointLight position={[0, 3, 1.6]} intensity={26} distance={12} decay={1.6} color="#cfffe0" />
            <group ref={body}>
                <BullModel legs={{ fl, fr, bl, br }} />
            </group>
            <Trail width={2.4} length={6} color={'#39ff14'} attenuation={(w) => w} decay={1}>
                <mesh position={[0, 1, 1.3]}>
                    <sphereGeometry args={[0.14, 8, 8]} />
                    <meshBasicMaterial color="#39ff14" toneMapped={false} />
                </mesh>
            </Trail>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
                <ringGeometry args={[0.78, 1.2, 32]} />
                <meshBasicMaterial color="#39ff14" transparent opacity={0.55} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <circleGeometry args={[1.15, 32]} />
                <meshBasicMaterial color="black" transparent opacity={0.35} />
            </mesh>
        </group>
    );
}

function Leg({ refObj, x, z }: { refObj: RefObject<THREE.Group | null>; x: number; z: number }) {
    return (
        <group ref={refObj} position={[x, 0.7, z]}>
            <RoundedBox args={[0.28, 0.8, 0.28]} radius={0.08} position={[0, -0.4, 0]} castShadow>
                <meshStandardMaterial color="#0c0c10" metalness={0.4} roughness={0.5} />
            </RoundedBox>
            <mesh position={[0, -0.82, 0]}>
                <boxGeometry args={[0.32, 0.12, 0.34]} />
                <meshStandardMaterial color="#1a1a1f" />
            </mesh>
        </group>
    );
}

export function BullModel({ legs }: { legs: LegRefs }) {
    return (
        <group position={[0, 0, 0]}>
            {/* torso */}
            <RoundedBox args={[1.5, 1.25, 2.4]} radius={0.4} position={[0, 1.45, 0.1]} castShadow>
                <meshStandardMaterial color="#0b0b0f" metalness={0.55} roughness={0.3} emissive="#0c4208" emissiveIntensity={0.55} />
            </RoundedBox>
            {/* shoulder hump */}
            <RoundedBox args={[1.35, 0.6, 1.1]} radius={0.3} position={[0, 2.0, -0.5]} castShadow>
                <meshStandardMaterial color="#0b0b0f" metalness={0.5} roughness={0.35} />
            </RoundedBox>
            {/* head */}
            <group position={[0, 1.55, -1.5]}>
                <RoundedBox args={[1.0, 0.95, 1.0]} radius={0.28} castShadow>
                    <meshStandardMaterial color="#0c0c11" metalness={0.5} roughness={0.35} />
                </RoundedBox>
                {/* snout */}
                <RoundedBox args={[0.7, 0.55, 0.5]} radius={0.18} position={[0, -0.2, -0.6]}>
                    <meshStandardMaterial color="#070709" metalness={0.4} roughness={0.5} />
                </RoundedBox>
                {/* forehead brand */}
                <mesh position={[0, 0.42, -0.5]} rotation={[0, 0, Math.PI / 4]}>
                    <boxGeometry args={[0.2, 0.2, 0.06]} />
                    <meshStandardMaterial color="#39ff14" emissive="#39ff14" emissiveIntensity={4} toneMapped={false} />
                </mesh>
                {/* eyes (emissive red — bloom catches these) */}
                <mesh position={[-0.28, 0.12, -0.45]}>
                    <sphereGeometry args={[0.12, 16, 16]} />
                    <meshStandardMaterial color="#ff2d3a" emissive="#ff2d3a" emissiveIntensity={6} toneMapped={false} />
                </mesh>
                <mesh position={[0.28, 0.12, -0.45]}>
                    <sphereGeometry args={[0.12, 16, 16]} />
                    <meshStandardMaterial color="#ff2d3a" emissive="#ff2d3a" emissiveIntensity={6} toneMapped={false} />
                </mesh>
                {/* horns (emissive green) */}
                <mesh position={[-0.5, 0.55, 0.05]} rotation={[0, 0, 0.7]}>
                    <coneGeometry args={[0.13, 0.95, 12]} />
                    <meshStandardMaterial color="#39ff14" emissive="#39ff14" emissiveIntensity={4} toneMapped={false} />
                </mesh>
                <mesh position={[0.5, 0.55, 0.05]} rotation={[0, 0, -0.7]}>
                    <coneGeometry args={[0.13, 0.95, 12]} />
                    <meshStandardMaterial color="#39ff14" emissive="#39ff14" emissiveIntensity={4} toneMapped={false} />
                </mesh>
            </group>
            {/* tail */}
            <mesh position={[0, 1.5, 1.4]} rotation={[0.5, 0, 0]}>
                <cylinderGeometry args={[0.06, 0.1, 1.0, 8]} />
                <meshStandardMaterial color="#0c0c11" />
            </mesh>
            <Leg refObj={legs.fl} x={-0.55} z={-0.7} />
            <Leg refObj={legs.fr} x={0.55} z={-0.7} />
            <Leg refObj={legs.bl} x={-0.55} z={0.85} />
            <Leg refObj={legs.br} x={0.55} z={0.85} />
        </group>
    );
}

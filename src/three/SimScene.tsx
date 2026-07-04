import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture, Trail } from '@react-three/drei';
import * as THREE from 'three';
import { refs, useGameStore, LANE_WIDTH, START_SPEED } from '../store';
import { Audio } from '../audio';
import { BullModel } from './Bull';
import { Obstacle } from './Obstacles';
import { SimRunner } from '../sim/runner';
import { Act } from '../sim/sim';
import { activeSim } from '../sim/active';

const DASH_CD_TICKS = Math.round(2.2 * 60);

// Sim-driven scene: the render layer reads from a deterministic SimRunner instead
// of computing its own float physics + Math.random spawns. Reuses the exact bull
// and obstacle visuals so it looks identical to the classic path.
export function SimScene() {
    const runId = useGameStore((s) => s.runId);
    const group = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const fl = useRef<THREE.Group>(null);
    const fr = useRef<THREE.Group>(null);
    const bl = useRef<THREE.Group>(null);
    const br = useRef<THREE.Group>(null);
    const runT = useRef(0);
    const runnerRef = useRef<SimRunner | null>(null);
    const [, setVersion] = useState(0);
    const rowSig = useRef(''); // detects when the visible obstacle set changes

    const [groundTex, buildingTex] = useTexture(['/ground.jpg', '/building.jpg']);
    useEffect(() => {
        groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
        groundTex.repeat.set(4, 240);
        groundTex.anisotropy = 8;
        buildingTex.wrapS = buildingTex.wrapT = THREE.RepeatWrapping;
        buildingTex.repeat.set(2, 2);
    }, [groundTex, buildingTex]);

    // Fresh runner per run (created lazily once the server seed is available).
    useEffect(() => {
        runnerRef.current = null;
        activeSim.runner = null;
    }, [runId]);

    // Inputs feed the runner; the sim decides what's legal (dash cooldown, clamps).
    useEffect(() => {
        const move = (dir: number) => {
            if (useGameStore.getState().phase !== 'playing') return;
            runnerRef.current?.input(dir < 0 ? Act.Left : Act.Right);
        };
        const dash = () => {
            if (useGameStore.getState().phase !== 'playing') return;
            runnerRef.current?.input(Act.Dash);
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
            if (Math.hypot(dx, dy) < 24 && dt < 250) return dash();
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

        // Create the runner once the server seed has arrived (a few frames in).
        if (phase === 'playing' && !runnerRef.current && refs.seed) {
            runnerRef.current = new SimRunner(refs.seed);
            activeSim.runner = runnerRef.current;
        }
        const runner = runnerRef.current;

        if (phase === 'playing' && runner) {
            runner.advance(dt);
            const s = runner.state;

            // Map sim state onto refs so the shared visuals + HUD + GameOver work.
            refs.pos.x = runner.playerX;
            refs.pos.z = -runner.distance;
            refs.distance = runner.distance;
            refs.speed = s.speedFP / 65536;
            refs.elapsed = s.tick / 60;
            refs.dashUntil = s.dashUntil / 60;
            refs.invulnUntil = s.invulnUntil / 60;
            refs.laneTarget = s.laneTarget;

            const dashPct = s.tick >= s.dashReadyAt ? 1 : Math.max(0, Math.min(1, 1 - (s.dashReadyAt - s.tick) / DASH_CD_TICKS));
            useGameStore.setState({ score: runner.score, dist: runner.distance, dashPct, hearts: s.hearts, shield: s.shield, combo: s.combo });

            for (const ev of runner.lastEvents) {
                if (ev.type === 'dash') {
                    refs.shake = Math.max(refs.shake, 0.28);
                    Audio.sfx('dash');
                } else if (ev.type === 'powerup') {
                    Audio.sfx('powerup');
                    refs.shake = Math.max(refs.shake, 0.15);
                } else if (ev.type === 'break') {
                    Audio.sfx('break');
                    refs.shake = Math.max(refs.shake, 0.2);
                } else if (ev.type === 'shield') {
                    Audio.sfx('break');
                    refs.shake = Math.max(refs.shake, 0.25);
                } else if (ev.type === 'cloud') {
                    refs.cloudUntil = s.invulnUntil / 60;
                    useGameStore.getState().triggerCloud();
                    Audio.sfx('charge');
                    refs.shake = Math.max(refs.shake, 0.45);
                } else if (ev.type === 'hit') {
                    refs.shake = Math.max(refs.shake, 0.45);
                    Audio.sfx('hit');
                    useGameStore.getState().flashHit();
                } else if (ev.type === 'death') {
                    useGameStore.getState().die(s.deathCause);
                }
            }

            // Re-render obstacles only when the visible set changes.
            const sig = `${s.rows.length}:${s.rows[0]?.index ?? -1}:${s.nextRow}`;
            if (sig !== rowSig.current) {
                rowSig.current = sig;
                setVersion((v) => v + 1);
            }
        }

        const dashing = refs.elapsed < refs.dashUntil;
        runT.current += dt * (phase === 'playing' ? refs.speed * 0.9 : 8);
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

    const rows = runnerRef.current?.rows ?? [];

    return (
        <group>
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
            </group>

            {/* static track */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1900]} receiveShadow>
                <planeGeometry args={[40, 4200]} />
                <meshStandardMaterial map={groundTex} color="#7a7a7a" roughness={0.85} metalness={0.15} />
            </mesh>
            {[-0.5, 0.5].map((o) => (
                <mesh key={o} position={[o * LANE_WIDTH, 0.04, -1900]}>
                    <boxGeometry args={[0.08, 0.02, 4200]} />
                    <meshStandardMaterial color="#39ff14" emissive="#39ff14" emissiveIntensity={1.4} toneMapped={false} />
                </mesh>
            ))}
            {[-1, 1].map((s) => (
                <mesh key={s} position={[s * (LANE_WIDTH * 1.5 + 0.6), 0.6, -1900]}>
                    <boxGeometry args={[0.18, 1.2, 4200]} />
                    <meshStandardMaterial color="#39e6ff" emissive="#39e6ff" emissiveIntensity={1.2} toneMapped={false} />
                </mesh>
            ))}

            {/* obstacles from the sim's upcoming rows */}
            {rows.map((row) =>
                row.cells.map((cell, i) =>
                    cell ? (
                        <group key={`${row.index}-${i}`} position={[(i - 1) * LANE_WIDTH, 0, -row.dist]}>
                            <Obstacle kind={cell.kind as Parameters<typeof Obstacle>[0]['kind']} />
                        </group>
                    ) : null,
                ),
            )}
        </group>
    );
}

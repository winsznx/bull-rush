import { Howl, Howler } from 'howler';

// SFX are synthesized in-browser (Web Audio). Music plays the real mood tracks
// via Howler (streamed with html5 so only the active track loads). One global
// mute drives both.
export type Sfx =
    | 'dash'
    | 'hit'
    | 'break'
    | 'powerup'
    | 'coin'
    | 'quizRight'
    | 'quizWrong'
    | 'charge'
    | 'death';

// Radio modes — mood slots, one licensed track each (see ASSET_PROVENANCE.md).
export const TRACKS = [
    { mode: 'SUPER RUSH', src: '/assets/audio/music/super-rush.mp3' },
    { mode: 'BUTTERFLY WAR', src: '/assets/audio/music/butterfly-war.mp3' },
    { mode: 'NIGHT CLOUD', src: '/assets/audio/music/night-cloud.mp3' },
    { mode: 'GREEN MOTION', src: '/assets/audio/music/green-motion.mp3' },
    { mode: 'VAMP CHARGE', src: '/assets/audio/music/vamp-charge.mp3' },
];

class AudioEngine {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private muted = false;

    private howls: (Howl | null)[] = TRACKS.map(() => null);
    private current = -1;
    private locked = false; // true once the player picks a specific mode (no auto-cycle)

    unlock(): void {
        if (!this.ctx) {
            this.ctx = new AudioContext();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.6;
            this.master.connect(this.ctx.destination);
        } else if (this.ctx.state === 'suspended') {
            void this.ctx.resume();
        }
        if (this.current < 0) this.playTrack(Math.floor(Math.random() * TRACKS.length));
    }

    setMuted(m: boolean): void {
        this.muted = m;
        if (this.master) this.master.gain.value = m ? 0 : 0.6;
        Howler.mute(m);
    }

    get mode(): string {
        return this.current >= 0 ? TRACKS[this.current].mode : '';
    }

    playTrack(i: number): void {
        const next = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
        if (this.current >= 0 && this.howls[this.current]) this.howls[this.current]!.stop();
        this.current = next;
        let h = this.howls[next];
        if (!h) {
            h = new Howl({ src: [TRACKS[next].src], loop: true, volume: 0.45, html5: true });
            this.howls[next] = h;
        }
        h.play();
    }

    // Player picked a specific mode → lock to it (stops auto-cycling between runs).
    setMode(i: number): void {
        this.locked = true;
        this.playTrack(i);
    }

    // Back to AUTO — resume cycling a fresh track each run.
    setAuto(): void {
        this.locked = false;
    }

    cycleMusic(): void {
        if (this.locked) {
            if (this.current < 0) this.playTrack(0);
            return; // keep the chosen mode looping
        }
        if (this.current < 0) this.playTrack(0);
        else this.playTrack(this.current + 1);
    }

    private tone(freq: number, type: OscillatorType, dur: number, vol: number, slideTo?: number, delay = 0): void {
        if (!this.ctx || !this.master) return;
        const t = this.ctx.currentTime + delay;
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + dur + 0.03);
    }

    private noise(dur: number, vol: number): void {
        if (!this.ctx || !this.master) return;
        const t = this.ctx.currentTime;
        const buf = this.ctx.createBuffer(1, Math.max(1, Math.floor(this.ctx.sampleRate * dur)), this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(g).connect(this.master);
        src.start(t);
    }

    sfx(name: Sfx): void {
        if (!this.ctx) return;
        switch (name) {
            case 'dash':
                this.tone(220, 'sawtooth', 0.22, 0.25, 560);
                this.noise(0.1, 0.05);
                break;
            case 'hit':
                this.tone(180, 'square', 0.22, 0.3, 60);
                this.noise(0.16, 0.12);
                break;
            case 'break':
                this.tone(520, 'triangle', 0.12, 0.18, 960);
                break;
            case 'powerup':
                this.tone(440, 'sine', 0.1, 0.18);
                this.tone(660, 'sine', 0.1, 0.18, undefined, 0.08);
                this.tone(880, 'sine', 0.14, 0.18, undefined, 0.16);
                break;
            case 'coin':
                this.tone(880, 'square', 0.08, 0.14, 1320);
                break;
            case 'quizRight':
                this.tone(523, 'sine', 0.12, 0.22);
                this.tone(784, 'sine', 0.16, 0.22, undefined, 0.1);
                break;
            case 'quizWrong':
                this.tone(120, 'square', 0.32, 0.3, 70);
                this.noise(0.12, 0.08);
                break;
            case 'charge':
                this.tone(70, 'sawtooth', 0.7, 0.32, 320);
                this.noise(0.5, 0.1);
                break;
            case 'death':
                this.tone(320, 'sawtooth', 0.7, 0.32, 38);
                this.noise(0.4, 0.12);
                break;
        }
    }
}

export const Audio = new AudioEngine();

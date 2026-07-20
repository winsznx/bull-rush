// Structured JSON logging (Phase 13). One JSON object per line on stdout —
// what Railway (and every log aggregator) ingests natively. Hand-rolled
// deliberately: the interface mirrors pino's (`log.info(fields, msg)`), so
// swapping in pino later is mechanical, but ~60 lines with zero dependencies
// covers everything this service actually needs today.
//
// Redaction is built into the logger, not left to call-site discipline: any
// field whose NAME looks credential-like is masked wherever it appears,
// including in nested objects. A leaked log stream must never be a session
// dump.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

const REDACT_PATTERN = /token|secret|signature|password|cookie|authorization|private|key$/i;
const MAX_DEPTH = 6;

export type LogFields = Record<string, unknown>;

export function redactFields(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return '[deep]';
    if (Array.isArray(value)) return value.map((v) => redactFields(v, depth + 1));
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = REDACT_PATTERN.test(k) ? '[redacted]' : redactFields(v, depth + 1);
        }
        return out;
    }
    return value;
}

function emit(level: LogLevel, context: LogFields, fields: LogFields, msg: string): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;
    const line = JSON.stringify({
        level,
        time: new Date().toISOString(),
        msg,
        ...(redactFields({ ...context, ...fields }) as Record<string, unknown>),
    });
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
}

export interface Logger {
    debug: (fields: LogFields, msg: string) => void;
    info: (fields: LogFields, msg: string) => void;
    warn: (fields: LogFields, msg: string) => void;
    error: (fields: LogFields, msg: string) => void;
    child: (context: LogFields) => Logger;
}

function makeLogger(context: LogFields): Logger {
    return {
        debug: (fields, msg) => emit('debug', context, fields, msg),
        info: (fields, msg) => emit('info', context, fields, msg),
        warn: (fields, msg) => emit('warn', context, fields, msg),
        error: (fields, msg) => emit('error', context, fields, msg),
        child: (extra) => makeLogger({ ...context, ...extra }),
    };
}

export const log = makeLogger({ service: 'bull-rush-api' });

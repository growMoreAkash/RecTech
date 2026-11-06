import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { PUBLIC_KEY, ROLES_KEY } from './decorators';

type Ctor = abstract new (...args: never[]) => unknown;

/** Walks the module graph via Nest's module metadata and returns every controller class. */
function controllersOf(mod: unknown, seen = new Set<unknown>()): Ctor[] {
  if (!mod || seen.has(mod)) return [];
  seen.add(mod);
  const target = (mod as { module?: unknown }).module ?? mod;
  const own = (Reflect.getMetadata('controllers', target) as Ctor[] | undefined) ?? [];
  const imports = (Reflect.getMetadata('imports', target) as unknown[] | undefined) ?? [];
  return [...own, ...imports.flatMap((m) => controllersOf(m, seen))];
}

describe('route security', () => {
  it('every route declares @Roles or @Public (default deny is never the only line of defence)', () => {
    const controllers = controllersOf(AppModule);
    expect(controllers.length).toBeGreaterThan(3);
    const offenders: string[] = [];
    for (const ctrl of controllers) {
      const proto = (ctrl as unknown as { prototype: Record<string, unknown> }).prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        const handler = proto[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue; // not a route
        const marked = [handler, ctrl].some(
          (t) =>
            Reflect.getMetadata(PUBLIC_KEY, t) !== undefined ||
            Reflect.getMetadata(ROLES_KEY, t) !== undefined,
        );
        if (!marked)
          offenders.push(`${ctrl.name}.${key} (${String(Reflect.getMetadata(PATH_METADATA, handler))})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

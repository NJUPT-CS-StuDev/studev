// How long it takes to walk somewhere from here, asked only once someone has allowed location.
import { initialize, Router, type Position } from 'wayfind';
import { loadSpace } from '@/map/model/space';

let router: Promise<Router> | null = null;
const getRouter = () => router ??= Promise.all([loadSpace(), initialize()]).then(([space]) => new Router(space.network));

async function allowedPosition(): Promise<Position | null> {
    try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (status.state !== 'granted') return null;
    } catch { return null; }
    return new Promise(resolve => navigator.geolocation.getCurrentPosition(
        position => resolve([position.coords.longitude, position.coords.latitude]),
        () => resolve(null),
        { maximumAge: 120_000, timeout: 6000 },
    ));
}

/** Walking minutes to a place, or null when it cannot be told. */
export async function walkMinutes(target: string): Promise<number | null> {
    const position = await allowedPosition();
    if (!position) return null;
    try {
        const answer = (await getRouter()).route({ origin: { type: 'position', position }, destination: { type: 'target', id: target }, mode: 'walk', avoid_steps: false, max_snap_distance_m: 100, alternatives: 1 });
        return answer.routes[0] ? Math.max(1, Math.ceil(answer.routes[0].duration_s / 60)) : null;
    } catch { return null; }
}

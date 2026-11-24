// How long it takes to walk somewhere from here, asked only once someone has allowed location.
import { initialize, Router, type Position } from 'wayfind';
import { loadNetwork, loadSpace } from '@/map/model/space';
import { routeContext } from './routes';

let world: Promise<{ space: Awaited<ReturnType<typeof loadSpace>>; router: Router }> | null = null;
const getWorld = () => world ??= Promise.all([
    loadSpace().then(async space => ({ space, network: await loadNetwork(space) })),
    initialize(),
]).then(([{ space, network }]) => ({ space, router: new Router(network) })).catch(error => {
    world = null;
    throw error;
});

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

export interface WalkEstimate { target: string; seconds: number; arrival: string }
/** The published outdoor walk reaches an access point, while the selected room remains the destination. */
export async function walkTo(target: string): Promise<WalkEstimate | null> {
    const position = await allowedPosition();
    if (!position) return null;
    try {
        const { space, router } = await getWorld(), destination = space.byId.get(target);
        if (!destination) return null;
        const answer = router.route({ origin: { type: 'position', position }, destination: destination.routing, mode: 'walk', avoid_steps: false, max_snap_distance_m: 100, alternatives: 1 });
        return answer.routes[0] ? { target, seconds: answer.routes[0].duration_s, arrival: routeContext(undefined, destination, space.byId).arrival } : null;
    } catch { return null; }
}
